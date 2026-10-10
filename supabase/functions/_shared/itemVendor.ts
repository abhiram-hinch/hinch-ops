/**
 * The vendor we show for a catalog item is the item's custom field "Vendor"
 * (api name `cf_vendor`, a lookup to Vendors) — NOT Purchase Information ->
 * Preferred Vendor (`vendor_name` / `vendor_id`). The two are maintained
 * independently in Zoho and mostly disagree, and there is deliberately no
 * fallback to the preferred vendor: an item with no cf_vendor has no vendor.
 *
 * Shape confirmed against GET /items/{id} from our own org (see
 * __fixtures__/item-with-cf-vendor.json): the lookup arrives both in
 * `custom_field_hash` (cf_vendor = display name, cf_vendor_unformatted = vendor
 * id) and in `custom_fields[]` (value = vendor id, value_formatted = name).
 * An item that has never had it set carries neither.
 *
 * Kept free of Deno/Zoho imports so it can be tested in plain Node.
 */
export interface ItemVendorSource {
  custom_field_hash?: Record<string, unknown> | null;
  custom_fields?: Array<{ api_name?: string; value?: unknown; value_formatted?: unknown }> | null;
  [key: string]: unknown;
}

export interface ItemVendor {
  id: string | null;
  name: string | null;
}

const text = (v: unknown): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

export function itemVendor(item: ItemVendorSource): ItemVendor {
  const hash = item.custom_field_hash ?? {};
  let name = text(hash["cf_vendor_formatted"]) ?? text(hash["cf_vendor"]);
  let id = text(hash["cf_vendor_unformatted"]);

  if (!name || !id) {
    const field = (item.custom_fields ?? []).find((f) => f?.api_name === "cf_vendor");
    name = name ?? text(field?.value_formatted);
    id = id ?? text(field?.value);
  }
  return { id, name };
}
