-- =====================================================================
-- Local override for the quotation reference.
--
-- quotation_ref mirrors Zoho's salesorder.reference_number and is
-- overwritten on every sync. When HINCH needs the board to show a
-- different quote number than what is in Zoho, sales sets an override
-- here; the sync never touches it. Display = coalesce(override, synced).
-- =====================================================================

alter table sales_orders
  add column if not exists quotation_ref_override text;

comment on column sales_orders.quotation_ref_override is
  'Sales-set quote ref that wins over the Zoho-synced quotation_ref. Null = use the synced value.';

-- No blanket UPDATE policy on sales_orders (RLS cannot restrict columns).
-- This SECURITY DEFINER function is the only sanctioned write path.
create or replace function set_quotation_ref_override(p_order uuid, p_ref text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_clean text := nullif(btrim(p_ref), '');
begin
  if not can_edit_payments() then
    raise exception 'Your role cannot edit the quote reference'
      using errcode = 'insufficient_privilege';
  end if;

  update sales_orders
     set quotation_ref_override = v_clean,
         updated_at = now()
   where id = p_order;

  perform log_activity(
    p_order, 'sales_order', p_order::text, 'quote_ref_override',
    null, jsonb_build_object('quotation_ref_override', v_clean));
end $$;

revoke execute on function set_quotation_ref_override(uuid, text) from anon;

-- Append the raw override to the board view (display coalesces on the client).
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
  and so.zoho_status not in ('void', 'draft');
