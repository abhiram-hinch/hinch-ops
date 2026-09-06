import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Paperclip,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import {
  CARD_NETWORKS,
  INSTANT_METHODS,
  PAYMENT_METHODS,
  TRANSFER_RAILS,
  clearanceLabel,
  clearanceTone,
  methodLabel,
  methodSpec,
} from "@/lib/labels";
import { money, moneyExact } from "@/lib/format";
import { toneChip } from "@/lib/statusUi";
import { canClearPayments, canEditPayments } from "@/hooks/useAuth";
import {
  useAddPaymentReceipts,
  useBankAccounts,
  usePayments,
  useProfiles,
  useReceiptUrl,
  useRecordPayment,
  useSetPaymentClearance,
  useVoidPayment,
} from "@/hooks/useBoard";
import { ErrorNote, Field, Input, Select, Skeleton } from "@/components/Primitives";
import type {
  BoardRow,
  CardNetwork,
  ClearanceStatus,
  PaymentMethod,
  PaymentReceipt,
  Profile,
  TransferRail,
} from "@/types/database";

const ACCEPT = "image/*,application/pdf";

function ReceiptLink({ receipt, index }: { receipt: PaymentReceipt; index: number }) {
  const { data: url, isLoading } = useReceiptUrl(receipt.storage_path);
  const label = `Proof ${index + 1}`;
  if (isLoading) return <span className="text-micro text-faint">{label}…</span>;
  if (!url) return <span className="text-micro text-faint">{label} (unavailable)</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-micro text-info underline"
    >
      <Paperclip size={11} /> {label}
    </a>
  );
}

function AddProofButton({
  orderId,
  paymentId,
  userId,
}: {
  orderId: string;
  paymentId: string;
  userId: string;
}) {
  const add = useAddPaymentReceipts(orderId);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) add.mutate({ paymentId, files, userId });
          if (ref.current) ref.current.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={add.isPending}
        className="inline-flex items-center gap-1 text-micro text-info underline"
      >
        <Upload size={11} /> {add.isPending ? "Uploading…" : "Add proof"}
      </button>
      {add.error && (
        <span className="text-micro text-bad">
          {add.error instanceof Error ? add.error.message : "Upload failed"}
        </span>
      )}
    </>
  );
}

const istToday = () => {
  const d = new Date();
  return new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60_000).toISOString().slice(0, 10);
};

function ClearanceChip({ status }: { status: ClearanceStatus }) {
  return (
    <span className={`chip px-2 py-0.5 text-micro ${toneChip[clearanceTone[status]]}`}>
      {clearanceLabel[status]}
    </span>
  );
}

