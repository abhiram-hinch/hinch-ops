import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { PaymentBar } from "@/components/Primitives";
import { StatusBadge, toneChip, toneText } from "@/lib/statusUi";
import { money, shortDate } from "@/lib/format";
import {
  ACTIONABLE_DISPATCH,
  creditLabel,
  creditTone,
  paymentView,
  paymentViewColor,
  paymentViewLabel,
  paymentViewTone,
} from "@/lib/labels";
import type { BoardRow } from "@/types/database";

export function OrderTable({
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
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement) {
        const t = e.target.tagName;
        if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return;
      }
      if (!["j", "k", "Enter", "o"].includes(e.key)) return;
      const idx = rows.findIndex((r) => r.id === selectedId);
      if (e.key === "j") {
        e.preventDefault();
        onSelect(rows[Math.min(rows.length - 1, idx < 0 ? 0 : idx + 1)]);
      } else if (e.key === "k") {
        e.preventDefault();
        onSelect(rows[Math.max(0, idx < 0 ? 0 : idx - 1)]);
      } else if ((e.key === "Enter" || e.key === "o") && idx >= 0) {
        e.preventDefault();
        onSelect(rows[idx]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selectedId, onSelect]);

  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const selected = r.id === selectedId;
        const pv = paymentView(r);
        const quote = r.quotation_ref_override ?? r.quotation_ref;
        const held = r.dispatch_status === "on_hold";
        const aged =
          r.days_in_status >= 3 && ACTIONABLE_DISPATCH.includes(r.dispatch_status);

        // One trailing money note, most-urgent first.
        const moneyNote =
          r.amount_pending_clearance > 0.01
            ? { text: `${money(r.amount_pending_clearance)} clearing`, tone: "text-warn" }
            : r.balance_due > 0.01
              ? { text: `${money(r.balance_due)} left`, tone: "text-muted" }
              : null;

        return (
          <button
            key={r.id}
            onClick={() => onSelect(r)}
            aria-current={selected}
            className={`card relative w-full overflow-hidden px-4 py-3 text-left transition
                        hover:border-lineStrong hover:shadow-raised
                        ${selected ? "ring-2 ring-brand ring-offset-1 ring-offset-canvas" : ""}
                        ${touched.has(r.id) ? "row-touched" : ""}`}
          >
            {held && <span className="band-hold absolute inset-y-0 left-0 w-1" aria-hidden />}

            {/* Tier 1 — who + where it is */}
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 truncate text-[15px] font-semibold text-ink">
                {r.customer_name ?? "Unnamed customer"}
              </p>
              <StatusBadge status={r.dispatch_status} size="sm" />
            </div>

            {/* Tier 2 — the money picture */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="num text-[15px] font-semibold text-ink">{money(r.total)}</span>
              <PaymentBar
                received={r.amount_received}
                total={r.total}
                color={paymentViewColor[pv]}
                showPct={false}
              />
              <span className={`text-[13px] font-medium ${toneText[paymentViewTone[pv]]}`}>
                {paymentViewLabel[pv]}
              </span>
              {moneyNote && (
                <span className={`num text-micro ${moneyNote.tone}`}>· {moneyNote.text}</span>
              )}
            </div>

            {/* Tier 3 — reference line, dim */}
            <div className="mt-1.5 flex items-center justify-between gap-3 text-micro text-faint">
              <span className="truncate">
                <span className="num">{r.so_number ?? "—"}</span>
                {quote && <span className="num"> · {quote}</span>}
                <span> · {shortDate(r.order_date)}</span>
                {r.salesperson_name && <span> · {r.salesperson_name}</span>}
              </span>
              <span className={`num shrink-0 ${aged ? "font-semibold text-warn" : ""}`}>
                {r.days_in_status}d here
              </span>
            </div>

            {held && r.hold_reason && (
              <p className="mt-1.5 text-micro font-medium text-bad">On hold — {r.hold_reason}</p>
            )}

            {(r.customer_credit_status !== "none" || r.is_overdue) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {r.customer_credit_status !== "none" && (
                  <span
                    className={`chip px-2 py-0.5 text-micro ${toneChip[creditTone[r.customer_credit_status]]}`}
                  >
                    {creditLabel[r.customer_credit_status]}
                  </span>
                )}
                {r.is_overdue && (
                  <span className="chip bg-badSoft px-2 py-0.5 text-micro text-bad">
                    <AlertTriangle size={11} /> Payment overdue
                  </span>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
