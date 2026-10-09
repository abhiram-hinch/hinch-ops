-- =====================================================================
-- Vendor on order lines now comes from the Zoho item's "Vendor" custom
-- field (cf_vendor), not its Purchase Information -> Preferred Vendor.
--
-- The sync code (_shared/itemVendor.ts) does the reading. This migration
-- covers the data already in the database:
--
--   1. Mark every cached item stale. zoho_items currently holds Preferred
--      Vendor names; the poll re-resolves the stalest 40 cached items per
--      15-minute run, so the cache converges on cf_vendor within hours, and
--      any order that syncs in the meantime re-resolves its own items at once.
--   2. Whenever an item's vendor changes in the cache, copy it onto that
--      item's order lines. Lines otherwise only change when their order is
--      re-synced, which for old orders is never.
--
-- Catalog lines only (zoho_item_id set): ad-hoc lines keep the vendor the
-- warehouse typed in. Only the service role writes zoho_items, so this
-- trigger is not reachable from a client.
-- =====================================================================

create or replace function propagate_item_vendor() returns trigger
language plpgsql
set search_path = public
as $$
begin
  update sales_order_lines
     set vendor_name = new.vendor_name
   where zoho_item_id = new.zoho_item_id
     and vendor_name is distinct from new.vendor_name;
  return new;
end;
$$;

drop trigger if exists propagate_item_vendor on zoho_items;
create trigger propagate_item_vendor
  after insert or update of vendor_name on zoho_items
  for each row execute function propagate_item_vendor();

update zoho_items set last_synced_at = 'epoch'::timestamptz;
