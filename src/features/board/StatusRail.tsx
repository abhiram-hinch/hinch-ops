import { AlertTriangle } from "lucide-react";
import { DISPATCH_FLOW, dispatchLabel } from "@/lib/labels";
import { moneyShort } from "@/lib/format";
import type { DispatchFilter } from "@/hooks/useBoard";

/**
 * Stage filter strip. "All" and "Needs attention" are always shown; the
 * pipeline stages appear only when they hold orders (or one is the active
 * filter), so the rail stays short instead of showing a dozen empty chips.
 */
export function StatusRail({
  totals,
  active,
  onSelect,
}: {
  totals: Record<string, { count: number; value: number }> | undefined;
  active: DispatchFilter;
  onSelect: (s: DispatchFilter) => void;
}) {
  const all = Object.entries(totals ?? {}).reduce(
    (a, [k, t]) => (k === "attention" ? a : { count: a.count + t.count, value: a.value + t.value }),
    { count: 0, value: 0 },
  );
  const attention = totals?.attention ?? { count: 0, value: 0 };

  const stages = DISPATCH_FLOW.filter(
    (s) => (totals?.[s]?.count ?? 0) > 0 || active === s,
  );

  const Chip = ({
    on,
    onClick,
    children,
    danger,
  }: {
    on: boolean;
    onClick: () => void;
    children: React.ReactNode;
    danger?: boolean;
  }) => (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-medium transition-colors ${
        on
          ? danger
            ? "bg-bad text-white"
            : "bg-ink text-white"
          : danger
            ? "bg-badSoft text-bad hover:bg-badSoft/70"
            : "bg-surface text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      <Chip on={active === "all"} onClick={() => onSelect("all")}>
        All
        <span className={`num ${active === "all" ? "text-white/70" : "text-faint"}`}>
          {all.count}
        </span>
      </Chip>

      {attention.count > 0 && (
        <Chip
          on={active === "attention"}
          onClick={() => onSelect("attention")}
          danger
        >
          <AlertTriangle size={13} strokeWidth={2.5} />
          Needs attention
          <span className={active === "attention" ? "text-white/80" : ""}>{attention.count}</span>
        </Chip>
      )}

      {stages.length > 0 && <span className="h-5 w-px shrink-0 bg-line" aria-hidden />}

      {stages.map((s) => {
        const t = totals?.[s] ?? { count: 0, value: 0 };
        return (
          <Chip key={s} on={active === s} onClick={() => onSelect(s)}>
            {dispatchLabel[s]}
            <span className={`num ${active === s ? "text-white/70" : "text-faint"}`}>{t.count}</span>
          </Chip>
        );
      })}

      <span className="ml-auto hidden shrink-0 items-center whitespace-nowrap pl-3 text-[13px] text-muted sm:flex">
        {moneyShort(all.value)}
      </span>
    </div>
  );
}
