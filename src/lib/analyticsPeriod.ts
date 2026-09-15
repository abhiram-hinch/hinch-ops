import { format, parseISO, startOfWeek } from "date-fns";
import type { AnalyticsRange } from "@/hooks/useAnalytics";

export type Granularity = "day" | "week";

/** Short ranges are readable daily; longer ones need weekly buckets. */
export const granularityFor = (range: AnalyticsRange): Granularity => (range === "30" ? "day" : "week");

export function periodKey(dateStr: string, granularity: Granularity): string {
  const d = parseISO(dateStr);
  return granularity === "day"
    ? format(d, "yyyy-MM-dd")
    : format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export function periodLabel(key: string, granularity: Granularity): string {
  const d = parseISO(key);
  return granularity === "day" ? format(d, "d MMM") : `Wk ${format(d, "d MMM")}`;
}

/** Group rows into sorted {label, value} buckets, keyed by a date field, summed by a numeric field. */
export function bucketSum<T>(
  rows: T[],
  getDate: (r: T) => string,
  getValue: (r: T) => number,
  granularity: Granularity,
): { label: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = periodKey(getDate(r), granularity);
    totals.set(key, (totals.get(key) ?? 0) + getValue(r));
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ label: periodLabel(key, granularity), value }));
}
