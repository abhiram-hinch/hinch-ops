import { Users, CreditCard, Wallet } from "lucide-react";
import type { CustomerType } from "@/hooks/useBoard";

const TABS: { value: CustomerType; label: string; icon: typeof Users }[] = [
  { value: "all", label: "All customers", icon: Users },
  { value: "regular", label: "Advance-payment", icon: Wallet },
  { value: "credit", label: "Credit", icon: CreditCard },
];

/**
 * Customer segment switch. Credit customers run late-booked, pay-on-terms
 * orders, so the team keeps them in their own tab to avoid confusing them
 * with the advance-payment flow.
 */
export function CustomerTypeTabs({
  value,
  counts,
  onSelect,
}: {
  value: CustomerType;
  counts: { all: number; regular: number; credit: number } | undefined;
  onSelect: (t: CustomerType) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto">
      {TABS.map(({ value: v, label, icon: Icon }) => {
        const on = value === v;
        const n = counts?.[v];
        return (
          <button
            key={v}
            onClick={() => onSelect(v)}
            aria-pressed={on}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              on
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-muted hover:text-ink"
            }`}
          >
            <Icon size={13} strokeWidth={2.25} />
            {label}
            {n !== undefined && (
              <span className={`num ${on ? "text-white/80" : "text-faint"}`}>{n}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
