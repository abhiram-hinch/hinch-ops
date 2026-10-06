import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * Posts one internal WhatsApp message (via Periskope) the first time a sales
 * order shows up on the dashboard, pointing the team at the dashboard to
 * process it. Called from upsertSalesOrder, so every sync path (webhook,
 * poll, panel-open) is covered, and written so that:
 *
 *   - it is a complete no-op until the secrets AND app_config.order_alerts_from
 *     are set, so deploying it changes nothing by itself;
 *   - only orders created on/after order_alerts_from are ever alerted, so
 *     switching it on can't blast the orders already in the system;
 *   - an order is claimed atomically before sending (claim_order_alert), so
 *     duplicate webhooks / a racing poll cannot post it twice;
 *   - a failure is recorded and retried (up to 3 attempts) and never throws
 *     into the sync.
 */

export interface AlertConfig {
  apiKey: string;
  groupChatId: string;
  /** The connected WhatsApp number. Optional for group chats per Periskope. */
  phone?: string;
  /** Public dashboard origin, e.g. https://hinch-ops.pages.dev */
  dashboardUrl: string;
  baseUrl: string;
}

export interface AlertOrder {
  id: string;
  so_number: string | null;
  quotation_ref: string | null;
  quotation_ref_override: string | null;
  customer_name: string | null;
  salesperson_name: string | null;
  total: number | string | null;
  dispatch_status: string;
}

export type Sender = (cfg: AlertConfig, text: string) => Promise<{ providerMessageId: string | null }>;

export type AlertResult =
  | "sent"
  | "failed"
  | "disabled"
  | "not-visible"
  | "before-cutoff"
  | "already-handled";

export interface AlertDeps {
  cfg?: AlertConfig | null;
  send?: Sender;
}

/** Reads the Periskope settings from the function secrets; null = feature off. */
export function loadAlertConfig(): AlertConfig | null {
  const apiKey = Deno.env.get("PERISKOPE_API_KEY");
  const groupChatId = Deno.env.get("PERISKOPE_GROUP_CHAT_ID");
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

const STAGE_LABEL: Record<string, string> = {
  awaiting_clearance: "Awaiting payment",
  to_be_ordered: "Ready to procure",
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** The message body. WhatsApp markdown: *bold*. Kept free of anything sensitive. */
export function formatOrderAlert(o: AlertOrder, dashboardUrl: string): string {
  const quote = o.quotation_ref_override ?? o.quotation_ref;
  const lines = [
    `*New sales order* ${o.so_number ?? ""}`.trim(),
    `Customer: ${o.customer_name ?? "—"}`,
    ...(o.salesperson_name ? [`Salesperson: ${o.salesperson_name}`] : []),
    `Amount: ${inr.format(Number(o.total ?? 0))}`,
    ...(quote ? [`Quote: ${quote}`] : []),
    `Stage: ${STAGE_LABEL[o.dispatch_status] ?? o.dispatch_status}`,
    "",
    `Please process it in the dashboard: ${dashboardUrl}/?order=${o.id}`,
  ];
  return lines.join("\n");
}

/** Periskope: POST /message/send. Returns once the message is accepted (queued). */
export const periskopeSend: Sender = async (cfg, text) => {
  const res = await fetch(`${cfg.baseUrl}/message/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      ...(cfg.phone ? { "x-phone": cfg.phone } : {}),
    },
    body: JSON.stringify({ chat_id: cfg.groupChatId, message: text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Periskope ${res.status}: ${body.slice(0, 160)}`);
  }
  const json = (await res.json().catch(() => ({}))) as { unique_id?: string };
  return { providerMessageId: json.unique_id ?? null };
};

const ORDER_COLUMNS =
  "id, so_number, quotation_ref, quotation_ref_override, customer_name, salesperson_name, total, dispatch_status";

// The cutoff changes rarely and is read on every upsert, so cache it briefly.
let cutoffCache: { at: number; value: Date | null } | null = null;
const CUTOFF_TTL_MS = 30_000;

async function readCutoff(db: SupabaseClient): Promise<Date | null> {
  if (cutoffCache && Date.now() - cutoffCache.at < CUTOFF_TTL_MS) return cutoffCache.value;
  const { data, error } = await db.from("app_config").select("value").eq("key", "order_alerts_from").maybeSingle();
  if (error) throw error;
  const raw = data?.value;
  const parsed = typeof raw === "string" && raw ? new Date(raw) : null;
  const value = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  cutoffCache = { at: Date.now(), value };
  return value;
}

/** Test hook: forget the cached cutoff. */
export function resetAlertCache() {
  cutoffCache = null;
}

/** Record the outcome. A message already went out by the time this runs, so a
 *  lost write would mean a duplicate later — retry once and shout if it still fails. */
async function recordOutcome(db: SupabaseClient, orderId: string, patch: Record<string, unknown>) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error } = await db
      .from("order_alerts")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("sales_order_id", orderId);
    if (!error) return;
    if (attempt === 2) console.error(`alert: could not record outcome order=${orderId}: ${error.message}`);
  }
}

