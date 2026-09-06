/**
 * Zoho Books API client for Supabase Edge Functions.
 *
 * Rules enforced here (see CLAUDE.md):
 *  - Credentials come from Deno.env only. Never persisted, never logged.
 *  - api_domain is read from the token response, never hardcoded.
 *  - Access tokens are cached in memory for the isolate's life only.
 */

const ACCOUNTS_HOST = Deno.env.get("ZOHO_ACCOUNTS_HOST") ?? "https://accounts.zoho.in";
const CLIENT_ID = requireEnv("ZOHO_CLIENT_ID");
const CLIENT_SECRET = requireEnv("ZOHO_CLIENT_SECRET");
const REFRESH_TOKEN = requireEnv("ZOHO_REFRESH_TOKEN");
export const ORG_ID = requireEnv("ZOHO_ORGANIZATION_ID");

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

interface TokenState {
  accessToken: string;
  apiDomain: string;
  expiresAt: number;
}

// Per-isolate cache. Supabase may reuse an isolate across invocations, so this
// avoids a token call per request without ever writing a token to disk or db.
let cached: TokenState | null = null;

/** Mint or reuse an access token. Refreshes 5 min before expiry. */
async function getToken(): Promise<TokenState> {
  if (cached && Date.now() < cached.expiresAt - 300_000) return cached;

  const url = new URL("/oauth/v2/token", ACCOUNTS_HOST);
  url.searchParams.set("refresh_token", REFRESH_TOKEN);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("client_secret", CLIENT_SECRET);
  url.searchParams.set("grant_type", "refresh_token");

  const res = await fetch(url, { method: "POST" });
  const body = await res.json().catch(() => ({}));

  if (!res.ok || !body.access_token) {
    // Deliberately does not echo the response body — it can contain the token.
    throw new Error(
      `Zoho token refresh failed (${res.status}). ` +
        `error=${body.error ?? "unknown"}. ` +
        `If this says invalid_code, the refresh token was revoked — most likely ` +
        `the 20-token-per-user limit. Re-authorize the dedicated integration user.`,
    );
  }

  cached = {
    accessToken: body.access_token,
    // Zoho returns this WITHOUT a scheme. Never hardcode the domain.
    apiDomain: (body.api_domain ?? "https://www.zohoapis.in").replace(/\/$/, ""),
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cached;
}

/** Invalidate the cache — call after a 401 so the next attempt re-mints. */
export function invalidateToken() {
  cached = null;
}

export interface ZohoRequest {
  path: string;
  params?: Record<string, string | number | undefined>;
  retryOn401?: boolean;
}

/**
 * GET against Zoho Books. Retries once on 401 (stale cached token) and
 * respects 429 with a single backoff. Anything else throws.
 */
export async function zohoGet<T = unknown>({
  path,
  params = {},
  retryOn401 = true,
}: ZohoRequest): Promise<T> {
  const { accessToken, apiDomain } = await getToken();

  const url = new URL(`/books/v3${path}`, apiDomain);
  url.searchParams.set("organization_id", ORG_ID);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });

  if (res.status === 401 && retryOn401) {
    invalidateToken();
    return zohoGet<T>({ path, params, retryOn401: false });
  }

  if (res.status === 429) {
    // ~100 req/min. Back off once, then give up and let the poll catch it.
    await new Promise((r) => setTimeout(r, 5_000));
    return zohoGet<T>({ path, params, retryOn401: false });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zoho GET ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }

  return (await res.json()) as T;
}

/** Fetch a single sales order with full line items. */
export async function fetchSalesOrder(salesorderId: string): Promise<ZohoSalesOrder> {
  const body = await zohoGet<{ salesorder: ZohoSalesOrder }>({
    path: `/salesorders/${salesorderId}`,
  });
  if (!body?.salesorder) throw new Error(`No salesorder in response for ${salesorderId}`);
  return body.salesorder;
}

/**
 * Fetch the sales order as a PDF. Same endpoint, `accept=pdf`. Returns the raw
 * bytes; the caller stores them in the so-pdfs bucket.
 */
export async function fetchSalesOrderPdf(salesorderId: string): Promise<Uint8Array> {
  const { accessToken, apiDomain } = await getToken();
  const url = new URL(`/books/v3/salesorders/${salesorderId}`, apiDomain);
  url.searchParams.set("organization_id", ORG_ID);
  url.searchParams.set("accept", "pdf");

  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: "application/pdf" },
  });

  if (res.status === 401) {
    invalidateToken();
    const retry = await getToken();
    const res2 = await fetch(url, {
      headers: {
        Authorization: `Zoho-oauthtoken ${retry.accessToken}`,
        Accept: "application/pdf",
      },
    });
    if (!res2.ok) throw new Error(`Zoho SO PDF ${salesorderId} failed (${res2.status})`);
    return new Uint8Array(await res2.arrayBuffer());
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zoho SO PDF ${salesorderId} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Page through sales orders modified since a timestamp. */
export async function* iterateModifiedSalesOrders(
  sinceIso: string,
  maxPages = 25,
): AsyncGenerator<ZohoSalesOrder[]> {
  let page = 1;
  while (page <= maxPages) {
    const body = await zohoGet<{
      salesorders: ZohoSalesOrder[];
      page_context?: { has_more_page?: boolean };
    }>({
      path: "/salesorders",
      params: {
        last_modified_time: sinceIso,
        sort_column: "last_modified_time",
        sort_order: "A",
        per_page: 200,
        page,
      },
    });

    const rows = body.salesorders ?? [];
    if (rows.length) yield rows;

    if (!body.page_context?.has_more_page) return;
    page++;
    // Stay well inside ~100 req/min.
    await new Promise((r) => setTimeout(r, 700));
  }
  console.warn(`Stopped paging at ${maxPages} pages — next run will resume from cursor`);
}

/** Constant-time string comparison for the webhook shared secret. */
export function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Types — intentionally loose. Zoho Books, Inventory and Commerce expose
// different sales-order fields; these are pinned from a live response from our
// own org. Do not widen from third-party docs.
// ---------------------------------------------------------------------------

export interface ZohoLineItem {
  line_item_id?: string;
  name?: string;
  sku?: string;
  description?: string;
  hsn_or_sac?: string;
  unit?: string;
  product_type?: string; // "goods" | "service"
  line_item_type?: string;
  quantity?: number;
  rate?: number;
  item_total?: number;
}

export interface ZohoAddress {
  attention?: string;
  address?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
  [key: string]: unknown;
}

export interface ZohoSalesOrder {
  salesorder_id: string;
  salesorder_number?: string;
  reference_number?: string; // HINCH puts the originating quotation number here
  customer_id?: string;
  customer_name?: string;
  salesperson_name?: string;
  date?: string;
  total?: number;
  status?: string;
  order_status?: string;
  current_sub_status?: string;
  approval_state?: string;
  is_approved?: boolean;
  approvers_list?: unknown[];
  last_modified_time?: string;
  line_items?: ZohoLineItem[];

  // Operational / dispatch detail (present on the single-order payload,
  // and partially on the list payload).
  shipped_status?: string;
  invoiced_status?: string;
  delivery_date?: string;
  total_quantity?: number;
  shipping_address?: ZohoAddress;
  email?: string;
  phone?: string;
  notes?: string;
  contact?: { phone?: string; mobile?: string; [key: string]: unknown };

  [key: string]: unknown;
}
