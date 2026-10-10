-- =====================================================================
-- "Partly sent" worklist for the operations team.
--
-- v_partly_sent: every order that has had at least one challan but isn't
-- fully sent/delivered, regardless of its order date (the board defaults
-- to today, so an order that went out in two halves a week apart would
-- otherwise drop out of sight). For each one: how many goods lines are
-- sent, which are still pending and how much of each, when the last
-- challan went, and any service-type lines still open.
--
-- Goods and service lines are kept apart on purpose. The order stays
-- "partly sent" until EVERY line is sent (or a challan is marked final),
-- and a service line has nothing physical to ship — so an order whose
-- goods have all gone out can sit at "partly sent" for weeks over one
-- service line. Separating them lets the team see that case for what it
-- is (close the order out) instead of chasing stock that doesn't exist.
--
-- Built straight on order_ops / sales_orders, not on v_ops_board, whose
-- per-row subqueries make it slow to join against.
-- =====================================================================

create or replace view v_partly_sent
with (security_invoker = true) as
select
  so.id,
  so.so_number,
  so.customer_name,
  so.salesperson_name,
  so.order_date,
  so.total,
  so.quotation_ref,
  so.quotation_ref_override,
  o.status                                            as dispatch_status,
  o.status_since,
  extract(day from now() - o.status_since)::int       as days_in_stage,
  d.challans,
  d.last_dispatched_at,
  extract(day from now() - d.last_dispatched_at)::int as days_since_last_dispatch,
  g.goods_total,
  g.goods_sent,
  g.pending_goods,
  g.pending_service
from order_ops o
join sales_orders so on so.id = o.sales_order_id
cross join lateral (
  select count(*) as challans, max(dispatched_at) as last_dispatched_at
  from dispatches where sales_order_id = so.id
) d
cross join lateral (
  select
    count(*) filter (where coalesce(l.line_item_kind, 'goods') <> 'service' and l.quantity > 0)
      as goods_total,
    count(*) filter (where coalesce(l.line_item_kind, 'goods') <> 'service' and l.quantity > 0
                       and l.qty_dispatched >= l.quantity)
      as goods_sent,
    coalesce(jsonb_agg(
      jsonb_build_object('name', l.item_name, 'sku', l.item_sku, 'unit', l.unit,
                         'quantity', l.quantity, 'remaining', l.quantity - l.qty_dispatched)
      order by l.line_order)
      filter (where coalesce(l.line_item_kind, 'goods') <> 'service' and l.quantity > 0
                and l.qty_dispatched < l.quantity), '[]'::jsonb)
      as pending_goods,
    coalesce(jsonb_agg(
      jsonb_build_object('name', l.item_name, 'sku', l.item_sku, 'unit', l.unit,
                         'quantity', l.quantity, 'remaining', l.quantity - l.qty_dispatched)
      order by l.line_order)
      filter (where l.line_item_kind = 'service' and l.quantity > 0
                and l.qty_dispatched < l.quantity), '[]'::jsonb)
      as pending_service
  from sales_order_lines l where l.sales_order_id = so.id
) g
where o.status in ('partially_dispatched', 'partially_delivered')
  and so.is_approved
  and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval', 'deleted_in_zoho');
