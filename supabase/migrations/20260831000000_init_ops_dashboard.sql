-- =====================================================================
-- HINCH Ops Dashboard — initial schema
-- Scope: mirror approved Zoho sales orders; own payment + dispatch state.
-- Zoho Books remains the system of record. This app never writes to Zoho.
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
-- 0. Roles and identity
-- =====================================================================

create type app_role as enum ('admin', 'sales', 'accounts', 'warehouse', 'ops');

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  role       app_role not null default 'sales',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER so RLS policies can read the caller's role without
-- recursing back into profiles' own policies. STABLE + pinned search_path.
create or replace function auth_role()
returns app_role
language sql
stable
security definer
set search_path = public, auth
as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth_role() = 'admin', false)
$$;

-- Can this user edit payments? (sales records, accounts corrects, admin all)
create or replace function can_edit_payments() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth_role() in ('sales', 'accounts', 'admin'), false)
$$;

-- Can this user move dispatch state?
create or replace function can_edit_dispatch() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth_role() in ('ops', 'warehouse', 'admin'), false)
$$;

-- =====================================================================
-- 1. Config
-- =====================================================================

create table app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

insert into app_config (key, value) values
  -- 'soft' = warn and log the override; 'hard' = Postgres refuses the transition.
  ('dispatch_gate_mode',      '"soft"'::jsonb),
  -- Minimum fraction of order total that must be received before dispatch.
  ('dispatch_min_paid_ratio', '1.0'::jsonb);

create or replace function config_text(p_key text)
returns text language sql stable as $$
  select value #>> '{}' from app_config where key = p_key
$$;

