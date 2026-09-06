import { useMemo, useState } from "react";
import { PackageCheck, Plus, Printer, Undo2 } from "lucide-react";
import { canEditDispatch } from "@/hooks/useAuth";
import {
  useAddDispatch,
  useDeleteDispatch,
  useDispatches,
  useOrderLines,
  useUpdateDispatch,
} from "@/hooks/useBoard";
import { lineState, lineStateColor, pendingQty } from "@/lib/labels";
import { Field, Input, Skeleton } from "@/components/Primitives";
import { ChallanDoc } from "./ChallanDoc";
import type { BoardRow, Dispatch, Profile } from "@/types/database";

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";

const EMPTY_HEADER = { vehicle_no: "", transporter: "", driver_phone: "", note: "", is_final: false };

export function DispatchTab({ order, profile }: { order: BoardRow; profile: Profile }) {
  const { data: challans, isLoading } = useDispatches(order.id);
  const { data: lines } = useOrderLines(order.id);
  const add = useAddDispatch(order.id);
  const upd = useUpdateDispatch(order.id);
  const del = useDeleteDispatch(order.id);
  const mayEdit = canEditDispatch(profile.role);

  const [hdr, setHdr] = useState(EMPTY_HEADER);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [itemsText, setItemsText] = useState("");
  const [printing, setPrinting] = useState<Dispatch | null>(null);
  // Dispatch team opens straight to the challan list; the form is one tap away.
  const [formOpen, setFormOpen] = useState(false);
  const setH = (p: Partial<typeof EMPTY_HEADER>) => setHdr((f) => ({ ...f, ...p }));

  const pendingLines = useMemo(
    () => (lines ?? []).filter((l) => pendingQty(l) > 0),
    [lines],
  );
  const hasLines = (lines?.length ?? 0) > 0;
  const hasChallans = (challans?.length ?? 0) > 0;
  const orderClosed =
    order.dispatch_status === "delivered" || order.dispatch_status === "fulfilled";

  function resetForm() {
    setHdr(EMPTY_HEADER);
    setPick({});
    setItemsText("");
    setFormOpen(false);
  }

  async function submit() {
    const challanLines = Object.entries(pick)
      .map(([id, q]) => ({ sales_order_line_id: id, quantity: Number(q) }))
      .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0);

    await add.mutateAsync({
      ...hdr,
      items_text: hasLines ? null : itemsText || null,
      userId: profile.id,
      lines: challanLines,
    });
    resetForm();
  }

  function markDelivered(d: Dispatch) {
    const who = window.prompt("Received by (name on the challan)?", d.received_by ?? "");
    if (who === null) return;
    upd.mutate({
      id: d.id,
      patch: { delivered_at: new Date().toISOString(), received_by: who || null },
      userId: profile.id,
    });
  }

  const canSubmit =
    !add.isPending &&
    (hasLines
      ? Object.values(pick).some((q) => Number(q) > 0)
      : itemsText.trim().length > 0);

  return (
    <div className="space-y-5">
      {/* ---- Challans + their actions, right at the top for the dispatch team --- */}
      {isLoading && <Skeleton rows={2} />}

      {!isLoading && !hasChallans && (
        <p className="rounded-lg bg-raised px-3 py-4 text-center text-[13px] text-muted">
          No delivery challans yet.{mayEdit && !orderClosed ? " Create the first one below." : ""}
        </p>
      )}

      {hasChallans && (
        <ul className="space-y-2.5">
          {challans!.map((d) => (
            <li key={d.id} className="card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="num text-sm font-semibold text-ink">
                    {d.dc_number || "DC —"}
                    {d.is_final && (
                      <span className="ml-2 font-sans text-micro font-medium text-good">
                        closes order
                      </span>
                    )}
                  </p>
                  <p className="text-micro text-faint">
                    Dispatched {fmt(d.dispatched_at)}
                    {d.delivered_at ? ` · delivered ${fmt(d.delivered_at)}` : ""}
                    {d.profiles?.full_name ? ` · ${d.profiles.full_name}` : ""}
                  </p>
                  {(d.vehicle_no || d.transporter) && (
                    <p className="text-micro text-faint">
                      {[d.vehicle_no, d.transporter].filter(Boolean).join(" · ")}
                      {d.driver_phone ? ` · ${d.driver_phone}` : ""}
                    </p>
                  )}
                  {d.dispatch_lines && d.dispatch_lines.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {d.dispatch_lines.map((dl) => (
                        <li key={dl.id} className="num text-micro text-muted">
                          {dl.quantity}
                          {dl.sales_order_lines?.unit ? ` ${dl.sales_order_lines.unit}` : ""} ·{" "}
                          {dl.sales_order_lines?.item_name ?? "item"}
                        </li>
                      ))}
                    </ul>
                  )}
                  {d.items_text && (
                    <p className="mt-0.5 whitespace-pre-line text-micro text-muted">{d.items_text}</p>
                  )}
                  {d.received_by && (
                    <p className="text-micro text-faint">Received by {d.received_by}</p>
                  )}
                </div>

                {d.delivered_at ? (
                  <span className="chip shrink-0 bg-goodSoft px-2 py-0.5 text-micro text-good">
                    <PackageCheck size={12} /> Delivered
                  </span>
                ) : (
                  <span className="chip shrink-0 bg-infoSoft px-2 py-0.5 text-micro text-info">
                    In transit
                  </span>
                )}
              </div>

              {/* Prominent actions */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  className="btn-soft btn-sm gap-1.5"
                  onClick={() => setPrinting(d)}
                >
                  <Printer size={14} /> Print challan
                </button>
                {mayEdit && !d.delivered_at && (
                  <button
                    className="btn-primary btn-sm gap-1.5"
                    disabled={upd.isPending}
                    onClick={() => markDelivered(d)}
                  >
                    <PackageCheck size={14} /> Mark delivered
                  </button>
                )}
                {mayEdit && d.delivered_at && (
                  <button
                    className="btn-ghost btn-sm gap-1.5"
                    disabled={upd.isPending}
                    onClick={() =>
                      upd.mutate({
                        id: d.id,
                        patch: { delivered_at: null, received_by: null },
                        userId: profile.id,
                      })
                    }
                  >
                    <Undo2 size={13} /> Undo delivered
                  </button>
                )}
                {mayEdit && (
                  <button
                    className="ml-auto text-micro text-faint hover:text-bad"
                    onClick={() => {
                      if (window.confirm("Delete this challan?")) del.mutate(d.id);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ---- Create challan --------------------------------------------------- */}
      {mayEdit && !orderClosed && !formOpen && (
        <button
          onClick={() => setFormOpen(true)}
          className="btn-primary btn-md w-full gap-1.5"
        >
          <Plus size={16} /> {hasChallans ? "Add another challan" : "Create delivery challan"}
        </button>
      )}

      {mayEdit && !orderClosed && formOpen && (
        <div className="card p-3">
          <p className="mb-2 text-micro font-medium text-muted">
            New delivery challan
            <span className="ml-1.5 font-normal text-faint">· DC number auto-generated</span>
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Vehicle no.">
              <Input value={hdr.vehicle_no} onChange={(e) => setH({ vehicle_no: e.target.value })} className="w-full" />
            </Field>
            <Field label="Transporter">
              <Input value={hdr.transporter} onChange={(e) => setH({ transporter: e.target.value })} className="w-full" />
            </Field>
            <Field label="Driver phone">
              <Input value={hdr.driver_phone} onChange={(e) => setH({ driver_phone: e.target.value })} className="w-full" />
            </Field>
            <Field label="Note">
              <Input value={hdr.note} onChange={(e) => setH({ note: e.target.value })} className="w-full" />
            </Field>
          </div>

          {hasLines ? (
            <div className="mt-3">
              <p className="mb-1 text-micro font-medium text-muted">Items on this challan</p>
              {pendingLines.length === 0 ? (
                <p className="text-micro text-faint">Every line is fully dispatched.</p>
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {pendingLines.map((l) => {
                    const pend = pendingQty(l);
                    const val = pick[l.id] ?? "";
                    return (
                      <li key={l.id} className="flex items-center gap-2 py-2">
                        <input
                          type="checkbox"
                          checked={!!pick[l.id] && Number(pick[l.id]) > 0}
                          onChange={(e) =>
                            setPick((p) => ({ ...p, [l.id]: e.target.checked ? String(pend) : "" }))
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{l.item_name ?? "—"}</span>
                          <span className="num block text-micro text-faint">
                            {pend} of {l.quantity}
                            {l.unit ? ` ${l.unit}` : ""} pending
                          </span>
                        </span>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={val}
                          placeholder="0"
                          onChange={(e) => setPick((p) => ({ ...p, [l.id]: e.target.value }))}
                          className="num h-8 w-20 text-right"
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <>
              <Field label="Items on this challan">
                <textarea
                  value={itemsText}
                  onChange={(e) => setItemsText(e.target.value)}
                  rows={2}
                  placeholder="e.g. 22 sheets 18mm BWP ply, 40 laminates — walnut"
                  className="field w-full py-1.5"
                />
              </Field>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={hdr.is_final} onChange={(e) => setH({ is_final: e.target.checked })} />
                This challan completes the order
              </label>
            </>
          )}

          <div className="mt-3 flex gap-2">
            <button onClick={submit} disabled={!canSubmit} className="btn-primary btn-md flex-1">
              {add.isPending ? "Creating…" : "Create challan"}
            </button>
            <button onClick={resetForm} className="btn-ghost btn-md">
              Cancel
            </button>
          </div>
          {add.error && (
            <p className="mt-2 text-sm text-bad">
              {add.error instanceof Error ? add.error.message : "Could not create that."}
            </p>
          )}
        </div>
      )}

      {/* ---- Line-level progress ------------------------------------------- */}
      {hasLines && (
        <section className="card p-3">
          <p className="mb-2 text-micro font-medium text-muted">Dispatch progress</p>
          <ul className="space-y-1.5">
            {(lines ?? []).map((l) => {
              const st = lineState(l);
              const pend = pendingQty(l);
              return (
                <li key={l.id} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2 w-2 shrink-0"
                    style={{ backgroundColor: lineStateColor[st] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{l.item_name ?? "—"}</span>
                  <span
                    className="num shrink-0 text-micro"
                    style={{ color: st === "done" ? undefined : lineStateColor[st] }}
                  >
                    {st === "done"
                      ? `${l.quantity} sent`
                      : `${pend} of ${l.quantity} pending`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {printing && <ChallanDoc order={order} dispatch={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}
