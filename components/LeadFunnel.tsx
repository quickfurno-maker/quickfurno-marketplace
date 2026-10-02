"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { submitLead } from "@/app/actions";

// QF-UI-TRACKING-01: shared attribution authority — the same one the modal uses.
import { resolveLeadTracking } from "@/lib/analytics/leadTracking";
import { useActiveCities, NO_ACTIVE_CITIES_MESSAGE } from "@/lib/locations/useActiveCities";
import { useActiveCategories, NO_ACTIVE_CATEGORIES_MESSAGE } from "@/lib/categories/useActiveCategories";
import { isIndianLeadMobile } from "@/lib/leads/indianMobile";
import GooglePlaceAutocomplete from "@/components/location/GooglePlaceAutocomplete";
import { isPlaceCompatibleWithSelectedCity } from "@/lib/google-maps/normalizePlace";
import type { NormalizedGooglePlace } from "@/lib/google-maps/types";
import { useProjectLocation } from "@/components/location/ProjectLocationProvider";
import { projectLocationToGooglePlace } from "@/lib/locations/projectLocation";

/**
 * Standalone enquiry funnel for /enquiry.
 *
 * QF-UI-V2-09 restyled this onto the V2 public system. The SUBMISSION AUTHORITY
 * IS UNCHANGED: the same submitLead() call, the same field names, the same
 * `source: "Enquiry funnel"`, the same share_consent flag, the same UTM capture,
 * the same admin-managed active cities/categories, the same ?service= default
 * and the same validation rules. Only presentation and a few copy lines moved.
 */

type Step = "form" | "done";

/**
 * QF-UI-HOTFIX-01 — the SAME Indian mobile contract the canonical homepage
 * enquiry modal already enforces (components/ClientEnquiryModal.tsx).
 *
 * This surface previously accepted any characters, any length, and only
 * rejected fewer than 10 DIGITS after stripping non-digits — so
 * "1234567890", "00000000000" and a 15-digit string all passed here while the
 * homepage modal rejected them. UI-only correction: the field sanitizes to
 * digits, caps at 10, and the submit gate uses the exact same regexp. No
 * backend, schema or business rule is touched.
 */
// QF-MVP-50.8: the accepted shape is IMPORTED from the shared lead contract, not
// re-declared here. The server (`services/leadService.ts`) and the lead
// destination adapter test the same constant, so this form cannot drift into
// accepting a number the dispatcher could never reach.
//
// This funnel stays deliberately NATIONAL-ONLY: the field sanitizes to digits
// and caps at ten, which is the India-market input design from the mobile-form
// phase. The server additionally accepts an explicitly international number;
// being stricter here is a UI choice, and widening it is form redesign rather
// than validation, so it is out of scope for this phase.
function sanitizePhone(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}

function isPhoneValid(digits: string): boolean {
  return isIndianLeadMobile(digits);
}