export function PaymentsTab({ order, profile }: { order: BoardRow; profile: Profile }) {
  const { data, isLoading, error, refetch } = usePayments(order.id);
  const { data: team } = useProfiles();
  const { data: accounts } = useBankAccounts();
  const record = useRecordPayment(order.id);
  const voidPayment = useVoidPayment(order.id);
  const setClearance = useSetPaymentClearance(order.id);
  const mayEdit = canEditPayments(profile.role);
  const mayClear = canClearPayments(profile.role);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("upi");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(istToday());
  const [depositedTo, setDepositedTo] = useState("");
  const [transferRail, setTransferRail] = useState<TransferRail | "">("");
  const [cardNetwork, setCardNetwork] = useState<CardNetwork | "">("");
  const [cardLast4, setCardLast4] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [draweeBank, setDraweeBank] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [note, setNote] = useState("");
  const [proofs, setProofs] = useState<File[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const spec = methodSpec(method);
  const parsed = Number(amount);
  const needs = (k: (typeof spec.needs)[number]) => spec.needs.includes(k);

  const missing =
    !Number.isFinite(parsed) ||
    parsed === 0 ||
    !depositedTo ||
    (needs("card_last4") && cardLast4.length !== 4) ||
    (needs("card_network") && !cardNetwork) ||
    (needs("cheque_date") && !chequeDate) ||
    (needs("drawee_bank") && !draweeBank.trim()) ||
    (needs("approved_by") && !approvedBy) ||
    (spec.wantsReceipt && proofs.length === 0);
  const valid = !missing;

  const willClearNow = INSTANT_METHODS.includes(method);
  const balance = order.total - order.amount_received;

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2600);
    return () => clearTimeout(t);
  }, [justSaved]);

  function reset() {
    setAmount("");
    setReference("");
    setTransferRail("");
    setCardNetwork("");
    setCardLast4("");
    setChequeDate("");
    setDraweeBank("");
    setApprovedBy("");
    setDepositedTo("");
    setNote("");
    setProofs([]);
    setMoreOpen(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    if (!valid || record.isPending) return;
    await record.mutateAsync({
      amount: parsed,
      payment_method: method,
      reference_no: reference,
      note: note.trim(),
      paid_on: paidOn,
      deposited_to: depositedTo,
      transfer_rail: transferRail || null,
      card_network: cardNetwork || null,
      card_last4: cardLast4 || null,
      cheque_date: chequeDate || null,
      drawee_bank: draweeBank || null,
      approved_by: approvedBy || null,
      proofs,
      userId: profile.id,
    });
    reset();
    setJustSaved(true);
  }

  return (
    <div className="space-y-5">
      {order.amount_pending_clearance > 0.01 && (
        <div className="rounded-lg bg-warnSoft/50 px-3 py-2 text-[13px] text-warn">
          <span className="num font-semibold">{money(order.amount_pending_clearance)}</span> is
          recorded but still waiting on accounts to confirm it — it doesn&apos;t count as paid yet.
        </div>
      )}

      {mayEdit && (
        <div className="card p-3.5">
          <div className="grid grid-cols-2 gap-x-2 gap-y-3">
            <Field label="Amount received">
              <Input
                type="number"
                inputMode="decimal"
                value={amount}
                placeholder="0.00"
                onChange={(e) => setAmount(e.target.value)}
                className="num w-full"
              />
            </Field>
            <Field label="Method">
              <Select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="w-full"
              >
                {PAYMENT_METHODS.filter((m) => m.selectable).map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="col-span-2">
              <Field label="Received in">
                <Select
                  value={depositedTo}
                  onChange={(e) => setDepositedTo(e.target.value)}
                  className="w-full"
                >
                  <option value="">Select account…</option>
                  {(accounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* Method-specific fields the entry can't be saved without */}
            {needs("card_network") && (
              <Field label="Card network">
                <Select
                  value={cardNetwork}
                  onChange={(e) => setCardNetwork(e.target.value as CardNetwork | "")}
                  className="w-full"
                >
                  <option value="">—</option>
                  {CARD_NETWORKS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {needs("card_last4") && (
              <Field label="Card last 4">
                <Input
                  value={cardLast4}
                  maxLength={4}
                  inputMode="numeric"
                  onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="num w-full"
                />
              </Field>
            )}
            {needs("cheque_date") && (
              <Field label="Cheque date">
                <Input
                  type="date"
                  value={chequeDate}
                  onChange={(e) => setChequeDate(e.target.value)}
                  className="w-full"
                />
              </Field>
            )}
            {needs("drawee_bank") && (
              <Field label="Drawee bank">
                <Input
                  value={draweeBank}
                  onChange={(e) => setDraweeBank(e.target.value)}
                  className="w-full"
                />
              </Field>
            )}
            {needs("approved_by") && (
              <Field label="Approved by">
                <Select
                  value={approvedBy}
                  onChange={(e) => setApprovedBy(e.target.value)}
                  className="w-full"
                >
                  <option value="">Select…</option>
                  {(team ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          {balance > 0.01 && (
            <button
              type="button"
              onClick={() => setAmount(balance.toFixed(2))}
              className="mt-2 text-micro text-info underline"
            >
              {order.amount_received > 0.01
                ? `Collect the balance (${money(balance)})`
                : `Fill the full amount (${money(balance)})`}
            </button>
          )}

          {/* Proof — required for methods that have a slip / screenshot */}
          {spec.wantsReceipt && (
            <div className="mt-3">
              <p className="mb-1 text-[13px] font-medium text-muted">
                Proof of payment <span className="text-bad">*</span>
              </p>
              <ProofPicker
                proofs={proofs}
                setProofs={setProofs}
                fileRef={fileRef}
                hint={`Attach the ${methodLabel(method)} screenshot or slip.`}
              />
            </div>
          )}

          {/* Everything else lives one click away */}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="mt-3 flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"
          >
            <ChevronDown
              size={14}
              className={`transition-transform ${moreOpen ? "rotate-180" : ""}`}
            />
            {moreOpen ? "Fewer details" : "More details"}
          </button>

          {moreOpen && (
            <div className="mt-3 space-y-3 border-t border-line pt-3">
              <div className="grid grid-cols-2 gap-x-2 gap-y-3">
                {spec.refLabel && (
                  <Field label={spec.refLabel}>
                    <Input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      className="w-full"
                    />
                  </Field>
                )}
                <Field label="Date">
                  <Input
                    type="date"
                    value={paidOn}
                    onChange={(e) => setPaidOn(e.target.value)}
                    className="w-full"
                  />
                </Field>
                {method === "bank_transfer" && (
                  <Field label="Rail">
                    <Select
                      value={transferRail}
                      onChange={(e) => setTransferRail(e.target.value as TransferRail | "")}
                      className="w-full"
                    >
                      <option value="">—</option>
                      {TRANSFER_RAILS.map((r) => (
                        <option key={r} value={r}>
                          {r.toUpperCase()}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>

              {!spec.wantsReceipt && (
                <div>
                  <p className="mb-1 text-[13px] font-medium text-muted">
                    Proof <span className="text-faint">(optional)</span>
                  </p>
                  <ProofPicker proofs={proofs} setProofs={setProofs} fileRef={fileRef} />
                </div>
              )}

              <div>
                <p className="mb-1 text-[13px] font-medium text-muted">
                  Note <span className="text-faint">(optional)</span>
                </p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Anything accounts should know — part payment, cheque banked later, etc."
                  className="field w-full resize-y py-2"
                />
              </div>
            </div>
          )}

          <button
            onClick={submit}
            disabled={!valid || record.isPending}
            className="btn-primary btn-md mt-4 w-full"
          >
            {record.isPending
              ? "Recording…"
              : valid
                ? `Record ${money(parsed)}`
                : "Record payment"}
          </button>
          <p className="mt-1.5 text-center text-micro text-faint">
            {willClearNow
              ? "Counts as paid right away."
              : "Accounts will confirm this before it counts as paid."}
          </p>

          {justSaved && (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-[13px] font-medium text-good">
              <CheckCircle2 size={14} /> Payment recorded
            </p>
          )}
          {record.error && (
            <p className="mt-2 text-sm text-bad">
              {record.error instanceof Error ? record.error.message : "Could not record that."}
            </p>
          )}
        </div>
      )}

      {isLoading && <Skeleton rows={3} />}
      {error && <ErrorNote error={error} retry={() => refetch()} />}

      {data && data.length === 0 && (
        <p className="rounded-lg bg-raised px-3 py-4 text-center text-[13px] text-muted">
          No payments yet.{mayEdit ? " Record the first one above." : ""}
        </p>
      )}

      {data && data.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {data.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className={p.voided ? "opacity-45" : ""}>
                <p className="num flex items-center gap-2 text-sm font-medium">
                  {moneyExact(p.amount)}
                  {!p.voided && <ClearanceChip status={p.clearance_status} />}
                  {p.voided && <span className="font-sans text-micro">voided</span>}
                </p>
                <p className="text-micro text-faint">
                  {methodLabel(p.payment_method)}
                  {p.reference_no ? ` · ${p.reference_no}` : ""}
                  {p.bank_accounts?.label ? ` · into ${p.bank_accounts.label}` : ""}
                  {p.profiles?.full_name ? ` · by ${p.profiles.full_name}` : ""}
                </p>
                {p.voided && p.voided_reason && (
                  <p className="text-micro text-faint">Reason: {p.voided_reason}</p>
                )}
                {p.note && <p className="mt-0.5 text-micro text-ink">“{p.note}”</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {(p.payment_receipts ?? []).map((r, i) => (
                    <ReceiptLink key={r.id} receipt={r} index={i} />
                  ))}
                  {!p.voided && (p.payment_receipts?.length ?? 0) === 0 && (
                    <span className="text-micro text-faint">No proof attached</span>
                  )}
                  {mayEdit && !p.voided && (
                    <AddProofButton orderId={order.id} paymentId={p.id} userId={profile.id} />
                  )}
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                {mayClear && !p.voided && p.clearance_status === "pending" && (
                  <div className="flex gap-1">
                    <button
                      className="btn-soft btn-sm h-7 gap-1 px-2 text-micro"
                      disabled={setClearance.isPending}
                      onClick={() =>
                        setClearance.mutate({
                          id: p.id,
                          clearance_status: "cleared",
                          userId: profile.id,
                        })
                      }
                    >
                      <CheckCircle2 size={12} /> Confirm
                    </button>
                    <button
                      className="btn-ghost btn-sm h-7 gap-1 px-2 text-micro text-bad"
                      disabled={setClearance.isPending}
                      onClick={() =>
                        setClearance.mutate({
                          id: p.id,
                          clearance_status: "bounced",
                          userId: profile.id,
                        })
                      }
                    >
                      <XCircle size={12} /> Bounce
                    </button>
                  </div>
                )}
                {mayEdit && !p.voided && (
                  <button
                    className="btn-ghost btn-sm h-7 px-2 text-micro"
                    onClick={() => {
                      const reason = window.prompt("Why is this being voided?");
                      if (reason) voidPayment.mutate({ id: p.id, reason, userId: profile.id });
                    }}
                  >
                    Void
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

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

function ProofPicker({
  proofs,
  setProofs,
  fileRef,
  hint,
}: {
  proofs: File[];
  setProofs: React.Dispatch<React.SetStateAction<File[]>>;
  fileRef: React.RefObject<HTMLInputElement>;
  hint?: string;
}) {
  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        onChange={(e) => setProofs(Array.from(e.target.files ?? []))}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="btn-soft btn-sm gap-1.5"
      >
        <Upload size={13} /> Attach screenshot / PDF
      </button>
      {proofs.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {proofs.map((f, i) => (
            <li key={i} className="flex items-center gap-1.5 text-micro text-ink">
              <Paperclip size={11} className="text-faint" />
              <span className="truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => setProofs((cur) => cur.filter((_, j) => j !== i))}
                className="text-faint hover:text-bad"
                aria-label={`Remove ${f.name}`}
              >
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {hint && proofs.length === 0 && <p className="mt-1 text-micro text-faint">{hint}</p>}
    </>
  );
}
