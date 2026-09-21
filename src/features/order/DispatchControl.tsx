import { useState } from "react";
import { ChevronRight, FileText, MapPin, PackageCheck, PauseCircle, Store } from "lucide-react";
import {
  HOLD_REASONS,
  SETTABLE_STAGES,
  dispatchLabel,
  manualActionsFor,
  orderActionLabel,
  showStageStepper,
} from "@/lib/labels";
import { canEditDispatch, canSetProcurementLocation } from "@/hooks/useAuth";
import { useOrderAction, useProcurementLocations, useSetProcurementLocation } from "@/hooks/useBoard";
import { money } from "@/lib/format";
import { Input, Select } from "@/components/Primitives";
import type { BoardRow, DispatchStatus, OrderAction, Profile } from "@/types/database";

/** Stages where starting a delivery challan makes sense. */
const CHALLAN_STAGES: DispatchStatus[] = [
  "at_warehouse",
  "ready_to_dispatch",
  "partially_dispatched",
  "dispatched",
  "partially_delivered",
];

/** Sales calls this; warehouse just needs to see it plainly. */
function ProcurementLocationControl({ order, profile }: { order: BoardRow; profile: Profile }) {
  const { data: locations } = useProcurementLocations();
  const setLocation = useSetProcurementLocation(order.id);
  const mayEdit = canSetProcurementLocation(profile.role);

  if (!mayEdit) {
    return order.procurement_location_label ? (
      <p className="mb-2.5 flex items-center gap-1.5 text-[13px] font-medium text-ink">
        <MapPin size={13} className="text-muted" /> Procuring from {order.procurement_location_label}
      </p>
    ) : null;
  }

  return (
    <div className="mb-2.5 flex items-center gap-2">
      <MapPin size={13} className="shrink-0 text-muted" />
      <Select
        value={order.procurement_location_id ?? ""}
        onChange={(e) => setLocation.mutate(e.target.value || null)}
        disabled={setLocation.isPending}
        className="h-8 flex-1 text-[13px]"
        aria-label="Procurement location"
      >
        <option value="">Procure from — not set</option>
        {(locations ?? []).map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Purely informational — the toggle itself lives on the Site tab, sales-owned. */
function StorePickupBanner({ order }: { order: BoardRow }) {
  if (!order.is_store_pickup) return null;
  return (
    <p className="mb-2.5 flex items-center gap-1.5 text-[13px] font-medium text-brandStrong">
      <Store size={13} /> Store pickup — Hinch Store, Hafeezpet. No delivery address needed.
    </p>
  );
}

export function DispatchControl({
  order,
  profile,
  onOpenDispatches,
}: {
  order: BoardRow;
  profile: Profile;
  onOpenDispatches: () => void;
}) {
  const act = useOrderAction(order.id);
  const mayEdit = canEditDispatch(profile.role);
  const hasDispatches = order.dispatch_count > 0;
  const actions = manualActionsFor(order.dispatch_status, hasDispatches);
  const stepper = showStageStepper(order.dispatch_status, hasDispatches);

  const [holdFor, setHoldFor] = useState(false);
  const [holdReason, setHoldReason] = useState("");

  function run(a: OrderAction) {
    if (a === "hold") return setHoldFor(true);
    act.mutate({ action: a });
  }

  if (!mayEdit) {
    return (
      <div className="px-5 py-2">
        <ProcurementLocationControl order={order} profile={profile} />
        <StorePickupBanner order={order} />
        <p className="text-micro text-faint">Your team can view dispatch status but not change it.</p>
      </div>
    );
  }

  const awaitingClearance = order.dispatch_status === "awaiting_clearance";
  const creditHold = order.customer_credit_status === "credit_hold";
  const creditRegular = order.customer_credit_status === "credit_regular";
  const shortfall = order.total - order.amount_received;
  const partPaid = order.amount_received > 0.01;
  const dispatchBlocked =
    creditHold || (!creditRegular && order.payment_status !== "fully_paid" && shortfall > 0.01);

  return (
    <div className="px-5 py-3">
      <ProcurementLocationControl order={order} profile={profile} />
      <StorePickupBanner order={order} />
      {awaitingClearance && (
        <p className="mb-2.5 rounded bg-warnSoft/50 px-3 py-2 text-[13px] font-medium text-warn">
          Waiting for accounts to confirm the payment — the order moves to procurement on its own
          once that&apos;s done.
        </p>
      )}
      {!awaitingClearance && creditHold && (
        <p className="mb-2.5 rounded bg-badSoft/50 px-3 py-2 text-[13px] font-medium text-bad">
          Customer is on credit hold — dispatch stays blocked until accounts lifts it.
        </p>
      )}
      {!awaitingClearance && !creditHold && dispatchBlocked && (
        <p className="mb-2.5 rounded bg-warnSoft/50 px-3 py-2 text-[13px] font-medium text-warn">
          {partPaid ? "Advance received. " : ""}
          Collect the {money(shortfall)} balance before dispatch — full payment is needed unless the
          customer is on credit terms.
        </p>
      )}
      {!awaitingClearance && creditRegular && (
        <p className="mb-2.5 rounded bg-infoSoft/50 px-3 py-2 text-[13px] font-medium text-info">
          Credit customer — dispatch is allowed with a balance outstanding.
        </p>
      )}

      {/* Delivery challans — the dispatch team's primary action, kept prominent */}
      {(hasDispatches || CHALLAN_STAGES.includes(order.dispatch_status)) && (
        <button
          onClick={onOpenDispatches}
          className={`mb-2.5 flex w-full items-center justify-between gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition-colors ${
            hasDispatches
              ? "border border-line bg-surface text-ink hover:border-lineStrong"
              : "bg-brand text-white hover:bg-brand/90"
          }`}
        >
          <span className="flex items-center gap-2">
            {hasDispatches ? <FileText size={16} /> : <PackageCheck size={16} />}
            {hasDispatches
              ? `Delivery challans — ${order.dispatch_count} created, ${order.delivered_count} delivered`
              : "Create delivery challan"}
          </span>
          <ChevronRight size={16} />
        </button>
      )}

      {stepper && !holdFor && (
        <div className="mb-2.5">
          <p className="mb-1.5 text-micro font-medium text-muted">Move to step</p>
          <div className="flex flex-wrap gap-1.5">
            {SETTABLE_STAGES.map((sVal) => {
              const on = order.dispatch_status === sVal;
              return (
                <button
                  key={sVal}
                  onClick={() => act.mutate({ action: sVal })}
                  disabled={act.isPending || on}
                  className={`rounded-pill px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    on
                      ? "bg-brand text-white"
                      : "bg-canvas text-muted hover:bg-line hover:text-ink"
                  }`}
                >
                  {dispatchLabel[sVal]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {actions.length > 0 && !holdFor && (
        <div className="flex flex-wrap gap-1.5">
          {actions.map((a) => (
            <button
              key={a}
              onClick={() => run(a)}
              disabled={act.isPending}
              className={
                a === "cancel" || a === "hold" || a === "unfulfill"
                  ? "btn-ghost btn-sm"
                  : "btn-primary btn-sm"
              }
            >
              {a === "hold" && <PauseCircle size={13} />}
              {orderActionLabel[a]}
            </button>
          ))}
        </div>
      )}

      {act.error && (
        <p className="mt-2 rounded bg-badSoft/50 px-2 py-1.5 text-[13px] text-bad">
          {act.error instanceof Error ? act.error.message : "Could not update."}
        </p>
      )}

      {holdFor && (
        <div className="mt-1 rounded-lg border border-badSoft bg-badSoft/30 p-3">
          <p className="text-[13px] font-semibold text-ink">Put this order on hold</p>
          <p className="mt-0.5 text-micro text-muted">The step is kept — resuming restores it.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {HOLD_REASONS.map((r) => (
              <button
                key={r}
                onClick={() => setHoldReason(r === "Other" ? "" : r)}
                className={`rounded-pill px-2.5 py-1 text-[13px] font-medium ${
                  holdReason === r ? "bg-bad text-white" : "bg-surface text-ink hover:bg-canvas"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <Input
            value={holdReason}
            placeholder="Add detail (optional)"
            onChange={(e) => setHoldReason(e.target.value)}
            className="mt-2 h-9"
          />
          <div className="mt-3 flex gap-2">
            <button
              className="btn-danger btn-sm"
              disabled={!holdReason.trim() || act.isPending}
              onClick={async () => {
                await act.mutateAsync({ action: "hold", reason: holdReason.trim() });
                setHoldFor(false);
                setHoldReason("");
              }}
            >
              Put on hold
            </button>
            <button
              className="btn-ghost btn-sm"
              onClick={() => {
                setHoldFor(false);
                setHoldReason("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