export function LeadFunnel({ defaultService }: { defaultService?: string }) {
  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    location: globalProjectLocation,
    setGoogleLocation: setGlobalProjectLocation,
    clearLocation: clearGlobalProjectLocation,
  } = useProjectLocation();

  // Phase 14B/14C: cities + services come only from admin-managed active
  // cities and active categories.
  const { cities: activeCities, records: activeCityRecords, loading: citiesLoading } = useActiveCities();
  const { categories: activeCategories, loading: categoriesLoading } = useActiveCategories();
  const inferredService =
    defaultService && activeCategories.includes(defaultService)
      ? defaultService
      : null;

  const [form, setForm] = useState({
    name: "", phone: "", city: "",
    service_required: "",
    area: "", budget: "", property_type: "", timeline: "", message: "",
  });
  const [consent, setConsent] = useState(false);
  const [googlePlace, setGooglePlace] = useState<NormalizedGooglePlace | null>(null);

  // Prefer the globally selected Google project location. If none exists,
  // fall back to the first active city for the legacy/manual path.
  useEffect(() => {
    if (!activeCities.length) return;

    if (
      globalProjectLocation &&
      activeCities.some(
        (city) => city.toLowerCase() === globalProjectLocation.city.toLowerCase(),
      )
    ) {
      setGooglePlace(projectLocationToGooglePlace(globalProjectLocation));
      setForm((current) => ({
        ...current,
        city: globalProjectLocation.city,
        area: globalProjectLocation.label,
      }));
      return;
    }

    if (!globalProjectLocation) {
      setForm((current) =>
        activeCities.includes(current.city)
          ? current
          : { ...current, city: activeCities[0] },
      );
    }
  }, [activeCities, globalProjectLocation]);

  // Default to defaultService (if active) or the first active category.
  useEffect(() => {
    if (!activeCategories.length) return;
    setForm((f) => {
      if (activeCategories.includes(f.service_required)) return f;
      const preferred = defaultService && activeCategories.includes(defaultService) ? defaultService : activeCategories[0];
      return { ...f, service_required: preferred };
    });
  }, [activeCategories, defaultService]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function setCity(value: string) {
    setGooglePlace(null);
    if (globalProjectLocation) clearGlobalProjectLocation({ refresh: false });
    setForm((current) => ({ ...current, city: value, area: "" }));
  }

  function setAreaManual(value: string) {
    setGooglePlace(null);
    if (globalProjectLocation) clearGlobalProjectLocation({ refresh: false });
    setForm((current) => ({ ...current, area: value }));
  }

  function setAreaFromGoogle(place: NormalizedGooglePlace) {
    const cityRecord = activeCityRecords.find(
      (record) => record.name.toLowerCase() === form.city.toLowerCase(),
    );
    const aliases = cityRecord?.acceptedCityLabels ?? (form.city ? [form.city] : []);
    if (form.city && !isPlaceCompatibleWithSelectedCity(place, form.city, aliases)) {
      setError(`Please select a location within ${form.city}.`);
      return;
    }
    setError(null);
    setGooglePlace(place);
    setForm((current) => ({
      ...current,
      area: place.area ?? place.formattedAddress ?? current.area,
    }));
    if (
      cityRecord &&
      place.placeId &&
      place.lat != null &&
      place.lng != null
    ) {
      setGlobalProjectLocation(place, cityRecord, { refresh: false });
    }
  }

  // QF-UI-TRACKING-01: the duplicate submit-time URL parser that used to live
  // here is gone. /enquiry now shares the one attribution authority with the
  // modal, so a visitor who lands tagged and reaches this page untagged keeps
  // their campaign.

  async function onSubmitForm() {
    if (busy) return;

    setError(null);
    if (
      !form.name.trim() ||
      !form.phone.trim() ||
      !form.city ||
      !form.area.trim() ||
      !form.service_required
    ) {
      setError("Please add your name, WhatsApp number, area and the service you need.");
      return;
    }
    if (!isPhoneValid(form.phone)) {
      setError("Enter a valid 10-digit WhatsApp number starting with 6, 7, 8 or 9.");
      return;
    }
    if (!consent) {
      setError("Please accept sharing your details with up to 3 eligible vendors to continue.");
      return;
    }
    setBusy(true);
    try {
      console.info("[lead funnel] submitting", {
        source: "Enquiry funnel",
        city: form.city,
        service_category: form.service_required,
        has_budget_range: Boolean(form.budget),
        has_requirement: Boolean(form.message),
      });
      const res = await submitLead({
        ...form,
        latitude: googlePlace?.lat ?? undefined,
        longitude: googlePlace?.lng ?? undefined,
        google_place_id: googlePlace?.placeId ?? undefined,
        google_city: googlePlace?.city ?? undefined,
        formatted_address: googlePlace?.formattedAddress ?? undefined,
        area_normalized:
          googlePlace?.areaNormalized ?? (form.area.trim() ? form.area.trim().toLowerCase() : undefined),
        sublocality: googlePlace?.sublocality ?? undefined,
        neighborhood: googlePlace?.neighborhood ?? undefined,
        location_source: googlePlace ? "google_place" : "manual",
        location_captured_at: googlePlace ? new Date().toISOString() : undefined,
        source: "Enquiry funnel",
        share_consent: consent,
        // QF-UI-TRACKING-01: current URL first, stored tagged campaign second.
        ...resolveLeadTracking(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      console.info("[lead funnel] submission confirmed", {
        lead_id: res.data.id,
        is_duplicate: res.data.is_duplicate,
      });
      setStep("done");
    } catch (err) {
      console.error("[lead funnel] submission error", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
      setError("We could not submit your enquiry. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <div className="qf-enqpage-success" role="status">
        <span className="qf-enqpage-success-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" focusable="false">
            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h2>Your enquiry is submitted</h2>
        <p>
          We&apos;ve captured your enquiry. If any project details are missing, we&apos;ll complete
          them with you on WhatsApp before matching you with suitable professionals.
        </p>
        <Link href="/" className="qf-pub-btn qf-pub-btn--secondary">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="qf-enqpage-panel">
      <Steps step={step} />

      {error ? (
        <p className="qf-enqpage-alert" role="alert">
          {error}
        </p>
      ) : null}

      <div className="qf-enqpage-grid">
        <Field label="Your name">
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Asha Kulkarni" autoComplete="name" />
        </Field>
        <Field label="WhatsApp number">
          <input
            value={form.phone}
            onChange={(e) => set("phone", sanitizePhone(e.target.value))}
            placeholder="10-digit mobile number"
            inputMode="numeric"
            maxLength={10}
            autoComplete="tel"
          />
        </Field>
        {activeCities.length === 1 ? null : (
          <Field label="City">
            <select value={form.city} onChange={(e) => setCity(e.target.value)} disabled={activeCities.length === 0}>
              {activeCities.length === 0
                ? <option value="">{citiesLoading ? "Loading cities…" : NO_ACTIVE_CITIES_MESSAGE}</option>
                : activeCities.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        )}
        <Field label="Area / locality">
          <GooglePlaceAutocomplete
            value={form.area}
            city={form.city}
            mode="address"
            suggestionsPortal
            onManualChange={setAreaManual}
            onPlaceSelected={setAreaFromGoogle}
            placeholder={form.city ? `Search area or location in ${form.city}` : "Search area or location"}
            autoComplete="off"
          />
        </Field>
        {inferredService ? null : (
          <Field label="Service needed">
            <select value={form.service_required} onChange={(e) => set("service_required", e.target.value)} disabled={activeCategories.length === 0}>
              {activeCategories.length === 0
                ? <option value="">{categoriesLoading ? "Loading services…" : NO_ACTIVE_CATEGORIES_MESSAGE}</option>
                : activeCategories.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
        )}
        <div className="qf-enqpage-field qf-enqpage-field--wide">
          <span>Quick qualification happens after submission</span>
          <p>
            We&apos;ll ask only the missing project details on WhatsApp so you
            don&apos;t have to complete a long form.
          </p>
        </div>
      </div>

      <label className="qf-enqpage-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          I agree that QuickFurno may share my enquiry and contact details with up to 3 eligible vendors initially. If vendors are unavailable, non-responsive, or unable to serve my requirement, QuickFurno may manually connect me with additional eligible vendors to fulfil my request. See our{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>{" "}
          and{" "}
          <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>.
        </span>
      </label>

      <button
        onClick={onSubmitForm}
        disabled={busy}
        className="qf-pub-btn qf-pub-btn--primary qf-enqpage-submit"
      >
        {busy ? "Submitting…" : "Get matched with vendors"}
      </button>
      <p className="qf-enqpage-fineprint">
        Your number is shared only with the vendors you are matched to. We never sell your details.
      </p>
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const items: [Step, string][] = [["form", "Your project"], ["done", "Submitted"]];
  const idx = items.findIndex(([s]) => s === step);
  return (
    <div className="qf-enqpage-steps">
      {items.map(([s, label], i) => (
        <div key={s} className="qf-enqpage-steps" style={{ margin: 0 }}>
          <span
            className="qf-enqpage-step"
            data-state={i < idx ? "done" : i === idx ? "current" : "upcoming"}
          >
            <span className="qf-enqpage-step-dot">{i < idx ? "✓" : i + 1}</span>
            {label}
          </span>
          {i < items.length - 1 ? <span className="qf-enqpage-step-rule" aria-hidden="true" /> : null}
        </div>
      ))}
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`qf-enqpage-field${wide ? " qf-enqpage-field--wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
