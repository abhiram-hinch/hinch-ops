import { useEffect } from "react";
import { AlertTriangle, ArrowUpDown, MapPin, PackagePlus, Store } from "lucide-react";
import { toneChip } from "@/lib/statusUi";
import { creditLabel, creditTone } from "@/lib/labels";
import type { BoardRow } from "@/types/database";

/** j / k / Enter / o to walk the list from the keyboard — shared by both board layouts. */
export function useRowKeyNav(
  rows: BoardRow[],
  selectedId: string | null,
  onSelect: (r: BoardRow) => void,
) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement) {
        const t = e.target.tagName;
        if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return;
      }
      if (!["j", "k", "Enter", "o"].includes(e.key)) return;
      if (rows.length === 0) return;
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
}

/** Whether an order has anything worth flagging beneath its main line. */
export const hasFlags = (r: BoardRow) =>
  r.customer_credit_status !== "none" ||
  r.is_overdue ||
  r.is_procure_first ||
  r.has_service_lift === false ||
  r.is_store_pickup ||
  !!r.procurement_location_label;

/** The small flag chips under an order: credit, overdue, buying early, no lift, pickup, location. */
export function OrderFlags({ r }: { r: BoardRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {r.customer_credit_status !== "none" && (
        <span
          className={`chip px-2 py-0.5 text-micro ${toneChip[creditTone[r.customer_credit_status]]}`}
        >
          {creditLabel[r.customer_credit_status]}
        </span>
      )}
      {r.is_procure_first && (
        <span className={`chip px-2 py-0.5 text-micro ${toneChip.accent}`}>
          <PackagePlus size={11} /> Buying before payment
        </span>
      )}
      {r.is_overdue && (
        <span className="chip bg-badSoft px-2 py-0.5 text-micro text-bad">
          <AlertTriangle size={11} /> Payment overdue
        </span>
      )}
      {r.has_service_lift === false && (
        <span className="chip bg-warnSoft px-2 py-0.5 text-micro text-warn">
          <ArrowUpDown size={11} /> No lift
        </span>
      )}
      {r.is_store_pickup && (
        <span className={`chip px-2 py-0.5 text-micro ${toneChip.accent}`}>
          <Store size={11} /> Store pickup
        </span>
      )}
      {r.procurement_location_label && (
        <span className={`chip px-2 py-0.5 text-micro ${toneChip.info}`}>
          <MapPin size={11} /> {r.procurement_location_label}
        </span>
      )}
    </div>
  );
}
