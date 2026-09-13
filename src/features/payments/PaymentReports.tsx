import { useState } from "react";
import { money, moneyExact, shortDate } from "@/lib/format";
import { usePaymentDailyReport, usePaymentWeeklyReport } from "@/hooks/useBoard";
import { Empty, ErrorNote, Skeleton } from "@/components/Primitives";
import { BarChart3 } from "lucide-react";
import type { PaymentDailyTotal, PaymentWeeklyTotal } from "@/types/database";

type Grain = "daily" | "weekly";

function Row({
  label,
  count,
  total,
  cleared,
  pending,
}: {
  label: string;
  count: number;
  total: number;
  cleared: number;
  pending: number;
}) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-2 pr-3 text-[13px] font-medium text-ink">{label}</td>
      <td className="num py-2 pr-3 text-right text-[13px] text-muted">{count}</td>
      <td className="num py-2 pr-3 text-right text-sm font-semibold text-ink">
        {moneyExact(total)}
      </td>
      <td className="num py-2 pr-3 text-right text-micro text-good">{money(cleared)}</td>
      <td className="num py-2 text-right text-micro text-warn">{money(pending)}</td>
    </tr>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="card overflow-x-auto p-3.5">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line text-micro text-faint">
            <th className="pb-2 pr-3 text-left font-medium">Period</th>
            <th className="pb-2 pr-3 text-right font-medium">Payments</th>
            <th className="pb-2 pr-3 text-right font-medium">Total</th>
            <th className="pb-2 pr-3 text-right font-medium">Cleared</th>
            <th className="pb-2 text-right font-medium">Pending</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * Admin-only view of money coming in over time. Reuses the payments table's
 * existing (already fully-open) RLS — this narrows nothing at the DB level
 * that wasn't already readable; the role check here is the same UI-gating
 * convention the rest of the app uses for payment visibility.
 */
export function PaymentReports() {
  const [grain, setGrain] = useState<Grain>("daily");
  const daily = usePaymentDailyReport(grain === "daily");
  const weekly = usePaymentWeeklyReport(grain === "weekly");
  const active = grain === "daily" ? daily : weekly;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
          <BarChart3 size={16} className="text-muted" /> Payments received
        </h2>
        <div className="flex rounded-pill border border-line p-0.5">
          <button
            onClick={() => setGrain("daily")}
            className={`rounded-pill px-3 py-1 text-[13px] font-semibold ${
              grain === "daily" ? "bg-brand text-white" : "text-muted hover:text-ink"
            }`}
          >
            Daily
          </button>
          <button
            onClick={() => setGrain("weekly")}
            className={`rounded-pill px-3 py-1 text-[13px] font-semibold ${
              grain === "weekly" ? "bg-brand text-white" : "text-muted hover:text-ink"
            }`}
          >
            Weekly
          </button>
        </div>
      </div>

      {active.isLoading && <Skeleton rows={5} />}
      {active.error && <ErrorNote error={active.error} retry={() => active.refetch()} />}

      {active.data && active.data.length === 0 && (
        <Empty
          icon={<BarChart3 size={28} />}
          title="No payments yet"
          hint="Once payments are recorded, totals show up here by period."
        />
      )}

      {grain === "daily" && daily.data && daily.data.length > 0 && (
        <Table>
          {(daily.data as PaymentDailyTotal[]).map((r) => (
            <Row
              key={r.day}
              label={shortDate(r.day)}
              count={r.payment_count}
              total={r.total_amount}
              cleared={r.cleared_amount}
              pending={r.pending_amount}
            />
          ))}
        </Table>
      )}

      {grain === "weekly" && weekly.data && weekly.data.length > 0 && (
        <Table>
          {(weekly.data as PaymentWeeklyTotal[]).map((r) => (
            <Row
              key={r.week_start}
              label={`Week of ${shortDate(r.week_start)}`}
              count={r.payment_count}
              total={r.total_amount}
              cleared={r.cleared_amount}
              pending={r.pending_amount}
            />
          ))}
        </Table>
      )}
    </div>
  );
}
