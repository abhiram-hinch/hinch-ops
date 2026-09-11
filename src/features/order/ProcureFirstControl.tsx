import { useState } from "react";
import { PackagePlus, X } from "lucide-react";
import { toneChip } from "@/lib/statusUi";
import { canAuthorizeProcureFirst } from "@/hooks/useAuth";
import { useSetProcureFirst } from "@/hooks/useBoard";
import { Input } from "@/components/Primitives";
import { shortDate } from "@/lib/format";
import type { BoardRow } from "@/types/database";

/**
 * Some customers ask us to buy the material before they have paid for it.
 * They are not credit customers — the goods still don't leave the warehouse
 * until the order is paid in full. What differs is that we are willing to
 * tie up money in stock first, and that is a decision worth a name against it.
 *
 * Without this, such an order is indistinguishable from one someone pushed
 * forward by mistake, and it sits lit up as a problem on the board forever.
 */
export function ProcureFirstControl({ order, role }: { order: BoardRow; role: string }) {
  const set = useSetProcureFirst(order.id);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const may = canAuthorizeProcureFirst(role);

  const on = order.is_procure_first;

  const authorise = () => {
    set.mutate(
      { on: true, note },
      {
        onSuccess: () => {
          setAsking(false);
          setNote("");
        },
      },
    );
  };

  const withdraw = () => {
    if (
      window.confirm(
        "Withdraw the go-ahead to buy this material before payment? The order goes back to being treated as ordinary.",
      )
    ) {
      set.mutate({ on: false });
    }
  };

  // Nothing to show, and nothing this person can do about it.
  if (!on && !may) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {on ? (
        <>
          <span className={`chip px-2 py-0.5 text-micro ${toneChip.accent}`}>
            <PackagePlus size={12} strokeWidth={2.25} />
            Buying before payment
          </span>
          <span className="text-micro text-muted">
            — approved
            {order.procure_first_by_name ? ` by ${order.procure_first_by_name}` : ""}
            {order.procure_first_at ? ` on ${shortDate(order.procure_first_at)}` : ""}. Still cannot
            be sent out until paid in full.
          </span>
          {may && (
            <button
              className="btn-ghost btn-sm h-7 px-2 text-micro"
              disabled={set.isPending}
              onClick={withdraw}
            >
              Undo
            </button>
          )}
        </>
      ) : asking ? (
        <div className="w-full">
          <p className="mb-1.5 text-micro text-muted">
            Why are we buying this before the customer pays? (optional, but it is what someone
            reads in six months)
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              autoFocus
              value={note}
              placeholder="e.g. customer asked us to hold the material"
              className="h-8 min-w-[15rem] flex-1 text-micro"
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") authorise();
                if (e.key === "Escape") setAsking(false);
              }}
            />
            <button
              className="btn-primary btn-sm h-8 px-3 text-micro"
              disabled={set.isPending}
              onClick={authorise}
            >
              {set.isPending ? "Saving…" : "Confirm"}
            </button>
            <button
              className="btn-ghost btn-sm h-8 px-2 text-micro"
              disabled={set.isPending}
              onClick={() => setAsking(false)}
            >
              <X size={13} strokeWidth={2.25} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            className="btn-soft btn-sm h-7 px-2 text-micro"
            disabled={set.isPending}
            onClick={() => setAsking(true)}
          >
            <PackagePlus size={12} strokeWidth={2.25} />
            Buy material before payment
          </button>
          <span className="text-micro text-faint">
            — for customers who ask us to get the material ready first
          </span>
        </>
      )}

      {set.error && (
        <p className="w-full text-micro text-bad">
          {set.error instanceof Error
            ? set.error.message
            : "Could not save that. Try again, or ask an admin."}
        </p>
      )}
    </div>
  );
}
