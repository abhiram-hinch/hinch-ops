-- =====================================================================
-- Site details become mandatory before an order can reach "Ready to
-- procure" (to_be_ordered). Warehouse was starting to work orders
-- whose delivery site nobody had actually captured yet — floor, lift,
-- precise location. This closes that gap at the three points that can
-- put an order into to_be_ordered, not just in the UI:
--
--   1. Payment clearing (recompute_payment) — the common path.
--   2. A customer getting tagged credit_regular (propagate_credit_regular,
--      and the initial insert in ensure_order_ops).
--   3. Warehouse/admin's manual "Move to step" override (order_action).
--
-- Everything else about the payment/dispatch gate is untouched — this
-- only adds a second condition alongside the existing ones. An order
-- that's otherwise eligible but blocked on site details simply stays
-- at awaiting_clearance until sales finishes the Site tab; a new
-- trigger on delivery_site_details releases it the moment they do.
--
-- The gate only applies to orders placed on or after
-- site_details_gate_effective_from (app_config). Every order already
-- sitting in Zoho before the cutover — including ones synced in later
-- as backdated/historical records — is grandfathered in and behaves
-- exactly as it did before this migration.
-- =====================================================================

insert into app_config (key, value)
values ('site_details_gate_effective_from', to_jsonb('2026-09-21'::date::text))
on conflict (key) do nothing;

