import { useMemo, useState } from "react";
import { Hourglass, Search } from "lucide-react";
import { Empty, ErrorNote, Input, Select, Skeleton } from "@/components/Primitives";
import { StatusBadge, toneChip } from "@/lib/statusUi";
import { money, shortDate } from "@/lib/format";
import { dispatchLabel } from "@/lib/labels";
import { AGING_BUCKETS, AGING_MIN_DAYS, AGING_STAGES, type AgingBucketKey, type AgingStage } from "@/lib/aging";
import { useAging, type AgingRow } from "@/hooks/useAging";

const PAGE_SIZE = 100;

interface Filters {
  stage: AgingStage | "all";
  bucket: AgingBucketKey | "all";
  salesperson: string;
  search: string;
  sort: "oldest" | "value";
  limit: number;
}

const initial: Filters = { stage: "all", bucket: "all", salesperson: "", search: "", sort: "oldest", limit: PAGE_SIZE };

const sum = (rows: AgingRow[]) => rows.reduce((s, r) => s + Number(r.total ?? 0), 0);

/** Older = redder: a week is a nudge, two weeks is a problem. */
const ageTone = (days: number) => (days >= 15 ? toneChip.bad : toneChip.warn);

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm font-medium transition-colors ${
        on ? "bg-ink text-white" : "bg-surface text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Orders that haven't moved: sitting at Awaiting payment or Ready to procure
 * for three days or more, oldest first. A standing worklist — it ignores the
 * board's date range, since an order stuck for six weeks is exactly the one
 * that has aged out of "today".
 */
export function AgingPage({ role, onSelectOrder }: { role?: string; onSelectOrder: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useAging(role);
  const [f, setF] = useState<Filters>(initial);
  const patch = (p: Partial<Filters>) => setF((cur) => ({ ...cur, limit: PAGE_SIZE, ...p }));

  const rows = data ?? [];
  const salespeople = useMemo(
    () => [...new Set(rows.map((r) => r.salesperson_name).filter(Boolean) as string[])].sort(),
    [rows],
  );

  // Stage cards always describe everything stuck, whatever else is filtered.
  const byStage = useMemo(
    () =>
      Object.fromEntries(
        AGING_STAGES.map((s) => {
          const list = rows.filter((r) => r.dispatch_status === s);
          return [s, { count: list.length, value: sum(list) }];
        }),
      ) as Record<AgingStage, { count: number; value: number }>,
    [rows],
  );

  // Everything except the age bucket, so each bucket chip shows what picking it would give.
  const scoped = useMemo(() => {
    const term = f.search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (f.stage === "all" || r.dispatch_status === f.stage) &&
        (!f.salesperson || r.salesperson_name === f.salesperson) &&
        (!term ||
          [r.customer_name, r.so_number, r.quotation_ref, r.quotation_ref_override]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(term))),
    );
  }, [rows, f.stage, f.salesperson, f.search]);

  const bucketCounts = useMemo(() => {
    const m = new Map<AgingBucketKey, number>();
    for (const r of scoped) m.set(r.bucket, (m.get(r.bucket) ?? 0) + 1);
    return m;
  }, [scoped]);

  const visible = useMemo(() => {
    const list = f.bucket === "all" ? scoped : scoped.filter((r) => r.bucket === f.bucket);
    return [...list].sort((a, b) => (f.sort === "value" ? b.total - a.total : b.age_days - a.age_days));
  }, [scoped, f.bucket, f.sort]);

  const stages = AGING_STAGES.filter((s) => byStage[s].count > 0 || f.stage === s);

  if (isLoading) return <Skeleton rows={8} />;
  if (error) return <ErrorNote error={error} retry={() => refetch()} />;

  return (
    <div>
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
          <Hourglass size={18} className="text-warn" /> Aging
        </h2>
        <p className="mt-0.5 max-w-2xl text-sm text-muted">
          Orders that haven't moved in {AGING_MIN_DAYS}+ days. Awaiting payment is counted from the order date; Ready
          to procure from the day it became ready. Orders Zoho shows as closed are left out.
        </p>
      </div>

      {stages.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-2.5">
          {stages.map((s) => {
            const on = f.stage === s;
            return (
              <button
                key={s}
                onClick={() => patch({ stage: on ? "all" : s })}
                aria-pressed={on}
                className={`card px-3 py-3 text-left transition hover:border-lineStrong sm:px-4 ${
                  on ? "ring-2 ring-brand ring-offset-1 ring-offset-canvas" : ""
                }`}
              >
                <StatusBadge status={s} size="sm" />
                <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="num text-2xl font-bold text-ink">{byStage[s].count.toLocaleString("en-IN")}</span>
                  <span className="text-sm text-muted">orders</span>
                  <span className="num w-full text-base font-semibold text-ink sm:ml-auto sm:w-auto">
                    {money(byStage[s].value)}
                  </span>
                </p>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Chip on={f.bucket === "all"} onClick={() => patch({ bucket: "all" })}>
          All ages <span className="num text-faint">{scoped.length.toLocaleString("en-IN")}</span>
        </Chip>
        {AGING_BUCKETS.map((b) => (
          <Chip key={b.key} on={f.bucket === b.key} onClick={() => patch({ bucket: b.key })}>
            {b.label}{" "}
            <span className="num text-faint">{(bucketCounts.get(b.key) ?? 0).toLocaleString("en-IN")}</span>
          </Chip>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={f.search}
            onChange={(e) => patch({ search: e.target.value })}
            placeholder="Search customer, order or quote"
            aria-label="Search aging orders"
            className="h-9 w-full pl-9 text-sm"
          />
        </div>
        <Select
          value={f.salesperson}
          onChange={(e) => patch({ salesperson: e.target.value })}
          aria-label="Salesperson"
          className="h-9 w-auto text-sm"
        >
          <option value="">Any salesperson</option>
          {salespeople.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          value={f.sort}
          onChange={(e) => patch({ sort: e.target.value as Filters["sort"] })}
          aria-label="Sort"
          className="h-9 w-auto text-sm"
        >
          <option value="oldest">Oldest first</option>
          <option value="value">Highest value first</option>
        </Select>
        <span className="num ml-auto text-sm text-muted">
          {visible.length.toLocaleString("en-IN")} orders · {money(sum(visible))}
        </span>
      </div>

      <div className="mt-4">
        {visible.length === 0 ? (
          <Empty
            icon={<Hourglass size={28} />}
            title={rows.length === 0 ? "Nothing is stuck" : "No orders match"}
            hint={
              rows.length === 0
                ? `No order has been waiting ${AGING_MIN_DAYS}+ days at Awaiting payment or Ready to procure.`
                : "Try a different age range, salesperson or search."
            }
          />
        ) : (
          <>
            <ul className="space-y-2">
              {visible.slice(0, f.limit).map((r) => {
                const quote = r.quotation_ref_override ?? r.quotation_ref;
                const awaiting = r.dispatch_status === "awaiting_clearance";
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => onSelectOrder(r.id)}
                      className="card flex w-full items-stretch gap-3 px-3 py-3 text-left transition hover:border-lineStrong hover:shadow-raised sm:gap-4 sm:px-4"
                    >
                      <span
                        className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-lg py-1 ${ageTone(r.age_days)}`}
                        title={awaiting ? "Days since the order date" : "Days since it became ready to procure"}
                      >
                        <span className="num text-lg font-bold leading-tight">{r.age_days}</span>
                        <span className="text-[11px] leading-none">days</span>
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-ink">
                          {r.customer_name ?? "Unnamed customer"}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-micro text-muted">
                          <span className="num">{r.so_number ?? "—"}</span>
                          {quote && <span className="num font-semibold text-ink">Quote {quote}</span>}
                          {r.salesperson_name && <span>· {r.salesperson_name}</span>}
                        </span>
                        <span className="mt-0.5 block text-micro text-faint">
                          {awaiting
                            ? `Ordered ${shortDate(r.order_date)}`
                            : `Ready since ${shortDate(r.status_since)}`}
                          {r.amount_received > 0.01
                            ? ` · ${money(r.amount_received)} received, ${money(r.balance_due)} left`
                            : awaiting
                              ? " · nothing received"
                              : ""}
                        </span>
                      </span>

                      <span className="flex shrink-0 flex-col items-end justify-between gap-1">
                        <span className="num text-base font-bold text-ink">{money(r.total)}</span>
                        <span className="hidden text-micro text-muted sm:block">{dispatchLabel[r.dispatch_status]}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {visible.length > f.limit && (
              <div className="mt-4 text-center">
                <button className="btn-soft btn-md" onClick={() => setF((cur) => ({ ...cur, limit: cur.limit + PAGE_SIZE }))}>
                  Show {Math.min(PAGE_SIZE, visible.length - f.limit)} more · {(visible.length - f.limit).toLocaleString("en-IN")} remaining
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
