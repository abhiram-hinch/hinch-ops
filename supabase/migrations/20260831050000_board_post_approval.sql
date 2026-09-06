-- =====================================================================
-- Show every sales order at or past approval, not just those whose
-- top-level Zoho `status` reads open/invoiced.
--
-- This org's Zoho leaves salesorder.status = 'draft' for a long time
-- after an order is approved; current_sub_status carries the real stage
-- ('approved', 'open', 'closed', ...). The sync now stores that stage in
-- zoho_status and sets is_approved from it, so the board filter can trust
-- is_approved and only needs to fence off the terminal/negative stages.
--
-- No column changes — CREATE OR REPLACE only swaps the WHERE clause.
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
  so.quotation_ref_override
from sales_orders so
join order_ops ops on ops.sales_order_id = so.id
where so.is_approved
  and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval');
