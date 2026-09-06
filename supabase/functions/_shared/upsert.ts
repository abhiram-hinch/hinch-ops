import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { ZohoSalesOrder } from "./zoho.ts";

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

async function upsertLines(
  db: SupabaseClient,
  salesOrderId: string,
  lines: NonNullable<ZohoSalesOrder["line_items"]>,
) {
  if (!lines.length) return;

  const rows = lines.map((li, i) => {
    // Ad-hoc service lines (SAC) arrive with name = "" and the label in
    // description. Fall back so they don't render blank; keep description
    // separate only when there's a real name.
    const name = li.name?.trim() || null;
    const desc = li.description?.trim() || null;
    return {
      sales_order_id: salesOrderId,
      zoho_line_item_id: li.line_item_id ?? `idx-${i}`,
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
