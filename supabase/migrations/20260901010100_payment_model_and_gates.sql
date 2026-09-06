-- =====================================================================
-- Payment model + two-gate ops workflow
--
-- - A recorded payment is not cleared money. Only `clearance_status =
--   'cleared'` counts toward amount_received. Accounts confirms.
-- - Credit standing is a customer property, not an order status.
-- - Procurement gate is ADVISORY (logs, never blocks).
-- - Dispatch gate is real: needs fully_paid OR credit_regular;
--   credit_hold hard-blocks in both modes.
--
-- No expenses table, no settlements ledger (deferred). `received_by`
-- tracks who holds the cash for when that ledger is built.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. New enums
-- ---------------------------------------------------------------------
create type payment_method as enum (
  'cash', 'upi', 'card_pos', 'bank_transfer', 'cheque', 'demand_draft',
  'payment_gateway', 'emi_finance', 'credit_note', 'advance_adjustment',
  'tds_deducted', 'write_off'
);
create type transfer_rail     as enum ('neft', 'rtgs', 'imps', 'other');
create type card_network       as enum ('visa', 'mastercard', 'rupay', 'amex', 'diners', 'other');
create type clearance_status   as enum ('pending', 'cleared', 'bounced', 'reversed');
create type credit_status      as enum ('none', 'credit_regular', 'credit_hold');
create type bank_account_kind  as enum ('bank', 'cash_box', 'gateway_settlement');

