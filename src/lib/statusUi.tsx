import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock,
  IndianRupee,
  PackageCheck,
  PauseCircle,
  ShoppingCart,
  Truck,
  Send,
  Warehouse,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  dispatchLabel,
  dispatchTone,
  paymentViewLabel,
  paymentViewTone,
  type PaymentView,
  type Tone,
} from "@/lib/labels";
import type { DispatchStatus } from "@/types/database";

/** tone -> tailwind classes. Soft pill, coloured dot, coloured bar. */
export const toneChip: Record<Tone, string> = {
  neutral: "bg-canvas text-muted",
  brand: "bg-brandSoft text-brand",
  good: "bg-goodSoft text-good",
  warn: "bg-warnSoft text-warn",
  bad: "bg-badSoft text-bad",
  info: "bg-infoSoft text-info",
  accent: "bg-accentSoft text-accent",
  teal: "bg-tealSoft text-teal",
};

export const toneText: Record<Tone, string> = {
  neutral: "text-muted",
  brand: "text-brand",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-info",
  accent: "text-accent",
  teal: "text-teal",
};

export const toneDot: Record<Tone, string> = {
  neutral: "bg-faint",
  brand: "bg-brand",
  good: "bg-good",
  warn: "bg-warn",
  bad: "bg-bad",
  info: "bg-info",
  accent: "bg-accent",
  teal: "bg-teal",
};

const dispatchIcon: Record<DispatchStatus, LucideIcon> = {
  awaiting_clearance: Clock,
  to_be_ordered: CircleDashed,
  ordered: ShoppingCart,
  in_transit: Truck,
  at_warehouse: Warehouse,
  ready_to_dispatch: PackageCheck,
  partially_dispatched: Send,
  dispatched: Send,
  partially_delivered: Truck,
  delivered: CheckCircle2,
  fulfilled: CheckCircle2,
  on_hold: PauseCircle,
  cancelled: XCircle,
};

export function StatusBadge({
  status,
  size = "md",
}: {
  status: DispatchStatus;
  size?: "sm" | "md";
}) {
  const Icon = dispatchIcon[status];
  return (
    <span
      className={`chip ${toneChip[dispatchTone[status]]} ${size === "sm" ? "px-2 py-0.5 text-micro" : ""}`}
    >
      <Icon size={size === "sm" ? 12 : 14} strokeWidth={2.25} />
      {dispatchLabel[status]}
    </span>
  );
}

export function PaymentBadge({ view, size = "md" }: { view: PaymentView; size?: "sm" | "md" }) {
  const tone = paymentViewTone[view];
  const Icon =
    view === "fully_paid" || view === "overpaid"
      ? CheckCircle2
      : view === "awaiting_clearance"
        ? Clock
        : view === "advance_paid"
          ? IndianRupee
          : AlertCircle;
  return (
    <span className={`chip ${toneChip[tone]} ${size === "sm" ? "px-2 py-0.5 text-micro" : ""}`}>
      <Icon size={size === "sm" ? 12 : 14} strokeWidth={2.25} />
      {paymentViewLabel[view]}
    </span>
  );
}

export { dispatchIcon };
