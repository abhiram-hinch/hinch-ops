import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { money } from "@/lib/format";
import { useOrderLines, useOrderRecord, useUpdateLineVendor } from "@/hooks/useBoard";
import { canEditLineVendor } from "@/hooks/useAuth";
import { lineState, lineStateColor, lineStateLabel, pendingQty } from "@/lib/labels";
import { Input, Skeleton } from "@/components/Primitives";
import type { BoardRow, OrderLine, Profile } from "@/types/database";

const UNASSIGNED = "Unassigned";

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

function ItemDetail({
  line,
  order,
  mayEditVendor,
  onSetVendor,
}: {
  line: OrderLine;
  order: BoardRow;
  mayEditVendor: boolean;
  onSetVendor: (vendorName: string | null) => void;
}) {
  const [vendorDraft, setVendorDraft] = useState(line.vendor_name ?? "");
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

      {mayEditVendor ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-micro text-faint">Vendor</span>
          <Input
            value={vendorDraft}
            onChange={(e) => setVendorDraft(e.target.value)}
            onBlur={() => {
              const trimmed = vendorDraft.trim();
              if (trimmed !== (line.vendor_name ?? "")) onSetVendor(trimmed || null);
            }}
            placeholder="Who's this being procured from?"
            className="h-8 flex-1 text-[13px]"
          />
        </div>
      ) : (
        line.vendor_name && row("Vendor", line.vendor_name)
      )}

      <p className="mb-1 mt-3 text-micro font-medium text-muted">Ship to</p>
      <ShipTo order={order} />
    </div>
  );
}

function formatForCopy(groups: { vendor: string; lines: OrderLine[] }[]): string {
  return groups
    .map(({ vendor, lines }) => {
      const items = lines
        .map((l) => `- ${l.item_name ?? "—"} — ${l.quantity}${l.unit ? ` ${l.unit}` : ""}`)
        .join("\n");
      return `${vendor} (${lines.length} item${lines.length === 1 ? "" : "s"})\n${items}`;
    })
    .join("\n\n");
}

export function ItemsTab({
  order,
  profile,
  syncing,
}: {
  order: BoardRow;
  profile: Profile;
  syncing: boolean;
}) {
  const { data, isLoading } = useOrderLines(order.id);
  const setVendor = useUpdateLineVendor(order.id);
  const mayEditVendor = canEditLineVendor(profile.role);
  const [open, setOpen] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const groups = useMemo(() => {
    if (!data || data.length === 0) return [];
    const byVendor = new Map<string, OrderLine[]>();
    for (const l of data) {
      const key = l.vendor_name?.trim() || UNASSIGNED;
      if (!byVendor.has(key)) byVendor.set(key, []);
      byVendor.get(key)!.push(l);
    }
    const named = [...byVendor.keys()].filter((k) => k !== UNASSIGNED).sort((a, b) => a.localeCompare(b));
    const ordered = byVendor.has(UNASSIGNED) ? [...named, UNASSIGNED] : named;
    return ordered.map((vendor) => ({ vendor, lines: byVendor.get(vendor)! }));
  }, [data]);

  async function copyGrouped() {
    try {
      await navigator.clipboard.writeText(formatForCopy(groups));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 2000);
  }

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

      {groups.length > 0 && (
        <>
          <div className="flex flex-col items-end gap-1">
            <button onClick={copyGrouped} className="btn-soft btn-sm gap-1.5">
              {copyState === "copied" ? <Check size={13} /> : <Copy size={13} />}
              {copyState === "copied" ? "Copied" : "Copy items, grouped by vendor"}
            </button>
            {copyState === "error" && (
              <p className="text-micro text-bad">
                Couldn&apos;t copy — your browser blocked clipboard access. Select the list above and copy it
                manually.
              </p>
            )}
          </div>

          {groups.map(({ vendor, lines }) => (
            <div key={vendor}>
              <p className="mb-1 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wide text-faint">
                {vendor}
                <span className="font-normal normal-case text-faint">
                  · {lines.length} item{lines.length === 1 ? "" : "s"}
                </span>
              </p>
              <ul className="divide-y divide-line border-t border-line">
                {lines.map((l) => {
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
                          <span
                            className="num block text-micro"
                            style={{ color: pendingQty(l) > 0 ? lineStateColor[lineState(l)] : "#667079" }}
                          >
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
                      {isOpen && (
                        <ItemDetail
                          line={l}
                          order={order}
                          mayEditVendor={mayEditVendor}
                          onSetVendor={(vendorName) => setVendor.mutate({ lineId: l.id, vendorName })}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
