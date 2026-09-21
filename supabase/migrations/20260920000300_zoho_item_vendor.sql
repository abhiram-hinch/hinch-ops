-- =====================================================================
-- Vendor grouping now sources from Zoho's Item master data (the
-- "Preferred Vendor" set on the item's Purchase Information in Zoho
-- Books), not just the manual free-text entry added in
-- 20260920000200. Zoho has no "vendor for this SO line" concept — only
-- "vendor for this catalog item" — so this is a per-item lookup, keyed
-- by the item_id already present in Zoho's line item payload but not
-- previously captured here.
--
-- Ad-hoc/service lines (typed directly into an SO, no catalog item —
-- zoho_item_id is null) have no Zoho vendor to source, so the manual
-- entry from 20260920000200 remains their only option. Catalog lines
-- become read-only from here, at the RLS layer (not just the UI) —
-- confirmed against a live response from our own org before coding
-- against it, per CLAUDE.md.
-- =====================================================================

create table if not exists zoho_items (
  zoho_item_id  text primary key,
  name          text,
  vendor_id     text,
  vendor_name   text,
  last_synced_at timestamptz not null default now()
);

alter table zoho_items enable row level security;

create policy read_zoho_items on zoho_items
  for select to authenticated using (true);
-- No insert/update/delete policy for authenticated — only the service
-- role (the sync code in the Edge Functions) writes here.

alter table sales_order_lines add column if not exists zoho_item_id text;

-- Catalog lines (zoho_item_id set) are Zoho-sourced from here on; only
-- ad-hoc lines (zoho_item_id null) can still be hand-edited. Closes the
-- direct-API bypass, not just the UI affordance.
drop policy if exists write_line_vendor on sales_order_lines;
create policy write_line_vendor on sales_order_lines
  for update to authenticated
  using (can_edit_dispatch() and zoho_item_id is null)
  with check (can_edit_dispatch() and zoho_item_id is null);
