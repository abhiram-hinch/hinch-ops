/**
 * Real-time sync. A Zoho Books workflow rule on the Sales Orders module POSTs
 * here the moment an order is approved / created / edited. The payload is thin
 * and its shape depends on the rule, so we only pull an id out of it, then run
 * the shared full sync (detail + line items + PDF).
 *
 * Deploy:  supabase functions deploy zoho-so-webhook --no-verify-jwt
 * (Zoho cannot send a Supabase JWT — the ?secret= shared secret is the boundary.)
 *
 * Workflow-rule URL:
 *   https://<ref>.supabase.co/functions/v1/zoho-so-webhook
 *     ?secret=<ZOHO_WEBHOOK_SECRET>&so_id=${salesorder.salesorder_id}
 */

import { safeEqual } from "../_shared/zoho.ts";
import { serviceClient, recordSyncRun } from "../_shared/upsert.ts";
import { syncOneOrder } from "../_shared/syncOne.ts";

const WEBHOOK_SECRET = Deno.env.get("ZOHO_WEBHOOK_SECRET");

Deno.serve(async (req) => {
  const started = Date.now();

  // ---- auth boundary -----------------------------------------------------
  if (!WEBHOOK_SECRET) {
    console.error("ZOHO_WEBHOOK_SECRET is not set — refusing all requests");
    return json({ error: "not configured" }, 503);
  }
  const url = new URL(req.url);
  const provided =
    url.searchParams.get("secret") ?? req.headers.get("x-webhook-secret") ?? "";
  if (!safeEqual(provided, WEBHOOK_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  // ---- pull the sales order id from wherever Zoho put it ----------------
  let soId =
    url.searchParams.get("so_id") ?? url.searchParams.get("salesorder_id") ?? null;

  if (!soId) {
    const ctype = req.headers.get("content-type") ?? "";
    try {
      if (ctype.includes("application/json")) {
        const b = await req.json();
        soId =
          b?.so_id ?? b?.salesorder_id ?? b?.salesorder?.salesorder_id ?? b?.data?.salesorder_id ?? null;
      } else if (ctype.includes("application/x-www-form-urlencoded")) {
        const form = new URLSearchParams(await req.text());
        soId = form.get("so_id") ?? form.get("salesorder_id") ?? null;
      }
    } catch {
      // empty or unparseable body — fall through
    }
  }

  // A literal merge field means the Zoho rule's placeholder didn't render.
  if (soId && soId.includes("${")) {
    console.error(`webhook: unrendered merge field: ${soId}`);
    return json({ error: "merge field did not render" }, 400);
  }
  if (!soId) {
    console.error("webhook: no sales order id in request");
    return json({ error: "missing salesorder_id" }, 400);
  }

  // ---- full sync ------------------------------------------------------
  const db = serviceClient();
  try {
    const { id, matchedOn, pdf } = await syncOneOrder(db, soId, "webhook");
    console.log(`webhook ok zoho=${soId} row=${id} via=${matchedOn} pdf=${pdf} ms=${Date.now() - started}`);
    return json({ ok: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`webhook failed zoho=${soId}: ${message}`);
    await recordSyncRun(db, "webhook", { records_seen: 1, error: message });
    // 500 so Zoho's delivery log shows the failure; the reconcile poll recovers it.
    return json({ error: "sync failed" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