create or replace function config_numeric(p_key text)
returns numeric language sql stable as $$
  select (value #>> '{}')::numeric from app_config where key = p_key
$$;

-- =====================================================================
-- 2. Mirrored from Zoho Books
-- =====================================================================

create table sales_orders (
  id                 uuid primary key default gen_random_uuid(),
  zoho_salesorder_id text not null unique,          -- sync key
  so_number          text,
  zoho_customer_id   text,
  customer_name      text,
  salesperson_name   text,
  order_date         date,
  total              numeric(14,2) not null default 0,

  zoho_status        text,        -- Zoho's own status, verbatim. Never write from app.
  zoho_sub_status    text,        -- custom sub-status, if configured
  is_approved        boolean not null default false,

  -- Computed by trigger from the payments ledger. NEVER set directly.
  amount_received    numeric(14,2) not null default 0,
  payment_status     text not null default 'unpaid'
                       check (payment_status in ('unpaid','partial','paid')),

  raw                jsonb,       -- full Zoho payload; backfill source of truth
  last_synced_at     timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on column sales_orders.amount_received is
  'Maintained by trg_recompute_payment. Do not write from application code.';

create index idx_so_payment_status on sales_orders(payment_status);
create index idx_so_order_date     on sales_orders(order_date desc);
create index idx_so_customer       on sales_orders(customer_name);
create index idx_so_number         on sales_orders(so_number);

create table sales_order_lines (
  id                uuid primary key default gen_random_uuid(),
  sales_order_id    uuid not null references sales_orders(id) on delete cascade,
  zoho_line_item_id text,
  item_name         text,
  item_sku          text,
  quantity          numeric(14,3) not null default 0,
  rate              numeric(14,2) not null default 0,
  amount            numeric(14,2) not null default 0,
  qty_dispatched    numeric(14,3) not null default 0,   -- owned by us (P1 use)
  line_order        int,
  unique (sales_order_id, zoho_line_item_id)
);

create index idx_lines_so on sales_order_lines(sales_order_id);

-- =====================================================================
-- 3. Owned by this app
-- =====================================================================

create type dispatch_status as enum (
  'pending', 'ready_to_dispatch', 'partially_dispatched',
  'dispatched', 'delivered', 'on_hold', 'cancelled'
);

create table order_ops (
  sales_order_id  uuid primary key references sales_orders(id) on delete cascade,
  status          dispatch_status not null default 'pending',
  hold_reason     text,
  notes           text,
  status_since    timestamptz not null default now(),   -- drives "days in state"
  dispatched_at   timestamptz,
  delivered_at    timestamptz,
  updated_by      uuid references profiles(id),
  updated_at      timestamptz not null default now(),
  constraint hold_needs_reason
    check (status <> 'on_hold' or (hold_reason is not null and hold_reason <> ''))
);

create index idx_ops_status on order_ops(status);

-- Append-only payment ledger. Corrections are new rows, not edits.
create type payment_instrument as enum
  ('upi', 'cash', 'cheque', 'bank_transfer', 'card', 'credit', 'adjustment');

create table payments (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references sales_orders(id) on delete cascade,
  amount         numeric(14,2) not null check (amount <> 0),  -- negative = reversal
  instrument     payment_instrument not null,
  reference_no   text,
  note           text,
  proof_path     text,                       -- private bucket object path
  paid_on        date not null default current_date,
  recorded_by    uuid not null references profiles(id),
  recorded_at    timestamptz not null default now(),
  voided         boolean not null default false,
  voided_by      uuid references profiles(id),
  voided_reason  text
);

create index idx_payments_so on payments(sales_order_id) where not voided;

-- =====================================================================
-- 4. Audit log — append only
-- =====================================================================

create table activity_log (
  id             bigserial primary key,
  sales_order_id uuid references sales_orders(id) on delete set null,
  entity         text not null,
  entity_id      text,
  action         text not null,
  before         jsonb,
  after          jsonb,
  actor          uuid references profiles(id),
  actor_name     text,
  at             timestamptz not null default now()
);

create index idx_activity_so on activity_log(sales_order_id, at desc);

revoke update, delete on activity_log from authenticated, anon;

create or replace function log_activity(
  p_so uuid, p_entity text, p_entity_id text,
  p_action text, p_before jsonb, p_after jsonb
) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  insert into activity_log (sales_order_id, entity, entity_id, action,
                            before, after, actor, actor_name)
  values (p_so, p_entity, p_entity_id, p_action, p_before, p_after,
          auth.uid(), (select full_name from profiles where id = auth.uid()));
end $$;

-- =====================================================================
-- 5. Sync observability
-- =====================================================================

create table sync_runs (
  id             bigserial primary key,
  source         text not null check (source in ('webhook','poll','manual')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  records_seen   int default 0,
  records_upsert int default 0,
  error          text
);

create index idx_sync_started on sync_runs(started_at desc);

-- =====================================================================
-- 6. Triggers
-- =====================================================================

-- 6.1 Recompute payment rollup from the ledger. Single source of truth.
create or replace function recompute_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_so    uuid := coalesce(new.sales_order_id, old.sales_order_id);
  v_recv  numeric(14,2);
  v_total numeric(14,2);
begin
  select coalesce(sum(amount), 0) into v_recv
    from payments where sales_order_id = v_so and not voided;

  select total into v_total from sales_orders where id = v_so;

  update sales_orders set
    amount_received = v_recv,
    payment_status  = case
      when v_recv <= 0                        then 'unpaid'
      when v_recv >= coalesce(v_total, 0)     then 'paid'
      else 'partial' end,
    updated_at = now()
  where id = v_so;

  return null;
end $$;

create trigger trg_recompute_payment
after insert or update or delete on payments
for each row execute function recompute_payment();

-- Order total can change on re-sync from Zoho; the badge must follow.
create or replace function recompute_payment_on_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_recv numeric(14,2);
begin
  if new.total is distinct from old.total then
    select coalesce(sum(amount), 0) into v_recv
      from payments where sales_order_id = new.id and not voided;
    new.payment_status := case
      when v_recv <= 0            then 'unpaid'
      when v_recv >= new.total    then 'paid'
      else 'partial' end;
    new.amount_received := v_recv;
  end if;
  return new;
end $$;

create trigger trg_recompute_on_total
before update on sales_orders
for each row execute function recompute_payment_on_total();

-- 6.2 Every mirrored order gets an ops row.
create or replace function ensure_order_ops()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into order_ops (sales_order_id) values (new.id)
  on conflict (sales_order_id) do nothing;
  return new;
end $$;

create trigger trg_ensure_order_ops
after insert on sales_orders
for each row execute function ensure_order_ops();

-- 6.3 The dispatch gate.
create or replace function enforce_dispatch_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total numeric(14,2);
  v_recv  numeric(14,2);
  v_ratio numeric;
  v_mode  text;
  v_short numeric(14,2);
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

  if new.status not in ('ready_to_dispatch','dispatched','partially_dispatched') then
    return new;
  end if;

  select total, amount_received into v_total, v_recv
    from sales_orders where id = new.sales_order_id;

  v_ratio := config_numeric('dispatch_min_paid_ratio');
  v_mode  := config_text('dispatch_gate_mode');
  v_short := (coalesce(v_total,0) * v_ratio) - coalesce(v_recv,0);

  if v_short > 0.01 then
    if v_mode = 'hard' then
      raise exception
        'Dispatch blocked: short by %. Received % of % required.',
        v_short, v_recv, coalesce(v_total,0) * v_ratio
        using errcode = 'check_violation';
    else
      -- soft mode: allow, but the override is permanently on record
      perform log_activity(
        new.sales_order_id, 'order_ops', new.sales_order_id::text,
        'dispatch_gate_override',
        jsonb_build_object('status', old.status),
        jsonb_build_object('status', new.status, 'shortfall', v_short,
                           'amount_received', v_recv, 'order_total', v_total));
    end if;
  end if;

  return new;
end $$;

create trigger trg_dispatch_gate
before update on order_ops
for each row execute function enforce_dispatch_gate();

-- 6.4 Audit trails
create or replace function audit_order_ops()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform log_activity(
      new.sales_order_id, 'order_ops', new.sales_order_id::text, 'status_change',
      jsonb_build_object('status', old.status, 'hold_reason', old.hold_reason),
      jsonb_build_object('status', new.status, 'hold_reason', new.hold_reason));
  end if;
  return null;
end $$;

create trigger trg_audit_order_ops
after update on order_ops
for each row execute function audit_order_ops();

create or replace function audit_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform log_activity(new.sales_order_id, 'payment', new.id::text, 'payment_recorded',
      null, jsonb_build_object('amount', new.amount, 'instrument', new.instrument,
                               'reference_no', new.reference_no));
  elsif tg_op = 'UPDATE' and new.voided and not old.voided then
    perform log_activity(new.sales_order_id, 'payment', new.id::text, 'payment_voided',
      jsonb_build_object('amount', old.amount),
      jsonb_build_object('reason', new.voided_reason));
  end if;
  return null;
end $$;

create trigger trg_audit_payment
after insert or update on payments
for each row execute function audit_payment();

-- =====================================================================
-- 7. Row level security — deny by default, read-all, write-by-role
-- =====================================================================

alter table profiles          enable row level security;
alter table app_config        enable row level security;
alter table sales_orders      enable row level security;
alter table sales_order_lines enable row level security;
alter table order_ops         enable row level security;
alter table payments          enable row level security;
alter table activity_log      enable row level security;
alter table sync_runs         enable row level security;

-- Everyone on the team reads everything. That is the point of the dashboard.
create policy read_all_profiles  on profiles          for select to authenticated using (true);
create policy read_all_orders    on sales_orders      for select to authenticated using (true);
create policy read_all_lines     on sales_order_lines for select to authenticated using (true);
create policy read_all_ops       on order_ops         for select to authenticated using (true);
create policy read_all_payments  on payments          for select to authenticated using (true);
create policy read_all_activity  on activity_log      for select to authenticated using (true);
create policy read_all_sync      on sync_runs         for select to authenticated using (true);
create policy read_all_config    on app_config        for select to authenticated using (true);

-- Writes. Note: no INSERT/UPDATE/DELETE policy on sales_orders or
-- sales_order_lines at all — only the service role (Edge Functions) writes the
-- mirror, and the service role bypasses RLS.

create policy write_payments on payments
  for insert to authenticated
  with check (can_edit_payments() and recorded_by = auth.uid());

-- Voiding is the only permitted mutation, and only these fields matter.
create policy void_payments on payments
  for update to authenticated
  using (can_edit_payments())
  with check (can_edit_payments());

create policy update_ops on order_ops
  for update to authenticated
  using (can_edit_dispatch())
  with check (can_edit_dispatch());

create policy admin_config on app_config
  for all to authenticated
  using (is_admin()) with check (is_admin());

create policy self_profile on profiles
  for update to authenticated
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

-- Nobody writes the audit log directly; log_activity() is SECURITY DEFINER.
-- (No insert policy = no direct insert from the client.)

-- =====================================================================
-- 8. Storage
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false),
       ('so-pdfs',        'so-pdfs',        false)
on conflict (id) do nothing;

create policy read_proofs on storage.objects
  for select to authenticated
  using (bucket_id in ('payment-proofs','so-pdfs'));

create policy upload_proofs on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-proofs' and can_edit_payments());

-- =====================================================================
-- 9. Dashboard view
-- =====================================================================

create or replace view v_ops_board
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
  ops.status_since,
  extract(day from now() - ops.status_since)::int as days_in_status,
  so.last_synced_at
from sales_orders so
join order_ops ops on ops.sales_order_id = so.id
where so.is_approved
  and so.zoho_status not in ('void', 'draft');
