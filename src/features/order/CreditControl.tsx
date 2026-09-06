import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { creditLabel, creditTone } from "@/lib/labels";
import { toneChip } from "@/lib/statusUi";
import { canSetCreditHold, canTagCreditRegular } from "@/hooks/useAuth";
import { useSetCreditStatus } from "@/hooks/useBoard";
import type { CreditStatus } from "@/types/database";

/**
 * Sales tags a customer as a credit customer at order time — that customer's
 * orders then skip the upfront-payment step and drop straight into procurement.
 * Placing / lifting a credit hold (the value that blocks dispatch) stays with
 * accounts / admin.
 */
export function CreditControl({
  customerId,
  customerName,
  creditStatus,
  role,
}: {
  customerId: string | null;
  customerName: string | null;
  creditStatus: CreditStatus;
  role: string;
}) {
  const set = useSetCreditStatus(customerId ?? "");
  const mayTag = canTagCreditRegular(role);
  const mayHold = canSetCreditHold(role);

  if (!customerId) {
    return (
      <p className="text-micro text-faint">
        Credit standing becomes editable once this customer syncs from Zoho.
      </p>
    );
  }

  const who = customerName ?? "this customer";
  const apply = (credit_status: CreditStatus, confirmMsg: string) => {
    if (window.confirm(confirmMsg)) set.mutate({ credit_status });
  };

  const Icon =
    creditStatus === "credit_hold"
      ? ShieldX
      : creditStatus === "credit_regular"
        ? ShieldCheck
        : ShieldAlert;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`chip px-2 py-0.5 text-micro ${toneChip[creditTone[creditStatus]]}`}>
          <Icon size={12} strokeWidth={2.25} />
          {creditLabel[creditStatus]}
        </span>

        {creditStatus === "none" && mayTag && (
          <button
            className="btn-soft btn-sm h-7 px-2 text-micro"
            disabled={set.isPending}
            onClick={() =>
              apply(
                "credit_regular",
                `Mark ${who} as a credit customer? Their orders will skip upfront payment and go straight to procurement.`,
              )
            }
          >
            Mark as credit customer
          </button>
        )}

        {creditStatus === "credit_regular" && (
          <>
            {mayTag && (
              <button
                className="btn-ghost btn-sm h-7 px-2 text-micro"
                disabled={set.isPending}
                onClick={() =>
                  apply(
                    "none",
                    `Remove credit terms for ${who}? New orders will wait for payment again.`,
                  )
                }
              >
                Remove
              </button>
            )}
            {mayHold && (
              <button
                className="btn-ghost btn-sm h-7 px-2 text-micro text-bad"
                disabled={set.isPending}
                onClick={() =>
                  apply("credit_hold", `Place ${who} on credit hold? Dispatch will be blocked.`)
                }
              >
                Place hold
              </button>
            )}
          </>
        )}

        {creditStatus === "credit_hold" &&
          (mayHold ? (
            <button
              className="btn-soft btn-sm h-7 px-2 text-micro"
              disabled={set.isPending}
              onClick={() =>
                apply("credit_regular", `Lift the credit hold on ${who}? Dispatch will be allowed.`)
              }
            >
              Lift hold
            </button>
          ) : (
            <span className="text-micro text-faint">Contact accounts to lift.</span>
          ))}
      </div>

      {creditStatus === "credit_regular" && (
        <span className="text-micro text-muted">
          — skips upfront payment, dispatch allowed with a balance
        </span>
      )}
      {creditStatus === "credit_hold" && (
        <span className="text-micro text-bad">— dispatch blocked until the hold is lifted</span>
      )}

      {set.error && (
        <p className="w-full text-micro text-bad">
          {set.error instanceof Error ? set.error.message : "Could not update credit standing."}
        </p>
      )}
    </div>
  );
}
