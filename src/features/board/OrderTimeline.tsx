import { useMemo } from "react";
import { PaymentBar } from "@/components/Primitives";
import { JourneyTracker } from "@/components/JourneyTracker";
import { StatusBadge, toneDot, toneText } from "@/lib/statusUi";
import { money } from "@/lib/format";
import {
  ACTIONABLE_DISPATCH,
  dispatchTone,
  paymentView,
  paymentViewColor,
  paymentViewLabel,
  paymentViewTone,
} from "@/lib/labels";
import { OrderFlags, hasFlags, useRowKeyNav } from "./orderRow";
import type { BoardRow } from "@/types/database";

const IST = "Asia/Kolkata";
const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST }); // YYYY-MM-DD

/** "Today" / "Yesterday" / "Thu, 19 Sep" for an order_date (a plain IST date). */
function dayLabel(iso: string | null): { title: string; sub: string } {
  if (!iso) return { title: "No date", sub: "" };
  const today = istDay(new Date());
  const yesterday = istDay(new Date(Date.now() - 86_400_000));
  const pretty = new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  if (iso === today) return { title: "Today", sub: pretty };
  if (iso === yesterday) return { title: "Yesterday", sub: pretty };
  return { title: pretty, sub: "" };
}

/**
 * Board v2 — orders laid out on a vertical timeline, newest day first, each
 * one carrying its own progress line so "where is this?" needs no reading.
 */
export function OrderTimeline({
  rows,
  touched,
  selectedId,
  onSelect,
}: {
  rows: BoardRow[];
  touched: Set<string>;
  selectedId: string | null;
  onSelect: (r: BoardRow) => void;
}) {
  useRowKeyNav(rows, selectedId, onSelect);

  const groups = useMemo(() => {
    const m = new Map<string, BoardRow[]>();
    for (const r of rows) {
      const k = r.order_date ?? "";
      const list = m.get(k);
      if (list) list.push(r);
      else m.set(k, [r]);
    }
    return [...m.entries()];
  }, [rows]);

  return (
    <div className="relative">
      <span aria-hidden className="absolute bottom-0 left-[9px] top-3 w-px bg-line" />

      {groups.map(([date, list]) => {
        const label = dayLabel(date || null);
        const value = list.reduce((s, r) => s + Number(r.total ?? 0), 0);
        return (
          <section key={date || "none"} className="relative pb-5">
            <header className="relative mb-3 flex items-baseline gap-2 pl-8">
              <span
                aria-hidden
                className="absolute left-0 top-1 h-[19px] w-[19px] rounded-full border-[5px] border-brand bg-surface"
              />
              <h3 className="text-sm font-bold text-ink">{label.title}</h3>
              {label.sub && <span className="text-micro text-muted">{label.sub}</span>}
              <span className="num ml-auto text-micro text-faint">
                {list.length} {list.length === 1 ? "order" : "orders"} · {money(value)}
              </span>
            </header>

            <ul className="space-y-2.5">
              {list.map((r) => {
                const selected = r.id === selectedId;
                const pv = paymentView(r);
                const quote = r.quotation_ref_override ?? r.quotation_ref;
                const held = r.dispatch_status === "on_hold";
                const aged =
                  r.days_in_status >= 3 && ACTIONABLE_DISPATCH.includes(r.dispatch_status);
                const moneyNote =
                  r.amount_pending_clearance > 0.01
                    ? { text: `${money(r.amount_pending_clearance)} clearing`, tone: "text-warn" }
                    : r.balance_due > 0.01
                      ? { text: `${money(r.balance_due)} left`, tone: "text-muted" }
                      : null;

                return (
                  <li key={r.id} className="relative pl-8">
                    <span
                      aria-hidden
                      className={`absolute left-[5px] top-5 h-[11px] w-[11px] rounded-full ring-4 ring-canvas ${
                        toneDot[dispatchTone[r.dispatch_status]]
                      }`}
                    />
                    <button
                      onClick={() => onSelect(r)}
                      aria-current={selected}
                      className={`card relative w-full overflow-hidden px-4 py-3.5 text-left transition
                                  hover:border-lineStrong hover:shadow-raised sm:px-5
                                  ${selected ? "ring-2 ring-brand ring-offset-1 ring-offset-canvas" : ""}
                                  ${touched.has(r.id) ? "row-touched" : ""}`}
                    >
                      {held && <span className="band-hold absolute inset-y-0 left-0 w-1" aria-hidden />}

                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold text-ink">
                            {r.customer_name ?? "Unnamed customer"}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-micro text-muted">
                            <span className="num">{r.so_number ?? "—"}</span>
                            {quote && <span className="num font-semibold text-ink">Quote {quote}</span>}
                            {r.salesperson_name && <span>· {r.salesperson_name}</span>}
                          </p>
                        </div>
                        <StatusBadge
                          status={r.dispatch_status}
                          size="sm"
                          blockedOnSiteDetails={r.blocked_on_site_details}
                        />
                      </div>

                      <div className="mt-3.5 px-0.5">
                        <JourneyTracker order={r} />
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="num text-base font-bold text-ink">{money(r.total)}</span>
                        <PaymentBar
                          received={r.amount_received}
                          total={r.total}
                          color={paymentViewColor[pv]}
                          showPct={false}
                          width={72}
                        />
                        <span className={`text-sm font-medium ${toneText[paymentViewTone[pv]]}`}>
                          {paymentViewLabel[pv]}
                        </span>
                        {moneyNote && (
                          <span className={`num text-micro ${moneyNote.tone}`}>· {moneyNote.text}</span>
                        )}
                        <span
                          className={`num ml-auto text-micro ${
                            aged ? "font-semibold text-warn" : "text-faint"
                          }`}
                        >
                          {r.days_in_status}d here
                        </span>
                      </div>

                      {held && r.hold_reason && (
                        <p className="mt-1.5 text-micro font-medium text-bad">
                          On hold — {r.hold_reason}
                        </p>
                      )}

                      {hasFlags(r) && (
                        <div className="mt-2.5">
                          <OrderFlags r={r} />
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
