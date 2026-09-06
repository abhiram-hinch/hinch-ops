-- =====================================================================
-- SOP operations model.
--
-- Internally: a sales order fans out to N vendor POs (procurement) and,
-- on the way out, to M customer dispatch challans (warehouse).
-- Externally: order_ops.status shows ONE rolled-up stage, computed from
-- those rows — never hand-set, except the latching overrides
-- (on_hold / cancelled / fulfilled) and the manual ready_to_dispatch.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Roles
-- ---------------------------------------------------------------------
create or replace function can_edit_procurement() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth_role() in ('procurement', 'ops', 'admin'), false)
$$;

-- ---------------------------------------------------------------------
-- 1. Vendor POs (procurement side)
-- ---------------------------------------------------------------------
create type warehouse_name  as enum ('hafeezpet', 'goshamahal');
create type vendor_po_stage as enum ('to_order', 'ordered', 'vendor_dispatched', 'received');

create table vendor_pos (
  id                   uuid primary key default gen_random_uuid(),
  sales_order_id       uuid not null references sales_orders(id) on delete cascade,
  vendor_name          text,
  po_number            text,
  stage                vendor_po_stage not null default 'to_order',
  warehouse            warehouse_name,          -- required once received
  expected_date        date,
  ordered_at           timestamptz,
  vendor_dispatched_at timestamptz,
  received_at          timestamptz,
  note                 text,
  created_by           uuid references profiles(id),
  updated_by           uuid references profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint received_needs_warehouse
    check (stage <> 'received' or warehouse is not null)
);
create index idx_vpo_so on vendor_pos(sales_order_id);

