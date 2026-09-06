import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { money, moneyExact, shortDate } from "@/lib/format";
import { creditLabel, creditTone, methodLabel } from "@/lib/labels";
import { toneChip } from "@/lib/statusUi";
import { usePaymentQueue, useSetPaymentClearance } from "@/hooks/useBoard";
import { Empty, ErrorNote, Skeleton } from "@/components/Primitives";
import type { Profile } from "@/types/database";

/**
 * Accounts approval leg — every recorded payment still awaiting confirmation,
 * oldest first. Confirming clears it (and auto-advances the order out of
 * awaiting_clearance); bouncing reverses it.
 */
export function PaymentQueue({ profile }: { profile: Profile }) {
  const { data, isLoading, error, refetch } = usePaymentQueue();
  const setClearance = useSetPaymentClearance();
  const [busyId, setBusyId] = useState<string | null>(null);

  function act(id: string, clearance_status: "cleared" | "bounced") {
    setBusyId(id);
    setClearance.mutate(
      { id, clearance_status, userId: profile.id },
      { onSettled: () => setBusyId(null) },
    );
  }

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorNote error={error} retry={() => refetch()} />;
  if (!data || data.length === 0) {
    return (
      <Empty
        icon={<CheckCircle2 size={28} />}
        title="Nothing waiting"
        hint="Every recorded payment has been confirmed or bounced."
      />
    );
  }

  const total = data.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  return (
    <div className="space-y-2">
      <p className="text-[13px] text-muted">
        <span className="num font-semibold text-ink">{data.length}</span> payment
        {data.length > 1 ? "s" : ""} awaiting confirmation ·{" "}
        <span className="num">{money(total)}</span>
      </p>

      {data.map((r) => (
        <div key={r.id} className="card flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="num text-base font-bold text-ink">{moneyExact(r.amount)}</span>
              <span className="text-sm text-muted">{r.customer_name ?? "—"}</span>
              {r.customer_credit_status !== "none" && (
                <span
                  className={`chip px-2 py-0.5 text-micro ${toneChip[creditTone[r.customer_credit_status]]}`}
                >
                  {creditLabel[r.customer_credit_status]}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-micro text-muted">
              <span className="num">{r.so_number ?? "—"}</span>
              {r.quotation_ref ? <span className="num"> · Quote {r.quotation_ref}</span> : ""} ·{" "}
              {methodLabel(r.payment_method)}
              {r.reference_no ? ` · ${r.reference_no}` : ""} · paid {shortDate(r.paid_on)}
              {r.deposited_to_label ? ` · into ${r.deposited_to_label}` : ""}
            </p>
            {r.note && <p className="mt-0.5 text-micro text-faint">{r.note}</p>}
          </div>

          <div className="flex shrink-0 gap-1.5">
            <button
              className="btn-primary btn-sm gap-1"
              disabled={busyId === r.id}
              onClick={() => act(r.id, "cleared")}
            >
              <CheckCircle2 size={13} /> Confirm
            </button>
            <button
              className="btn-ghost btn-sm gap-1 text-bad"
              disabled={busyId === r.id}
              onClick={() => act(r.id, "bounced")}
            >
              <XCircle size={13} /> Bounce
            </button>
          </div>
        </div>
      ))}

      {setClearance.error && (
        <p className="text-sm text-bad">
          {setClearance.error instanceof Error
            ? setClearance.error.message
            : "Could not update that payment."}
        </p>
      )}
    </div>
  );
}
