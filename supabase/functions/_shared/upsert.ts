import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { fetchItem, type ZohoSalesOrder } from "./zoho.ts";

/** Cached item vendor lookups are refreshed after this long. */
const ITEM_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/**
 * The lifecycle stages that mean "not yet approved". Everything else — approved,
 * open, confirmed, (partially_)invoiced, (partially_)fulfilled, closed, overdue —
 * is at or past approval and belongs on the ops board.
 */
const UNAPPROVED_STAGES = new Set([
  "",
  "draft",
  "pending_approval",
  "pending approval",
  "declined",
  "rejected",
  "void",
]);

/** The stage this order has actually reached, most-authoritative field first. */
export function orderStage(so: ZohoSalesOrder): string {
  return String(so.current_sub_status || so.order_status || so.status || "").toLowerCase();
}

/**
 * Decide whether an order counts as approved.
 *
 * This Zoho org exposes no `is_approved` / `approval_state` on the payload, and
 * the top-level `status` sticks at "draft" for a long time after approval. The
 * reliable signal is `current_sub_status` (then order_status, then status):
 * anything not in UNAPPROVED_STAGES has cleared approval.
 */
export function deriveApproval(so: ZohoSalesOrder): {
  isApproved: boolean;
  matchedOn: string;
} {
  if (typeof so.is_approved === "boolean") {
    return { isApproved: so.is_approved, matchedOn: "is_approved" };
  }
  const state = String(so.approval_state ?? "").toLowerCase();
  if (state === "approved") return { isApproved: true, matchedOn: "approval_state" };
  if (["pending", "pending_approval", "rejected", "declined"].includes(state)) {
    return { isApproved: false, matchedOn: `approval_state:${state}` };
  }

  const stage = orderStage(so);
  return { isApproved: !UNAPPROVED_STAGES.has(stage), matchedOn: `stage:${stage || "empty"}` };
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Resolve (or create) the customers row for a Zoho contact and return its id.
 *
 * Credit standing (credit_status / credit_limit / credit_days) is owned by us,
 * not Zoho — this only ever writes identity fields. On conflict it refreshes the
 * name and nothing else, so the sync can never stomp an accounts-set credit hold.
 */
async function resolveCustomer(
  db: SupabaseClient,
  zohoContactId: string | null | undefined,
  name: string | null | undefined,
): Promise<string | null> {
  const cid = zohoContactId?.trim();
  if (!cid) return null;

  const { data, error } = await db
    .from("customers")
    .upsert(
      { zoho_contact_id: cid, name: name?.trim() || null },
      { onConflict: "zoho_contact_id", ignoreDuplicates: false },
    )
    .select("id")
    .single();

  if (error) {
    console.error(`resolveCustomer ${cid}: ${error.message}`);
    return null;
  }
  return data.id;
}

/**
 * Idempotent upsert of one Zoho sales order plus its line items.
 * Safe to call repeatedly with the same payload — Zoho does send duplicates.
 */
export async function upsertSalesOrder(
  db: SupabaseClient,
  so: ZohoSalesOrder,
): Promise<{ id: string; matchedOn: string }> {
  const { isApproved, matchedOn } = deriveApproval(so);

  // The list payload (poll) has no line_items; the single-order payload
  // (webhook, zoho-so-detail) does. Only the full one fills the operational
  // columns — a thin poll must never wipe detail fetched earlier.
  const isFull = Array.isArray(so.line_items);
  const now = new Date().toISOString();

  const patch: Record<string, unknown> = {
    zoho_salesorder_id: so.salesorder_id,
    so_number: so.salesorder_number ?? null,
    quotation_ref: so.reference_number?.trim() || null,
    zoho_customer_id: so.customer_id ?? null,
    customer_name: so.customer_name ?? null,
    salesperson_name: so.salesperson_name ?? null,
    order_date: so.date ?? null,
    total: num(so.total),
    // The lifecycle stage the order has reached — not the top-level `status`,
    // which stays "draft" long after approval. Invoiced/shipped detail lives in
    // zoho_invoiced_status / zoho_shipped_status.
    zoho_status: orderStage(so) || null,
    zoho_sub_status: so.current_sub_status ?? null,
    is_approved: isApproved,
    raw: so,
    last_synced_at: now,
    updated_at: now,
  };

  // Link to our customers row (identity only — never credit fields). Keep any
  // existing link if the contact can't be resolved this run.
  const customerId = await resolveCustomer(db, so.customer_id, so.customer_name);
  if (customerId) patch.customer_id = customerId;

  // Operational fields carried on BOTH payloads.
  if (so.shipped_status !== undefined) patch.zoho_shipped_status = so.shipped_status || null;
  if (so.invoiced_status !== undefined) patch.zoho_invoiced_status = so.invoiced_status || null;
  if (so.delivery_date !== undefined) patch.delivery_date = so.delivery_date || null;
  if (so.email !== undefined) patch.contact_email = so.email || null;

  // Fields that only the full single-order payload carries.
  if (isFull) {
    patch.detail_raw = so;
    patch.detail_synced_at = now;
    patch.ship_to = so.shipping_address ?? null;
    patch.notes = so.notes?.trim() || null;
    patch.total_quantity = so.total_quantity != null ? num(so.total_quantity) : null;
    patch.contact_phone =
      so.shipping_address?.phone ||
      so.contact?.mobile ||
      so.contact?.phone ||
      so.phone ||
      null;
  }

  const { data: order, error } = await db
    .from("sales_orders")
    .upsert(patch, { onConflict: "zoho_salesorder_id" })
    .select("id")
    .single();

  if (error) throw new Error(`Upsert sales_order ${so.salesorder_id}: ${error.message}`);

  // Only a full payload has authoritative line items; a thin poll must not
  // prune the lines a detail fetch stored.
  if (isFull) await upsertLines(db, order.id, so.line_items ?? []);
  return { id: order.id, matchedOn };
}

/**
 * Resolve each item_id's vendor via a write-through cache — most items
 * repeat across many orders, so this costs one Zoho call per distinct
 * item ever seen (or every ITEM_CACHE_TTL_MS, in case a preferred vendor
 * changes), not one per line or per order.
 */
async function resolveVendorNames(
  db: SupabaseClient,
  itemIds: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (!itemIds.length) return result;

  const { data: cached, error } = await db
    .from("zoho_items")
    .select("zoho_item_id, vendor_name, last_synced_at")
    .in("zoho_item_id", itemIds);
  if (error) throw new Error(`Read zoho_items cache: ${error.message}`);

  const fresh = new Map((cached ?? []).map((r) => [r.zoho_item_id as string, r]));
  const stale = new Date(Date.now() - ITEM_CACHE_TTL_MS).toISOString();

  for (const itemId of itemIds) {
    const row = fresh.get(itemId);
    if (row && row.last_synced_at > stale) {
      result.set(itemId, row.vendor_name ?? null);
      continue;
    }
    try {
      const item = await fetchItem(itemId);
      const vendorName = item.vendor_name?.trim() || null;
      result.set(itemId, vendorName);
      const { error: upsertErr } = await db.from("zoho_items").upsert({
        zoho_item_id: itemId,
        name: item.name ?? null,
        vendor_id: item.vendor_id || null,
        vendor_name: vendorName,
        last_synced_at: new Date().toISOString(),
      });
      if (upsertErr) console.error(`Cache item ${itemId}: ${upsertErr.message}`);
    } catch (e) {
      // A lookup failure shouldn't fail the whole SO sync — fall back to
      // whatever's cached (possibly stale), or leave it unresolved.
      console.error(`Fetch item ${itemId} for vendor lookup: ${e}`);
      result.set(itemId, row?.vendor_name ?? null);
    }
  }
  return result;
}

async function upsertLines(
  db: SupabaseClient,
  salesOrderId: string,
  lines: NonNullable<ZohoSalesOrder["line_items"]>,
) {
  if (!lines.length) return;

  const itemIds = [...new Set(lines.map((li) => li.item_id?.trim()).filter((id): id is string => !!id))];
  const vendorByItem = await resolveVendorNames(db, itemIds);

  // Every row in a single bulk upsert must carry the same columns — a key
  // present on some rows and absent on others resolves to NULL for the
  // rows missing it, which would wipe out warehouse's manual vendor_name
  // entries on ad-hoc lines every time the order re-syncs. So: fetch
  // what's there today and carry it forward unchanged for ad-hoc lines,
  // rather than omitting the column.
  const { data: existing, error: existingErr } = await db
    .from("sales_order_lines")
    .select("zoho_line_item_id, vendor_name")
    .eq("sales_order_id", salesOrderId);
  if (existingErr) throw new Error(`Read existing lines for ${salesOrderId}: ${existingErr.message}`);
  const existingVendorByLine = new Map((existing ?? []).map((r) => [r.zoho_line_item_id as string, r.vendor_name as string | null]));

  const rows = lines.map((li, i) => {
    // Ad-hoc service lines (SAC) arrive with name = "" and the label in
    // description. Fall back so they don't render blank; keep description
    // separate only when there's a real name.
    const name = li.name?.trim() || null;
    const desc = li.description?.trim() || null;
    const itemId = li.item_id?.trim() || null;
    const zohoLineItemId = li.line_item_id ?? `idx-${i}`;
    return {
      sales_order_id: salesOrderId,
      zoho_line_item_id: zohoLineItemId,
      zoho_item_id: itemId,
      item_name: name ?? desc ?? "(unnamed line)",
      item_sku: li.sku?.trim() || null,
      description: name ? desc : null,
      hsn_or_sac: li.hsn_or_sac?.trim() || null,
      unit: li.unit?.trim() || null,
      line_item_kind: (li.line_item_type || li.product_type || "goods").toLowerCase(),
      quantity: num(li.quantity),
      rate: num(li.rate),
      amount: num(li.item_total),
      line_order: i,
      // Catalog lines: Zoho's vendor wins, every sync. Ad-hoc lines
      // (itemId null) keep whatever was already there.
      vendor_name: itemId ? (vendorByItem.get(itemId) ?? null) : (existingVendorByLine.get(zohoLineItemId) ?? null),
    };
  });

  const { error } = await db
    .from("sales_order_lines")
    .upsert(rows, { onConflict: "sales_order_id,zoho_line_item_id" });
  if (error) throw new Error(`Upsert lines for ${salesOrderId}: ${error.message}`);

  // Lines removed in Zoho must disappear here too, or the order total stops
  // reconciling against the sum of its lines.
  const keep = rows.map((r) => r.zoho_line_item_id);
  const { error: delErr } = await db
    .from("sales_order_lines")
    .delete()
    .eq("sales_order_id", salesOrderId)
    .not("zoho_line_item_id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
  if (delErr) console.error(`Prune lines for ${salesOrderId}: ${delErr.message}`);
}

export async function recordSyncRun(
  db: SupabaseClient,
  source: "webhook" | "poll" | "manual",
  fields: { records_seen?: number; records_upsert?: number; error?: string },
) {
  const { error } = await db.from("sync_runs").insert({
    source,
    finished_at: new Date().toISOString(),
    ...fields,
  });
  if (error) console.error(`sync_runs insert failed: ${error.message}`);
}