-- ---------------------------------------------------------------------
-- 2. Customer dispatch challans (warehouse side)
-- ---------------------------------------------------------------------
create table dispatches (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references sales_orders(id) on delete cascade,
  dc_number      text,
  is_final       boolean not null default false,  -- "this challan completes the order"
  dispatched_at  timestamptz not null default now(),
  delivered_at   timestamptz,
  note           text,
  created_by     uuid references profiles(id),
  updated_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_disp_so on dispatches(sales_order_id);

-- Resume-after-hold needs to know where the order was.
alter table order_ops
  add column if not exists stage_before_hold dispatch_status;

-- ---------------------------------------------------------------------
-- 3. The rollup
-- ---------------------------------------------------------------------

-- Before the customer is involved the order is only as advanced as its
-- slowest PO; once dispatch to the customer starts, partial states take over.
create or replace function compute_order_stage(p_so uuid)
returns dispatch_status
language plpgsql stable
set search_path = public
as $$
declare
  po_total int; po_ordered int; po_vd int; po_recv int;
  d_total int; d_deliv int; d_final boolean;
begin
  select count(*),
         count(*) filter (where stage in ('ordered', 'vendor_dispatched', 'received')),
         count(*) filter (where stage in ('vendor_dispatched', 'received')),
         count(*) filter (where stage = 'received')
    into po_total, po_ordered, po_vd, po_recv
  from vendor_pos where sales_order_id = p_so;

  select count(*),
         count(*) filter (where delivered_at is not null),
         coalesce(bool_or(is_final), false)
    into d_total, d_deliv, d_final
  from dispatches where sales_order_id = p_so;

  if d_total > 0 then
    if d_final and d_deliv = d_total then return 'delivered'; end if;
    if d_deliv > 0                    then return 'partially_delivered'; end if;
    if d_final                        then return 'dispatched'; end if;
    return 'partially_dispatched';
  end if;

  if po_total = 0            then return 'to_be_ordered'; end if;
  if po_recv = po_total      then return 'at_warehouse'; end if;
  if po_vd > 0               then return 'in_transit'; end if;
  if po_ordered = po_total   then return 'ordered'; end if;
  return 'to_be_ordered';
end $$;

-- Apply the rollup unless a latch is holding the status.
create or replace function recompute_order_ops(p_so uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  cur      dispatch_status;
  nextv    dispatch_status;
  has_disp boolean;
begin
  select status into cur from order_ops where sales_order_id = p_so;
  if cur is null then return; end if;
  if cur in ('cancelled', 'on_hold', 'fulfilled') then return; end if;

  select exists(select 1 from dispatches where sales_order_id = p_so) into has_disp;
  -- ready_to_dispatch is a manual warehouse latch; it holds only until the
  -- first customer dispatch exists.
  if cur = 'ready_to_dispatch' and not has_disp then return; end if;

  nextv := compute_order_stage(p_so);
  if nextv is distinct from cur then
    update order_ops set
      status       = nextv,
      status_since = now(),
      updated_at   = now(),
      dispatched_at = case
        when nextv in ('partially_dispatched', 'dispatched', 'partially_delivered', 'delivered')
             and dispatched_at is null then now() else dispatched_at end,
      delivered_at = case
        when nextv = 'delivered' and delivered_at is null then now() else delivered_at end
    where sales_order_id = p_so;
  end if;
end $$;

create or replace function trg_vpo_stamp() returns trigger
language plpgsql as $$
begin
  if new.stage = 'ordered'          and new.ordered_at is null           then new.ordered_at := now(); end if;
  if new.stage = 'vendor_dispatched' and new.vendor_dispatched_at is null then new.vendor_dispatched_at := now(); end if;
  if new.stage = 'received'         and new.received_at is null          then new.received_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;

create trigger vpo_stamp before insert or update on vendor_pos
  for each row execute function trg_vpo_stamp();

create or replace function trg_recompute_from_child() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recompute_order_ops(coalesce(new.sales_order_id, old.sales_order_id));
  return null;
end $$;

create trigger vpo_recompute  after insert or update or delete on vendor_pos
  for each row execute function trg_recompute_from_child();
create trigger disp_recompute after insert or update or delete on dispatches
  for each row execute function trg_recompute_from_child();

create or replace function trg_disp_stamp() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger disp_stamp before update on dispatches
  for each row execute function trg_disp_stamp();

-- ---------------------------------------------------------------------
-- 4. Payment gate — now fires when a customer dispatch is created.
-- ---------------------------------------------------------------------
create or replace function enforce_dispatch_gate_on_dispatch()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total numeric(14,2); v_recv numeric(14,2);
  v_ratio numeric; v_mode text; v_short numeric(14,2);
begin
  select total, amount_received into v_total, v_recv
    from sales_orders where id = new.sales_order_id;

  v_ratio := config_numeric('dispatch_min_paid_ratio');
  v_mode  := config_text('dispatch_gate_mode');
  v_short := (coalesce(v_total, 0) * v_ratio) - coalesce(v_recv, 0);

  if v_short > 0.01 then
    if v_mode = 'hard' then
      raise exception 'Dispatch blocked: short by %. Received % of % required.',
        v_short, v_recv, coalesce(v_total, 0) * v_ratio
        using errcode = 'check_violation';
    else
      perform log_activity(
        new.sales_order_id, 'dispatch', new.id::text, 'dispatch_gate_override',
        null, jsonb_build_object('shortfall', v_short,
                                 'amount_received', v_recv, 'order_total', v_total));
    end if;
  end if;
  return new;
end $$;

create trigger disp_gate before insert on dispatches
  for each row execute function enforce_dispatch_gate_on_dispatch();

-- The old order_ops gate no longer guards customer dispatch (that goes
-- through `dispatches` now). Keep it only for its timestamp/hold-reason
-- housekeeping on a manual status change.
create or replace function enforce_dispatch_gate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  new.status_since := now();
  new.updated_at   := now();
  if new.status = 'dispatched' and new.dispatched_at is null then
    new.dispatched_at := now();
  end if;
  if new.status = 'delivered' and new.delivered_at is null then
    new.delivered_at := now();
  end if;
  if new.status <> 'on_hold' then
    new.hold_reason := null;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
alter table vendor_pos enable row level security;
alter table dispatches enable row level security;

create policy read_vpo  on vendor_pos for select to authenticated using (true);
create policy read_disp on dispatches for select to authenticated using (true);

create policy write_vpo on vendor_pos for all to authenticated
  using (can_edit_procurement()) with check (can_edit_procurement());
create policy write_disp on dispatches for all to authenticated
  using (can_edit_dispatch()) with check (can_edit_dispatch());

alter publication supabase_realtime add table vendor_pos;
alter publication supabase_realtime add table dispatches;
alter table vendor_pos replica identity full;
alter table dispatches replica identity full;

-- ---------------------------------------------------------------------
-- 6. Board view — carry the rollup inputs and refreshed attention rule.
-- Rebuilt (not replaced) because the column list changes mid-way.
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
  (select count(*) from vendor_pos v where v.sales_order_id = so.id) as po_count,
  (select count(*) from vendor_pos v where v.sales_order_id = so.id and v.stage = 'received') as po_received,
  (select count(*) from dispatches d where d.sales_order_id = so.id) as dispatch_count,
  (select count(*) from dispatches d where d.sales_order_id = so.id and d.delivered_at is not null) as delivered_count,
  (
    ops.status = 'on_hold'
    or (ops.status in ('at_warehouse', 'ready_to_dispatch')
        and so.total - so.amount_received > 0.01)
    or (
      ops.status in ('to_be_ordered', 'ordered', 'in_transit', 'at_warehouse',
                     'ready_to_dispatch', 'partially_dispatched', 'partially_delivered')
      and extract(day from now() - ops.status_since)::int >= 3
    )
  ) as needs_attention
from sales_orders so
join order_ops ops on ops.sales_order_id = so.id
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