async function deliver(db: SupabaseClient, order: AlertOrder, cfg: AlertConfig, send: Sender): Promise<AlertResult> {
  try {
    const { providerMessageId } = await send(cfg, formatOrderAlert(order, cfg.dashboardUrl));
    await recordOutcome(db, order.id, {
      status: "sent",
      provider_message_id: providerMessageId,
      sent_at: new Date().toISOString(),
    });
    console.log(`alert: sent order=${order.id}`);
    return "sent";
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    await recordOutcome(db, order.id, { status: "failed", last_error: message });
    console.error(`alert: failed order=${order.id}: ${message}`);
    return "failed";
  }
}

/**
 * Alert the group about this order if it's visible on the dashboard, was
 * created after the switch-on time, and hasn't been alerted yet.
 */
export async function notifyNewOrder(db: SupabaseClient, orderId: string, deps: AlertDeps = {}): Promise<AlertResult> {
  const cfg = deps.cfg === undefined ? loadAlertConfig() : deps.cfg;
  if (!cfg) return "disabled";

  const cutoff = await readCutoff(db);
  if (!cutoff) return "disabled";

  // v_ops_board only contains orders that are approved and not void/draft/
  // declined/pending/deleted — i.e. exactly "shown on the dashboard".
  const { data: order, error } = await db.from("v_ops_board").select(ORDER_COLUMNS).eq("id", orderId).maybeSingle();
  if (error) throw error;
  if (!order) return "not-visible";

  const { data: so, error: soError } = await db.from("sales_orders").select("created_at").eq("id", orderId).maybeSingle();
  if (soError) throw soError;
  if (!so || new Date(so.created_at) < cutoff) return "before-cutoff";

  const { data: claimed, error: claimError } = await db.rpc("claim_order_alert", { p_so: orderId });
  if (claimError) throw claimError;
  if (!claimed) return "already-handled";

  return deliver(db, order as AlertOrder, cfg, deps.send ?? periskopeSend);
}

/**
 * Re-send alerts that failed (or whose sender died mid-send). Called from the
 * 15-minute poll; claim_order_alert enforces the 3-attempt limit.
 */
export async function retryFailedAlerts(db: SupabaseClient, deps: AlertDeps = {}): Promise<number> {
  const cfg = deps.cfg === undefined ? loadAlertConfig() : deps.cfg;
  if (!cfg) return 0;
  if (!(await readCutoff(db))) return 0;

  const { data, error } = await db
    .from("order_alerts")
    .select("sales_order_id")
    .lt("attempts", 3)
    .or(`status.eq.failed,and(status.eq.sending,updated_at.lt.${new Date(Date.now() - 10 * 60_000).toISOString()})`);
  if (error) throw error;

  let sent = 0;
  for (const row of data ?? []) {
    const { data: order } = await db.from("v_ops_board").select(ORDER_COLUMNS).eq("id", row.sales_order_id).maybeSingle();
    if (!order) continue;
    const { data: claimed } = await db.rpc("claim_order_alert", { p_so: row.sales_order_id });
    if (!claimed) continue;
    if ((await deliver(db, order as AlertOrder, cfg, deps.send ?? periskopeSend)) === "sent") sent++;
  }
  return sent;
}
