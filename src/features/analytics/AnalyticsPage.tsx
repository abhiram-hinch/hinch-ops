import { useState } from "react";
import { BarChart3 } from "lucide-react";
import { rangeFromDate, type AnalyticsRange } from "@/hooks/useAnalytics";
import { SalesAnalytics } from "./SalesAnalytics";
import { PaymentsAnalytics } from "@/features/payments/PaymentsAnalytics";
import { DispatchAnalytics } from "./DispatchAnalytics";

type Section = "sales" | "payments" | "dispatch";

const RANGES: [AnalyticsRange, string][] = [
  ["30", "30 days"],
  ["90", "90 days"],
  ["365", "1 year"],
  ["all", "All time"],
];

const SECTIONS: [Section, string][] = [
  ["sales", "Sales"],
  ["payments", "Payments"],
  ["dispatch", "Dispatch"],
];

/**
 * Admin-only analytics. All three sections share one date-range control —
 * short ranges bucket daily, longer ones weekly (see analyticsPeriod.ts).
 */
export function AnalyticsPage() {
  const [section, setSection] = useState<Section>("sales");
  const [range, setRange] = useState<AnalyticsRange>("90");
  const from = rangeFromDate(range);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
          <BarChart3 size={16} className="text-muted" /> Analytics
        </h2>
        <div className="flex rounded-pill border border-line p-0.5">
          {RANGES.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              className={`rounded-pill px-3 py-1 text-[13px] font-semibold ${
                range === key ? "bg-brand text-white" : "text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 border-b border-line">
        {SECTIONS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
              section === key ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "sales" && <SalesAnalytics from={from} range={range} />}
      {section === "payments" && <PaymentsAnalytics from={from} range={range} />}
      {section === "dispatch" && <DispatchAnalytics from={from} range={range} />}
    </div>
  );
}
