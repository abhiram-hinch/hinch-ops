/**
 * Daily nudge to the operations team about partly sent orders. Invoked once a
 * morning by pg_cron (Mon-Sat, 10:00 IST) with the service-role key, so it is
 * deployed WITH JWT verification, like zoho-so-poll. Does nothing until
 * PERISKOPE_OPS_GROUP_CHAT_ID is set.
 *
 * Deploy with:  supabase functions deploy pending-dispatch-digest
 */

import { serviceClient } from "../_shared/upsert.ts";
import { sendPendingDigest } from "../_shared/digest.ts";

Deno.serve(async () => {
  try {
    const { result, count } = await sendPendingDigest(serviceClient());
    return new Response(JSON.stringify({ ok: result !== "failed", result, count }), {
      status: result === "failed" ? 502 : 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error(`digest failed: ${err instanceof Error ? err.message : String(err)}`);
    return new Response(JSON.stringify({ error: "digest failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
