/**
 * Daily safety net for the one thing the webhook and the 15-minute poll can
 * never catch: a sales order deleted outright in Zoho (not voided — actually
 * removed). Neither of the other two sync paths ever sees that happen — a
 * deleted record generates no webhook, and it can never appear in a
 * "modified since" scan again, so it would otherwise sit in our mirror
 * forever, still showing on the dashboard with stale data.
 *
 * This pages through every sales order Zoho currently has and compares that
 * full id set against every order we still treat as active. Anything active
 * on our side that's absent from Zoho's current list gets marked
 * 'deleted_in_zoho' — distinct from a real Zoho-side void — and logged, then
 * v_ops_board's existing "hidden by default" filter takes it from there.
 *
 * Deploy with:  supabase functions deploy zoho-so-reconcile
 * Invoked once a day by pg_cron (see the migration) — never by the UI, since
 * a full catalogue page-through is too heavy for an on-demand button.
 */

import { iterateModifiedSalesOrders } from "../_shared/zoho.ts";
import { serviceClient, recordSyncRun } from "../_shared/upsert.ts";

// "Since the beginning" — Zoho accepts an arbitrarily old last_modified_time,
// and reusing the same paginated list call the poll already relies on is a
// smaller risk than reaching for a different, unproven endpoint shape.
const EPOCH = "2000-01-01T00:00:00+0530";

// Rows in this state are already hidden from the board; nothing is lost by
// skipping the Zoho existence check for them, and it keeps the daily job
// from re-verifying orders that dropped off months ago.
const ALREADY_HIDDEN = new Set(["void", "draft", "declined", "pending_approval", "deleted_in_zoho"]);

Deno.serve(async (req) => {
  const db = serviceClient();
  const started = Date.now();
  let seen = 0;
  let hidden = 0;

  try {
    // ---- every sales order id Zoho currently has ------------------------
    const zohoIds = new Set<string>();
    for await (const page of iterateModifiedSalesOrders(EPOCH)) {
      for (const so of page) zohoIds.add(so.salesorder_id);
    }
    seen = zohoIds.size;

    if (seen === 0) {
      // An empty result almost certainly means the listing call itself
      // failed silently or the org id / token was wrong — never let that
      // read as "Zoho has nothing", which would hide every active order.
      throw new Error("Zoho returned zero sales orders — refusing to reconcile against an empty set");
    }

    // ---- our currently-active mirrored orders ----------------------------
    const { data: active, error } = await db
      .from("sales_orders")
      .select("id, so_number, zoho_status, zoho_salesorder_id")
      .not("zoho_salesorder_id", "is", null)
      .not("zoho_status", "in", `(${[...ALREADY_HIDDEN].map((s) => `"${s}"`).join(",")})`);
    if (error) throw error;

    const missing = (active ?? []).filter((so) => !zohoIds.has(so.zoho_salesorder_id!));

    for (const so of missing) {
      const { error: updateError } = await db
        .from("sales_orders")
        .update({ zoho_status: "deleted_in_zoho" })
        .eq("id", so.id);
      if (updateError) {
        console.error(`reconcile: failed to hide ${so.so_number}: ${updateError.message}`);
        continue;
      }
      await db.from("activity_log").insert({
        sales_order_id: so.id,
        entity: "sales_order",
        entity_id: so.zoho_salesorder_id,
        action: "auto_hidden_deleted_in_zoho",
        before: { zoho_status: so.zoho_status },
        after: { zoho_status: "deleted_in_zoho" },
        actor_name: "Zoho reconcile (automatic)",
      });
      hidden++;
      console.log(`reconcile: hid ${so.so_number} — no longer in Zoho`);
    }

    await recordSyncRun(db, "reconcile", { records_seen: seen, records_upsert: hidden });
    console.log(`reconcile done zohoIds=${seen} checked=${active?.length ?? 0} hidden=${hidden} ms=${Date.now() - started}`);

    return json({ ok: true, zohoIds: seen, checked: active?.length ?? 0, hidden });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`reconcile failed: ${message}`);
    await recordSyncRun(db, "reconcile", { records_seen: seen, records_upsert: hidden, error: message });
    return json({ error: "reconcile failed" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
