-- =====================================================================
-- Admin analytics: sales performance, payment method mix, and dispatch
-- efficiency. Deliberately thin views — most grouping (by date range, by
-- salesperson, by method) happens client-side against a small slim
-- rowset, since order volumes here are low enough that this is simpler
-- than baking every cut into SQL. Excludes cancelled orders from
-- "sales performance" — a cancelled order never became revenue.
-- =====================================================================

create view v_sales_orders_slim
with (security_invoker = true) as
select
  so.id,
  so.order_date,
  so.salesperson_name,
  so.customer_name,
  so.total
from sales_orders so
join order_ops ops on ops.sales_order_id = so.id
where so.is_approved
  and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval')
  and ops.status <> 'cancelled';

create view v_payments_slim
with (security_invoker = true) as
select
  paid_on,
  amount,
  payment_method
from payments
where not voided;

-- One row per order that has both a promised delivery_date and at least
-- one completed challan — the basis for an on-time-delivery rate.
create view v_delivery_performance
with (security_invoker = true) as
select
  so.id as sales_order_id,
  so.delivery_date,
  max(d.delivered_at) as delivered_at
from sales_orders so
join dispatches d on d.sales_order_id = so.id and d.delivered_at is not null
where so.delivery_date is not null
group by so.id, so.delivery_date;

create view v_dispatch_daily
with (security_invoker = true) as
select
  dispatched_at::date as day,
  count(*) as dispatch_count,
  count(*) filter (where delivered_at is not null) as delivered_count
from dispatches
group by dispatched_at::date
order by day desc;
