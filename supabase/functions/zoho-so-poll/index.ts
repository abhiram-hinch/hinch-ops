/**
 * Safety-net poll. Zoho webhooks have no retry guarantee and are capped near
 * 500/day, so any order whose webhook failed to deliver would otherwise never
 * appear. This reconciles from a persisted cursor.
 *
 * Deploy with:  supabase functions deploy zoho-so-poll
 * Invoked by pg_cron every 15 minutes (see migration), and by the "Sync now"
 * button in the dashboard.
 */

import { iterateModifiedSalesOrders } from "../_shared/zoho.ts";
import { serviceClient, upsertSalesOrder, recordSyncRun } from "../_shared/upsert.ts";

const CURSOR_KEY = "so_last_modified_cursor";
const OVERLAP_MINUTES = 10; // re-scan window; upserts are idempotent so overlap is free

Deno.serve(async (req) => {
  const db = serviceClient();
  const started = Date.now();

  // Auth: cron passes the service role key; the UI button calls with the user's
  // JWT and this function is deployed WITH jwt verification, so reaching this
  // line already means an authenticated caller.
  let seen = 0;
  let upserted = 0;

  try {
    // ---- resolve cursor ---------------------------------------------------
    const { data: state } = await db
      .from("sync_state")
      .select("value")
      .eq("key", CURSOR_KEY)
      .maybeSingle();

    const fallback = new Date(Date.now() - 24 * 3600_000);
    const cursor = state?.value ? new Date(state.value) : fallback;
    const since = new Date(cursor.getTime() - OVERLAP_MINUTES * 60_000);

    // Zoho expects local-offset ISO. Our org is IST.
    const sinceParam = toZohoTime(since);

    // ---- page through modified orders -------------------------------------
    let newest = cursor;

    for await (const page of iterateModifiedSalesOrders(sinceParam)) {
      seen += page.length;
      for (const so of page) {
        try {
          await upsertSalesOrder(db, so);
          upserted++;
          const lm = so.last_modified_time ? new Date(so.last_modified_time) : null;
          if (lm && lm > newest) newest = lm;
        } catch (err) {
          // One bad order must not abort the run — the rest still need syncing.
          console.error(
            `poll: skipped ${so.salesorder_id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    // ---- advance cursor only on a clean pass ------------------------------
    if (upserted === seen) {
      await db.from("sync_state").upsert({
        key: CURSOR_KEY,
        value: newest.toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    } else {
      console.warn(
        `poll: ${seen - upserted} failures — holding cursor so next run retries`,
      );
    }

    await recordSyncRun(db, "poll", { records_seen: seen, records_upsert: upserted });
    console.log(`poll done seen=${seen} upserted=${upserted} ms=${Date.now() - started}`);

    return json({ ok: true, seen, upserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`poll failed: ${message}`);
    await recordSyncRun(db, "poll", { records_seen: seen, records_upsert: upserted, error: message });
    return json({ error: "poll failed" }, 500);
  }
});

/** Zoho expects yyyy-MM-ddTHH:mm:ss±HHmm in the org's timezone (IST). */
function toZohoTime(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return ist.toISOString().replace(/\.\d{3}Z$/, "") + "+0530";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
