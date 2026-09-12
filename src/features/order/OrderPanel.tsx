import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, Pencil, Check, Phone, FileText, ExternalLink } from "lucide-react";
import { money, moneyExact, shortDate, relativeTime } from "@/lib/format";
import {
  paymentView,
  paymentViewColor,
  paymentViewLabel,
  paymentViewTone,
} from "@/lib/labels";
import { StatusBadge, toneText } from "@/lib/statusUi";
import {
  canEditDispatch,
  canEditPayments,
  canSeePaymentsFor,
} from "@/hooks/useAuth";
import {
  useActivity,
  useOrderRecord,
  usePdfUrl,
  useSetQuoteRef,
  useSyncOrderDetail,
} from "@/hooks/useBoard";
import { CreditControl } from "./CreditControl";
import { ProcureFirstControl } from "./ProcureFirstControl";
import { PaymentBar, Skeleton } from "@/components/Primitives";
import { PaymentsTab } from "./PaymentsTab";
import { DispatchControl } from "./DispatchControl";
import { DispatchTab } from "./DispatchTab";
import { ItemsTab } from "./ItemsTab";
import { NotesTab } from "./NotesTab";
import type { BoardRow, Profile } from "@/types/database";

type Tab = "payments" | "delivery" | "items" | "details" | "notes";

const titleCase = (s: string | null | undefined) =>
  s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";

