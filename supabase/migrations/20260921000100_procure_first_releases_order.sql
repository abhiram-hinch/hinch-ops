-- =====================================================================
-- Authorising "buy material before payment" never actually moved the
-- order anywhere. set_procure_first() only ever wrote the flag; the two
-- functions that auto-advance an order out of awaiting_clearance
-- (recompute_payment, propagate_credit_regular / the site-details
-- release trigger) only look at payment_status and credit_status — a
-- procure-first order with nothing paid and a non-credit customer never
-- satisfies either, so it sits at awaiting_clearance ("Awaiting
-- payment" / now "Awaiting site details") indefinitely. Reported
-- directly: sales authorises it, but the order never becomes "Ready to
-- procure" for warehouse.
--
-- Compounding it: awaiting_clearance is deliberately excluded from
-- SETTABLE_STAGES (see labels.ts) — by design, nobody has ever been
-- able to manually move an order out of it from the UI. So this is the
-- only fix: procure-first authorization becomes a third condition that
-- releases the order, exactly like payment clearing and credit tagging
-- already do, subject to the exact same site-details gate. It does NOT
-- touch the dispatch gate — a procure-first order still cannot reach
-- ready_to_dispatch/dispatched until paid in full or credit_regular,
-- completely unchanged, per the original 20260911000000 migration's
-- explicit intent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Authorising procure-first now also attempts the release —
--    reproduced verbatim from 20260911000000, plus the release at the
--    end of the p_on branch.
-- ---------------------------------------------------------------------
create or replace function set_procure_first(
  p_so   uuid,
  p_on   boolean,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_note text := nullif(btrim(p_note), '');
  v_was  timestamptz;
  v_found boolean;
begin
  if not can_authorize_procure_first() then
    raise exception 'Your role cannot authorise procuring an order before payment'
      using errcode = 'insufficient_privilege';
  end if;

  select procure_first_at, true into v_was, v_found
  from order_ops where sales_order_id = p_so;

  if not coalesce(v_found, false) then
    raise exception 'No order found for %', p_so using errcode = 'no_data_found';
  end if;

  if p_on then
    -- idempotent: re-authorising keeps the original author and timestamp
    if v_was is not null then
      return true;
    end if;
    update order_ops
       set procure_first_at   = now(),
           procure_first_by   = auth.uid(),
           procure_first_note = v_note,
           updated_at         = now()
     where sales_order_id = p_so;

    perform log_activity(p_so, 'order_ops', p_so::text, 'procure_first_authorised',
      null,
      jsonb_build_object('note', v_note, 'by', auth.uid()));

    -- The whole point of authorising this is to get procurement moving
    -- now, not whenever someone next happens to touch the order. Site
    -- details still gate it — a procure-first order still needs a real
    -- delivery site (or a store-pickup tag) same as any other order.
    if (not site_details_gate_required(p_so) or site_details_complete(p_so)) then
      update order_ops
        set status = 'to_be_ordered', status_since = now(), updated_at = now()
      where sales_order_id = p_so and status = 'awaiting_clearance';
    end if;

    return true;
  else
    if v_was is null then
      return false;
    end if;
    update order_ops
       set procure_first_at   = null,
           procure_first_by   = null,
           procure_first_note = null,
           updated_at         = now()
     where sales_order_id = p_so;

    perform log_activity(p_so, 'order_ops', p_so::text, 'procure_first_withdrawn',
      jsonb_build_object('authorised_at', v_was),
      jsonb_build_object('by', auth.uid()));
    return false;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1b. Dispatch-before-payment — a second, narrower authorisation.
--
-- Procuring ahead of payment was never meant to also mean dispatching
-- ahead of payment — the goods still shouldn't leave the building until
-- the customer has paid, same as any non-credit order. But the existing
-- dispatch gate is a single org-wide soft/hard toggle (CLAUDE.md: no
-- third mode), and in 'soft' mode ANY warehouse/admin user can already
-- push ANY order through unpaid, procure-first or not, on their own.
--
-- Rather than touch dispatch_gate_mode's meaning, this adds one narrow,
-- additional rule that only ever applies to procure-first orders: for
-- those specifically, dispatch is an unconditional hard stop — no
-- warehouse self-override, regardless of the global soft/hard setting —
-- until either it's actually paid in full, or sales/admin (deliberately
-- not accounts here, unlike procure-first authorisation itself — this
-- is a different call than committing to buy stock) explicitly approves
-- dispatching it early. Every other order's dispatch gate is completely
-- unaffected: same two values, same behaviour, untouched.
-- ---------------------------------------------------------------------
alter table order_ops
  add column if not exists dispatch_before_payment_at   timestamptz,
  add column if not exists dispatch_before_payment_by   uuid references profiles(id),
  add column if not exists dispatch_before_payment_note text;

comment on column order_ops.dispatch_before_payment_at is
  'Sales/admin approval to dispatch a procure-first order before it''s paid in full. Null = not approved; the hard stop holds.';

create or replace function can_authorize_dispatch_before_payment() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth_role() in ('sales', 'admin'), false)
$$;

