/**
 * On-demand full sync of one sales order — called by the dashboard panel when
 * an order is opened. Same shared sync as the webhook, with a short freshness
 * guard so re-opening the same order doesn't re-hit Zoho.
 *
 * Deployed WITH jwt verification — reaching the handler means an authenticated
 * dashboard user (or the service role, for scripts).
 */

import { serviceClient } from "../_shared/upsert.ts";
import { syncOneOrder } from "../_shared/syncOne.ts";

const FRESH_MS = 10 * 60_000;

Deno.serve(async (req) => {
  let soId: string | null = null;
  const url = new URL(req.url);
  soId = url.searchParams.get("so_id") ?? url.searchParams.get("salesorder_id");
  if (!soId) {
    try {
      const body = await req.json();
      soId = body?.so_id ?? body?.salesorder_id ?? null;
    } catch {
      // no body
    }
  }
  if (!soId) return json({ error: "missing so_id" }, 400);

  const db = serviceClient();
  try {
    const { data: existing } = await db
      .from("sales_orders")
      .select("id, detail_synced_at, so_pdf_path")
      .eq("zoho_salesorder_id", soId)
      .maybeSingle();

    if (
      existing?.detail_synced_at &&
      Date.now() - new Date(existing.detail_synced_at).getTime() < FRESH_MS &&
      existing.so_pdf_path
    ) {
      return json({ ok: true, id: existing.id, pdf_path: existing.so_pdf_path, cached: true });
    }

    const { id, pdf } = await syncOneOrder(db, soId, "manual");
    return json({ ok: true, id, pdf_path: pdf ? `${soId}.pdf` : existing?.so_pdf_path ?? null, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`so-detail failed ${soId}: ${message}`);
    return json({ error: "detail sync failed", message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
