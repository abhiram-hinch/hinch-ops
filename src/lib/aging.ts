import type { BoardRow } from "@/types/database";

/** Orders younger than this are just in normal flow, not "stuck". */
export const AGING_MIN_DAYS = 3;

export const AGING_BUCKETS = [
  { key: "3-7", label: "3–7 days", min: 3, max: 7 },
  { key: "8-14", label: "8–14 days", min: 8, max: 14 },
  { key: "15-30", label: "15–30 days", min: 15, max: 30 },
  { key: "31-90", label: "31–90 days", min: 31, max: 90 },
  { key: "90+", label: "90+ days", min: 91, max: Infinity },
] as const;

export type AgingBucketKey = (typeof AGING_BUCKETS)[number]["key"];

/** The two stages where an order can sit unprocessed. */
export const AGING_STAGES = ["awaiting_clearance", "to_be_ordered"] as const;
export type AgingStage = (typeof AGING_STAGES)[number];

/** Today's date in IST as YYYY-MM-DD — order_date is Zoho's IST document date. */
export const istToday = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Whole days from an IST calendar date to `today` (never negative). */
export function daysSinceDate(iso: string, today: string = istToday()): number {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const diff = Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d);
  return Math.max(0, Math.round(diff / 86_400_000));
}

/**
 * How long an order has been waiting, counted from the moment that matters
 * for its stage. Awaiting payment is measured from the order date — the
 * dashboard only learned of older orders recently, so "days in stage" is
 * capped at about a month for them and would hide how long the customer has
 * really not paid. Ready to procure is measured from when it became ready,
 * which is what the warehouse can be held to.
 */
export function agingDays(
  r: Pick<BoardRow, "dispatch_status" | "order_date" | "days_in_status">,
  today: string = istToday(),
): number {
  if (r.dispatch_status === "awaiting_clearance" && r.order_date) {
    return daysSinceDate(r.order_date, today);
  }
  return Math.max(0, r.days_in_status ?? 0);
}

export function bucketOf(days: number): AgingBucketKey | null {
  for (const b of AGING_BUCKETS) if (days >= b.min && days <= b.max) return b.key;
  return null;
}
