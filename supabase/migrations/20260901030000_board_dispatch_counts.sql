-- =====================================================================
-- Restore the challan / vendor-PO count columns on v_ops_board.
--
-- 20260901000100 added po_count / po_received / dispatch_count /
-- delivered_count to v_ops_board. 20260901010100 rebuilt the view for the
-- payment model and dropped them by omission — DispatchControl relies on
-- order.dispatch_count to know whether a challan exists, so without it the
-- stage stepper never hides. Rebuild the view (and its dependent totals
-- view) with the four columns back.
-- =====================================================================

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
  ) as needs_attention,
  (select count(*) from vendor_pos v where v.sales_order_id = so.id) as po_count,
  (select count(*) from vendor_pos v
     where v.sales_order_id = so.id and v.stage = 'received') as po_received,
  (select count(*) from dispatches d where d.sales_order_id = so.id) as dispatch_count,
  (select count(*) from dispatches d
     where d.sales_order_id = so.id and d.delivered_at is not null) as delivered_count
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

-- ---------------------------------------------------------------------
-- Also surface the quotation reference on the accounts payment queue,
-- so a confirmer can tie a payment back to its quote.
-- ---------------------------------------------------------------------
drop view if exists v_payment_queue;
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
  coalesce(s.quotation_ref_override, s.quotation_ref) as quotation_ref,
  s.customer_name,
  s.total,
  coalesce(c.credit_status, 'none')::text as customer_credit_status
from payments p
join sales_orders s on s.id = p.sales_order_id
left join customers c on c.id = s.customer_id
left join profiles rb on rb.id = p.received_by
where p.clearance_status = 'pending' and not p.voided
order by p.paid_on asc, p.recorded_at asc;
