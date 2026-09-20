-- =====================================================================
-- Vendor per line item — free text, not a lookup, since "the vendor for
-- this item" is decided ad hoc by whoever's procuring, not chosen from
-- a fixed list. Lets the Items tab group by vendor and warehouse copy a
-- vendor-grouped list out to actually place the order.
-- =====================================================================

alter table sales_order_lines add column if not exists vendor_name text;

create policy write_line_vendor on sales_order_lines
  for update to authenticated
  using (can_edit_dispatch())
  with check (can_edit_dispatch());