create or replace function site_details_gate_required(p_so uuid) returns boolean
language sql stable set search_path = public as $$
  select so.order_date >= coalesce(
    (select (value #>> '{}')::date from app_config where key = 'site_details_gate_effective_from'),
    '1900-01-01'::date
  )
  from sales_orders so where so.id = p_so
$$;

create or replace function site_details_complete(p_so uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1 from delivery_site_details
    where sales_order_id = p_so
      and maps_url is not null and btrim(maps_url) <> ''
      and floor is not null and btrim(floor) <> ''
      and has_service_lift is not null
  )
$$;

-- ---------------------------------------------------------------------
-- 1. New orders always start at awaiting_clearance now — site details
--    can never be ready at insert time (the order didn't exist a moment
--    ago), so the credit_regular fast path no longer applies here. A
--    credit_regular customer's order is released by the trigger below
--    as soon as its site details are filled in.
-- ---------------------------------------------------------------------
create or replace function ensure_order_ops()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into order_ops (sales_order_id, status)
  values (new.id, 'awaiting_clearance'::dispatch_status)
  on conflict (sales_order_id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Payment-driven auto-advance now also requires site details.
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

  -- Auto-advance out of awaiting_clearance once real money lands AND
  -- the delivery site is known (orders predating the gate skip that
  -- second condition entirely).
  if v_status in ('advance_paid', 'fully_paid', 'overpaid')
     and (not site_details_gate_required(v_so) or site_details_complete(v_so)) then
    update order_ops
      set status = 'to_be_ordered', status_since = now(), updated_at = now()
    where sales_order_id = v_so and status = 'awaiting_clearance';
  end if;

  return null;
end $$;

-- ---------------------------------------------------------------------
-- 3. Tagging a customer credit_regular now only releases orders whose
--    site details are already done; the rest wait for the trigger below.
-- ---------------------------------------------------------------------
create or replace function propagate_credit_regular()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.credit_status = 'credit_regular'
     and new.credit_status is distinct from old.credit_status then
    update order_ops
      set status = 'to_be_ordered', status_since = now()
    where status = 'awaiting_clearance'
      and sales_order_id in (
        select so.id from sales_orders so
        where so.customer_id = new.id
          and (not site_details_gate_required(so.id) or site_details_complete(so.id))
      );
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4. The moment site details become complete, release any order that
--    was otherwise already eligible (paid, or belongs to a
--    credit_regular customer) but stuck waiting on this.
-- ---------------------------------------------------------------------
create or replace function release_awaiting_clearance_on_site_details()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_so      uuid := new.sales_order_id;
  v_cur     dispatch_status;
  v_pay     text;
  v_credit  credit_status;
begin
  if not site_details_complete(v_so) then
    return new;
  end if;

  select status into v_cur from order_ops where sales_order_id = v_so;
  if v_cur is distinct from 'awaiting_clearance' then
    return new;
  end if;

  select so.payment_status, c.credit_status
    into v_pay, v_credit
  from sales_orders so
  left join customers c on c.id = so.customer_id
  where so.id = v_so;

  if v_pay in ('advance_paid', 'fully_paid', 'overpaid') or v_credit = 'credit_regular' then
    update order_ops
      set status = 'to_be_ordered', status_since = now(), updated_at = now()
    where sales_order_id = v_so and status = 'awaiting_clearance';
  end if;

  return new;
end $$;

drop trigger if exists trg_release_on_site_details on delivery_site_details;
create trigger trg_release_on_site_details
after insert or update on delivery_site_details
for each row execute function release_awaiting_clearance_on_site_details();

-- ---------------------------------------------------------------------
-- 5. Warehouse/admin's manual override can't skip the same requirement.
--    Reproduces order_action verbatim (from 20260901000400) plus the
--    one added check, so nothing else about it changes.
-- ---------------------------------------------------------------------
create or replace function order_action(
  p_so uuid,
  p_action text,
  p_reason text default null
)
returns dispatch_status
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  cur    dispatch_status;
  nextv  dispatch_status;
  reason text := nullif(btrim(p_reason), '');
  n_disp int;
begin
  if not can_edit_dispatch() then
    raise exception 'Your role cannot change dispatch status'
      using errcode = 'insufficient_privilege';
  end if;

  select status into cur from order_ops where sales_order_id = p_so;
  if cur is null then
    raise exception 'No order_ops row for %', p_so;
  end if;

  select count(*) into n_disp from dispatches where sales_order_id = p_so;

  case p_action
    when 'hold' then
      if reason is null then
        raise exception 'A hold needs a reason' using errcode = 'check_violation';
      end if;
      if cur not in ('on_hold', 'cancelled') then
        update order_ops set stage_before_hold = cur where sales_order_id = p_so;
      end if;
      nextv := 'on_hold';
      update order_ops
         set status = nextv, hold_reason = reason, status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    when 'resume' then
      if cur <> 'on_hold' then return cur; end if;
      nextv := coalesce(
        (select stage_before_hold from order_ops where sales_order_id = p_so),
        compute_order_stage(p_so));
      update order_ops
         set status = nextv, hold_reason = null, stage_before_hold = null,
             status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    when 'cancel' then
      if cur not in ('on_hold', 'cancelled') then
        update order_ops set stage_before_hold = cur where sales_order_id = p_so;
      end if;
      nextv := 'cancelled';
      update order_ops
         set status = nextv, hold_reason = null, status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    when 'reactivate' then
      if cur <> 'cancelled' then return cur; end if;
      nextv := coalesce(
        (select stage_before_hold from order_ops where sales_order_id = p_so),
        compute_order_stage(p_so));
      update order_ops
         set status = nextv, stage_before_hold = null,
             status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    when 'fulfill' then
      if cur <> 'delivered' then
        raise exception 'Only a delivered order can be marked fulfilled'
          using errcode = 'check_violation';
      end if;
      nextv := 'fulfilled';
      update order_ops
         set status = nextv, status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    when 'unfulfill' then
      if cur <> 'fulfilled' then return cur; end if;
      nextv := compute_order_stage(p_so);
      update order_ops
         set status = nextv, status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    -- Manual pre-dispatch stages.
    when 'to_be_ordered', 'ordered', 'in_transit', 'at_warehouse', 'ready_to_dispatch' then
      if p_action = 'to_be_ordered' and site_details_gate_required(p_so) and not site_details_complete(p_so) then
        raise exception 'Site details (precise location, floor, service lift) must be filled in before this order can move to Ready to procure'
          using errcode = 'check_violation';
      end if;
      if n_disp > 0 then
        raise exception 'Order already has delivery challans — stage is set from those'
          using errcode = 'check_violation';
      end if;
      nextv := p_action::dispatch_status;
      update order_ops
         set status = nextv, hold_reason = null, stage_before_hold = null,
             status_since = now(), updated_at = now()
       where sales_order_id = p_so;

    else
      raise exception 'Unknown action %', p_action;
  end case;

  perform log_activity(
    p_so, 'order_ops', p_so::text, 'status_' || p_action,
    jsonb_build_object('status', cur),
    jsonb_build_object('status', nextv, 'reason', reason));

  return nextv;
end $$;

revoke execute on function order_action(uuid, text, text) from anon;

-- ---------------------------------------------------------------------
-- 6. Only sales/admin fill in the site details that gate procurement;
--    everyone else (warehouse included) reads them.
-- ---------------------------------------------------------------------
drop policy if exists write_site_details on delivery_site_details;
create policy write_site_details on delivery_site_details
  for all to authenticated
  using (coalesce(auth_role() in ('sales', 'admin'), false))
  with check (coalesce(auth_role() in ('sales', 'admin'), false));

-- ---------------------------------------------------------------------
-- 7. Surface "blocked on site details" on the board so sales can see
--    which orders are otherwise ready but waiting on them.
-- ---------------------------------------------------------------------
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
  ops.procure_first_at is not null as is_procure_first,
  ops.procure_first_at,
  ops.procure_first_note,
  pf.full_name as procure_first_by_name,
  (
    c.credit_status in ('credit_regular', 'credit_hold')
    and (so.total - so.amount_received) > 0.01
    and (so.order_date + coalesce(c.credit_days, 0)) < current_date
  ) as is_overdue,
  (
    ops.status = 'on_hold'
    or (
      ops.status in ('at_warehouse', 'ready_to_dispatch')
      and so.total - so.amount_received > 0.01
      and ops.procure_first_at is null
    )
    or (
      ops.status in ('awaiting_clearance', 'to_be_ordered', 'ordered', 'in_transit',
                     'at_warehouse', 'ready_to_dispatch', 'partially_dispatched',
                     'partially_delivered')
      and extract(day from now() - ops.status_since)::int >= 3
      and not (
        ops.procure_first_at is not null
        and ops.status in ('at_warehouse', 'ready_to_dispatch')
      )
    )
  ) as needs_attention,
  (select count(*) from vendor_pos v where v.sales_order_id = so.id) as po_count,
  (select count(*) from vendor_pos v
     where v.sales_order_id = so.id and v.stage = 'received') as po_received,
  (select count(*) from dispatches d where d.sales_order_id = so.id) as dispatch_count,
  (select count(*) from dispatches d
     where d.sales_order_id = so.id and d.delivered_at is not null) as delivered_count,
  dsd.has_service_lift,
  so.customer_id,
  (
    ops.status = 'awaiting_clearance'
    and so.order_date >= coalesce(
      (select (ac.value #>> '{}')::date from app_config ac where ac.key = 'site_details_gate_effective_from'),
      '1900-01-01'::date
    )
    and (
      so.payment_status in ('advance_paid', 'fully_paid', 'overpaid')
      or coalesce(c.credit_status, 'none') = 'credit_regular'
    )
    and not coalesce(
      dsd.maps_url is not null and btrim(dsd.maps_url) <> ''
      and dsd.floor is not null and btrim(dsd.floor) <> ''
      and dsd.has_service_lift is not null,
      false
    )
  ) as blocked_on_site_details
from sales_orders so
join order_ops ops on ops.sales_order_id = so.id
left join customers c on c.id = so.customer_id
left join profiles pf on pf.id = ops.procure_first_by
left join delivery_site_details dsd on dsd.sales_order_id = so.id
where so.is_approved
  and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval');
