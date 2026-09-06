-- =====================================================================
-- Handle service (SAC) line items.
--
-- Zoho sends ad-hoc service lines with name = "" and the label only in
-- description, so they were stored blank and vanished from the items
-- list. Add line_item_kind (goods | service), fall back to description
-- for the name, and backfill the rows already synced.
-- =====================================================================

alter table sales_order_lines
  add column if not exists line_item_kind text;   -- 'goods' | 'service'

update sales_order_lines l set
  item_name = coalesce(
    nullif(btrim(src.li->>'name'), ''),
    nullif(btrim(src.li->>'description'), ''),
    l.item_name),
  description = case
    when nullif(btrim(src.li->>'name'), '') is not null
      then nullif(btrim(src.li->>'description'), '')
    else null
  end,
  hsn_or_sac = coalesce(nullif(btrim(src.li->>'hsn_or_sac'), ''), l.hsn_or_sac),
  unit = nullif(btrim(src.li->>'unit'), ''),
  line_item_kind = lower(coalesce(
    nullif(src.li->>'line_item_type', ''),
    nullif(src.li->>'product_type', ''),
    'goods'))
from (
  select s.id as so_id, li
  from sales_orders s,
       jsonb_array_elements(s.detail_raw->'line_items') li
  where s.detail_raw ? 'line_items'
) src
where src.so_id = l.sales_order_id
  and l.zoho_line_item_id = src.li->>'line_item_id';

-- Anything still blank (older list-payload rows): keep it visible.
update sales_order_lines
   set item_name = '(unnamed line)'
 where item_name is null or btrim(item_name) = '';
