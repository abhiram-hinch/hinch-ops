import { RotateCcw } from "lucide-react";
import { Input, Select } from "@/components/Primitives";
import { paymentLabel } from "@/lib/labels";
import type { BoardFilters, DatePreset } from "@/hooks/useBoard";
import type { PaymentStatus } from "@/types/database";

const DATE_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
  { value: "all", label: "All dates" },
  { value: "custom", label: "Custom range…" },
];

/**
 * The board's filter cluster — date range, payment state, salesperson.
 * Sits on the same row as the customer-type switch.
 */
export function Filters({
  value,
  salespeople,
  onChange,
  onReset,
}: {
  value: BoardFilters;
  salespeople: string[];
  onChange: (patch: Partial<BoardFilters>) => void;
  onReset: () => void;
}) {
  const dirty =
    value.payment !== "all" ||
    !!value.salesperson ||
    value.datePreset !== "today";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value.datePreset}
        onChange={(e) => {
          const p = e.target.value as DatePreset;
          onChange(p === "custom" ? { datePreset: p } : { datePreset: p, fromDate: "", toDate: "" });
        }}
        aria-label="Date range"
        className="h-9 w-auto text-[13px]"
      >
        {DATE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>

      {value.datePreset === "custom" && (
        <>
          <Input
            type="date"
            value={value.fromDate}
            onChange={(e) => onChange({ fromDate: e.target.value })}
            aria-label="From date"
            className="h-9 w-auto text-[13px]"
          />
          <span className="text-micro text-faint">to</span>
          <Input
            type="date"
            value={value.toDate}
            onChange={(e) => onChange({ toDate: e.target.value })}
            aria-label="To date"
            className="h-9 w-auto text-[13px]"
          />
        </>
      )}

      <Select
        value={value.payment}
        onChange={(e) => onChange({ payment: e.target.value as PaymentStatus | "all" })}
        aria-label="Payment"
        className="h-9 w-auto text-[13px]"
      >
        <option value="all">Any payment</option>
        {(["pending", "advance_paid", "fully_paid", "overpaid"] as PaymentStatus[]).map((p) => (
          <option key={p} value={p}>
            {paymentLabel[p]}
          </option>
        ))}
      </Select>

      <Select
        value={value.salesperson}
        onChange={(e) => onChange({ salesperson: e.target.value })}
        aria-label="Salesperson"
        className="h-9 w-auto text-[13px]"
      >
        <option value="">Any salesperson</option>
        {salespeople.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>

      {dirty && (
        <button
          onClick={onReset}
          className="btn-ghost btn-sm gap-1 text-muted"
          aria-label="Reset filters"
        >
          <RotateCcw size={13} /> Reset
        </button>
      )}
    </div>
  );
}
