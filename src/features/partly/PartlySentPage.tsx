import { useMemo, useState } from "react";
import { AlertTriangle, PackageOpen, Search } from "lucide-react";
import { Empty, ErrorNote, Input, Skeleton } from "@/components/Primitives";
import { toneChip } from "@/lib/statusUi";
import { money, shortDate } from "@/lib/format";
import { dispatchLabel } from "@/lib/labels";
import { usePartlySent, type PartlySentOrder, type PendingItem } from "@/hooks/usePartlySent";

/** A week without the rest going out is a problem; three days is a nudge. */
const ageTone = (days: number | null) => ((days ?? 0) >= 7 ? toneChip.bad : (days ?? 0) >= 3 ? toneChip.warn : toneChip.neutral);

const qty = (n: number) => String(Math.round(Number(n) * 1000) / 1000);
const itemLabel = (i: PendingItem) => `${i.name ?? i.sku ?? "Item"} ×${qty(i.remaining)}`;

function Pending({ order }: { order: PartlySentOrder }) {
  if (order.pending_goods.length > 0) {
    return (
      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        {order.pending_goods.slice(0, 4).map((g, i) => (
          <span key={i} className={`chip px-2 py-0.5 text-micro ${toneChip.warn}`}>
            {itemLabel(g)}
          </span>
        ))}
        {order.pending_goods.length > 4 && (
          <span className="text-micro text-muted">+{order.pending_goods.length - 4} more</span>
        )}
      </span>
    );
  }
  if (order.pending_service.length > 0) {
    return (
      <span className="mt-2 flex items-start gap-1.5 rounded-md bg-warnSoft/50 px-2 py-1.5 text-micro text-warn">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>
          All goods sent — only a service line is open ({order.pending_service.map((s) => s.name ?? s.sku).join(", ")}).
          Close the order out if there's nothing more to send.
        </span>
      </span>
    );
  }
  return null;
}

/**
 * Orders that have gone out in part and are still waiting on the rest, oldest
 * dispatch first, whatever their order date. Opening one lands in the normal
 * order panel (Delivery tab has the challans).
 */
export function PartlySentPage({ onSelectOrder }: { onSelectOrder: (id: string) => void }) {
  const { data, isLoading, error, refetch } = usePartlySent();
  const [search, setSearch] = useState("");

  const rows = data ?? [];
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.customer_name, r.so_number, r.quotation_ref, r.quotation_ref_override]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    );
  }, [rows, search]);

  if (isLoading) return <Skeleton rows={4} />;
  if (error) return <ErrorNote error={error} retry={() => refetch()} />;

  return (
    <div>
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
          <PackageOpen size={18} className="text-warn" /> Partly sent
        </h2>
        <p className="mt-0.5 max-w-2xl text-sm text-muted">
          Orders where some items have gone out and the rest are still waiting — whatever the order date. The longer
          since the last dispatch, the redder.
        </p>
      </div>

      {rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, order or quote"
              aria-label="Search partly sent orders"
              className="h-9 w-full pl-9 text-sm"
            />
          </div>
          <span className="num ml-auto text-sm text-muted">
            {visible.length} {visible.length === 1 ? "order" : "orders"} · {money(visible.reduce((s, r) => s + Number(r.total ?? 0), 0))}
          </span>
        </div>
      )}

      {visible.length === 0 ? (
        <Empty
          icon={<PackageOpen size={28} />}
          title={rows.length === 0 ? "Nothing is waiting" : "No orders match"}
          hint={
            rows.length === 0
              ? "Every order that has started going out has been sent in full."
              : "Try a different customer, order or quote number."
          }
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => {
            const quote = r.quotation_ref_override ?? r.quotation_ref;
            const days = r.days_since_last_dispatch;
            return (
              <li key={r.id}>
                <button
                  onClick={() => onSelectOrder(r.id)}
                  className="card flex w-full items-stretch gap-3 px-3 py-3 text-left transition hover:border-lineStrong hover:shadow-raised sm:gap-4 sm:px-4"
                >
                  <span
                    className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-lg py-1 ${ageTone(days)}`}
                    title="Days since the last dispatch"
                  >
                    <span className="num text-lg font-bold leading-tight">{days ?? "–"}</span>
                    <span className="text-[11px] leading-none">{days === 1 ? "day" : "days"}</span>
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
                      Ordered {shortDate(r.order_date)} · last sent {shortDate(r.last_dispatched_at)} ·{" "}
                      {r.challans} {r.challans === 1 ? "challan" : "challans"}
                      {r.goods_total > 0 && ` · ${r.goods_sent} of ${r.goods_total} items sent`}
                    </span>
                    <Pending order={r} />
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
      )}
    </div>
  );
}
