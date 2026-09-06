import { emptyFilters, type BoardFilters, type DatePreset } from "@/hooks/useBoard";
import type { PaymentStatus } from "@/types/database";

/**
 * Board state <-> URL query string, so a view is shareable and survives a
 * refresh. Only non-default values are written, to keep links short.
 */

export interface BoardUrlState {
  filters: BoardFilters;
  selectedId: string | null;
}

const DATE_PRESETS: DatePreset[] = ["all", "today", "yesterday", "week", "month", "custom"];
const DISPATCH_VALUES = [
  "all",
  "attention",
  "awaiting_clearance",
  "to_be_ordered",
  "ordered",
  "in_transit",
  "at_warehouse",
  "ready_to_dispatch",
  "partially_dispatched",
  "dispatched",
  "partially_delivered",
  "delivered",
  "fulfilled",
  "on_hold",
  "cancelled",
];
const PAYMENT_VALUES = ["all", "pending", "advance_paid", "fully_paid", "overpaid"];
const CUSTOMER_TYPES = ["all", "regular", "credit"];

export function readBoardState(search = window.location.search): BoardUrlState {
  const p = new URLSearchParams(search);
  const d = p.get("d");
  const disp = p.get("disp");
  const pay = p.get("pay");
  const ct = p.get("ct");

  return {
    filters: {
      dispatch: (DISPATCH_VALUES.includes(disp ?? "") ? disp : "all") as BoardFilters["dispatch"],
      payment: (PAYMENT_VALUES.includes(pay ?? "") ? pay : "all") as PaymentStatus | "all",
      customerType: (CUSTOMER_TYPES.includes(ct ?? "")
        ? ct
        : "all") as BoardFilters["customerType"],
      salesperson: p.get("sp") ?? "",
      search: p.get("q") ?? "",
      datePreset: (DATE_PRESETS.includes((d ?? "") as DatePreset) ? d : emptyFilters.datePreset) as DatePreset,
      fromDate: p.get("from") ?? "",
      toDate: p.get("to") ?? "",
    },
    selectedId: p.get("order"),
  };
}

export function writeBoardState({ filters, selectedId }: BoardUrlState): void {
  const p = new URLSearchParams();
  if (filters.datePreset !== emptyFilters.datePreset) p.set("d", filters.datePreset);
  if (filters.dispatch !== "all") p.set("disp", filters.dispatch);
  if (filters.payment !== "all") p.set("pay", filters.payment);
  if (filters.customerType !== "all") p.set("ct", filters.customerType);
  if (filters.salesperson) p.set("sp", filters.salesperson);
  if (filters.search.trim()) p.set("q", filters.search.trim());
  if (filters.datePreset === "custom") {
    if (filters.fromDate) p.set("from", filters.fromDate);
    if (filters.toDate) p.set("to", filters.toDate);
  }
  if (selectedId) p.set("order", selectedId);

  const qs = p.toString();
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  if (next !== window.location.pathname + window.location.search) {
    window.history.replaceState(null, "", next);
  }
}
