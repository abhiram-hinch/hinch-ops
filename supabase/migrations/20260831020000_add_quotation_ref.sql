-- =====================================================================
-- Add the quotation reference to every sales order.
--
-- Zoho Books puts the originating quote number in the sales order's
-- free-text "Reference#" field (payload key: reference_number). HINCH
-- fills it with the QT-YY-YY/NNNN quotation number, so sales can trace a
-- board row back to the quote it came from.
-- =====================================================================

alter table sales_orders
  add column if not exists quotation_ref text;

comment on column sales_orders.quotation_ref is
  'Originating quotation number, from Zoho salesorder.reference_number.';

create index if not exists idx_so_quotation_ref on sales_orders(quotation_ref);

-- Backfill from payloads already mirrored.
update sales_orders
   set quotation_ref = nullif(raw->>'reference_number', '')
 where raw is not null
   and quotation_ref is null;

-- ---------------------------------------------------------------------
-- Surface it on the board view. CREATE OR REPLACE only permits appending
-- columns, so quotation_ref goes at the end of the select list.
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
  so.total - so.amount_received as balance_due,
  so.payment_status,
  so.zoho_status,
  ops.status        as dispatch_status,
  ops.hold_reason,
  ops.status_since,
  extract(day from now() - ops.status_since)::int as days_in_status,
  so.last_synced_at,
  so.quotation_ref
from sales_orders so
join order_ops ops on ops.sales_order_id = so.id
where so.is_approved
  and so.zoho_status not in ('void', 'draft');