create or replace function set_dispatch_before_payment(
  p_so   uuid,
  p_on   boolean,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_note text := nullif(btrim(p_note), '');
  v_was  timestamptz;
  v_is_procure_first boolean;
  v_found boolean;
begin
  if not can_authorize_dispatch_before_payment() then
    raise exception 'Your role cannot approve dispatching an order before payment'
      using errcode = 'insufficient_privilege';
  end if;

  select dispatch_before_payment_at, procure_first_at is not null, true
    into v_was, v_is_procure_first, v_found
  from order_ops where sales_order_id = p_so;

  if not coalesce(v_found, false) then
    raise exception 'No order found for %', p_so using errcode = 'no_data_found';
  end if;

  if p_on and not coalesce(v_is_procure_first, false) then
    raise exception 'This approval only applies to orders bought ahead of payment'
      using errcode = 'check_violation';
  end if;

  if p_on then
    if v_was is not null then
      return true;
    end if;
    update order_ops
       set dispatch_before_payment_at   = now(),
           dispatch_before_payment_by   = auth.uid(),
           dispatch_before_payment_note = v_note,
           updated_at = now()
     where sales_order_id = p_so;

    perform log_activity(p_so, 'order_ops', p_so::text, 'dispatch_before_payment_approved',
      null, jsonb_build_object('note', v_note, 'by', auth.uid()));
    return true;
  else
    if v_was is null then
      return false;
    end if;
    update order_ops
       set dispatch_before_payment_at   = null,
           dispatch_before_payment_by   = null,
           dispatch_before_payment_note = null,
           updated_at = now()
     where sales_order_id = p_so;

    perform log_activity(p_so, 'order_ops', p_so::text, 'dispatch_before_payment_withdrawn',
      jsonb_build_object('approved_at', v_was), jsonb_build_object('by', auth.uid()));
    return false;
  end if;
end $$;

revoke execute on function set_dispatch_before_payment(uuid, boolean, text) from anon;

-- ---------------------------------------------------------------------
-- 1c. The dispatch gate itself — reproduced verbatim from
--     20260911000000, with the procure-first branch added. Every other
--     order takes the exact same path it always has.
-- ---------------------------------------------------------------------
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
  -- An authorised procure-first order is not a surprise, so it is not logged
  -- as an override: the authorisation is already in activity_log.
  if new.status = 'ordered' and new.procure_first_at is null then
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

      if new.procure_first_at is not null then
        -- Procure-first: unconditional hard stop, no warehouse self-
        -- override, regardless of dispatch_gate_mode either way.
        if new.dispatch_before_payment_at is null then
          raise exception 'Dispatch blocked: this order was procured ahead of payment and % is still due. Sales or admin must approve dispatching it before full payment.',
            v_short using errcode = 'check_violation';
        end if;
        perform log_activity(new.sales_order_id, 'order_ops', new.sales_order_id::text,
          'dispatch_before_payment_used',
          jsonb_build_object('status', old.status),
          jsonb_build_object('status', new.status, 'shortfall', v_short,
            'amount_cleared', v_recv, 'order_total', v_total));
      else
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
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. The reverse ordering — site details get filled in AFTER
--    procure-first was already authorised — needs the same release
--    condition added. Reproduced verbatim from 20260921000000, plus
--    procure_first_at in the eligibility check.
-- ---------------------------------------------------------------------
create or replace function release_awaiting_clearance_on_site_details()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_so      uuid := new.sales_order_id;
  v_cur     dispatch_status;
  v_pay     text;
  v_credit  credit_status;
  v_procure_first boolean;
begin
  if not site_details_complete(v_so) then
    return new;
  end if;

  select status, procure_first_at is not null into v_cur, v_procure_first
  from order_ops where sales_order_id = v_so;
  if v_cur is distinct from 'awaiting_clearance' then
    return new;
  end if;

  select so.payment_status, c.credit_status
    into v_pay, v_credit
  from sales_orders so
  left join customers c on c.id = so.customer_id
  where so.id = v_so;

  if v_pay in ('advance_paid', 'fully_paid', 'overpaid')
     or v_credit = 'credit_regular'
     or v_procure_first then
    update order_ops
      set status = 'to_be_ordered', status_since = now(), updated_at = now()
    where sales_order_id = v_so and status = 'awaiting_clearance';
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Board view — reproduced verbatim from 20260921000000, plus:
--    - blocked_on_site_details recognises procure_first as a third
--      "otherwise eligible" condition, same as payment/credit — a
--      procure-first order stuck only on site details should say so,
--      not "awaiting payment".
--    - the new dispatch-before-payment fields, and a computed
--      dispatch_locked_on_payment the frontend can key its alert off
--      directly instead of re-deriving the same condition client-side.
-- ---------------------------------------------------------------------
create or replace view v_ops_board
with (security_invoker = true) as
select
  v.id,
  v.so_number,
  v.order_date,
  v.customer_name,
  v.salesperson_name,
  v.total,
  v.amount_received,
  v.amount_pending_clearance,
  v.balance_due,
  v.payment_status,
  v.zoho_status,
  v.dispatch_status,
  v.hold_reason,
  v.stage_before_hold,
  v.status_since,
  v.days_in_status,
  v.last_synced_at,
  v.quotation_ref,
  v.zoho_salesorder_id,
  v.zoho_shipped_status,
  v.zoho_invoiced_status,
  v.delivery_date,
  v.total_quantity,
  v.ship_to,
  v.contact_phone,
  v.contact_email,
  v.notes,
  v.so_pdf_path,
  v.detail_synced_at,
  v.quotation_ref_override,
  v.customer_credit_status,
  v.credit_days,
  v.is_procure_first,
  v.procure_first_at,
  v.procure_first_note,
  v.procure_first_by_name,
  v.is_overdue,
  v.needs_attention,
  v.po_count,
  v.po_received,
  v.dispatch_count,
  v.delivered_count,
  v.has_service_lift,
  v.customer_id,
  v.blocked_on_site_details,
  v.procurement_location_id,
  pl.label as procurement_location_label,
  v.is_store_pickup,
  v.dispatch_before_payment_at,
  v.dispatch_before_payment_note,
  v.dispatch_before_payment_by_name,
  v.dispatch_locked_on_payment
from (
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
      and (
        so.payment_status in ('advance_paid', 'fully_paid', 'overpaid')
        or coalesce(c.credit_status, 'none') = 'credit_regular'
        or ops.procure_first_at is not null
      )
      and site_details_gate_required(so.id)
      and not site_details_complete(so.id)
    ) as blocked_on_site_details,
    ops.procurement_location_id,
    coalesce(dsd.is_store_pickup, false) as is_store_pickup,
    ops.dispatch_before_payment_at,
    ops.dispatch_before_payment_note,
    dbf.full_name as dispatch_before_payment_by_name,
    (
      ops.procure_first_at is not null
      and ops.dispatch_before_payment_at is null
      and so.payment_status <> 'fully_paid'
      and coalesce(c.credit_status, 'none') <> 'credit_regular'
    ) as dispatch_locked_on_payment
  from sales_orders so
  join order_ops ops on ops.sales_order_id = so.id
  left join customers c on c.id = so.customer_id
  left join profiles pf on pf.id = ops.procure_first_by
  left join profiles dbf on dbf.id = ops.dispatch_before_payment_by
  left join delivery_site_details dsd on dsd.sales_order_id = so.id
  where so.is_approved
    and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval')
) v
left join procurement_locations pl on pl.id = v.procurement_location_id;
