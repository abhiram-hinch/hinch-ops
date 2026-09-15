import { useEffect, useState } from "react";
import { CheckCircle2, MapPin } from "lucide-react";
import { BUILDING_TYPES, buildingTypeLabel } from "@/lib/labels";
import { mapsUrl } from "@/lib/format";
import { useSaveSiteDetails, useSiteDetails } from "@/hooks/useBoard";
import { Field, Input, Select, Skeleton } from "@/components/Primitives";
import type { BoardRow, BuildingType, Profile } from "@/types/database";

const LIFT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Not recorded" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export function SiteTab({ order, profile }: { order: BoardRow; profile: Profile }) {
  const { data, isLoading } = useSiteDetails(order.id);
  const save = useSaveSiteDetails(order.id);

  const [buildingType, setBuildingType] = useState<BuildingType | "">("");
  const [block, setBlock] = useState("");
  const [floor, setFloor] = useState("");
  const [flatOrVilla, setFlatOrVilla] = useState("");
  const [lift, setLift] = useState("");
  const [mapsOverride, setMapsOverride] = useState("");
  const [notes, setNotes] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
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
      building_type: buildingType || null,
      block: block.trim() || null,
      floor: floor.trim() || null,
      flat_or_villa_no: flatOrVilla.trim() || null,
      has_service_lift: lift === "" ? null : lift === "yes",
      maps_url: trimmedMaps ? (/^https?:\/\//i.test(trimmedMaps) ? trimmedMaps : `https://${trimmedMaps}`) : null,
      notes: notes.trim() || null,
      userId: profile.id,
    });
    setJustSaved(true);
  }

  const maps = data?.maps_url || mapsUrl(order.ship_to);

  if (isLoading) return <Skeleton rows={5} />;

  return (
    <div className="space-y-4">
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

      <div className="card p-3.5">
        <p className="mb-3 text-[13px] font-semibold text-ink">Site details</p>
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
          <Field label="Service lift">
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
          <Field label="Floor">
            <Input value={floor} onChange={(e) => setFloor(e.target.value)} className="w-full" />
          </Field>
          <div className="col-span-2">
            <Field label="Flat / villa number">
              <Input value={flatOrVilla} onChange={(e) => setFlatOrVilla(e.target.value)} className="w-full" />
            </Field>
          </div>
        </div>

        <div className="mt-3">
          <p className="mb-1 text-[13px] font-medium text-muted">
            Precise location <span className="text-faint">(optional)</span>
          </p>
          <Input
            value={mapsOverride}
            onChange={(e) => setMapsOverride(e.target.value)}
            placeholder="Paste a Google Maps share link if the address above is wrong"
            className="w-full"
          />
          <p className="mt-1 text-micro text-faint">
            Find the actual spot in Google Maps, share it, and paste the link here — it takes over from the
            auto-guessed address.
          </p>
        </div>

        <div className="mt-3">
          <p className="mb-1 text-[13px] font-medium text-muted">
            Notes <span className="text-faint">(optional)</span>
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Anything hamali should know — narrow street, gated entry, stairs only, etc."
            className="field w-full resize-y py-2"
          />
        </div>

        <button onClick={submit} disabled={save.isPending} className="btn-primary btn-md mt-4 w-full">
          {save.isPending ? "Saving…" : "Save site details"}
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
    </div>
  );
}
