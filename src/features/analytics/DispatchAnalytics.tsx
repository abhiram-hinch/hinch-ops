import { useMemo } from "react";
import { Download, PauseCircle, Truck } from "lucide-react";
import { ACTIONABLE_DISPATCH, dispatchShort } from "@/lib/labels";
import { bucketSum, granularityFor } from "@/lib/analyticsPeriod";
import { downloadCsv } from "@/lib/csv";
import { BarRows, TrendLine } from "@/components/Charts";
import {
  useDeliveryPerformance,
  useDispatchDaily,
  useStageSnapshot,
  type AnalyticsRange,
} from "@/hooks/useAnalytics";
import { ErrorNote, Skeleton } from "@/components/Primitives";

export function DispatchAnalytics({ from, range }: { from: string | null; range: AnalyticsRange }) {
  const stage = useStageSnapshot();
  const dispatchDaily = useDispatchDaily(from);
  const delivery = useDeliveryPerformance(from);
  const granularity = granularityFor(range);

  const stageRows = useMemo(() => {
    if (!stage.data) return [];
    const counts = new Map<string, { fresh: number; aged: number }>();
    for (const r of stage.data) {
      if (!ACTIONABLE_DISPATCH.includes(r.dispatch_status)) continue;
      const cur = counts.get(r.dispatch_status) ?? { fresh: 0, aged: 0 };
      if (r.days_in_status >= 3) cur.aged += 1;
      else cur.fresh += 1;
      counts.set(r.dispatch_status, cur);
    }
    return ACTIONABLE_DISPATCH.filter((s) => counts.has(s)).map((s) => ({
      label: dispatchShort[s],
      segments: [
        { value: counts.get(s)!.fresh, color: "#2a78d6" },
        { value: counts.get(s)!.aged, color: "#B45309" },
      ],
    }));
  }, [stage.data]);

  const onHoldCount = stage.data?.filter((r) => r.dispatch_status === "on_hold").length ?? 0;

  const volumeTrend = useMemo(
    () =>
      dispatchDaily.data
        ? bucketSum(dispatchDaily.data, (r) => r.day, (r) => r.dispatch_count, granularity)
        : [],
    [dispatchDaily.data, granularity],
  );

  const onTimeRate = useMemo(() => {
    if (!delivery.data || delivery.data.length === 0) return null;
    const onTime = delivery.data.filter(
      (r) => new Date(r.delivered_at) <= new Date(r.delivery_date + "T23:59:59"),
    ).length;
    return Math.round((onTime / delivery.data.length) * 100);
  }, [delivery.data]);

  if (stage.isLoading || dispatchDaily.isLoading) return <Skeleton rows={6} />;
  if (stage.error) return <ErrorNote error={stage.error} retry={() => stage.refetch()} />;
  if (dispatchDaily.error) return <ErrorNote error={dispatchDaily.error} retry={() => dispatchDaily.refetch()} />;

  function exportCsv() {
    if (!dispatchDaily.data) return;
    downloadCsv(
      `dispatch-volume-${range}.csv`,
      dispatchDaily.data.map((r) => ({
        day: r.day,
        dispatch_count: r.dispatch_count,
        delivered_count: r.delivered_count,
      })),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={exportCsv}
          disabled={!dispatchDaily.data?.length}
          className="btn-ghost btn-sm gap-1.5"
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card p-3.5">
          <p className="flex items-center gap-1 text-micro text-muted">
            <PauseCircle size={11} /> On hold right now
          </p>
          <p className="num mt-1 text-xl font-bold text-ink">{onHoldCount}</p>
        </div>
        <div className="card p-3.5">
          <p className="flex items-center gap-1 text-micro text-muted">
            <Truck size={11} /> Dispatches, this period
          </p>
          <p className="num mt-1 text-xl font-bold text-ink">
            {dispatchDaily.data?.reduce((s, r) => s + r.dispatch_count, 0) ?? 0}
          </p>
        </div>
        <div className="card p-3.5">
          <p className="text-micro text-muted">On-time delivery rate</p>
          <p className="num mt-1 text-xl font-bold text-ink">
            {onTimeRate === null ? "—" : `${onTimeRate}%`}
          </p>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-1 text-sm font-semibold text-ink">Orders in progress, by stage</h3>
        <p className="mb-3 text-micro text-faint">Blue = moving normally · amber = 3+ days in that stage</p>
        <BarRows
          rows={stageRows}
          legend={[
            { label: "Fresh", color: "#2a78d6" },
            { label: "3+ days", color: "#B45309" },
          ]}
        />
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Dispatch volume over time</h3>
        <TrendLine data={volumeTrend} formatValue={(v) => `${v} dispatched`} color="#4a3aa7" />
      </div>

      {onTimeRate === null && (
        <p className="text-micro text-faint">
          On-time rate needs orders with both a promised delivery date and a completed delivery — none yet
          in this period.
        </p>
      )}
    </div>
  );
}
