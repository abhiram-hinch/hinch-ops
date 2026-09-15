import { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { money, moneyShort } from "@/lib/format";
import { bucketSum, granularityFor } from "@/lib/analyticsPeriod";
import { BarRows, TrendLine, categoricalColor } from "@/components/Charts";
import { useSalesOrdersSlim, type AnalyticsRange } from "@/hooks/useAnalytics";
import { ErrorNote, Skeleton } from "@/components/Primitives";

export function SalesAnalytics({ from, range }: { from: string | null; range: AnalyticsRange }) {
  const { data, isLoading, error, refetch } = useSalesOrdersSlim(from);
  const granularity = granularityFor(range);

  const trend = useMemo(
    () => (data ? bucketSum(data, (r) => r.order_date ?? "", (r) => r.total, granularity) : []),
    [data, granularity],
  );

  const bySalesperson = useMemo(() => {
    if (!data) return [];
    const totals = new Map<string, { total: number; count: number }>();
    for (const r of data) {
      const key = r.salesperson_name?.trim() || "Unassigned";
      const cur = totals.get(key) ?? { total: 0, count: 0 };
      cur.total += r.total;
      cur.count += 1;
      totals.set(key, cur);
    }
    return [...totals.entries()]
      .sort(([, a], [, b]) => b.total - a.total)
      .map(([label, v], i) => ({
        label: `${label} (${v.count})`,
        segments: [{ value: v.total, color: categoricalColor(i) }],
      }));
  }, [data]);

  const byCustomer = useMemo(() => {
    if (!data) return [];
    const totals = new Map<string, number>();
    for (const r of data) {
      const key = r.customer_name?.trim() || "Unknown";
      totals.set(key, (totals.get(key) ?? 0) + r.total);
    }
    return [...totals.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([label, value], i) => ({ label, segments: [{ value, color: categoricalColor(i) }] }));
  }, [data]);

  const totalValue = data?.reduce((s, r) => s + r.total, 0) ?? 0;
  const totalCount = data?.length ?? 0;

  if (isLoading) return <Skeleton rows={6} />;
  if (error) return <ErrorNote error={error} retry={() => refetch()} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card p-3.5">
          <p className="text-micro text-muted">Order value</p>
          <p className="num mt-1 text-xl font-bold text-ink">{moneyShort(totalValue)}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-micro text-muted">Orders</p>
          <p className="num mt-1 text-xl font-bold text-ink">{totalCount}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-micro text-muted">Avg order value</p>
          <p className="num mt-1 text-xl font-bold text-ink">
            {money(totalCount ? totalValue / totalCount : 0)}
          </p>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <TrendingUp size={14} className="text-muted" /> Order value over time
        </h3>
        <TrendLine data={trend} formatValue={money} />
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-[13px] font-semibold text-ink">Salesperson leaderboard</h3>
        <BarRows rows={bySalesperson} formatValue={money} />
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-[13px] font-semibold text-ink">Top customers</h3>
        <BarRows rows={byCustomer} formatValue={money} />
      </div>
    </div>
  );
}
