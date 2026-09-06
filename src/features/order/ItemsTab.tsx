import { useState } from "react";
import { money } from "@/lib/format";
import { useOrderLines, useOrderRecord } from "@/hooks/useBoard";
import { lineState, lineStateColor, lineStateLabel, pendingQty } from "@/lib/labels";
import { Skeleton } from "@/components/Primitives";
import type { BoardRow, OrderLine } from "@/types/database";

/** Ship-to block, reused on the item detail. */
function ShipTo({ order }: { order: BoardRow }) {
  const { data: rec } = useOrderRecord(order.id);
  const ship = rec?.ship_to ?? order.ship_to;
  if (!ship) {
    return <p className="text-micro text-faint">Shipping address not synced yet.</p>;
  }
  return (
    <address className="text-sm not-italic leading-relaxed">
      <span className="block font-medium">{order.customer_name ?? "—"}</span>
      {ship.attention && <span className="block">{ship.attention}</span>}
      {ship.address && <span className="block">{ship.address}</span>}
      {ship.street2 && <span className="block">{ship.street2}</span>}
      <span className="block">{[ship.city, ship.state, ship.zip].filter(Boolean).join(", ")}</span>
      {(rec?.contact_phone || ship.phone) && (
        <a
          href={`tel:${rec?.contact_phone ?? ship.phone}`}
          className="num mt-0.5 block text-info underline"
        >
          {rec?.contact_phone ?? ship.phone}
        </a>
      )}
    </address>
  );
}

function ItemDetail({ line, order }: { line: OrderLine; order: BoardRow }) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1">
      <span className="shrink-0 text-micro text-faint">{label}</span>
      <span className="text-right text-sm">{value}</span>
    </div>
  );
  return (
    <div className="mt-2 border-l-2 border-line pl-3">
      {line.description && (
        <p className="mb-2 whitespace-pre-line text-sm text-muted">{line.description}</p>
      )}
      {row("SKU", line.item_sku ?? "—")}
      {row(line.line_item_kind === "service" ? "SAC" : "HSN", line.hsn_or_sac ?? "—")}
      {row("Type", line.line_item_kind === "service" ? "Service" : "Goods")}
      {row("Ordered", `${line.quantity}${line.unit ? ` ${line.unit}` : ""}`)}
      {row(
        "Dispatched",
        <span className="num" style={{ color: lineStateColor[lineState(line)] }}>
          {line.qty_dispatched} · {lineStateLabel[lineState(line)]}
          {pendingQty(line) > 0 && ` (${pendingQty(line)} pending)`}
        </span>,
      )}
      {row("Rate", <span className="num">{money(line.rate)}</span>)}
      {row("Amount", <span className="num font-medium">{money(line.amount)}</span>)}

      <p className="mb-1 mt-3 text-micro font-medium text-muted">Ship to</p>
      <ShipTo order={order} />
    </div>
  );
}

export function ItemsTab({ order, syncing }: { order: BoardRow; syncing: boolean }) {
  const { data, isLoading } = useOrderLines(order.id);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <section className="card p-3">
        <p className="mb-1 text-micro font-medium text-muted">Shipping address</p>
        <ShipTo order={order} />
      </section>

      {isLoading && <Skeleton rows={4} />}

      {!isLoading && (!data || data.length === 0) && (
        <p className="text-sm text-faint">
          {syncing
            ? "Fetching line items from Zoho…"
            : "No line items came through from Zoho for this order."}
        </p>
      )}

      {data && data.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {data.map((l) => {
            const isOpen = open === l.id;
            return (
              <li key={l.id} className="py-2">
                <button
                  onClick={() => setOpen(isOpen ? null : l.id)}
                  className="grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-3 text-left text-sm"
                  aria-expanded={isOpen}
                >
                  <span
                    className="h-2 w-2 shrink-0"
                    style={{ backgroundColor: lineStateColor[lineState(l)] }}
                    title={lineStateLabel[lineState(l)]}
                    aria-hidden
                  />
                  <span className="truncate">
                    <span className="block truncate">
                      {l.item_name ?? "—"}
                      {l.line_item_kind === "service" && (
                        <span className="ml-1.5 text-micro text-faint">SAC</span>
                      )}
                    </span>
                    <span className="num block text-micro" style={{ color: pendingQty(l) > 0 ? lineStateColor[lineState(l)] : "#667079" }}>
                      {pendingQty(l) > 0
                        ? `${pendingQty(l)} of ${l.quantity}${l.unit ? ` ${l.unit}` : ""} pending`
                        : `${l.quantity}${l.unit ? ` ${l.unit}` : ""} sent`}
                    </span>
                  </span>
                  <span className="num text-right text-micro text-faint">
                    {l.quantity}
                    {l.unit ? ` ${l.unit}` : ""}
                  </span>
                  <span className="num w-20 text-right font-medium">{money(l.amount)}</span>
                </button>
                {isOpen && <ItemDetail line={l} order={order} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
