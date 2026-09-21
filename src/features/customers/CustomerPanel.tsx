import { useEffect, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { money, moneyExact, relativeTime, shortDate } from "@/lib/format";
import {
  clearanceLabel,
  clearanceTone,
  creditLabel,
  creditTone,
  methodLabel,
  paymentView,
  paymentViewLabel,
  paymentViewTone,
} from "@/lib/labels";
import { canSetCreditHold } from "@/hooks/useAuth";
import { StatusBadge, toneChip, toneText } from "@/lib/statusUi";
import {
  useCustomer,
  useCustomerNotes,
  useCustomerOrders,
  useCustomerPayments,
  useSetOpeningBalance,
} from "@/hooks/useCustomers";
import { ErrorNote, Skeleton } from "@/components/Primitives";
import type { Profile } from "@/types/database";

function OpeningBalanceField({
  customerId,
  value,
  editable,
}: {
  customerId: string;
  value: number;
  editable: boolean;
}) {
  const setBalance = useSetOpeningBalance(customerId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  if (editing) {
    return (
      <span className="mt-2 flex items-center gap-1.5 text-micro">
        <span className="text-faint">Opening balance received</span>
        <input
          type="number"
          inputMode="decimal"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setBalance.mutate(Number(draft) || 0, { onSuccess: () => setEditing(false) });
            }
            if (e.key === "Escape") setEditing(false);
          }}
          className="field num h-6 w-28 px-1.5 text-micro"
        />
        <button
          className="text-good"
          aria-label="Save opening balance"
          onClick={() => setBalance.mutate(Number(draft) || 0, { onSuccess: () => setEditing(false) })}
        >
          <Check size={13} />
        </button>
      </span>
    );
  }

  if (!editable && value === 0) return null;

  return (
    <p className="mt-2 flex items-center gap-1.5 text-micro text-faint">
      Opening balance received: <span className="num text-ink">{money(value)}</span>
      {editable && (
        <button
          onClick={() => {
            setDraft(String(value));
            setEditing(true);
          }}
          aria-label="Edit opening balance"
          className="hover:text-ink"
        >
          <Pencil size={11} />
        </button>
      )}
    </p>
  );
}

