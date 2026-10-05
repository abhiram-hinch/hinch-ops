-- =====================================================================
-- Site details are no longer required to reach "Ready to procure".
-- Once a payment clears (or a credit_regular customer's order, or a
-- procure-first sign-off), the order moves on whether or not sales has
-- filled in the Site tab yet. The Site tab stays — it's still how the
-- warehouse learns where to deliver — it just doesn't block anything.
--
-- Every path that can put an order into to_be_ordered (payment
-- clearing, credit tagging, procure-first, warehouse/admin's manual
-- "Move to step") and v_ops_board's blocked_on_site_details flag
-- already ask site_details_gate_required() whether the requirement
-- applies, so switching it off here switches it off everywhere at once.
-- (The gate was introduced in 20260920000000_site_details_mandatory_gate.sql;
-- to bring it back, restore that function body in a new migration.)
-- =====================================================================

create or replace function site_details_gate_required(p_so uuid) returns boolean
language sql stable set search_path = public as $$
  select false
$$;

-- ---------------------------------------------------------------------
-- Release orders that were already waiting only on site details: paid
-- (or credit_regular, or procure-first) but parked at awaiting_clearance.
-- The condition mirrors the blocked_on_site_details flag exactly, so it
-- picks up precisely the orders the board labelled "Awaiting site
-- details" and nothing else. Each move is written to activity_log by
-- the existing order_ops audit trigger.
-- ---------------------------------------------------------------------
update order_ops o
   set status = 'to_be_ordered', status_since = now(), updated_at = now()
  from sales_orders so
  left join customers c on c.id = so.customer_id
 where o.sales_order_id = so.id
   and o.status = 'awaiting_clearance'
   and (
        so.payment_status in ('advance_paid', 'fully_paid', 'overpaid')
        or coalesce(c.credit_status, 'none') = 'credit_regular'
        or o.procure_first_at is not null
   );
