import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { periskopeSend, clean, type AlertConfig, type Sender } from "./notify.ts";

/**
 * Daily WhatsApp nudge for the operations team: every order that has been
 * partly sent and is still waiting on the rest, oldest first, with what's
 * pending and a link to the dashboard's Partly sent tab. Run once a morning by
 * pg_cron (see 20261008000000_partly_sent.sql).
 *
 *   - No-op until PERISKOPE_OPS_GROUP_CHAT_ID is set (it's a different audience
 *     from the new-order alert group, so it has its own setting).
 *   - Sends nothing when nothing is pending — a daily "all clear" would just
 *     teach people to ignore it.
 *   - Claims the day in daily_digests before sending, so a retry or double
 *     trigger can't post it twice; a failed send releases the claim so the
 *     next run can try again.
 */

export interface PendingItem {
  name: string | null;
  sku: string | null;
  unit: string | null;
  quantity: number | string;
  remaining: number | string;
}

export interface PartlySentRow {
  id: string;
  so_number: string | null;
  customer_name: string | null;
  dispatch_status: string;
  days_since_last_dispatch: number | null;
  goods_sent: number;
  goods_total: number;
  pending_goods: PendingItem[];
  pending_service: PendingItem[];
}

export type DigestResult = "sent" | "disabled" | "nothing-pending" | "already-sent" | "failed";

export interface DigestDeps {
  cfg?: AlertConfig | null;
  send?: Sender;
  now?: () => Date;
}

const KIND = "partly_sent";
const MAX_ORDERS = 12;
const MAX_ITEMS = 3;
const STALE_CLAIM_MS = 15 * 60_000;
const RULE = "━━━━━━━━━━━━━━";

/** Settings from the function secrets; null = digest is off. */
export function loadDigestConfig(): AlertConfig | null {
  const apiKey = Deno.env.get("PERISKOPE_API_KEY");
  const groupChatId = Deno.env.get("PERISKOPE_OPS_GROUP_CHAT_ID");
  const dashboardUrl = Deno.env.get("DASHBOARD_URL");
  if (!apiKey || !groupChatId || !dashboardUrl) return null;
  return {
    apiKey,
    groupChatId,
    phone: Deno.env.get("PERISKOPE_PHONE") || undefined,
    dashboardUrl: dashboardUrl.replace(/\/+$/, ""),
    baseUrl: (Deno.env.get("PERISKOPE_BASE_URL") || "https://api.periskope.app/v1").replace(/\/+$/, ""),
  };
}

const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

const prettyQty = (q: number | string): string => {
  const n = Number(q);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "?";
};

const itemText = (i: PendingItem) => `${clean(i.name ?? i.sku ?? "item", 40) || "item"} ×${prettyQty(i.remaining)}`;

const ageIcon = (days: number | null) => ((days ?? 0) >= 7 ? "🔴" : (days ?? 0) >= 3 ? "🟠" : "🟡");

function describe(r: PartlySentRow): string[] {
  const days = r.days_since_last_dispatch;
  const since = days == null ? "" : days === 0 ? "Last dispatch today" : `Last dispatch ${days} day${days === 1 ? "" : "s"} ago`;
  const progress = r.goods_total > 0 ? `${r.goods_sent}/${r.goods_total} items sent` : "";
  const head = [since, progress].filter(Boolean).join(" · ");

  const lines = [`${ageIcon(days)} *${clean(r.so_number) || "—"}* · ${clean(r.customer_name) || "—"}`];
  if (head) lines.push(`      ${head}`);

  if (r.pending_goods.length > 0) {
    const shown = r.pending_goods.slice(0, MAX_ITEMS).map(itemText).join(", ");
    const more = r.pending_goods.length - MAX_ITEMS;
    lines.push(`      ⏳ Pending: ${shown}${more > 0 ? ` +${more} more` : ""}`);
  } else if (r.pending_service.length > 0) {
    const names = r.pending_service.slice(0, MAX_ITEMS).map((i) => clean(i.name ?? i.sku ?? "service", 40) || "service").join(", ");
    lines.push(`      ⚠️ All goods sent — only a service line is open (${names}). Close the order out if there's nothing more to send.`);
  }
  return lines;
}

/** The digest text. Oldest dispatch first (the caller passes rows in that order). */
export function formatPendingDigest(rows: PartlySentRow[], dashboardUrl: string, today: Date): string {
  const date = today.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const shown = rows.slice(0, MAX_ORDERS);
  const hidden = rows.length - shown.length;
  return [
    `📦 *PARTLY SENT ORDERS* — ${rows.length} waiting`,
    `🗓 ${date}`,
    RULE,
    ...shown.flatMap((r, i) => (i === 0 ? describe(r) : ["", ...describe(r)])),
    ...(hidden > 0 ? ["", `…and ${hidden} more in the dashboard`] : []),
    RULE,
    "👉 *Please update these in the dashboard* (Partly sent tab):",
    `${dashboardUrl}/?view=partly`,
  ].join("\n");
}

async function claimDay(db: SupabaseClient, day: string, nowMs: number): Promise<boolean> {
  const { data, error } = await db
    .from("daily_digests")
    .upsert({ kind: KIND, day, status: "sending" }, { onConflict: "kind,day", ignoreDuplicates: true })
    .select("kind");
  if (error) throw error;
  if (data && data.length > 0) return true;

  // Already claimed today. A claim whose sender died mid-send (still 'sending'
  // after a while) is taken over; a sent one is final.
  const { data: existing, error: readError } = await db
    .from("daily_digests").select("status, created_at").eq("kind", KIND).eq("day", day).maybeSingle();
  if (readError) throw readError;
  if (existing?.status === "sending" && nowMs - new Date(existing.created_at).getTime() > STALE_CLAIM_MS) {
    const { error: takeError } = await db
      .from("daily_digests").update({ created_at: new Date(nowMs).toISOString() }).eq("kind", KIND).eq("day", day).eq("status", "sending");
    if (takeError) throw takeError;
    return true;
  }
  return false;
}

export async function sendPendingDigest(db: SupabaseClient, deps: DigestDeps = {}): Promise<{ result: DigestResult; count: number }> {
  const cfg = deps.cfg === undefined ? loadDigestConfig() : deps.cfg;
  if (!cfg) return { result: "disabled", count: 0 };
  const now = (deps.now ?? (() => new Date()))();
  const send = deps.send ?? periskopeSend;

  const { data, error } = await db
    .from("v_partly_sent")
    .select("id, so_number, customer_name, dispatch_status, days_since_last_dispatch, goods_sent, goods_total, pending_goods, pending_service")
    .order("last_dispatched_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as unknown as PartlySentRow[];
  if (rows.length === 0) return { result: "nothing-pending", count: 0 };

  const day = istDay(now);
  if (!(await claimDay(db, day, now.getTime()))) return { result: "already-sent", count: rows.length };

  try {
    const { providerMessageId } = await send(cfg, formatPendingDigest(rows, cfg.dashboardUrl, now));
    const { error: doneError } = await db
      .from("daily_digests")
      .update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: providerMessageId, order_count: rows.length })
      .eq("kind", KIND).eq("day", day);
    if (doneError) console.error(`digest: sent but could not record it day=${day}: ${doneError.message}`);
    console.log(`digest: sent day=${day} orders=${rows.length}`);
    return { result: "sent", count: rows.length };
  } catch (err) {
    // Release the claim so the next run can retry; log without any secret.
    await db.from("daily_digests").delete().eq("kind", KIND).eq("day", day).eq("status", "sending");
    console.error(`digest: send failed day=${day}: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
    return { result: "failed", count: rows.length };
  }
}