export function OrderPanel({
  order,
  profile,
  onClose,
}: {
  order: BoardRow;
  profile: Profile;
  onClose: () => void;
}) {
  const isCreditCustomer = order.customer_credit_status !== "none";
  const showPayments = canSeePaymentsFor(profile.role, isCreditCustomer);
  // Dispatch team lands on Delivery; everyone else on Payments (when visible).
  const dispatchFirst = canEditDispatch(profile.role) && !canEditPayments(profile.role);
  const [tab, setTab] = useState<Tab>(
    dispatchFirst ? "delivery" : showPayments ? "payments" : "delivery",
  );
  const pv = paymentView(order);
  const mayEditPay = canEditPayments(profile.role) && showPayments;
  const mayEditDispatch = canEditDispatch(profile.role);

  const { data: rec } = useOrderRecord(order.id);
  const syncDetail = useSyncOrderDetail();

  // Payments tab can vanish under the caller (customer just tagged credit) —
  // don't leave them staring at a hidden tab.
  useEffect(() => {
    if (!showPayments && tab === "payments") setTab("delivery");
  }, [showPayments, tab]);
  useEffect(() => {
    if (order.zoho_salesorder_id) {
      syncDetail.mutate({ orderId: order.id, zohoId: order.zoho_salesorder_id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const TABS: [Tab, string][] = [
    ...(showPayments ? ([["payments", "Payments"]] as [Tab, string][]) : []),
    ["delivery", "Delivery"],
    ["items", "Items"],
    ["details", "Details"],
    ["notes", "Notes"],
  ];

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-ink/25 backdrop-blur-[1px] sm:bg-transparent sm:backdrop-blur-0"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-0 z-40 flex h-screen w-full max-w-[540px] flex-col bg-canvas shadow-pop"
        aria-label={`Order ${order.so_number ?? ""}`}
      >
        {/* Header */}
        <header className="border-b border-line bg-surface px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-ink">
                {order.customer_name ?? "Unnamed customer"}
              </h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-micro text-muted">
                <span className="num">{order.so_number ?? "—"}</span>
                <span>·</span>
                <QuoteRef order={order} editable={mayEditPay || mayEditDispatch} />
                <span>·</span>
                <span>{shortDate(order.order_date)}</span>
                {order.salesperson_name && (
                  <>
                    <span>·</span>
                    <span>{order.salesperson_name}</span>
                  </>
                )}
              </p>
            </div>
            <button onClick={onClose} className="btn-ghost btn-sm shrink-0" aria-label="Close">
              <X size={16} />
            </button>
          </div>

          {/* One summary strip: money on the left, order stage on the right */}
          <div className="mt-3 flex items-center justify-between gap-4 rounded-lg bg-raised p-3">
            <div className="min-w-0">
              <p className="num text-xl font-semibold leading-none text-ink">
                {money(order.total)}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <PaymentBar
                  received={order.amount_received}
                  total={order.total}
                  color={paymentViewColor[pv]}
                  width={104}
                  showPct={false}
                />
                <span className={`text-[13px] font-medium ${toneText[paymentViewTone[pv]]}`}>
                  {paymentViewLabel[pv]}
                </span>
              </div>
              {order.balance_due > 0.01 && (
                <p className="num mt-1 text-micro text-muted">{money(order.balance_due)} left</p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <StatusBadge status={order.dispatch_status} size="sm" />
              <p className="num mt-1.5 text-micro text-faint">{order.days_in_status}d here</p>
            </div>
          </div>
          {order.dispatch_status === "on_hold" && order.hold_reason && (
            <p className="mt-1.5 text-micro font-medium text-bad">On hold — {order.hold_reason}</p>
          )}

          <div className="mt-3">
            <CreditControl
              customerId={rec?.customer_id ?? null}
              customerName={order.customer_name}
              creditStatus={order.customer_credit_status}
              role={profile.role}
            />
          </div>

          {order.customer_credit_status === "none" && (
            <div className="mt-2">
              <ProcureFirstControl order={order} role={profile.role} />
            </div>
          )}
        </header>

        {/* Dispatch actions (own their own copy of the permission note) */}
        <div className="border-b border-line bg-surface">
          <DispatchControl
            order={order}
            profile={profile}
            onOpenDispatches={() => setTab("delivery")}
          />
        </div>

        {/* Tabs */}
        <nav className="flex gap-1 border-b border-line bg-surface px-3" role="tablist">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
                tab === key
                  ? "border-brand text-brand"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "payments" && <PaymentsTab order={order} profile={profile} />}
          {tab === "delivery" && <DispatchTab order={order} profile={profile} />}
          {tab === "items" && <ItemsTab order={order} syncing={syncDetail.isPending} />}
          {tab === "details" && (
            <DetailsTab
              order={order}
              syncing={syncDetail.isPending}
              failed={syncDetail.isError}
              onRetry={() =>
                syncDetail.mutate({ orderId: order.id, zohoId: order.zoho_salesorder_id })
              }
            />
          )}
          {tab === "notes" && <NotesTab order={order} profile={profile} />}
        </div>

        <footer className="border-t border-line bg-surface px-5 py-2 text-micro text-faint">
          Zoho: {order.zoho_status ?? "unknown"} · synced {relativeTime(order.last_synced_at)}
          {syncDetail.isPending && " · loading details…"}
        </footer>
      </aside>
    </>
  );
}

function QuoteRef({ order, editable }: { order: BoardRow; editable: boolean }) {
  const setRef = useSetQuoteRef(order.id);
  const shown = order.quotation_ref_override ?? order.quotation_ref;
  const overridden = !!order.quotation_ref_override;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shown ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(shown ?? "");
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setRef.mutate(draft, { onSuccess: () => setEditing(false) });
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="QT-…"
          className="field num h-6 w-32 px-1.5 text-micro"
        />
        <button
          className="text-good"
          onClick={() => setRef.mutate(draft, { onSuccess: () => setEditing(false) })}
          aria-label="Save quote ref"
        >
          <Check size={13} />
        </button>
      </span>
    );
  }

  return (
    <button
      className={`num inline-flex items-center gap-1 ${editable ? "hover:text-ink" : "cursor-default"} ${
        overridden ? "font-semibold text-ink" : ""
      }`}
      onClick={() => editable && setEditing(true)}
      title={overridden ? `Overrides Zoho: ${order.quotation_ref ?? "none"}` : undefined}
    >
      {shown ?? (editable ? "add quote #" : "—")}
      {editable && <Pencil size={10} className="text-faint" />}
    </button>
  );
}

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className="shrink-0 text-micro text-muted">{label}</span>
      <span className="text-right text-sm text-ink">{children}</span>
    </div>
  );
}

function DetailsTab({
  order,
  syncing,
  failed,
  onRetry,
}: {
  order: BoardRow;
  syncing: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const { data: rec, isLoading } = useOrderRecord(order.id);
  const { data: pdfUrl } = usePdfUrl(rec?.so_pdf_path ?? null);

  if (isLoading) return <Skeleton rows={5} />;

  const raw = (rec?.detail_raw ?? {}) as Record<string, unknown>;
  const s = (k: string) => {
    const v = raw[k];
    return v === undefined || v === null || v === "" ? null : String(v);
  };
  const n = (k: string) => {
    const v = Number(raw[k]);
    return Number.isFinite(v) ? v : null;
  };
  const ship = rec?.ship_to ?? order.ship_to;

  return (
    <div className="space-y-5">
      {/* PDF */}
      <section className="card p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <FileText size={14} className="text-muted" /> Sales order PDF
          </span>
          {pdfUrl ? (
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="btn-soft btn-sm">
              Open <ExternalLink size={12} />
            </a>
          ) : (
            <span className="text-micro text-faint">
              {syncing ? "fetching…" : "not available"}
              {failed && (
                <button onClick={onRetry} className="ml-2 text-brand underline">
                  retry
                </button>
              )}
            </span>
          )}
        </div>
      </section>

      {/* Ship to */}
      <section>
        <h3 className="mb-1 text-[13px] font-semibold text-ink">Delivery address</h3>
        {ship ? (
          <address className="text-sm not-italic leading-relaxed text-ink">
            {ship.attention && <span className="block font-medium">{ship.attention}</span>}
            {ship.address && <span className="block">{ship.address}</span>}
            {ship.street2 && <span className="block">{ship.street2}</span>}
            <span className="block">{[ship.city, ship.state, ship.zip].filter(Boolean).join(", ")}</span>
            {(rec?.contact_phone || ship.phone) && (
              <a
                href={`tel:${rec?.contact_phone ?? ship.phone}`}
                className="mt-1 inline-flex items-center gap-1 text-info underline"
              >
                <Phone size={12} /> {rec?.contact_phone ?? ship.phone}
              </a>
            )}
          </address>
        ) : (
          <p className="text-sm text-muted">
            {syncing ? "Loading from Zoho…" : "No address on this order."}
          </p>
        )}
        {rec?.contact_email && <p className="mt-1 text-micro text-faint">{rec.contact_email}</p>}
      </section>

      {/* Order facts */}
      <section className="border-t border-line pt-2">
        <KV label="In Zoho">{titleCase(rec?.zoho_shipped_status ?? order.zoho_shipped_status)}</KV>
        <KV label="Invoiced">{titleCase(rec?.zoho_invoiced_status ?? order.zoho_invoiced_status)}</KV>
        <KV label="Total quantity">{rec?.total_quantity ?? order.total_quantity ?? "—"}</KV>
        {s("payment_terms_label") && <KV label="Payment terms">{s("payment_terms_label")}</KV>}
        {s("gst_no") && <KV label="GST no.">{s("gst_no")}</KV>}
        {s("place_of_supply") && <KV label="Place of supply">{s("place_of_supply")}</KV>}
      </section>

      {(n("sub_total") !== null || n("tax_total") !== null) && (
        <section className="border-t border-line pt-2">
          <h3 className="mb-1 text-[13px] font-semibold text-ink">Amount breakdown</h3>
          {n("sub_total") !== null && (
            <KV label="Sub-total">
              <span className="num">{money(n("sub_total")!)}</span>
            </KV>
          )}
          {n("discount_total") ? (
            <KV label="Discount">
              <span className="num">−{money(n("discount_total")!)}</span>
            </KV>
          ) : null}
          {n("tax_total") !== null && (
            <KV label="Tax">
              <span className="num">{money(n("tax_total")!)}</span>
            </KV>
          )}
          {n("adjustment") ? (
            <KV label={s("adjustment_description") || "Adjustment"}>
              <span className="num">{money(n("adjustment")!)}</span>
            </KV>
          ) : null}
          <KV label="Total">
            <span className="num font-bold">{money(order.total)}</span>
          </KV>
        </section>
      )}

      {rec?.notes && (
        <section className="border-t border-line pt-2">
          <h3 className="mb-1 text-[13px] font-semibold text-ink">Notes</h3>
          <p className="whitespace-pre-line text-sm text-ink">{rec.notes}</p>
        </section>
      )}

      {s("terms") && (
        <details className="border-t border-line pt-2">
          <summary className="cursor-pointer text-[13px] font-semibold text-ink">
            Terms &amp; conditions
          </summary>
          <p className="mt-1 whitespace-pre-line text-micro text-muted">{s("terms")}</p>
        </details>
      )}

      <ActivityLog orderId={order.id} />
    </div>
  );
}

function ActivityLog({ orderId }: { orderId: string }) {
  const { data, isLoading } = useActivity(orderId);

  const describe = (a: NonNullable<typeof data>[number]) => {
    const after = a.after ?? {};
    switch (a.action) {
      case "payment_recorded":
        return `Recorded ${moneyExact(Number(after.amount ?? 0))} by ${String(
          after.payment_method ?? after.instrument ?? "",
        )}`;
      case "payment_cleared":
        return `Payment confirmed — ${moneyExact(Number(after.amount ?? 0))}`;
      case "payment_bounced":
        return `Payment bounced — ${moneyExact(Number(after.amount ?? 0))}`;
      case "payment_voided":
        return `Voided a payment — ${String(after.reason ?? "no reason")}`;
      case "procurement_gate_override":
        return `Ordered with ${moneyExact(Number(after.shortfall ?? 0))} still to clear`;
      case "dispatch_gate_override":
        return `Sent with ${moneyExact(Number(after.shortfall ?? 0))} still due`;
      case "quote_ref_override":
        return `Quote reference changed`;
      case "procure_first_authorised":
        return after.note
          ? `Approved buying the material before payment — ${String(after.note)}`
          : `Approved buying the material before payment`;
      case "procure_first_withdrawn":
        return `Withdrew approval to buy before payment`;
      default:
        return a.action.replace(/^status_/, "").replace(/_/g, " ");
    }
  };

  return (
    <details className="border-t border-line pt-2" open>
      <summary className="cursor-pointer text-[13px] font-semibold text-ink">History</summary>
      <div className="mt-2">
        {isLoading && <Skeleton rows={3} />}
        {data && data.length === 0 && (
          <p className="text-micro text-faint">Nothing has happened yet.</p>
        )}
        {data && data.length > 0 && (
          <ol className="space-y-2.5">
            {data.map((a) => (
              <li key={a.id} className="border-l-2 border-line pl-3">
                <p
                  className={`text-[13px] ${
                    a.action === "dispatch_gate_override" ? "font-semibold text-bad" : "text-ink"
                  }`}
                >
                  {describe(a)}
                </p>
                <p className="mt-0.5 text-micro text-faint">
                  {a.actor_name ?? "System"} · {new Date(a.at).toLocaleString("en-IN")}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}
