-- =====================================================================
-- Operational / dispatch detail from the full Zoho sales order.
--
-- The poll only sees Zoho's LIST payload (thin, no line items). These
-- columns are filled from the SINGLE-order payload, fetched by the
-- webhook and by the on-demand zoho-so-detail function when a panel is
-- opened. Everything not broken out here stays readable from raw, which
-- the detail fetch overwrites with the full 176-field payload.
-- =====================================================================

alter table sales_orders
  add column if not exists zoho_shipped_status  text,   -- pending | partially_fulfilled | fulfilled
  add column if not exists zoho_invoiced_status text,   -- not_invoiced | partially_invoiced | invoiced
  add column if not exists delivery_date        date,
  add column if not exists total_quantity       numeric(14,3),
  add column if not exists ship_to              jsonb,  -- Zoho shipping_address object
  add column if not exists contact_phone        text,
  add column if not exists contact_email        text,
  add column if not exists notes                text,
  add column if not exists so_pdf_path          text,   -- object path in the so-pdfs bucket
  add column if not exists detail_raw           jsonb,  -- full single-order payload; raw stays "last seen"
  add column if not exists detail_synced_at     timestamptz;

comment on column sales_orders.detail_synced_at is
  'When the full single-order payload + PDF were last fetched. Null = only the thin list payload seen so far.';

create index if not exists idx_so_shipped_status on sales_orders(zoho_shipped_status);
create index if not exists idx_so_delivery_date  on sales_orders(delivery_date);

-- Backfill the operational fields the LIST payload already carries.
update sales_orders set
  zoho_shipped_status  = coalesce(zoho_shipped_status,  nullif(raw->>'shipped_status', '')),
  zoho_invoiced_status = coalesce(zoho_invoiced_status, nullif(raw->>'invoiced_status', '')),
  delivery_date        = coalesce(delivery_date,        nullif(raw->>'delivery_date', '')::date),
  contact_email        = coalesce(contact_email,        nullif(raw->>'email', ''))
where raw is not null;

-- ---------------------------------------------------------------------
-- Board view. CREATE OR REPLACE only permits appending columns.
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
  so.detail_synced_at
from sales_orders so
join order_ops ops on ops.sales_order_id = so.id
where so.is_approved
  and so.zoho_status not in ('void', 'draft');

-- ---------------------------------------------------------------------
-- so-pdfs bucket: authenticated users may read (bucket already created
-- in the first migration). Writes are service-role only (edge function),
-- which bypasses RLS, so no insert policy is needed.
-- ---------------------------------------------------------------------
-- read_proofs from migration 1 already covers select on 'so-pdfs'.