-- ---------------------------------------------------------------------
-- 2. Bank accounts / cash boxes
-- ---------------------------------------------------------------------
create table bank_accounts (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  kind       bank_account_kind not null default 'bank',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table bank_accounts enable row level security;
create policy read_bank_accounts  on bank_accounts for select to authenticated using (true);
create policy write_bank_accounts on bank_accounts for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- 3. Customers — mirrored from Zoho, credit dimension owned by us
-- ---------------------------------------------------------------------
create table customers (
  id              uuid primary key default gen_random_uuid(),
  zoho_contact_id text unique,
  name            text,
  credit_status   credit_status not null default 'none',
  credit_limit    numeric(14,2),
  credit_days     int,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_customers_zoho on customers(zoho_contact_id);

alter table customers enable row level security;
create policy read_customers  on customers for select to authenticated using (true);
-- Accounts / admin own the credit fields. Sync writes via the service role.
create policy write_customers on customers for all to authenticated
  using (coalesce(auth_role() in ('accounts', 'admin'), false))
  with check (coalesce(auth_role() in ('accounts', 'admin'), false));

alter table sales_orders add column if not exists customer_id uuid references customers(id);
create index idx_so_customer_id on sales_orders(customer_id);

-- backfill: one customer per distinct Zoho contact
insert into customers (zoho_contact_id, name)
select distinct on (zoho_customer_id) zoho_customer_id, customer_name
from sales_orders
where zoho_customer_id is not null and btrim(zoho_customer_id) <> ''
order by zoho_customer_id, order_date desc
on conflict (zoho_contact_id) do nothing;

update sales_orders s set customer_id = c.id
from customers c
where c.zoho_contact_id = s.zoho_customer_id and s.customer_id is null;

-- ---------------------------------------------------------------------
-- 4. sales_orders: pending-clearance total + new payment_status values
-- ---------------------------------------------------------------------
alter table sales_orders
  add column if not exists amount_pending_clearance numeric(14,2) not null default 0;

-- Old check (unpaid|partial|paid) is dropped up front; the new one is
-- added at the end of section 8 once every row holds a new value.
alter table sales_orders drop constraint if exists sales_orders_payment_status_check;

-- ---------------------------------------------------------------------
-- 5. payments: method, custody, clearance, method-specific fields
-- ---------------------------------------------------------------------
alter table payments
  add column payment_method   payment_method,
  add column received_by       uuid references profiles(id),
  add column clearance_status  clearance_status not null default 'pending',
  add column cleared_on        date,
  add column cleared_by        uuid references profiles(id),
  add column deposited_to      uuid references bank_accounts(id),
  add column transfer_rail     transfer_rail,
  add column card_network      card_network,
  add column card_last4        text,
  add column cheque_date       date,
  add column drawee_bank       text,
  add column fee_amount        numeric(14,2) not null default 0,
  add column approved_by       uuid references profiles(id),
  add column source            text not null default 'manual';

alter table payments add constraint card_last4_len
  check (card_last4 is null or char_length(card_last4) = 4);
alter table payments add constraint writeoff_needs_approver
  check (payment_method is distinct from 'write_off' or approved_by is not null);

-- migrate instrument -> payment_method
update payments set payment_method = case instrument
  when 'upi'           then 'upi'
  when 'cash'          then 'cash'
  when 'cheque'        then 'cheque'
  when 'bank_transfer' then 'bank_transfer'
  when 'card'          then 'card_pos'
  when 'credit'        then 'credit_note'
  when 'adjustment'    then 'advance_adjustment'
end::payment_method;
alter table payments alter column payment_method set not null;

-- custody: fall back to whoever recorded it
update payments set received_by = recorded_by where received_by is null;
alter table payments alter column received_by set not null;

-- every historical payment was already counted -> treat as cleared
update payments
  set clearance_status = 'cleared', cleared_on = paid_on, cleared_by = recorded_by
where clearance_status = 'pending';

-- receipts become one-to-many
create table payment_receipts (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null references payments(id) on delete cascade,
  storage_path text not null,
  uploaded_by  uuid references profiles(id),
  uploaded_at  timestamptz not null default now()
);
create index idx_receipts_payment on payment_receipts(payment_id);

alter table payment_receipts enable row level security;
create policy read_receipts  on payment_receipts for select to authenticated using (true);
create policy write_receipts on payment_receipts for insert to authenticated
  with check (can_edit_payments());

insert into payment_receipts (payment_id, storage_path, uploaded_by, uploaded_at)
select id, proof_path, recorded_by, recorded_at
from payments where proof_path is not null and btrim(proof_path) <> '';

alter table payments drop column proof_path;

-- ---------------------------------------------------------------------
-- 6. Clearance defaults on insert
-- ---------------------------------------------------------------------
create or replace function set_payment_clearance_default()
returns trigger language plpgsql as $$
begin
  new.clearance_status := case new.payment_method
    when 'cash'               then 'cleared'
    when 'upi'                then 'cleared'
    when 'credit_note'       then 'cleared'
    when 'advance_adjustment' then 'cleared'
    when 'tds_deducted'      then 'cleared'
    when 'write_off'         then 'cleared'
    else 'pending'
  end::clearance_status;

  if new.clearance_status = 'cleared' then
    new.cleared_on := coalesce(new.cleared_on, new.paid_on, current_date);
    new.cleared_by := coalesce(new.cleared_by, new.recorded_by);
  end if;
  return new;
end $$;

create trigger trg_payment_clearance_default
  before insert on payments
  for each row execute function set_payment_clearance_default();

-- ---------------------------------------------------------------------
-- 7. Only accounts / admin may confirm or bounce a payment
-- ---------------------------------------------------------------------
create or replace function guard_payment_clearance()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if new.clearance_status is distinct from old.clearance_status then
    if not coalesce(auth_role() in ('accounts', 'admin'), false) then
      raise exception 'Only accounts can confirm or bounce a payment'
        using errcode = 'insufficient_privilege';
    end if;
    if new.clearance_status = 'cleared' then
      new.cleared_on := coalesce(new.cleared_on, current_date);
      new.cleared_by := coalesce(new.cleared_by, auth.uid());
    end if;
    if new.clearance_status = 'bounced' then
      new.cleared_by := coalesce(new.cleared_by, auth.uid());
    end if;
  end if;
  return new;
end $$;

create trigger trg_guard_payment_clearance
  before update on payments
  for each row execute function guard_payment_clearance();

-- ---------------------------------------------------------------------
-- 8. Recompute: only CLEARED money counts
-- ---------------------------------------------------------------------
create or replace function recompute_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_so      uuid := coalesce(new.sales_order_id, old.sales_order_id);
  v_recv    numeric(14,2);
  v_pending numeric(14,2);
  v_total   numeric(14,2);
  v_status  text;
begin
  select
    coalesce(sum(amount) filter (where clearance_status = 'cleared' and not voided), 0),
    coalesce(sum(amount) filter (where clearance_status = 'pending' and not voided), 0)
  into v_recv, v_pending
  from payments where sales_order_id = v_so;

  select total into v_total from sales_orders where id = v_so;

  v_status := case
    when v_recv <= 0                      then 'pending'
    when v_recv >  coalesce(v_total, 0) + 1 then 'overpaid'
    when v_recv >= coalesce(v_total, 0)   then 'fully_paid'
    else 'advance_paid'
  end;

  update sales_orders set
    amount_received          = v_recv,
    amount_pending_clearance = v_pending,
    payment_status           = v_status,
    updated_at               = now()
  where id = v_so;

  -- Auto-advance out of awaiting_clearance once real money lands.
  if v_status in ('advance_paid', 'fully_paid', 'overpaid') then
    update order_ops
      set status = 'to_be_ordered', status_since = now(), updated_at = now()
    where sales_order_id = v_so and status = 'awaiting_clearance';
  end if;

  return null;
end $$;

create or replace function recompute_payment_on_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_recv numeric(14,2);
begin
  if new.total is distinct from old.total then
    select coalesce(sum(amount) filter (where clearance_status = 'cleared' and not voided), 0)
      into v_recv
    from payments where sales_order_id = new.id;
    new.amount_received := v_recv;
    new.payment_status := case
      when v_recv <= 0            then 'pending'
      when v_recv >  new.total + 1 then 'overpaid'
      when v_recv >= new.total    then 'fully_paid'
      else 'advance_paid'
    end;
  end if;
  return new;
end $$;

-- one-time recompute for existing data
update sales_orders so set
  amount_received = coalesce((
    select sum(amount) from payments p
    where p.sales_order_id = so.id and p.clearance_status = 'cleared' and not p.voided), 0),
  amount_pending_clearance = coalesce((
    select sum(amount) from payments p
    where p.sales_order_id = so.id and p.clearance_status = 'pending' and not p.voided), 0);

update sales_orders set payment_status = case
  when amount_received <= 0             then 'pending'
  when amount_received >  total + 1     then 'overpaid'
  when amount_received >= total         then 'fully_paid'
  else 'advance_paid'
end;

alter table sales_orders alter column payment_status set default 'pending';
alter table sales_orders add constraint sales_orders_payment_status_check
  check (payment_status in ('pending', 'advance_paid', 'fully_paid', 'overpaid'));

-- ---------------------------------------------------------------------
-- 9. Audit — reference payment_method, and log clearance changes
-- ---------------------------------------------------------------------
create or replace function audit_payment()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.sales_order_id, 'payment', new.id::text, 'payment_recorded',
      null, jsonb_build_object('amount', new.amount, 'method', new.payment_method,
                               'reference_no', new.reference_no,
                               'clearance_status', new.clearance_status));
  elsif tg_op = 'UPDATE' then
    if new.voided and not old.voided then
      perform log_activity(new.sales_order_id, 'payment', new.id::text, 'payment_voided',
        jsonb_build_object('amount', old.amount),
        jsonb_build_object('reason', new.voided_reason));
    elsif new.clearance_status is distinct from old.clearance_status then
      perform log_activity(new.sales_order_id, 'payment', new.id::text,
        'payment_' || new.clearance_status,
        jsonb_build_object('clearance_status', old.clearance_status),
        jsonb_build_object('clearance_status', new.clearance_status,
                           'amount', new.amount, 'by', auth.uid()));
    end if;
  end if;
  return null;
end $$;

alter table payments drop column instrument;

-- ---------------------------------------------------------------------
-- 10. Config — procurement (advisory) + dispatch gate modes
-- ---------------------------------------------------------------------
insert into app_config (key, value) values
  ('procurement_gate_mode',      '"soft"'::jsonb),
  ('procurement_min_paid_ratio', '0.25'::jsonb)
on conflict (key) do nothing;

delete from app_config where key = 'dispatch_min_paid_ratio';

-- ---------------------------------------------------------------------
-- 11. The two gates
-- ---------------------------------------------------------------------

-- order_ops status change: timestamps + procurement (advisory) + dispatch gate
create or replace function enforce_dispatch_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total  numeric(14,2);
  v_recv   numeric(14,2);
  v_pstat  text;
  v_credit credit_status;
  v_mode   text;
  v_ratio  numeric;
  v_short  numeric(14,2);
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  new.status_since := now();
  new.updated_at   := now();
  if new.status = 'dispatched' and new.dispatched_at is null then new.dispatched_at := now(); end if;
  if new.status = 'delivered'  and new.delivered_at  is null then new.delivered_at  := now(); end if;
  if new.status <> 'on_hold' then new.hold_reason := null; end if;

  select so.total, so.amount_received, so.payment_status, coalesce(c.credit_status, 'none')
    into v_total, v_recv, v_pstat, v_credit
  from sales_orders so
  left join customers c on c.id = so.customer_id
  where so.id = new.sales_order_id;

  -- Procurement gate — ADVISORY. Never blocks; just records the shortfall.
  if new.status = 'ordered' then
    v_ratio := coalesce(config_numeric('procurement_min_paid_ratio'), 0);
    v_short := (coalesce(v_total, 0) * v_ratio) - coalesce(v_recv, 0);
    if v_short > 0.01 and v_credit <> 'credit_regular' then
      perform log_activity(new.sales_order_id, 'order_ops', new.sales_order_id::text,
        'procurement_gate_override',
        jsonb_build_object('status', old.status),
        jsonb_build_object('status', new.status, 'shortfall', v_short,
          'amount_cleared', v_recv, 'order_total', v_total, 'credit_status', v_credit));
    end if;
  end if;

  -- Dispatch gate — real.
  if new.status in ('ready_to_dispatch', 'partially_dispatched', 'dispatched') then
    if v_credit = 'credit_hold' then
      raise exception 'Dispatch blocked: customer is on credit hold.'
        using errcode = 'check_violation';
    end if;
    if v_credit <> 'credit_regular' and v_pstat <> 'fully_paid' then
      v_short := coalesce(v_total, 0) - coalesce(v_recv, 0);
      v_mode  := config_text('dispatch_gate_mode');
      if v_mode = 'hard' then
        raise exception 'Dispatch blocked: % still due (cleared % of %).',
          v_short, v_recv, coalesce(v_total, 0) using errcode = 'check_violation';
      else
        perform log_activity(new.sales_order_id, 'order_ops', new.sales_order_id::text,
          'dispatch_gate_override',
          jsonb_build_object('status', old.status),
          jsonb_build_object('status', new.status, 'shortfall', v_short,
            'amount_cleared', v_recv, 'order_total', v_total, 'credit_status', v_credit));
      end if;
    end if;
  end if;

  return new;
end $$;

-- creating a delivery challan = a dispatch: same gate
create or replace function enforce_dispatch_gate_on_dispatch()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total  numeric(14,2);
  v_recv   numeric(14,2);
  v_pstat  text;
  v_credit credit_status;
  v_mode   text;
  v_short  numeric(14,2);
begin
  select so.total, so.amount_received, so.payment_status, coalesce(c.credit_status, 'none')
    into v_total, v_recv, v_pstat, v_credit
  from sales_orders so
  left join customers c on c.id = so.customer_id
  where so.id = new.sales_order_id;

  if v_credit = 'credit_hold' then
    raise exception 'Dispatch blocked: customer is on credit hold.'
      using errcode = 'check_violation';
  end if;
  if v_credit <> 'credit_regular' and v_pstat <> 'fully_paid' then
    v_short := coalesce(v_total, 0) - coalesce(v_recv, 0);
    v_mode  := config_text('dispatch_gate_mode');
    if v_mode = 'hard' then
      raise exception 'Dispatch blocked: % still due.', v_short
        using errcode = 'check_violation';
    else
      perform log_activity(new.sales_order_id, 'dispatch', new.id::text, 'dispatch_gate_override',
        null, jsonb_build_object('shortfall', v_short, 'amount_cleared', v_recv,
          'order_total', v_total, 'credit_status', v_credit));
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 12. Start orders in awaiting_clearance
-- ---------------------------------------------------------------------
alter table order_ops alter column status set default 'awaiting_clearance';

update order_ops o set status = 'awaiting_clearance', status_since = now()
from sales_orders s
where s.id = o.sales_order_id
  and o.status = 'to_be_ordered'
  and s.payment_status = 'pending';

-- ---------------------------------------------------------------------
-- 13. Views
-- ---------------------------------------------------------------------
drop view if exists v_ops_board_totals;
drop view if exists v_ops_board;

create view v_ops_board
with (security_invoker = true) as
select
  so.id,
  so.so_number,
  so.order_date,
  so.customer_name,
  so.salesperson_name,
  so.total,
  so.amount_received,
  so.amount_pending_clearance,
  so.total - so.amount_received as balance_due,
  so.payment_status,
  so.zoho_status,
  ops.status        as dispatch_status,
  ops.hold_reason,
  ops.stage_before_hold,
  ops.status_since,
  extract(day from now() - ops.status_since)::int as days_in_status,
  so.last_synced_at,
  so.quotation_ref,
  so.zoho_salesorder_id,
  so.zoho_shipped_status,
  so.zoho_invoiced_status,
  so.delivery_date,
  so.total_quantity,
  so.ship_to,
  so.contact_phone,
  so.contact_email,
  so.notes,
  so.so_pdf_path,
  so.detail_synced_at,
  so.quotation_ref_override,
  coalesce(c.credit_status, 'none')::text as customer_credit_status,
  c.credit_days,
  (
    c.credit_status in ('credit_regular', 'credit_hold')
    and (so.total - so.amount_received) > 0.01
    and (so.order_date + coalesce(c.credit_days, 0)) < current_date
  ) as is_overdue,
  (
    ops.status = 'on_hold'
    or (ops.status in ('at_warehouse', 'ready_to_dispatch')
        and so.total - so.amount_received > 0.01)
    or (
      ops.status in ('awaiting_clearance', 'to_be_ordered', 'ordered', 'in_transit',
                     'at_warehouse', 'ready_to_dispatch', 'partially_dispatched',
                     'partially_delivered')
      and extract(day from now() - ops.status_since)::int >= 3
    )
  ) as needs_attention
from sales_orders so
join order_ops ops on ops.sales_order_id = so.id
left join customers c on c.id = so.customer_id
where so.is_approved
  and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval');

create view v_ops_board_totals
with (security_invoker = true) as
select dispatch_status::text as key, count(*)::int as count,
       coalesce(sum(total), 0)::float8 as value
from v_ops_board
group by dispatch_status
union all
select 'attention', count(*)::int, coalesce(sum(total), 0)::float8
from v_ops_board
where needs_attention;

-- Accounts' daily reconcile queue.
create view v_payment_queue
with (security_invoker = true) as
select
  p.id,
  p.sales_order_id,
  p.amount,
  p.payment_method,
  p.reference_no,
  p.paid_on,
  p.recorded_at,
  p.received_by,
  rb.full_name as received_by_name,
  p.note,
  s.so_number,
  s.customer_name,
  s.total,
  coalesce(c.credit_status, 'none')::text as customer_credit_status
from payments p
join sales_orders s on s.id = p.sales_order_id
left join customers c on c.id = s.customer_id
left join profiles rb on rb.id = p.received_by
where p.clearance_status = 'pending' and not p.voided
order by p.paid_on asc, p.recorded_at asc;
