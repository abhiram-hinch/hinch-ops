import { useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Paperclip, Upload, X } from "lucide-react";
import {
  CARD_NETWORKS,
  INSTANT_METHODS,
  PAYMENT_METHODS,
  TRANSFER_RAILS,
  methodSpec,
} from "@/lib/labels";
import { money } from "@/lib/format";
import {
  useBankAccounts,
  useProfiles,
  useRecordCombinedPayment,
} from "@/hooks/useBoard";
import { Field, Input, Select } from "@/components/Primitives";
import type { BoardRow, CardNetwork, PaymentMethod, TransferRail } from "@/types/database";

const istToday = () => {
  const d = new Date();
  return new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60_000).toISOString().slice(0, 10);
};

/**
 * One real-world payment split across several of a customer's orders —
 * every order still gets its own payment row (nothing downstream, no gate
 * or trigger, needs to know this was combined), just inserted together with
 * a shared reference and a grouping id so they don't drift out of sync or
 * read as unrelated payments later.
 */
export function RecordCombinedPayment({
  orders,
  userId,
  onDone,
  onCancel,
}: {
  orders: BoardRow[];
  userId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const record = useRecordCombinedPayment();
  const { data: accounts } = useBankAccounts();
  const { data: team } = useProfiles();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [total, setTotal] = useState("");
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
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const spec = methodSpec(method);
  const needs = (k: (typeof spec.needs)[number]) => spec.needs.includes(k);
  const accountOptions = (accounts ?? []).filter((a) =>
    method === "cash" ? a.kind === "cash_box" : true,
  );

  const eligible = orders.filter((o) => o.balance_due > 0.01 || o.amount_received > 0.01);
  const ids = [...selected];
  const allocatedSum = ids.reduce((s, id) => s + (Number(amounts[id]) || 0), 0);
  const totalNum = Number(total) || 0;
  const remaining = Math.round((totalNum - allocatedSum) * 100) / 100;

  function toggle(orderId: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(orderId)) {
        next.delete(orderId);
        setAmounts((a) => {
          const copy = { ...a };
          delete copy[orderId];
          return copy;
        });
      } else {
        next.add(orderId);
      }
      return next;
    });
  }

  function splitEvenly() {
    if (ids.length === 0 || totalNum <= 0) return;
    const per = Math.floor((totalNum / ids.length) * 100) / 100;
    const next: Record<string, string> = {};
    let allocated = 0;
    ids.forEach((id, i) => {
      const amt = i === ids.length - 1 ? Math.round((totalNum - allocated) * 100) / 100 : per;
      next[id] = amt.toFixed(2);
      allocated += amt;
    });
    setAmounts(next);
  }

  function splitByBalance() {
    const totalBalance = ids.reduce((s, id) => s + (orders.find((o) => o.id === id)?.balance_due ?? 0), 0);
    if (ids.length === 0 || totalNum <= 0 || totalBalance <= 0) return;
    const next: Record<string, string> = {};
    let allocated = 0;
    ids.forEach((id, i) => {
      const bal = orders.find((o) => o.id === id)?.balance_due ?? 0;
      const amt =
        i === ids.length - 1
          ? Math.round((totalNum - allocated) * 100) / 100
          : Math.round(totalNum * (bal / totalBalance) * 100) / 100;
      next[id] = amt.toFixed(2);
      allocated += amt;
    });
    setAmounts(next);
  }

  const missing =
    ids.length < 2 ||
    !Number.isFinite(totalNum) ||
    totalNum <= 0 ||
    Math.abs(remaining) > 0.01 ||
    ids.some((id) => !(Number(amounts[id]) > 0)) ||
    !depositedTo ||
    (needs("card_last4") && cardLast4.length !== 4) ||
    (needs("card_network") && !cardNetwork) ||
    (needs("cheque_date") && !chequeDate) ||
    (needs("drawee_bank") && !draweeBank.trim()) ||
    (needs("approved_by") && !approvedBy) ||
    (spec.wantsReceipt && proofs.length === 0);
  const valid = !missing;
  const willClearNow = INSTANT_METHODS.includes(method);

  function acceptFiles(files: FileList | File[]) {
    const accepted = Array.from(files).filter(
      (f) => f.type.startsWith("image/") || f.type === "application/pdf",
    );
    if (accepted.length) setProofs(accepted);
  }

  async function submit() {
    if (!valid || record.isPending) return;
    await record.mutateAsync({
      allocations: ids.map((id) => ({ orderId: id, amount: Number(amounts[id]) })),
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
      userId,
    });
    onDone();
  }

  return (
    <div className="card p-3.5">
      <p className="mb-3 text-sm font-semibold text-ink">Record a combined payment</p>

      <div className="grid grid-cols-2 gap-x-2 gap-y-3">
        <Field label="Total amount received">
          <Input
            type="number"
            inputMode="decimal"
            value={total}
            placeholder="0.00"
            onChange={(e) => setTotal(e.target.value)}
            className="num w-full"
          />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-full">
            {PAYMENT_METHODS.filter((m) => m.selectable).map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="col-span-2">
          <Field label="Received in">
            <Select value={depositedTo} onChange={(e) => setDepositedTo(e.target.value)} className="w-full">
              <option value="">Select account…</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {needs("card_network") && (
          <Field label="Card network">
            <Select value={cardNetwork} onChange={(e) => setCardNetwork(e.target.value as CardNetwork | "")} className="w-full">
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
            <Input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} className="w-full" />
          </Field>
        )}
        {needs("drawee_bank") && (
          <Field label="Drawee bank">
            <Input value={draweeBank} onChange={(e) => setDraweeBank(e.target.value)} className="w-full" />
          </Field>
        )}
        {needs("approved_by") && (
          <Field label="Approved by">
            <Select value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} className="w-full">
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

      {/* ---- Which orders it covers ------------------------------------- */}
      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-medium text-muted">Orders this covers (pick at least 2)</p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={splitEvenly}
              disabled={ids.length === 0 || totalNum <= 0}
              className="text-micro text-info underline disabled:opacity-40"
            >
              Split evenly
            </button>
            <button
              type="button"
              onClick={splitByBalance}
              disabled={ids.length === 0 || totalNum <= 0}
              className="text-micro text-info underline disabled:opacity-40"
            >
              Split by balance
            </button>
          </div>
        </div>

        {eligible.length === 0 ? (
          <p className="text-micro text-faint">No orders with an outstanding balance.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {eligible.map((o) => {
              const on = selected.has(o.id);
              return (
                <li key={o.id} className="flex items-center gap-2 py-2">
                  <input type="checkbox" checked={on} onChange={() => toggle(o.id)} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{o.so_number ?? "—"}</span>
                    <span className="num block text-micro text-faint">{money(o.balance_due)} due</span>
                  </span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    disabled={!on}
                    value={amounts[o.id] ?? ""}
                    placeholder="0.00"
                    onChange={(e) => setAmounts((a) => ({ ...a, [o.id]: e.target.value }))}
                    className="num h-8 w-24 text-right"
                  />
                </li>
              );
            })}
          </ul>
        )}

        {ids.length > 0 && (
          <p
            className={`mt-1.5 text-right text-micro font-medium ${
              Math.abs(remaining) > 0.01 ? "text-bad" : "text-good"
            }`}
          >
            {Math.abs(remaining) > 0.01
              ? `${money(Math.abs(remaining))} ${remaining > 0 ? "left to allocate" : "over the total"}`
              : "Fully allocated"}
          </p>
        )}
      </div>

      {/* ---- Proof + everything else -------------------------------------- */}
      <div className="mt-3">
        <p className="mb-1 text-[13px] font-medium text-muted">
          Proof of payment {spec.wantsReceipt && <span className="text-bad">*</span>}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          onChange={(e) => e.target.files && acceptFiles(e.target.files)}
          className="hidden"
        />
        <div
          onDragEnter={(e) => {
            e.preventDefault();
            dragCounter.current += 1;
            setDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            e.preventDefault();
            dragCounter.current -= 1;
            if (dragCounter.current <= 0) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragCounter.current = 0;
            setDragging(false);
            if (e.dataTransfer.files.length) acceptFiles(e.dataTransfer.files);
          }}
          className={`rounded-lg border border-dashed p-3 text-center transition-colors ${
            dragging ? "border-brand bg-brandSoft/40" : "border-line"
          }`}
        >
          <button type="button" onClick={() => fileRef.current?.click()} className="btn-soft btn-sm gap-1.5">
            <Upload size={13} /> Attach screenshot / PDF
          </button>
          <p className="mt-1.5 text-micro text-faint">or drag and drop it here — applies to every order above</p>
          {proofs.length > 0 && (
            <ul className="mt-2 space-y-1 text-left">
              {proofs.map((f, i) => (
                <li key={i} className="flex items-center gap-1.5 text-micro text-ink">
                  <Paperclip size={11} className="shrink-0 text-faint" />
                  <span className="truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setProofs((cur) => cur.filter((_, j) => j !== i))}
                    className="ml-auto shrink-0 text-faint hover:text-bad"
                  >
                    <X size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setMoreOpen((v) => !v)}
        className="mt-3 flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"
      >
        <ChevronDown size={14} className={`transition-transform ${moreOpen ? "rotate-180" : ""}`} />
        {moreOpen ? "Fewer details" : "More details"}
      </button>

      {moreOpen && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="grid grid-cols-2 gap-x-2 gap-y-3">
            {spec.refLabel && (
              <Field label={spec.refLabel}>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} className="w-full" />
              </Field>
            )}
            <Field label="Date">
              <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="w-full" />
            </Field>
            {method === "bank_transfer" && (
              <Field label="Rail">
                <Select value={transferRail} onChange={(e) => setTransferRail(e.target.value as TransferRail | "")} className="w-full">
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
          <div>
            <p className="mb-1 text-[13px] font-medium text-muted">
              Note <span className="text-faint">(optional)</span>
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything accounts should know about this combined payment"
              className="field w-full resize-y py-2"
            />
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button onClick={submit} disabled={!valid || record.isPending} className="btn-primary btn-md flex-1">
          {record.isPending
            ? "Recording…"
            : valid
              ? `Record ${money(totalNum)} across ${ids.length} orders`
              : "Record payment"}
        </button>
        <button onClick={onCancel} className="btn-ghost btn-md">
          Cancel
        </button>
      </div>
      <p className="mt-1.5 text-center text-micro text-faint">
        {willClearNow ? "Counts as paid right away." : "Accounts will confirm this before it counts as paid."}
      </p>
      {record.error && (
        <p className="mt-2 text-sm text-bad">
          {record.error instanceof Error ? record.error.message : "Could not record that."}
        </p>
      )}
      {record.isSuccess && (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[13px] font-medium text-good">
          <CheckCircle2 size={14} /> Recorded
        </p>
      )}
    </div>
  );
}
