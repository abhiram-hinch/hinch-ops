import { useState } from "react";
import { Layers } from "lucide-react";
import { moneyExact } from "@/lib/format";
import { useCombinedPaymentSiblings } from "@/hooks/useBoard";
import type { Payment } from "@/types/database";

/** Shown on a payment that was recorded as part of a multi-order split. */
export function CombinedBadge({ payment }: { payment: Payment }) {
  const [open, setOpen] = useState(false);
  const { data: siblings } = useCombinedPaymentSiblings(payment.combined_payment_group, payment.id);

  if (!payment.combined_payment_group) return null;

  return (
    <div className="mt-0.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-micro text-info hover:underline"
      >
        <Layers size={11} /> Part of a combined payment
      </button>
      {open && siblings && siblings.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {siblings.map((s) => (
            <li key={s.id} className="num text-micro text-faint">
              {moneyExact(s.amount)} · {s.so_number ?? "—"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
