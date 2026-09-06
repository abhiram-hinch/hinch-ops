-- =====================================================================
-- Server-side board aggregates.
--
-- With ~2,600 approved orders, pulling every row to count them in the
-- browser hits PostgREST's max_rows cap and the status rail under-reports.
-- v_ops_board_totals does the grouping in Postgres (≈10 rows out), and
-- needs_attention becomes a real column so "Needs attention" filters and
-- counts server-side too.
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
  so.quotation_ref_override,
  (
    ops.status = 'on_hold'
    or (ops.status = 'ready_to_dispatch' and so.total - so.amount_received > 0.01)
    or (
      ops.status in ('pending', 'ready_to_dispatch', 'partially_dispatched')
      and extract(day from now() - ops.status_since)::int >= 3
    )
  ) as needs_attention
from sales_orders so
join order_ops ops on ops.sales_order_id = so.id
where so.is_approved
  and coalesce(so.zoho_status, '') not in ('void', 'draft', 'declined', 'pending_approval');

-- One row per dispatch bucket, plus an "attention" row. Small, uncapped.
create or replace view v_ops_board_totals
with (security_invoker = true) as
select
  dispatch_status::text as key,
  count(*)::int         as count,
  coalesce(sum(total), 0)::float8 as value
from v_ops_board
group by dispatch_status
union all
select
  'attention',
  count(*)::int,
  coalesce(sum(total), 0)::float8
from v_ops_board
where needs_attention;