export function CustomerPanel({
  customerId,
  profile,
  onClose,
  onSelectOrder,
}: {
  customerId: string;
  profile: Profile;
  onClose: () => void;
  onSelectOrder: (orderId: string) => void;
}) {
  const { data: customer, isLoading: loadingCustomer } = useCustomer(customerId);
  const { data: orders, isLoading: loadingOrders, error } = useCustomerOrders(customerId);
  const orderIds = orders?.map((o) => o.id) ?? [];
  const { data: payments } = useCustomerPayments(orderIds);
  const { data: notes } = useCustomerNotes(orderIds);
  const mayEditBalance = canSetCreditHold(profile.role);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-ink/25 backdrop-blur-[1px] sm:bg-transparent sm:backdrop-blur-0"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-0 z-40 flex h-screen w-full max-w-[560px] flex-col bg-canvas shadow-pop"
        aria-label={customer?.name ?? "Customer"}
      >
        <header className="border-b border-line bg-surface px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-ink">{customer?.name ?? "Loading…"}</h2>
              {customer && customer.credit_status !== "none" && (
                <span className={`chip mt-1.5 px-2 py-0.5 text-micro ${toneChip[creditTone[customer.credit_status]]}`}>
                  {creditLabel[customer.credit_status]}
                  {customer.credit_days ? ` · ${customer.credit_days}d terms` : ""}
                </span>
              )}
            </div>
            <button onClick={onClose} className="btn-ghost btn-sm shrink-0" aria-label="Close">
              <X size={16} />
            </button>
          </div>

          {customer && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-raised p-2.5">
                <p className="text-micro text-muted">Total value</p>
                <p className="num text-sm font-bold text-ink">{money(customer.total_value)}</p>
              </div>
              <div className="rounded-lg bg-raised p-2.5">
                <p className="text-micro text-muted">Received</p>
                <p className="num text-sm font-bold text-good">{money(customer.total_received)}</p>
              </div>
              <div className="rounded-lg bg-raised p-2.5">
                <p className="text-micro text-muted">Outstanding</p>
                <p className={`num text-sm font-bold ${customer.total_outstanding > 0.01 ? "text-warn" : "text-ink"}`}>
                  {money(customer.total_outstanding)}
                </p>
              </div>
            </div>
          )}
          {customer?.credit_limit != null && (
            <p className="mt-2 text-micro text-faint">Credit limit {money(customer.credit_limit)}</p>
          )}
          {customer && (
            <OpeningBalanceField
              customerId={customerId}
              value={customer.opening_balance_paid}
              editable={mayEditBalance}
            />
          )}
          {customer?.notes && <p className="mt-2 text-[13px] text-ink">{customer.notes}</p>}
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {loadingCustomer || loadingOrders ? (
            <Skeleton rows={5} />
          ) : error ? (
            <ErrorNote error={error} />
          ) : (
            <div className="space-y-5">
              <section>
                <h3 className="mb-2 text-[13px] font-semibold text-ink">
                  Orders <span className="text-faint">({orders?.length ?? 0})</span>
                </h3>
                <ul className="space-y-1.5">
                  {(orders ?? []).map((o) => {
                    const pv = paymentView(o);
                    return (
                      <li key={o.id}>
                        <button
                          onClick={() => onSelectOrder(o.id)}
                          className="card flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition hover:border-lineStrong hover:shadow-raised"
                        >
                          <div className="min-w-0">
                            <p className="num text-sm font-medium text-ink">{o.so_number ?? "—"}</p>
                            <p className="text-micro text-faint">{shortDate(o.order_date)}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className={`text-micro font-medium ${toneText[paymentViewTone[pv]]}`}>
                              {paymentViewLabel[pv]}
                            </span>
                            <StatusBadge
                              status={o.dispatch_status}
                              size="sm"
                              blockedOnSiteDetails={o.blocked_on_site_details}
                            />
                            <span className="num text-sm font-semibold text-ink">{money(o.total)}</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section>
                <h3 className="mb-2 text-[13px] font-semibold text-ink">
                  Payments received <span className="text-faint">({payments?.length ?? 0})</span>
                </h3>
                {(!payments || payments.length === 0) && (
                  <p className="text-[13px] text-muted">No payments recorded on any of their orders yet.</p>
                )}
                {payments && payments.length > 0 && (
                  <ul className="divide-y divide-line border-y border-line">
                    {payments.map((p) => (
                      <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
                        <div>
                          <p className="num flex items-center gap-2 text-sm font-medium text-ink">
                            {moneyExact(p.amount)}
                            <span className={`chip px-2 py-0.5 text-micro ${toneChip[clearanceTone[p.clearance_status]]}`}>
                              {clearanceLabel[p.clearance_status]}
                            </span>
                          </p>
                          <p className="text-micro text-faint">
                            {methodLabel(p.payment_method)}
                            {p.bank_accounts?.label ? ` · into ${p.bank_accounts.label}` : ""}
                            {p.so_number ? ` · ${p.so_number}` : ""} · paid {shortDate(p.paid_on)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-[13px] font-semibold text-ink">Notes across their orders</h3>
                {(!notes || notes.length === 0) && (
                  <p className="text-[13px] text-muted">No notes on any of their orders yet.</p>
                )}
                {notes && notes.length > 0 && (
                  <ul className="space-y-2.5">
                    {notes.map((n) => (
                      <li key={n.id} className="rounded-lg bg-raised px-3 py-2">
                        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-[13px] font-semibold text-ink">
                            {n.profiles?.full_name ?? "Someone"}
                          </span>
                          <span className="num text-micro text-faint">{n.so_number}</span>
                          <span className="text-micro text-faint">{relativeTime(n.created_at)}</span>
                        </p>
                        <p className="mt-0.5 whitespace-pre-line text-[13px] text-ink">{n.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
