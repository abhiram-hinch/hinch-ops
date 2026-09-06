import type {
  ClearanceStatus,
  CreditStatus,
  DispatchStatus,
  OrderAction,
  PaymentMethod,
  PaymentStatus,
  SettableStage,
} from "@/types/database";

/** Board / status-rail order, left to right. Follows the SOP ladder. */
export const DISPATCH_FLOW: DispatchStatus[] = [
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
];

/**
 * States where the order is still someone's problem — an idle order here is
 * what the board exists to catch. Delivered / fulfilled / cancelled are done.
 */
export const ACTIONABLE_DISPATCH: DispatchStatus[] = [
  "awaiting_clearance",
  "to_be_ordered",
  "ordered",
  "in_transit",
  "at_warehouse",
  "ready_to_dispatch",
  "partially_dispatched",
  "partially_delivered",
];

/** Plain-language status, for people who don't know the codes. */
export const dispatchLabel: Record<DispatchStatus, string> = {
  awaiting_clearance: "Awaiting payment",
  to_be_ordered: "Ready to procure",
  ordered: "Ordered from vendor",
  in_transit: "Coming to warehouse",
  at_warehouse: "In our warehouse",
  ready_to_dispatch: "Ready to send",
  partially_dispatched: "Partly sent",
  dispatched: "Sent to customer",
  partially_delivered: "Partly delivered",
  delivered: "Delivered",
  fulfilled: "Completed",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

/** Compact label for tight spaces. */
export const dispatchShort: Record<DispatchStatus, string> = {
  awaiting_clearance: "Awaiting payment",
  to_be_ordered: "Ready to procure",
  ordered: "Ordered",
  in_transit: "Incoming",
  at_warehouse: "In warehouse",
  ready_to_dispatch: "Ready",
  partially_dispatched: "Partly sent",
  dispatched: "Sent",
  partially_delivered: "Partly delivered",
  delivered: "Delivered",
  fulfilled: "Completed",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

export type Tone =
  | "neutral"
  | "brand"
  | "good"
  | "warn"
  | "bad"
  | "info"
  | "accent"
  | "teal";

export const dispatchTone: Record<DispatchStatus, Tone> = {
  awaiting_clearance: "warn",
  to_be_ordered: "neutral",
  ordered: "accent",
  in_transit: "info",
  at_warehouse: "teal",
  ready_to_dispatch: "good",
  partially_dispatched: "warn",
  dispatched: "info",
  partially_delivered: "warn",
  delivered: "good",
  fulfilled: "good",
  on_hold: "bad",
  cancelled: "neutral",
};

// ---------------------------------------------------------------------------
// Manual order actions the panel offers, by current status.
// ---------------------------------------------------------------------------

export const orderActionLabel: Record<OrderAction, string> = {
  hold: "Put on hold",
  resume: "Resume order",
  cancel: "Cancel order",
  reactivate: "Reactivate order",
  fulfill: "Mark completed",
  unfulfill: "Reopen order",
};

/**
 * The pre-dispatch ladder the warehouse team steps an order through by hand.
 * Once a delivery challan exists the stage is challan-driven and this hides.
 * `awaiting_clearance` is deliberately absent — an order only leaves it when
 * accounts confirms the payment, which auto-advances it to `to_be_ordered`.
 */
export const SETTABLE_STAGES: SettableStage[] = [
  "to_be_ordered",
  "ordered",
  "in_transit",
  "at_warehouse",
  "ready_to_dispatch",
];

export function showStageStepper(status: DispatchStatus, hasDispatches: boolean): boolean {
  return !hasDispatches && (SETTABLE_STAGES as DispatchStatus[]).includes(status);
}

export function manualActionsFor(status: DispatchStatus, _hasDispatches: boolean): OrderAction[] {
  switch (status) {
    case "on_hold":
      return ["resume", "cancel"];
    case "cancelled":
      return ["reactivate"];
    case "fulfilled":
      return ["unfulfill"];
    case "delivered":
      return ["fulfill", "hold"];
    default:
      return ["hold", "cancel"];
  }
}

// ---------------------------------------------------------------------------
// Payment — cleared money vs money still waiting on the bank.
// ---------------------------------------------------------------------------

export type PaymentView = "pending" | "advance_paid" | "awaiting_clearance" | "fully_paid" | "overpaid";

export const paymentViewLabel: Record<PaymentView, string> = {
  pending: "Not paid",
  advance_paid: "Part paid",
  awaiting_clearance: "Clearing",
  fully_paid: "Paid",
  overpaid: "Overpaid",
};

export const paymentViewTone: Record<PaymentView, Tone> = {
  pending: "bad",
  advance_paid: "warn",
  awaiting_clearance: "warn",
  fully_paid: "good",
  overpaid: "info",
};

/** Bar colour (solid hex) for the cleared portion of the payment bar. */
export const paymentViewColor: Record<PaymentView, string> = {
  pending: "#B91C1C",
  advance_paid: "#B45309",
  awaiting_clearance: "#B45309",
  fully_paid: "#15803D",
  overpaid: "#1D4ED8",
};

export function paymentView(row: {
  payment_status: PaymentStatus;
  amount_received: number;
  amount_pending_clearance: number;
}): PaymentView {
  if (row.payment_status === "pending" && row.amount_pending_clearance > 0.01) {
    return "awaiting_clearance";
  }
  return row.payment_status;
}

// The board's payment filter queries the DB payment_status column directly.
export const paymentLabel: Record<PaymentStatus, string> = {
  pending: "Not paid",
  advance_paid: "Part paid",
  fully_paid: "Paid",
  overpaid: "Overpaid",
};

// ---------------------------------------------------------------------------
// Payment clearance + credit standing
// ---------------------------------------------------------------------------

export const clearanceLabel: Record<ClearanceStatus, string> = {
  pending: "Awaiting confirmation",
  cleared: "Confirmed",
  bounced: "Bounced",
  reversed: "Reversed",
};

export const clearanceTone: Record<ClearanceStatus, Tone> = {
  pending: "warn",
  cleared: "good",
  bounced: "bad",
  reversed: "neutral",
};

export const creditLabel: Record<CreditStatus, string> = {
  none: "Standard",
  credit_regular: "Credit customer",
  credit_hold: "On credit hold",
};

export const creditTone: Record<CreditStatus, Tone> = {
  none: "neutral",
  credit_regular: "info",
  credit_hold: "bad",
};

// ---------------------------------------------------------------------------
// Payment methods — reference-field label + which extras a form must collect
// ---------------------------------------------------------------------------

export interface MethodSpec {
  value: PaymentMethod;
  label: string;
  refLabel: string | null;
  needs: Array<"card_last4" | "card_network" | "cheque_date" | "drawee_bank" | "approved_by">;
  wantsReceipt: boolean;
  selectable: boolean;
}

export const PAYMENT_METHODS: MethodSpec[] = [
  { value: "cash", label: "Cash", refLabel: "Receipt no. (optional)", needs: [], wantsReceipt: false, selectable: true },
  { value: "upi", label: "UPI", refLabel: "UTR / RRN", needs: [], wantsReceipt: true, selectable: true },
  { value: "card_pos", label: "Card (POS)", refLabel: "Approval code", needs: ["card_last4", "card_network"], wantsReceipt: true, selectable: true },
  { value: "bank_transfer", label: "Bank transfer", refLabel: "UTR", needs: [], wantsReceipt: true, selectable: true },
  { value: "cheque", label: "Cheque", refLabel: "Cheque number", needs: ["cheque_date", "drawee_bank"], wantsReceipt: true, selectable: true },
  { value: "demand_draft", label: "Demand draft", refLabel: "DD number", needs: ["drawee_bank"], wantsReceipt: true, selectable: true },
  { value: "emi_finance", label: "EMI / finance", refLabel: "Loan / application ID", needs: [], wantsReceipt: true, selectable: true },
  { value: "credit_note", label: "Credit note", refLabel: "Credit note number", needs: [], wantsReceipt: false, selectable: true },
  { value: "advance_adjustment", label: "Advance adjustment", refLabel: "Source SO reference", needs: [], wantsReceipt: false, selectable: true },
  { value: "tds_deducted", label: "TDS deducted", refLabel: "TDS section", needs: [], wantsReceipt: false, selectable: true },
  { value: "write_off", label: "Write-off", refLabel: null, needs: ["approved_by"], wantsReceipt: false, selectable: true },
  { value: "payment_gateway", label: "Payment gateway", refLabel: "Gateway reference", needs: [], wantsReceipt: false, selectable: false },
];

export const methodSpec = (m: PaymentMethod): MethodSpec =>
  PAYMENT_METHODS.find((x) => x.value === m) ?? PAYMENT_METHODS[0];

export const methodLabel = (m: PaymentMethod): string => methodSpec(m).label;

export const TRANSFER_RAILS = ["neft", "rtgs", "imps", "other"] as const;
export const CARD_NETWORKS = ["visa", "mastercard", "rupay", "amex", "diners", "other"] as const;

/** Instantly-cleared methods — accounts doesn't need to confirm these. */
export const INSTANT_METHODS: PaymentMethod[] = [
  "cash",
  "upi",
  "credit_note",
  "advance_adjustment",
  "tds_deducted",
  "write_off",
];

// ---------------------------------------------------------------------------
// Per-line dispatch progress
// ---------------------------------------------------------------------------

export type LineDispatchState = "pending" | "partial" | "done";

export function lineState(l: { quantity: number; qty_dispatched: number }): LineDispatchState {
  if (l.quantity > 0 && l.qty_dispatched >= l.quantity) return "done";
  if (l.qty_dispatched > 0) return "partial";
  return "pending";
}

export const lineStateColor: Record<LineDispatchState, string> = {
  pending: "#B91C1C",
  partial: "#B45309",
  done: "#15803D",
};

export const lineStateTone: Record<LineDispatchState, Tone> = {
  pending: "bad",
  partial: "warn",
  done: "good",
};

export const lineStateLabel: Record<LineDispatchState, string> = {
  pending: "Not sent",
  partial: "Partly sent",
  done: "Sent",
};

export const pendingQty = (l: { quantity: number; qty_dispatched: number }) =>
  Math.max(0, Number((l.quantity - l.qty_dispatched).toFixed(3)));

// ---------------------------------------------------------------------------
// Hold reasons
// ---------------------------------------------------------------------------

export const HOLD_REASONS = [
  "Payment",
  "Customer site not ready",
  "Material shortage",
  "Vendor delay",
  "QC / finishing",
  "Other",
];
