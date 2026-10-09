import type { BoardRow, DispatchStatus } from "@/types/database";

/**
 * The order's life as six milestones — the same SOP ladder as the status
 * rail, collapsed so a person can read "how far along is this?" at a glance.
 * Payment is the first milestone but is tracked on its own axis: procure-first
 * and credit orders move on before it's settled.
 */
export const JOURNEY = [
  { key: "payment", label: "Payment" },
  { key: "procure", label: "Procure" },
  { key: "ordered", label: "Ordered" },
  { key: "warehouse", label: "Warehouse" },
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
] as const;

const STAGE_TO_STEP: Partial<Record<DispatchStatus, number>> = {
  awaiting_clearance: 0,
  to_be_ordered: 1,
  ordered: 2,
  in_transit: 2,
  at_warehouse: 3,
  ready_to_dispatch: 3,
  partially_dispatched: 4,
  dispatched: 4,
  partially_delivered: 5,
  delivered: 5,
  fulfilled: 5,
};

export type StepState = "done" | "current" | "todo" | "owed" | "hold";

/** Which milestone the order is at; on hold, where it was paused. */
export function journeyIndex(r: Pick<BoardRow, "dispatch_status" | "stage_before_hold">): number {
  const s =
    r.dispatch_status === "on_hold" ? (r.stage_before_hold as DispatchStatus | null) : r.dispatch_status;
  return (s && STAGE_TO_STEP[s]) || 0;
}

/** True once the order has finished its journey (nothing left to move). */
export function journeyComplete(r: Pick<BoardRow, "dispatch_status">): boolean {
  return r.dispatch_status === "delivered" || r.dispatch_status === "fulfilled";
}

export function stepStates(
  r: Pick<BoardRow, "dispatch_status" | "stage_before_hold" | "payment_status">,
): StepState[] {
  const idx = journeyIndex(r);
  const held = r.dispatch_status === "on_hold";
  const paid = r.payment_status === "fully_paid" || r.payment_status === "overpaid";
  const finished = journeyComplete(r);

  return JOURNEY.map((_, i) => {
    if (i === 0) {
      if (paid) return "done";
      // Order has moved past payment but money is still owed — keep it visible.
      if (idx > 0) return "owed";
      return held ? "hold" : "current";
    }
    if (i < idx) return "done";
    if (i === idx) return finished ? "done" : held ? "hold" : "current";
    return "todo";
  });
}
