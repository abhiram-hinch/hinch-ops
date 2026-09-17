-- =====================================================================
-- Customer-centric view: right now everything is siloed per sales
-- order, with no "show me this customer's full history" anywhere.
-- Adds customer_id to v_ops_board (needed to filter a customer's
-- orders by FK, not fragile name matching) and a summary view for the
-- customer list/search. Read-only aggregation — no new write paths.
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
  so.customer_id
from sales_orders so
join order_ops ops on ops.sales_order_id = so.id
left join customers c on c.id = so.customer_id
left join profiles pf on pf.id = ops.procure_first_by
left join delivery_site_details dsd on dsd.sales_order_id = so.id
where so.is_approved
  and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval');

create view v_customer_summary
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.credit_status,
  c.credit_limit,
  c.credit_days,
  c.notes,
  count(so.id) as order_count,
  coalesce(sum(so.total), 0)::numeric(14,2) as total_value,
  coalesce(sum(so.amount_received), 0)::numeric(14,2) as total_received,
  coalesce(sum(so.total - so.amount_received), 0)::numeric(14,2) as total_outstanding,
  max(so.order_date) as last_order_date
from customers c
left join sales_orders so
  on so.customer_id = c.id
  and so.is_approved
  and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval')
group by c.id, c.name, c.credit_status, c.credit_limit, c.credit_days, c.notes
having count(so.id) > 0
order by total_value desc;
