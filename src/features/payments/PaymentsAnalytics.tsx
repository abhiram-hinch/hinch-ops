import { useMemo } from "react";
import { AlertTriangle, TrendingUp } from "lucide-react";
import { money, moneyShort, shortDate } from "@/lib/format";
import { methodLabel } from "@/lib/labels";
import { bucketSum, granularityFor } from "@/lib/analyticsPeriod";
import { BarRows, TrendLine, categoricalColor } from "@/components/Charts";
import { useCreditExposure, usePaymentsSlim, type AnalyticsRange } from "@/hooks/useAnalytics";
import { ErrorNote, Skeleton } from "@/components/Primitives";

function agingBucket(orderDate: string | null, creditDays: number | null): string {
  if (!orderDate || creditDays == null) return "Unknown";
  const dueDate = new Date(orderDate);
  dueDate.setDate(dueDate.getDate() + creditDays);
  const daysPast = Math.floor((Date.now() - dueDate.getTime()) / 86_400_000);
  if (daysPast <= 0) return "Not yet due";
  if (daysPast <= 30) return "1–30 days overdue";
  if (daysPast <= 60) return "31–60 days overdue";
  return "60+ days overdue";
}

const AGING_ORDER = ["Not yet due", "1–30 days overdue", "31–60 days overdue", "60+ days overdue", "Unknown"];
const AGING_COLOR: Record<string, string> = {
  "Not yet due": "#15803D",
  "1–30 days overdue": "#B45309",
  "31–60 days overdue": "#e34948",
  "60+ days overdue": "#B91C1C",
  Unknown: "#94A3B8",
};

export function PaymentsAnalytics({ from, range }: { from: string | null; range: AnalyticsRange }) {
  const { data, isLoading, error, refetch } = usePaymentsSlim(from);
  const credit = useCreditExposure();
  const granularity = granularityFor(range);

  const trend = useMemo(
    () => (data ? bucketSum(data, (r) => r.paid_on, (r) => r.amount, granularity) : []),
    [data, granularity],
  );

  const clearedVsPending = useMemo(() => {
    if (!data) return [];
    const totals = new Map<string, { cleared: number; pending: number }>();
    for (const r of data) {
      const key = r.paid_on;
      const cur = totals.get(key) ?? { cleared: 0, pending: 0 };
      if (r.clearance_status === "cleared") cur.cleared += r.amount;
      else if (r.clearance_status === "pending") cur.pending += r.amount;
      totals.set(key, cur);
    }
    return [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([label, v]) => ({
        label: shortDate(label),
        segments: [
          { value: v.cleared, color: "#15803D" },
          { value: v.pending, color: "#B45309" },
        ],
      }));
  }, [data]);

  const byMethod = useMemo(() => {
    if (!data) return [];
    const totals = new Map<string, number>();
    for (const r of data) totals.set(r.payment_method, (totals.get(r.payment_method) ?? 0) + r.amount);
    return [...totals.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([method, value], i) => ({
        label: methodLabel(method as Parameters<typeof methodLabel>[0]),
        segments: [{ value, color: categoricalColor(i) }],
      }));
  }, [data]);

  const creditRows = useMemo(() => {
    if (!credit.data) return [];
    const totals = new Map<string, number>();
    for (const r of credit.data) {
      const bucket = agingBucket(r.order_date, r.credit_days);
      totals.set(bucket, (totals.get(bucket) ?? 0) + r.balance_due);
    }
    return AGING_ORDER.filter((b) => totals.has(b)).map((b) => ({
      label: b,
      segments: [{ value: totals.get(b)!, color: AGING_COLOR[b] }],
    }));
  }, [credit.data]);

  const totalExposure = credit.data?.reduce((s, r) => s + r.balance_due, 0) ?? 0;
  const totalReceived = data?.reduce((s, r) => s + r.amount, 0) ?? 0;

  if (isLoading) return <Skeleton rows={6} />;
  if (error) return <ErrorNote error={error} retry={() => refetch()} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card p-3.5">
          <p className="text-micro text-muted">Payments received</p>
          <p className="num mt-1 text-xl font-bold text-ink">{moneyShort(totalReceived)}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-micro text-muted">Payments recorded</p>
          <p className="num mt-1 text-xl font-bold text-ink">{data?.length ?? 0}</p>
        </div>
        <div className="card p-3.5">
          <p className="flex items-center gap-1 text-micro text-muted">
            <AlertTriangle size={11} /> Credit exposure
          </p>
          <p className="num mt-1 text-xl font-bold text-ink">{moneyShort(totalExposure)}</p>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <TrendingUp size={14} className="text-muted" /> Payments received over time
        </h3>
        <TrendLine data={trend} formatValue={money} />
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-[13px] font-semibold text-ink">Cleared vs pending (recent)</h3>
        <BarRows
          rows={clearedVsPending}
          formatValue={money}
          legend={[
            { label: "Cleared", color: "#15803D" },
            { label: "Pending", color: "#B45309" },
          ]}
        />
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-[13px] font-semibold text-ink">Payment method mix</h3>
        <BarRows rows={byMethod} formatValue={money} />
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-[13px] font-semibold text-ink">Credit exposure by age</h3>
        {credit.isLoading && <Skeleton rows={3} />}
        {credit.data && <BarRows rows={creditRows} formatValue={money} />}
      </div>
    </div>
  );
}
