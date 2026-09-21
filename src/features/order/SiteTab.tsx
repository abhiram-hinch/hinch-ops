import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, MapPin, Store } from "lucide-react";
import { BUILDING_TYPES, buildingTypeLabel } from "@/lib/labels";
import { mapsUrl } from "@/lib/format";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { canEditSiteDetails } from "@/hooks/useAuth";
import { useSaveSiteDetails, useSiteDetails } from "@/hooks/useBoard";
import { Field, Input, Select, Skeleton } from "@/components/Primitives";
import type { BoardRow, BuildingType, Profile } from "@/types/database";

/**
 * Attaches Google Places Autocomplete to a plain text input — picking a
 * suggestion fills in a real Maps link instead of sales having to find the
 * spot themselves and paste a share link. Typing or pasting a link directly
 * still works exactly as before; this is additive, not a replacement.
 *
 * A callback ref rather than useRef+useEffect: this input can legitimately
 * mount and unmount more than once (the pickup-mode toggle swaps it in and
 * out of the tree), and a plain useEffect keyed on a stable ref object never
 * re-fires when only the DOM node underneath it changes — it can end up
 * racing loadGoogleMaps() against a node that's already been replaced. A
 * callback ref fires exactly on every real attach/detach, so it can't drift.
 */
function useAddressAutocomplete(onSelect: (mapsUrl: string) => void) {
  const [error, setError] = useState<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const listenerRef = useRef<google.maps.MapsEventListener | null>(null);

  const ref = useCallback((node: HTMLInputElement | null) => {
    listenerRef.current?.remove();
    listenerRef.current = null;
    if (!node) return;

    loadGoogleMaps()
      .then((g) => {
        const autocomplete = new g.maps.places.Autocomplete(node, {
          fields: ["formatted_address", "place_id", "url"],
        });
        listenerRef.current = autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          const url =
            place.url ??
            (place.place_id ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}` : null);
          if (url) onSelectRef.current(url);
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load Google Maps"));
  }, []);

  return { ref, error };
}

const LIFT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Not recorded" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/** Mirrors site_details_complete() in Postgres — keep the two in sync. */
function isComplete(data: {
  is_store_pickup: boolean;
  maps_url: string | null;
  floor: string | null;
  has_service_lift: boolean | null;
} | null | undefined): boolean {
  if (data?.is_store_pickup) return true;
  return !!(data?.maps_url?.trim() && data?.floor?.trim() && data?.has_service_lift !== null && data?.has_service_lift !== undefined);
}

function ReadOnlyRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right text-ink">{value}</span>
    </div>
  );
}

/** Shown wherever the order is a store pickup, instead of delivery-site detail. */
function StorePickupNotice() {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-brandSoft/50 px-3.5 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brandSoft text-brandStrong">
        <Store size={17} />
      </span>
      <div>
        <p className="text-[13px] font-semibold text-ink">Store pickup — Hinch Store, Hafeezpet</p>
        <p className="text-micro text-muted">Customer collects this order in person. No delivery site needed.</p>
      </div>
    </div>
  );
}

export function SiteTab({ order, profile }: { order: BoardRow; profile: Profile }) {
  const { data, isLoading } = useSiteDetails(order.id);
  const save = useSaveSiteDetails(order.id);
  const mayEdit = canEditSiteDetails(profile.role);

  const [pickupMode, setPickupMode] = useState(false);
  const [buildingType, setBuildingType] = useState<BuildingType | "">("");
  const [block, setBlock] = useState("");
  const [floor, setFloor] = useState("");
  const [flatOrVilla, setFlatOrVilla] = useState("");
  const [lift, setLift] = useState("");
  const [mapsOverride, setMapsOverride] = useState("");
  const [notes, setNotes] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const { ref: mapsInputRef, error: gmapsError } = useAddressAutocomplete(setMapsOverride);

  useEffect(() => {
    if (!data) return;
    setPickupMode(data.is_store_pickup);
    setBuildingType(data.building_type ?? "");
    setBlock(data.block ?? "");
    setFloor(data.floor ?? "");
    setFlatOrVilla(data.flat_or_villa_no ?? "");
    setLift(data.has_service_lift === null ? "" : data.has_service_lift ? "yes" : "no");
    setMapsOverride(data.maps_url ?? "");
    setNotes(data.notes ?? "");
  }, [data]);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2400);
    return () => clearTimeout(t);
  }, [justSaved]);

  async function submit() {
    const trimmedMaps = mapsOverride.trim();
    await save.mutateAsync({
      // Pickup orders carry no delivery-site data at all — clears whatever
      // was drafted before the toggle, so nothing stale lingers underneath.
      building_type: pickupMode ? null : buildingType || null,
      block: pickupMode ? null : block.trim() || null,
      floor: pickupMode ? null : floor.trim() || null,
      flat_or_villa_no: pickupMode ? null : flatOrVilla.trim() || null,
      has_service_lift: pickupMode ? null : lift === "" ? null : lift === "yes",
      maps_url:
        pickupMode || !trimmedMaps
          ? null
          : /^https?:\/\//i.test(trimmedMaps)
            ? trimmedMaps
            : `https://${trimmedMaps}`,
      notes: notes.trim() || null,
      is_store_pickup: pickupMode,
      userId: profile.id,
    });
    setJustSaved(true);
  }

  const maps = data?.maps_url || mapsUrl(order.ship_to);
  // Sales gets live feedback as they fill the form or flip the toggle;
  // warehouse (read-only) only ever sees what's actually been saved.
  const complete = mayEdit
    ? pickupMode || !!(mapsOverride.trim() && floor.trim() && lift !== "")
    : isComplete(data);
  const effectivePickup = mayEdit ? pickupMode : !!data?.is_store_pickup;

  if (isLoading) return <Skeleton rows={5} />;

  return (
    <div className="space-y-4">
      {!complete && (
        <div className="flex items-start gap-2 rounded-lg bg-warnSoft/60 px-3.5 py-3 text-[13px] text-warn">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            Precise location, floor, and service lift are required before this order can move to{" "}
            <strong>Ready to procure</strong> — or mark it as a store pickup if the customer's
            collecting it themselves.
            {!mayEdit && " Sales needs to fill this in."}
          </span>
        </div>
      )}

      {!mayEdit && effectivePickup && <StorePickupNotice />}

      {!effectivePickup && (
        <div className="card p-3.5">
          <p className="mb-2 text-[13px] font-semibold text-ink">Location</p>
          <div className="flex items-center gap-2">
            {maps ? (
              <a href={maps} target="_blank" rel="noopener noreferrer" className="btn-soft btn-sm gap-1.5">
                <MapPin size={13} /> Open in Maps
              </a>
            ) : (
              <p className="text-[13px] text-muted">No address on this order yet.</p>
            )}
            {maps && !data?.maps_url && (
              <span className="text-micro text-faint">Guessed from Zoho's address — may be off</span>
            )}
            {data?.maps_url && <span className="text-micro text-good">Corrected location saved</span>}
          </div>
        </div>
      )}

      {!mayEdit ? (
        !effectivePickup && (
          <div className="card p-3.5">
            <p className="mb-1 text-[13px] font-semibold text-ink">Site details</p>
            <ReadOnlyRow label="Building type" value={buildingType ? buildingTypeLabel[buildingType] : "—"} />
            <ReadOnlyRow label="Block" value={block || "—"} />
            <ReadOnlyRow label="Floor" value={floor || "—"} />
            <ReadOnlyRow label="Flat / villa number" value={flatOrVilla || "—"} />
            <ReadOnlyRow label="Service lift" value={lift === "" ? "—" : lift === "yes" ? "Yes" : "No"} />
            {notes && (
              <div className="mt-2 border-t border-line pt-2">
                <p className="mb-1 text-micro font-medium text-muted">Notes</p>
                <p className="whitespace-pre-line text-sm text-ink">{notes}</p>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="card p-3.5">
          <p className="mb-3 text-[13px] font-semibold text-ink">Site details</p>

          {/* How this order reaches the customer — mutually exclusive, so a
              plain two-way switch reads clearer than a checkbox buried in a form. */}
          <div className="mb-3.5 flex rounded-pill border border-line p-0.5">
            <button
              type="button"
              onClick={() => setPickupMode(false)}
              className={`flex-1 rounded-pill px-3 py-1.5 text-[13px] font-medium transition-colors ${
                !pickupMode ? "bg-brand text-white" : "text-muted hover:text-ink"
              }`}
            >
              Deliver to site
            </button>
            <button
              type="button"
              onClick={() => setPickupMode(true)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-medium transition-colors ${
                pickupMode ? "bg-brand text-white" : "text-muted hover:text-ink"
              }`}
            >
              <Store size={13} /> Store pickup
            </button>
          </div>

          {pickupMode ? (
            <StorePickupNotice />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-2 gap-y-3">
                <Field label="Building type">
                  <Select
                    value={buildingType}
                    onChange={(e) => setBuildingType(e.target.value as BuildingType | "")}
                    className="w-full"
                  >
                    <option value="">Not recorded</option>
                    {BUILDING_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {buildingTypeLabel[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Service lift *">
                  <Select value={lift} onChange={(e) => setLift(e.target.value)} className="w-full">
                    {LIFT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Block">
                  <Input value={block} onChange={(e) => setBlock(e.target.value)} className="w-full" />
                </Field>
                <Field label="Floor *">
                  <Input value={floor} onChange={(e) => setFloor(e.target.value)} className="w-full" />
                </Field>
                <div className="col-span-2">
                  <Field label="Flat / villa number">
                    <Input value={flatOrVilla} onChange={(e) => setFlatOrVilla(e.target.value)} className="w-full" />
                  </Field>
                </div>
              </div>

              <div className="mt-3">
                <p className="mb-1 text-[13px] font-medium text-muted">Precise location *</p>
                <Input
                  ref={mapsInputRef}
                  value={mapsOverride}
                  onChange={(e) => setMapsOverride(e.target.value)}
                  placeholder="Search for the address, or paste a Google Maps link"
                  className="w-full"
                />
                {gmapsError ? (
                  <p className="mt-1 text-micro text-faint">
                    Address search is unavailable right now — find the spot in Google Maps, share it, and
                    paste the link here instead.
                  </p>
                ) : (
                  <p className="mt-1 text-micro text-faint">
                    Pick the real address from the suggestions, or paste a Google Maps share link directly —
                    either takes over from the auto-guessed address.
                  </p>
                )}
              </div>
            </>
          )}

          <div className="mt-3">
            <p className="mb-1 text-[13px] font-medium text-muted">
              Notes <span className="text-faint">(optional)</span>
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={
                pickupMode
                  ? "Anything warehouse should know — who's collecting, when, etc."
                  : "Anything hamali should know — narrow street, gated entry, stairs only, etc."
              }
              className="field w-full resize-y py-2"
            />
          </div>

          <button onClick={submit} disabled={save.isPending} className="btn-primary btn-md mt-4 w-full">
            {save.isPending ? "Saving…" : pickupMode ? "Confirm store pickup" : "Save site details"}
          </button>
          {justSaved && (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-[13px] font-medium text-good">
              <CheckCircle2 size={14} /> Saved
            </p>
          )}
          {save.error && (
            <p className="mt-2 text-sm text-bad">
              {save.error instanceof Error ? save.error.message : "Could not save that."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
