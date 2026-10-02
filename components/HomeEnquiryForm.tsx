"use client";

import { useEffect, useState } from "react";
import { submitLead } from "@/app/actions";
import { ENQUIRY_SERVICES, trackEvent } from "@/lib/config";
import { isIndianLeadMobile } from "@/lib/leads/indianMobile";
import { useActiveCities, NO_ACTIVE_CITIES_MESSAGE } from "@/lib/locations/useActiveCities";
import GooglePlaceAutocomplete from "@/components/location/GooglePlaceAutocomplete";
import { isPlaceCompatibleWithSelectedCity } from "@/lib/google-maps/normalizePlace";
import type { NormalizedGooglePlace } from "@/lib/google-maps/types";

export function HomeEnquiryForm({ defaultService }: { defaultService?: string }) {
  const inferredService =
    defaultService && (ENQUIRY_SERVICES as readonly string[]).includes(defaultService)
      ? defaultService
      : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [shareConsent, setShareConsent] = useState(false);

  // Phase 14B: cities come only from admin-managed active cities.
  const { cities: activeCities, records: activeCityRecords, loading: citiesLoading } = useActiveCities();

  const [f, setF] = useState({
    name: "", phone: "", city: "", area: "",
    service_required: inferredService ?? ENQUIRY_SERVICES[0],
    budget: "", timeline: "", message: "",
  });
  const [googlePlace, setGooglePlace] = useState<NormalizedGooglePlace | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  function setCity(value: string) {
    setGooglePlace(null);
    setF((current) => ({ ...current, city: value }));
  }

  function setAreaManual(value: string) {
    setGooglePlace(null);
    setF((current) => ({ ...current, area: value }));
  }

  function setAreaFromGoogle(place: NormalizedGooglePlace) {
    const cityRecord = activeCityRecords.find(
      (record) => record.name.toLowerCase() === f.city.toLowerCase(),
    );
    const aliases = cityRecord?.acceptedCityLabels ?? (f.city ? [f.city] : []);
    if (f.city && !isPlaceCompatibleWithSelectedCity(place, f.city, aliases)) {
      setError(`Please select a location within ${f.city}.`);
      return;
    }
    setError(null);
    setGooglePlace(place);
    setF((current) => ({
      ...current,
      area: place.area ?? place.formattedAddress ?? current.area,
    }));
  }

  // Default to the first active city once the list loads; keep the user's pick
  // if it is still active.
  useEffect(() => {
    if (!activeCities.length) return;
    setF((s) => (activeCities.includes(s.city) ? s : { ...s, city: activeCities[0] }));
  }, [activeCities]);

  async function onSubmit() {
    if (busy) return;

    setError(null);
    if (
      !f.name.trim() ||
      !f.phone.trim() ||
      !f.city ||
      !f.area.trim() ||
      !f.service_required
    ) {
      setError("Please add your name, WhatsApp number, area and the service you need.");
      return;
    }
    if (!isIndianLeadMobile(f.phone)) {
      setError("Please enter a valid 10-digit WhatsApp number.");
      return;
    }
    if (!shareConsent) {
      setError("Please agree to share your enquiry with up to 3 verified vendors.");
      return;
    }
    setBusy(true);
    try {
      console.info("[home enquiry form] submitting", {
        source: "Homepage",
        city: f.city,
        service_category: f.service_required,
        has_budget_range: Boolean(f.budget),
        has_requirement: Boolean(f.message),
      });
      const res = await submitLead({
        ...f,
        latitude: googlePlace?.lat ?? undefined,
        longitude: googlePlace?.lng ?? undefined,
        google_place_id: googlePlace?.placeId ?? undefined,
        google_city: googlePlace?.city ?? undefined,
        formatted_address: googlePlace?.formattedAddress ?? undefined,
        area_normalized:
          googlePlace?.areaNormalized ?? (f.area.trim() ? f.area.trim().toLowerCase() : undefined),
        sublocality: googlePlace?.sublocality ?? undefined,
        neighborhood: googlePlace?.neighborhood ?? undefined,
        location_source: googlePlace ? "google_place" : "manual",
        location_captured_at: googlePlace ? new Date().toISOString() : undefined,
        source: "Homepage",
        share_consent: shareConsent,
      });
      if (!res.ok) { setError(res.error); return; }
      console.info("[home enquiry form] submission confirmed", {
        lead_id: res.data.id,
        is_duplicate: res.data.is_duplicate,
      });
      trackEvent("lead_submit", { source: "homepage", service: f.service_required });
      setDone(true);
    } catch (err) {
      console.error("[home enquiry form] submission error", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
      setError("We could not submit your enquiry. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel p-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-gold/50 bg-gold/15 text-gold">✓</div>
        <h3 className="mt-5 text-2xl text-ivory">Thank you!</h3>
        <p className="mx-auto mt-3 max-w-md font-sans text-sm text-muted">
          Your enquiry is captured. We&apos;ll complete any missing project details on WhatsApp before matching you with suitable professionals.
        </p>
      </div>
    );
  }

  return (
    <div className="panel p-6 md:p-7">
      <h3 className="font-display text-xl text-ivory">Get free quotes</h3>
      <p className="mt-1 font-sans text-sm text-muted">One requirement → up to 3 verified pros. No charge, no spam.</p>

      {error && <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 font-sans text-sm text-red-200">{error}</p>}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <L label="Full name"><input className="field" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Your name" /></L>
        <L label="WhatsApp number"><input className="field" value={f.phone} onChange={(e) => set("phone", e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" maxLength={10} placeholder="10-digit WhatsApp number" /></L>
        {activeCities.length === 1 ? null : (
          <L label="City"><select className="field" value={f.city} onChange={(e) => setCity(e.target.value)} disabled={activeCities.length === 0}>{activeCities.length === 0 ? <option value="" className="bg-navy-deep">{citiesLoading ? "Loading cities…" : NO_ACTIVE_CITIES_MESSAGE}</option> : activeCities.map((c) => <option key={c} className="bg-navy-deep">{c}</option>)}</select></L>
        )}
        <L label="Area / locality">
          <GooglePlaceAutocomplete
            className="field"
            value={f.area}
            city={f.city}
            mode="address"
            suggestionsPortal
            onManualChange={setAreaManual}
            onPlaceSelected={setAreaFromGoogle}
            placeholder={f.city ? `Search area or location in ${f.city}` : "Search area or location"}
            autoComplete="off"
          />
        </L>
        {inferredService ? null : (
          <L label="Service required"><select className="field" value={f.service_required} onChange={(e) => set("service_required", e.target.value)}>{ENQUIRY_SERVICES.map((s) => <option key={s} className="bg-navy-deep">{s}</option>)}</select></L>
        )}
        <div className="sm:col-span-2 font-sans text-xs text-muted">
          We&apos;ll ask only the missing project details on WhatsApp after you submit.
        </div>
      </div>
      <label className="mt-5 flex items-start gap-3 font-sans text-xs leading-5 text-muted">
        <input
          type="checkbox"
          checked={shareConsent}
          onChange={(e) => setShareConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-gold"
        />
        <span>
          I agree that QuickFurno may share my enquiry and contact details with up to 3 verified vendors initially. If vendors are unavailable, non-responsive, or unable to serve my requirement, QuickFurno may manually connect me with additional verified vendors to fulfil my request.
        </span>
      </label>

      <button onClick={onSubmit} disabled={busy} className="btn-gold mt-5 w-full">
        {busy ? "Sending…" : "Get Free Quotes"}
      </button>
      <p className="mt-3 font-sans text-xs text-muted/70">Your number is shared only with matched professionals. Never sold.</p>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}
