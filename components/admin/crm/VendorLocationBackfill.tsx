import { useState } from "react";
import GooglePlaceAutocomplete from "@/components/location/GooglePlaceAutocomplete";
import { isPlaceCompatibleWithSelectedCity } from "@/lib/google-maps/normalizePlace";
import type { NormalizedGooglePlace } from "@/lib/google-maps/types";
import { useActiveCities } from "@/lib/locations/useActiveCities";
import type { VendorCoreFacts } from "@/lib/crm/vendorCrmProfileTypes";
import { NoteBar, PrimaryButton, SectionCard, StatusBadge } from "../AdminPrimitives";
import { formatDate } from "./VendorCrmProfileSections";
import type { VendorLocationBackfillInput } from "@/services/adminVendorLocationService";

export function VendorLocationBackfill({
  core,
  pending,
  onSave,
}: {
  core: VendorCoreFacts;
  pending: boolean;
  onSave: (input: VendorLocationBackfillInput) => Promise<boolean>;
}) {
  const { records: activeCityRecords } = useActiveCities();
  const [query, setQuery] = useState(core.formatted_address ?? "");
  const [selected, setSelected] = useState<NormalizedGooglePlace | null>(null);
  const [error, setError] = useState("");

  const status = core.location_verification_status ?? "unverified";
  const statusLabel =
    status === "unverified" ? "Needs backfill" :
    status === "provisional" ? "Provisional" :
    status === "verified" ? "Verified" :
    status === "outside_service_area" ? "Outside service area" : status;
  const statusTone =
    status === "verified" ? "emerald" :
    status === "provisional" ? "cyan" :
    status === "outside_service_area" ? "rose" : "amber";

  function manual(value: string) {
    setQuery(value);
    setSelected(null);
    setError("");
  }

  function picked(place: NormalizedGooglePlace) {
    const city = (core.city ?? "").trim();
    const market = activeCityRecords.find((record) => record.name.toLowerCase() === city.toLowerCase());
    const labels = market?.acceptedCityLabels ?? (city ? [city] : []);
    if (!city || !isPlaceCompatibleWithSelectedCity(place, city, labels)) {
      setSelected(null);
      setError(city ? `Select an office location inside ${city}.` : "Vendor city must be set before location backfill.");
      return;
    }
    if (!place.placeId || !place.city || !place.formattedAddress || place.lat == null || place.lng == null) {
      setSelected(null);
      setError("This Google result does not contain enough location evidence. Choose another suggestion.");
      return;
    }
    setError("");
    setSelected(place);
    setQuery(place.formattedAddress);
  }

  async function save() {
    if (!selected?.placeId || !selected.city || !selected.formattedAddress || selected.lat == null || selected.lng == null) {
      setError("Choose a Google suggestion before saving.");
      return;
    }
    const ok = await onSave({
      google_place_id: selected.placeId,
      google_city: selected.city,
      formatted_address: selected.formattedAddress,
      area_normalized: selected.areaNormalized,
      sublocality: selected.sublocality,
      neighborhood: selected.neighborhood,
      latitude: selected.lat,
      longitude: selected.lng,
    });
    if (ok) setSelected(null);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <SectionCard
        title="Exact office / business location"
        description="Core matching authority · Google place selection required"
        action={<StatusBadge value={statusLabel} tone={statusTone} />}
      >
        <NoteBar>
          This changes only the vendor&apos;s canonical office/base matching point and its service-zone verification.
          It does not change service coverage, package, credits, CRM relationship, or postal/contact address.
        </NoteBar>

        <div className="mt-4">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600">Search exact vendor office / business point</span>
            <GooglePlaceAutocomplete
              value={query}
              city={core.city ?? undefined}
              mode="address"
              onManualChange={manual}
              onPlaceSelected={picked}
              placeholder="Search building, shop, society, street or office"
              disabled={pending || !core.city}
              autoComplete="off"
            />
            <span className="text-[10px] leading-4 text-slate-500">
              Typing text is not enough. Select a Google suggestion so QuickFurno receives Place ID + coordinates.
            </span>
          </label>
        </div>

        {error ? <p role="alert" className="mt-2 text-[12px] font-medium text-rose-700">{error}</p> : null}

        {selected ? (
          <div className="mt-3 rounded-[var(--qfa-radius)] border border-emerald-200 bg-emerald-50/60 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">Ready to verify</p>
            <p className="mt-1 text-[13px] font-semibold text-slate-900">{selected.formattedAddress}</p>
            <p className="mt-1 text-[11px] text-slate-600">
              Google city: {selected.city} · precise coordinate pair captured
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <PrimaryButton onClick={save} disabled={pending || !selected}>
            {pending ? "Verifying…" : "Verify & save matching point"}
          </PrimaryButton>
        </div>
      </SectionCard>

      <SectionCard title="Current location authority" description="Read-only Core state">
        <dl className="space-y-3 text-[13px]">
          <Fact label="Verification"><StatusBadge value={statusLabel} tone={statusTone} /></Fact>
          <Fact label="Method">{core.location_verification_method ?? "Not resolved"}</Fact>
          <Fact label="Verified at">{formatDate(core.location_verified_at)}</Fact>
          <Fact label="Google place">{core.google_place_id ? "Stored" : "Not stored"}</Fact>
          <Fact label="Office coordinates">
            {core.office_latitude != null && core.office_longitude != null ? "Stored" : "Not stored"}
          </Fact>
          <Fact label="Current address">{core.formatted_address ?? "Not stored"}</Fact>
          <Fact label="Service zone">{core.service_zone_id ? "Resolved" : "Not resolved"}</Fact>
          <Fact label="Core city">{core.city ?? "Not set"}</Fact>
        </dl>
      </SectionCard>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[color:var(--qfa-line-soft)] pb-2 last:border-0 last:pb-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</dt>
      <dd className="mt-1 break-words font-medium text-slate-900">{children}</dd>
    </div>
  );
}
