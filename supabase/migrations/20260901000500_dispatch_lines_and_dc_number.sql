-- =====================================================================
-- Delivery challans become line-item documents.
--
--  * dc_number is auto-generated (DC-YY-YY/NNNN) — warehouse fills the
--    transporter / vehicle / driver details, not the number.
--  * dispatch_lines record which order line and how much each challan
--    carries, so partial dispatch is tracked by quantity.
--  * sales_order_lines.qty_dispatched is kept in sync by trigger, and
--    the order rollup ("Part dispatched" vs "Dispatched") is derived
--    from whether every line is fully sent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Auto DC number
-- ---------------------------------------------------------------------
create or replace function current_fy() returns text
language sql stable as $$
  select case
    when extract(month from now())::int >= 4
      then to_char(now(), 'YY') || '-' || to_char(now() + interval '1 year', 'YY')
      else to_char(now() - interval '1 year', 'YY') || '-' || to_char(now(), 'YY')
  end
$$;

create sequence if not exists dc_seq;

create or replace function gen_dc_number() returns trigger
language plpgsql as $$
begin
  if new.dc_number is null or btrim(new.dc_number) = '' then
    new.dc_number := 'DC-' || current_fy() || '/' || lpad(nextval('dc_seq')::text, 4, '0');
  end if;
  return new;
end $$;

create trigger aa_dispatches_dc_number before insert on dispatches
  for each row execute function gen_dc_number();

-- ---------------------------------------------------------------------
-- 2. Challan lines
-- ---------------------------------------------------------------------
create table dispatch_lines (
  id                  uuid primary key default gen_random_uuid(),
  dispatch_id         uuid not null references dispatches(id) on delete cascade,
  sales_order_line_id uuid not null references sales_order_lines(id) on delete cascade,
  quantity            numeric(14,3) not null check (quantity > 0),
  unique (dispatch_id, sales_order_line_id)
);
create index idx_dl_dispatch on dispatch_lines(dispatch_id);
create index idx_dl_soline   on dispatch_lines(sales_order_line_id);

alter table dispatch_lines enable row level security;
create policy read_dl  on dispatch_lines for select to authenticated using (true);
create policy write_dl on dispatch_lines for all to authenticated
  using (can_edit_dispatch()) with check (can_edit_dispatch());

alter publication supabase_realtime add table dispatch_lines;
alter publication supabase_realtime add table sales_order_lines;
alter table dispatch_lines replica identity full;

-- ---------------------------------------------------------------------
-- 3. Keep sales_order_lines.qty_dispatched in sync + roll the order up
-- ---------------------------------------------------------------------
create or replace function recompute_line_dispatched() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_line uuid := coalesce(new.sales_order_line_id, old.sales_order_line_id);
  v_so   uuid;
begin
  update sales_order_lines
     set qty_dispatched = coalesce(
       (select sum(quantity) from dispatch_lines where sales_order_line_id = v_line), 0)
   where id = v_line
   returning sales_order_id into v_so;

  if v_so is not null then
    perform recompute_order_ops(v_so);
  end if;
  return null;
end $$;

create trigger dl_recompute after insert or update or delete on dispatch_lines
  for each row execute function recompute_line_dispatched();

-- ---------------------------------------------------------------------
-- 4. Rollup — quantity-driven once challans exist
-- ---------------------------------------------------------------------
create or replace function compute_order_stage(p_so uuid)
returns dispatch_status
language plpgsql stable
set search_path = public
as $$
declare
  ln_total int; ln_full int;
  d_total int; d_deliv int; d_final boolean;
  fully_dispatched boolean;
begin
  select count(*),
         count(*) filter (where quantity > 0 and qty_dispatched >= quantity)
    into ln_total, ln_full
  from sales_order_lines where sales_order_id = p_so;

  select count(*),
         count(*) filter (where delivered_at is not null),
         coalesce(bool_or(is_final), false)
    into d_total, d_deliv, d_final
  from dispatches where sales_order_id = p_so;

  if d_total > 0 then
    -- fully dispatched when every order line is sent, or a challan is
    -- explicitly closed (short-supply accepted), or there are no synced
    -- lines to measure against.
    fully_dispatched := d_final
      or (ln_total > 0 and ln_full = ln_total)
      or ln_total = 0;

    if fully_dispatched and d_deliv = d_total then return 'delivered'; end if;
    if d_deliv > 0                             then return 'partially_delivered'; end if;
    if fully_dispatched                        then return 'dispatched'; end if;
    return 'partially_dispatched';
  end if;

  return 'to_be_ordered';
end $$;

-- Latch the manual pre-dispatch stages too, until the first challan.
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
  if cur in ('ordered', 'in_transit', 'at_warehouse', 'ready_to_dispatch')
     and not has_disp then
    return;
  end if;

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
