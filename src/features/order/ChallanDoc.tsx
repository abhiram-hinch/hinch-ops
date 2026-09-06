import { Printer, X } from "lucide-react";
import { money } from "@/lib/format";
import { useOrderLines, useOrderRecord } from "@/hooks/useBoard";
import type { BoardRow, Dispatch } from "@/types/database";

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

/**
 * A printable Delivery Challan. Rendered into an overlay; "Print" hides the rest
 * of the app via the .print-doc rule in index.css.
 */
export function ChallanDoc({
  order,
  dispatch,
  onClose,
}: {
  order: BoardRow;
  dispatch: Dispatch;
  onClose: () => void;
}) {
  const { data: rec } = useOrderRecord(order.id);
  const { data: lines } = useOrderLines(order.id);
  const ship = rec?.ship_to ?? order.ship_to;
  const quote = order.quotation_ref_override ?? order.quotation_ref;

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center overflow-y-auto bg-ink/30 p-6 print:bg-surface print:p-0">
      {/* Sticky action bar so Print is always in reach */}
      <div className="sticky top-0 z-10 mb-4 flex w-full max-w-[720px] items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 shadow-pop print:hidden">
        <span className="num text-sm font-semibold text-ink">
          {dispatch.dc_number || "Delivery Challan"}
        </span>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="btn-primary btn-md gap-1.5">
            <Printer size={16} /> Print
          </button>
          <button onClick={onClose} className="btn-ghost btn-md gap-1.5">
            <X size={15} /> Close
          </button>
        </div>
      </div>

      <div className="print-doc w-full max-w-[720px] bg-surface p-8 text-ink shadow-lg print:max-w-none print:shadow-none">
        <div className="flex items-start justify-between border-b-2 border-ink pb-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">HINCH</h1>
            <p className="text-micro text-muted">Delivery Challan</p>
          </div>
          <div className="text-right text-sm">
            <p className="num font-semibold">{dispatch.dc_number || "DC —"}</p>
            <p className="text-micro text-muted">Dispatched {dt(dispatch.dispatched_at)}</p>
            {dispatch.is_final && <p className="text-micro text-good">Final — completes order</p>}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-micro font-medium text-muted">Order</p>
            <p className="num">{order.so_number ?? "—"}</p>
            {quote && <p className="num text-micro text-faint">Quote {quote}</p>}
            <p className="mt-2 text-micro font-medium text-muted">Salesperson</p>
            <p>{order.salesperson_name ?? "—"}</p>
          </div>
          <div>
            <p className="text-micro font-medium text-muted">Deliver to</p>
            <p className="font-medium">{order.customer_name ?? "—"}</p>
            {ship?.attention && <p>{ship.attention}</p>}
            {ship?.address && <p>{ship.address}</p>}
            {ship?.street2 && <p>{ship.street2}</p>}
            <p>{[ship?.city, ship?.state, ship?.zip].filter(Boolean).join(", ") || "—"}</p>
            {(rec?.contact_phone || ship?.phone) && (
              <p className="num">{rec?.contact_phone ?? ship?.phone}</p>
            )}
          </div>
        </div>

        <table className="mt-5 w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-ink text-micro font-medium text-muted">
              <th className="py-1.5 text-left">#</th>
              <th className="py-1.5 text-left">Item</th>
              <th className="py-1.5 text-right">Qty</th>
              <th className="py-1.5 text-left">Unit</th>
            </tr>
          </thead>
          <tbody>
            {dispatch.dispatch_lines && dispatch.dispatch_lines.length > 0 ? (
              dispatch.dispatch_lines.map((dl, i) => (
                <tr key={dl.id} className="border-b border-line">
                  <td className="py-1.5">{i + 1}</td>
                  <td className="py-1.5">
                    {dl.sales_order_lines?.item_name ?? "—"}
                    {dl.sales_order_lines?.item_sku && (
                      <span className="num block text-micro text-faint">
                        {dl.sales_order_lines.item_sku}
                      </span>
                    )}
                  </td>
                  <td className="num py-1.5 text-right">{dl.quantity}</td>
                  <td className="py-1.5">{dl.sales_order_lines?.unit ?? "—"}</td>
                </tr>
              ))
            ) : dispatch.items_text ? (
              <tr>
                <td colSpan={4} className="whitespace-pre-line py-2">
                  {dispatch.items_text}
                </td>
              </tr>
            ) : (lines ?? []).length > 0 ? (
              (lines ?? []).map((l, i) => (
                <tr key={l.id} className="border-b border-line">
                  <td className="py-1.5">{i + 1}</td>
                  <td className="py-1.5">
                    {l.item_name ?? "—"}
                    {l.item_sku && <span className="num block text-micro text-faint">{l.item_sku}</span>}
                  </td>
                  <td className="num py-1.5 text-right">{l.quantity}</td>
                  <td className="py-1.5">{l.unit ?? "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="py-2 text-faint">
                  No item list on this challan.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-5 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-micro font-medium text-muted">Vehicle / Transporter</p>
            <p>{[dispatch.vehicle_no, dispatch.transporter].filter(Boolean).join(" · ") || "—"}</p>
            {dispatch.driver_phone && <p className="num text-micro text-faint">{dispatch.driver_phone}</p>}
            <p className="mt-2 text-micro font-medium text-muted">Order value</p>
            <p className="num">{money(order.total)}</p>
          </div>
          <div>
            <p className="text-micro font-medium text-muted">Delivery</p>
            <p>{dispatch.delivered_at ? `Delivered ${dt(dispatch.delivered_at)}` : "Pending"}</p>
            {dispatch.received_by && <p className="text-micro text-faint">Received by {dispatch.received_by}</p>}
          </div>
        </div>

        {dispatch.note && (
          <p className="mt-4 whitespace-pre-line border-t border-line pt-2 text-micro text-muted">
            {dispatch.note}
          </p>
        )}

        <div className="mt-10 flex justify-between text-micro text-faint">
          <span>Dispatched by: {dispatch.profiles?.full_name ?? "—"}</span>
          <span>Receiver's signature: ______________________</span>
        </div>
      </div>
    </div>
  );
}
