"use client";

import { useEffect, useRef, useState } from "react";
import { submitVendorAccountRegistration } from "@/app/actions";
import { trackEvent, whatsappLink } from "@/lib/config";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { mainCategories, type MainCategory } from "@/lib/categories";
import { type QuickFurnoCategory } from "@/lib/quickfurno-data";
import { useActiveCities, NO_ACTIVE_CITIES_MESSAGE } from "@/lib/locations/useActiveCities";
// Phase 1: reuse the SAME Google autocomplete the client form uses (no second
// system) for the vendor's Google business base area / locality.
import GooglePlaceAutocomplete from "@/components/location/GooglePlaceAutocomplete";
import { isPlaceCompatibleWithSelectedCity } from "@/lib/google-maps/normalizePlace";
import type { NormalizedGooglePlace } from "@/lib/google-maps/types";

// ---------------------------------------------------------------------------
// Guided vendor onboarding wizard.
// One focused screen per step, mirroring the premium "requirement first" client
// flow. Creates a vendor LOGIN account (email + password) AND the vendor profile
// in one submit via submitVendorAccountRegistration — the profile still lands as
// Pending / Unpaid / not publicly visible until the team verifies and credits it.
//
// Step 2 categories come from the SHARED source of truth (lib/categories.ts) so
// they always match the homepage. The selected leaf category (a public category
// name, e.g. "Modular Factory") is stored directly in service_categories so Admin
// and public category pages show the correct category.
// ---------------------------------------------------------------------------

// Phase 1: static per-city service-area chips (CITY_SERVICE_AREAS) were removed.
// Vendors now set a single Google business base area/locality (with manual
// fallback), which produces canonical base coordinates for future matching.
// Phase 14B: active cities come from the admin-managed cities table (via the
// shared useActiveCities hook), so the vendor form never drifts from the
// homepage / client enquiry modal. No custom-city entry allowed.

const EXPERIENCE_OPTIONS = ["Less than 1 year", "1–3 years", "3–5 years", "5–10 years", "10+ years"];
const TEAM_OPTIONS = ["1–5", "6–10", "11–25", "25+"];
const CAPACITY_OPTIONS = ["1–5 projects", "5–10 projects", "10–20 projects", "20+ projects"];
// Category-based minimum starting ₹/sqft rate. Interior leaves require a per-sqft
// rate (auto-filled to this minimum); other categories use "Varies by project".
const CATEGORY_MIN_RATE: Partial<Record<QuickFurnoCategory, number>> = {
  "Interior Designers": 1000,
  Carpenters: 200,
  "Modular Factory": 1000,
  "Premium Interiors": 1200,
};

const BUSINESS_TYPE_OPTIONS = ["Showroom", "Factory", "Studio", "Workshop", "Home-based / On-site"];

const STEP_NAMES = [
  "Business Identity",
  "Service Category",
  "City & Base Area",
  "Location",
  "Business Strength",
  "Review",
];
const LAST_STEP = 5;

type LocStatus = "idle" | "requesting" | "granted" | "denied" | "unavailable";

type WizardState = {
  businessName: string;
  ownerName: string;
  phone: string;
  whatsappSame: boolean;
  whatsapp: string;
  email: string;
  password: string;
  confirmPassword: string;
  categoryId: string;
  subCategory: string;
  city: string;
  addressLine1: string;
  addressLine2: string;
  landmark: string;
  stateName: string;
  // Google business base area / locality (Phase 1). Manual fallback preserved.
  baseArea: string;
  baseAreaNormalized: string;
  googlePlaceId: string;
  formattedAddress: string;
  sublocality: string;
  neighborhood: string;
  baseLatitude: number | null;
  baseLongitude: number | null;
  yearsExperience: string;
  teamSize: string;
  monthlyCapacity: string;
  rateValue: string;
  businessType: string;
  coversFullCity: boolean;
};

// QF-MVP-80.16C. The same Indian-mobile contract the server now enforces in
// services/vendorService.ts and that the notification lane's destination
// adapter expects. Ten digits was never the rule: a number starting 0-5 is
// not a mobile and can never receive the WhatsApp lead alert the vendor is
// charged for. The server stays authoritative; this only stops the mistake
// being made at all.
const VENDOR_MOBILE_RE = /^[6-9]\d{9}$/;

const initialState: WizardState = {
  businessName: "",
  ownerName: "",
  phone: "",
  whatsappSame: true,
  whatsapp: "",
  email: "",
  password: "",
  confirmPassword: "",
  categoryId: "",
  subCategory: "",
  city: "",
  addressLine1: "",
  addressLine2: "",
  landmark: "",
  stateName: "Maharashtra",
  baseArea: "",
  baseAreaNormalized: "",
  googlePlaceId: "",
  formattedAddress: "",
  sublocality: "",
  neighborhood: "",
  baseLatitude: null,
  baseLongitude: null,
  yearsExperience: "",
  teamSize: "",
  monthlyCapacity: "",
  rateValue: "",
  businessType: "",
  coversFullCity: false,
};

/** Lightweight email sanity check (real validation happens at account creation). */
function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Read UTM params + the current page URL for vendor-source tracking. */
function readTracking() {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const pick = (key: string) => params.get(key)?.trim() || undefined;
  return {
    source_url: window.location.href,
    utm_source: pick("utm_source"),
    utm_medium: pick("utm_medium"),
    utm_campaign: pick("utm_campaign"),
  };
}

export function VendorRegisterForm() {
  const [step, setStep] = useState(0);
  const [f, setF] = useState<WizardState>(initialState);
  // Phase 14B: city chips come only from admin-managed active cities.
  const { cities: activeCities, loading: citiesLoading } = useActiveCities();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Show per-field validation warnings only after the user tries to advance.
  const [showErrors, setShowErrors] = useState(false);
  // Track individual fields touched by the user.
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const isFieldValid = (field: string): boolean => {
    const valOf = (key: keyof WizardState) => {
      const v = f[key];
      return typeof v === "string" ? v : "";
    };

    switch (field) {
      case "businessName":
        return valOf("businessName").trim().length >= 2;
      case "ownerName":
        return valOf("ownerName").trim().length >= 2;
      case "phone":
        return VENDOR_MOBILE_RE.test(valOf("phone"));
      case "email":
        return isEmail(valOf("email"));
      case "password":
        return valOf("password").length >= 6;
      case "confirmPassword":
        return valOf("confirmPassword").length >= 6 && valOf("confirmPassword") === valOf("password");
      case "addressLine1":
        return valOf("addressLine1").trim().length >= 5;
      case "state":
        return valOf("stateName").trim().length > 0;
      default:
        return true;
    }
  };

  function renderInputField({
    label,
    fieldKey,
    type = "text",
    placeholder,
    autoComplete,
    inputMode,
    maxLength,
    customOnChange,
    ref,
  }: {
    label: string;
    fieldKey: string;
    type?: string;
    placeholder?: string;
    autoComplete?: string;
    inputMode?: "search" | "text" | "none" | "tel" | "url" | "email" | "numeric" | "decimal";
    maxLength?: number;
    customOnChange?: (val: string) => void;
    ref?: React.RefObject<HTMLInputElement>;
  }) {
    const val = fieldKey === "state" ? f.stateName : f[fieldKey as keyof WizardState];
    const valStr = typeof val === "string" ? val : "";
    const isTouched = touched[fieldKey] || showErrors;
    const errMsg = fieldError(fieldKey);

    let isValid = false;
    let isInvalid = false;

    if (fieldKey === "addressLine2" || fieldKey === "landmark") {
      isValid = valStr.trim().length > 0;
    } else {
      const fieldValid = isFieldValid(fieldKey);
      isValid = fieldValid;
      isInvalid = isTouched && !fieldValid;
    }

    const wrapperClass = `qf-rf-field${isInvalid ? " has-error" : ""}${isValid ? " is-valid" : ""}`;

    return (
      <label className={wrapperClass} ref={bindField(fieldKey)}>
        <span>{label}</span>
        <div className="qf-rf-input-wrapper">
          <input
            ref={ref}
            type={type}
            value={valStr}
            onChange={(e) => {
              const value = e.target.value;
              if (customOnChange) {
                customOnChange(value);
              } else {
                set(fieldKey as keyof WizardState, value);
              }
              setTouched((prev) => ({ ...prev, [fieldKey]: true }));
            }}
            onBlur={() => setTouched((prev) => ({ ...prev, [fieldKey]: true }))}
            placeholder={placeholder}
            autoComplete={autoComplete}
            inputMode={inputMode}
            maxLength={maxLength}
          />
          {isValid ? (
            <span className="qf-rf-input-icon qf-rf-input-icon--valid">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#19a55a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </span>
          ) : isInvalid ? (
            <span className="qf-rf-input-icon qf-rf-input-icon--invalid">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b4231a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </span>
          ) : null}
        </div>
        {isInvalid && errMsg ? <span className="qf-rf-field-err">{errMsg}</span> : null}
      </label>
    );
  }

  // Field wrappers registered for scroll-to-first-error on a failed Continue.
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  // Location capture
  const [loc, setLoc] = useState<{
    status: LocStatus;
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    capturedAt: string | null;
  }>({ status: "idle", latitude: null, longitude: null, accuracy: null, capturedAt: null });

  const bodyRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setF((current) => ({ ...current, [key]: value }));
  }

  const selectedMain = mainCategories.find((c) => c.id === f.categoryId) ?? null;

  // Reset scroll on step change; focus the first input on the identity step.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    if (step === 0) {
      const t = window.setTimeout(() => firstFieldRef.current?.focus(), 120);
      return () => window.clearTimeout(t);
    }
  }, [step]);

  useEffect(() => {
    trackEvent("vendor_onboarding_started");
  }, []);

  function selectCategory(category: MainCategory) {
    setF((current) =>
      current.categoryId === category.id
        ? current
        : { ...current, categoryId: category.id, subCategory: "" },
    );
  }

  function selectSubcategory(label: string) {
    setF((current) => ({
      ...current,
      subCategory: current.subCategory === label ? "" : label,
    }));
  }

  // ── Phase 1: Google business base area / locality (manual fallback preserved) ──
  // Manual typing keeps a free-text base area and clears any stale Google identity
  // + canonical coordinates so the saved text never disagrees with a picked place.
  function onBaseAreaManual(value: string) {
    setError("");
    setF((current) => ({
      ...current,
      baseArea: value,
      baseAreaNormalized: value.trim().toLowerCase(),
      googlePlaceId: "",
      formattedAddress: "",
      sublocality: "",
      neighborhood: "",
      baseLatitude: null,
      baseLongitude: null,
    }));
    setTouched((prev) => ({ ...prev, baseArea: true }));
  }

  // A Google place was picked. City-consistency guard: never overwrite anything
  // if the place clearly belongs to a different city than the one selected.
  function onBaseAreaPlace(place: NormalizedGooglePlace) {
    if (f.city && !isPlaceCompatibleWithSelectedCity(place, f.city)) {
      setError(`Please select a base area within ${f.city}.`);
      return;
    }
    setError("");
    setF((current) => ({
      ...current,
      baseArea: place.area ?? current.baseArea,
      baseAreaNormalized: place.areaNormalized ?? (place.area ? place.area.toLowerCase() : ""),
      googlePlaceId: place.placeId ?? "",
      formattedAddress: place.formattedAddress ?? "",
      sublocality: place.sublocality ?? "",
      neighborhood: place.neighborhood ?? "",
      // Canonical vendor base coordinates come from THIS place only. If the newly
      // picked place has no coordinates we store null — never retain the previous
      // place's coords, so base identity + area + coordinates stay consistent.
      baseLatitude: place.lat,
      baseLongitude: place.lng,
    }));
    setTouched((prev) => ({ ...prev, baseArea: true }));
  }

  function requestLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLoc((s) => ({ ...s, status: "unavailable" }));
      return;
    }
    setLoc((s) => ({ ...s, status: "requesting" }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({
          status: "granted",
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: new Date().toISOString(),
        });
      },
      (err) => {
        setLoc((s) => ({
          ...s,
          status: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable",
        }));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  type FieldError = { key: string; message: string };

  // Required-field check per step. Returns a human-readable reason per missing
  // field so we can surface them both inline and in the top warning box.
  function stepErrors(target: number): FieldError[] {
    const e: FieldError[] = [];
    switch (target) {
      case 0:
        if (f.businessName.trim().length < 2) e.push({ key: "businessName", message: "Business name must be at least 2 characters." });
        if (f.ownerName.trim().length < 2) e.push({ key: "ownerName", message: "Owner name must be at least 2 characters." });
        if (!VENDOR_MOBILE_RE.test(f.phone.replace(/\D/g, ""))) e.push({ key: "phone", message: "Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9." });
        if (!f.whatsappSame && !VENDOR_MOBILE_RE.test(f.whatsapp.replace(/\D/g, ""))) e.push({ key: "whatsapp", message: "Enter a valid 10-digit WhatsApp number starting with 6, 7, 8 or 9." });
        if (!isEmail(f.email)) e.push({ key: "email", message: "Enter a valid business email." });
        if (f.password.length < 6) e.push({ key: "password", message: "Password must be at least 6 characters." });
        if (f.confirmPassword !== f.password) e.push({ key: "confirmPassword", message: "Passwords do not match." });
        break;
      case 1:
        if (!selectedMain) e.push({ key: "category", message: "Select your service category" });
        else if (selectedMain.subcategories.length > 0 && !f.subCategory)
          e.push({ key: "subCategory", message: "Select your specialisation" });
        break;
      case 2: {
        const cityStr = String(f.city ?? "").trim();
        const baseAreaStr = String(f.baseArea ?? "").trim();
        const address1Str = String(f.addressLine1 ?? "").trim();
        const stateStr = String(f.stateName ?? "").trim();

        if (!cityStr) {
          e.push({ key: "city", message: "Select your city." });
        }
        if (baseAreaStr.length < 2) {
          e.push({ key: "baseArea", message: "Enter your business base area / locality." });
        }
        if (address1Str.length < 5) {
          e.push({ key: "addressLine1", message: "Enter your office or business address." });
        }
        if (!stateStr) {
          e.push({ key: "state", message: "Enter your state." });
        }
        break;
      }
      case 4:
        // Interior categories require a valid per-sqft rate at/above the minimum.
        if (usesSqftRate && !rateValid)
          e.push({ key: "rate", message: `Minimum starting rate for this category is ₹${minRate}/sqft.` });
        break;
    }
    return e;
  }

  // Errors currently visible (only after a failed Continue on this step).
  const currentErrors = showErrors ? stepErrors(step) : [];
  const errorKeys = new Set(currentErrors.map((er) => er.key));
  const fieldError = (key: string) => currentErrors.find((er) => er.key === key)?.message ?? "";
  const bindField = (key: string) => (el: HTMLElement | null) => {
    fieldRefs.current[key] = el;
  };
  function scrollToError(key: string) {
    const el = fieldRefs.current[key];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusable = el.querySelector("input, textarea, button") as HTMLElement | null;
    window.setTimeout(() => focusable?.focus({ preventScroll: true }), 80);
  }

  function goNext() {
    if (step >= LAST_STEP) return;
    
    // Mark all fields on the current step as touched
    setTouched((prev) => {
      const next = { ...prev };
      if (step === 0) {
        next.businessName = true;
        next.ownerName = true;
        next.phone = true;
        next.email = true;
        next.password = true;
        next.confirmPassword = true;
      } else if (step === 2) {
        next.city = true;
        next.baseArea = true;
        next.addressLine1 = true;
        next.addressLine2 = true;
        next.landmark = true;
        next.state = true;
      } else if (step === 4) {
        next.rate = true;
      }
      return next;
    });

    const errs = stepErrors(step);
    if (errs.length > 0) {
      setShowErrors(true);
      setError("");
      scrollToError(errs[0].key);
      return;
    }
    setShowErrors(false);
    setError("");
    trackEvent("vendor_onboarding_step", { step: step + 1, name: STEP_NAMES[step] });
    setStep((s) => Math.min(s + 1, LAST_STEP));
  }

  function goBack() {
    setShowErrors(false);
    setError("");
    setStep((s) => Math.max(s - 1, 0));
  }

  const cityValue = String(f.city ?? "").trim();
  const baseAreaValue = String(f.baseArea ?? "").trim();
  const hasCitySelected = Boolean(f.city);
  // Phase 1: areas_covered is derived from the single Google business base area
  // (keeps the existing exact-area match path alive without touching the RPC).
  // covers_full_city continues to widen coverage city-wide.
  const derivedAreasCovered = baseAreaValue ? [baseAreaValue] : [];

  // Resolve the final marketplace category (leaf or chosen subcategory), then map
  // it to the canonical service tag used by lead↔vendor matching.
  const selectedSubItem = selectedMain?.subcategories.find((s) => s.label === f.subCategory) ?? null;
  const finalCategory =
    selectedMain && selectedMain.subcategories.length > 0
      ? selectedSubItem?.category ?? null
      : selectedMain?.category ?? null;
  // Store the selected PUBLIC category name (e.g. "Modular Factory") in
  // service_categories — not the enquiry service tag ("Modular Kitchen"), which
  // is not a public category and made Admin/listings show the wrong label.
  const matchingServices = finalCategory ? [finalCategory] : [];
  const finalCategoryLabel = selectedSubItem?.label ?? selectedMain?.category ?? selectedMain?.label ?? "";

  // Per-sqft rate only applies to interior categories that have a minimum.
  const minRate = finalCategory ? CATEGORY_MIN_RATE[finalCategory] ?? null : null;
  const usesSqftRate = minRate != null;
  const rateNum = Number(f.rateValue || 0);
  const rateBelowMin = usesSqftRate && f.rateValue !== "" && rateNum < (minRate ?? 0);
  const rateValid = !usesSqftRate || (f.rateValue !== "" && rateNum > 0 && rateNum >= (minRate ?? 0));

  // Final value saved to starting_price: formatted ₹/sqft, or "Varies by project".
  const formattedRate = usesSqftRate
    ? rateNum > 0
      ? `₹${rateNum.toLocaleString("en-IN")}/sqft`
      : ""
    : finalCategory
      ? "Varies by project"
      : "";

  // Auto-fill the minimum rate when the chosen category/subcategory changes
  // (interior categories only). Manual edits persist — this only fires on change.
  useEffect(() => {
    if (!finalCategory) return;
    const min = CATEGORY_MIN_RATE[finalCategory] ?? null;
    setF((current) => ({ ...current, rateValue: min != null ? String(min) : "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalCategory]);

  // Per spec: only granted / denied / not_requested. Any error (incl. unavailable)
  // counts as denied; idle (button never clicked) is not_requested.
  const locationPermissionStatus =
    loc.status === "granted"
      ? "granted"
      : loc.status === "denied" || loc.status === "unavailable"
        ? "denied"
        : "not_requested";

  async function onSubmit() {
    if (busy) return;
    setError("");

    // Re-validate every step. If an earlier step is incomplete, send the vendor
    // back to it with the exact reason rather than failing silently at submit.
    for (const s of [0, 1, 2, 4]) {
      if (stepErrors(s).length > 0) {
        setStep(s);
        setShowErrors(true);
        setError(`Some required details are missing. Please review Step ${s + 1}.`);
        return;
      }
    }

    // Final review validation before submit
    const businessNameStr = String(f.businessName ?? "").trim();
    const ownerNameStr = String(f.ownerName ?? "").trim();
    const phoneDigits = String(f.phone ?? "").replace(/\D/g, "");
    const whatsappDigits = f.whatsappSame
      ? phoneDigits
      : String(f.whatsapp ?? "").replace(/\D/g, "");
    const emailStr = String(f.email ?? "").trim();
    const address1Str = String(f.addressLine1 ?? "").trim();
    const stateStr = String(f.stateName ?? "").trim();

    const isAllValid =
      businessNameStr.length >= 2 &&
      ownerNameStr.length >= 2 &&
      VENDOR_MOBILE_RE.test(phoneDigits) &&
      VENDOR_MOBILE_RE.test(whatsappDigits) &&
      isEmail(emailStr) &&
      f.password.length >= 6 &&
      f.confirmPassword === f.password &&
      selectedMain &&
      (selectedMain.subcategories.length === 0 || f.subCategory) &&
      cityValue &&
      baseAreaValue.length >= 2 &&
      address1Str.length >= 5 &&
      stateStr.length > 0 &&
      (!usesSqftRate || rateValid);

    if (!isAllValid) {
      setError("Some required details are missing. Please go back and complete the highlighted fields.");
      return;
    }

    setBusy(true);
    try {
      const res = await submitVendorAccountRegistration({
        // Creates the Supabase auth login (email + password) AND the vendor
        // profile in one call. The profile still lands Pending / Unpaid / not
        // publicly visible (enforced by registerVendor) until admin approval.
        password: f.password,
        business_name: businessNameStr,
        owner_name: ownerNameStr || undefined,
        phone: phoneDigits,
        whatsapp_number: whatsappDigits || undefined,
        email: emailStr,
        city: cityValue,
        // Detailed office / business address (Step 3) — kept for profile/contact
        // only; it does NOT drive matching. office_city mirrors the service city.
        // Pincode removed (Phase 1). office_lat/long are now the CANONICAL vendor
        // base coordinates, sourced from the Google business base area place.
        office_address_line1: address1Str || undefined,
        office_address_line2: String(f.addressLine2 ?? "").trim() || undefined,
        office_landmark: String(f.landmark ?? "").trim() || undefined,
        office_city: cityValue || undefined,
        office_state: stateStr || undefined,
        office_latitude: f.baseLatitude,
        office_longitude: f.baseLongitude,
        // Phase 1: derived from the single Google base area (keeps existing
        // area-match path). covers_full_city still widens coverage city-wide.
        areas_covered: derivedAreasCovered,
        covers_full_city: f.coversFullCity,
        // service_radius_km intentionally not sent (no hardcoded 20; DB default applies).
        service_categories: matchingServices,
        experience: f.yearsExperience || undefined,
        // Google business base area — structured identity + normalized fields.
        google_place_id: f.googlePlaceId || undefined,
        formatted_address: f.formattedAddress || undefined,
        area_normalized: f.baseAreaNormalized || undefined,
        sublocality: f.sublocality || undefined,
        neighborhood: f.neighborhood || undefined,
        // Legacy fallback coordinates from optional browser GPS (Step 4).
        location_permission_status: locationPermissionStatus,
        latitude: loc.status === "granted" ? loc.latitude : null,
        longitude: loc.status === "granted" ? loc.longitude : null,
        // Step 5 — business strength.
        business_type: f.businessType || undefined,
        team_size: f.teamSize || undefined,
        monthly_capacity: f.monthlyCapacity || undefined,
        starting_price: formattedRate || undefined,
        ...readTracking(),
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }

      trackEvent("vendor_onboarding_submitted", {
        category: finalCategoryLabel || selectedMain?.label,
        city: cityValue,
      });
      setDone(true);
    } catch (err) {
      console.error("[vendor onboarding] submission error", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
      setError("Unable to submit right now. Please check your internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="qf-vrf qf-vrf--done">
        <div className="qf-rf-success">
          <span className="qf-rf-success-mark" aria-hidden="true">✓</span>
          <h2>Vendor account created</h2>
          <p>
            Your vendor account and application have been submitted. QuickFurno will review your
            profile. Once approved and credited, leads will appear in your dashboard. You can log
            in from this page.
          </p>
          <a className="qf-rf-btn qf-rf-btn--primary qf-rf-btn--full" href="/vendor?mode=login">
            Go to vendor login
          </a>
          <a
            className="qf-rf-btn qf-rf-btn--ghost qf-rf-btn--full"
            href={whatsappLink("Hi QuickFurno team, I just created my vendor account and submitted my application. I'd like to know the next steps.")}
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginTop: "0.6rem" }}
          >
            Chat with QuickFurno Team
          </a>
        </div>
      </div>
    );
  }

  const percent = Math.round(((step + 1) / STEP_NAMES.length) * 100);

  return (
    <div className="qf-vrf">
      <header className="qf-vrf-head">
        <div className="qf-vrf-head-row">
          <span className="qf-vrf-stepcount">Step {step + 1} of {STEP_NAMES.length}</span>
          <span className="qf-vrf-stepname">{STEP_NAMES[step]}</span>
        </div>
        <div className="qf-vrf-dots" aria-hidden="true">
          {STEP_NAMES.map((name, i) => (
            <span
              key={name}
              className={`qf-vrf-dot${i === step ? " is-active" : ""}${i < step ? " is-done" : ""}`}
            >
              {i < step ? "✓" : i + 1}
            </span>
          ))}
        </div>
        <div
          className="qf-rf-progress"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Application progress"
        >
          <span className="qf-rf-progress-fill" style={{ width: `${percent}%` }} />
        </div>
      </header>

      <div className="qf-vrf-body" ref={bodyRef}>
        {error ? (
          <p className="qf-rf-alert" role="alert">{error}</p>
        ) : null}

        {currentErrors.length > 0 ? (
          <div className="qf-rf-warnbox" role="alert">
            <strong>Please complete the following before continuing:</strong>
            <ul>
              {currentErrors.map((er) => (
                <li key={er.key}>{er.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="qf-rf-step" key={step}>
          {renderStep()}
        </div>
      </div>

      <footer className="qf-vrf-footer">
        {step > 0 ? (
          <button type="button" className="qf-rf-btn qf-rf-btn--ghost" onClick={goBack}>
            Back
          </button>
        ) : (
          <span className="qf-rf-footer-spacer" />
        )}
        {step < LAST_STEP ? (
          <button
            type="button"
            className="qf-rf-btn qf-rf-btn--primary"
            onClick={goNext}
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            className="qf-rf-btn qf-rf-btn--primary"
            disabled={busy}
            onClick={onSubmit}
          >
            {busy ? "Submitting…" : "Submit Application"}
          </button>
        )}
      </footer>
    </div>
  );

  function renderStep() {
    switch (step) {
      case 0:
        return (
          /* QF-UI-V2-17R: these step titles are h2, not h3. This form renders
             INLINE under the page h1 on /vendor?mode=signup, so an h3 here
             skipped a level. The identical qf-rf-question markup inside the
             client enquiry MODAL keeps its h3#qf-rf-title, because there it is
             the dialog's accessible name and a dialog starts its own context. */
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">Step 1 of 6</span>
            <h2>Tell us about your business</h2>
            <p className="qf-rf-qhint">These details help us create your vendor profile and dashboard access.</p>
            <div className="qf-rf-fields">
              {renderInputField({
                label: "Business name",
                fieldKey: "businessName",
                // QF-UI-V2-11: the example here named a fictional business.
                // A generic placeholder is used instead, so no invented brand
                // appears anywhere in the product.
                placeholder: "Your business name",
                autoComplete: "organization",
                ref: firstFieldRef,
              })}
              {renderInputField({
                label: "Owner name",
                fieldKey: "ownerName",
                placeholder: "Your full name",
                autoComplete: "name",
              })}
              {renderInputField({
                label: "WhatsApp number",
                fieldKey: "phone",
                placeholder: "10-digit mobile number",
                inputMode: "numeric",
                autoComplete: "tel",
                maxLength: 10,
                customOnChange: (val) => set("phone", val.replace(/\D/g, "").slice(0, 10)),
              })}
              <label className="qf-rf-check">
                <input
                  type="checkbox"
                  checked={f.whatsappSame}
                  onChange={(e) => set("whatsappSame", e.target.checked)}
                />
                <span>This is also my business contact number</span>
              </label>
              {!f.whatsappSame ? (
                <label className="qf-rf-field">
                  <span>Business contact number</span>
                  <div className="qf-rf-input-wrapper">
                    <input
                      value={f.whatsapp}
                      onChange={(e) => set("whatsapp", e.target.value.replace(/\D/g, "").slice(0, 10))}
                      placeholder="10-digit mobile number"
                      inputMode="numeric"
                      maxLength={10}
                    />
                  </div>
                </label>
              ) : null}
              {renderInputField({
                label: "Business email for dashboard login",
                fieldKey: "email",
                type: "email",
                placeholder: "you@example.com",
                inputMode: "email",
                autoComplete: "email",
              })}
              {renderInputField({
                label: "Create password",
                fieldKey: "password",
                type: "password",
                placeholder: "At least 6 characters",
                autoComplete: "new-password",
              })}
              {renderInputField({
                label: "Confirm password",
                fieldKey: "confirmPassword",
                type: "password",
                placeholder: "Re-enter password",
                autoComplete: "new-password",
              })}
            </div>
          </div>
        );
      case 1:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">Step 2 of 6</span>
            <h2>What do you specialise in?</h2>
            <p className="qf-rf-qhint">Choose the same category clients use to find vendors on QuickFurno.</p>
            <div className={`qf-rf-tiles${fieldError("category") ? " has-error" : ""}`} ref={bindField("category")}>
              {mainCategories.map((category) => {
                const selected = f.categoryId === category.id;
                return (
                  <button
                    type="button"
                    key={category.id}
                    className={`qf-rf-tile${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => selectCategory(category)}
                  >
                    <span className="qf-rf-tile-icon">
                      <QFIcon name={category.icon} />
                    </span>
                    <span className="qf-rf-tile-label">{category.label}</span>
                    <small className="qf-rf-tile-micro">{category.tagline}</small>
                    {selected ? <span className="qf-rf-tile-check" aria-hidden="true">✓</span> : null}
                  </button>
                );
              })}
            </div>
            {fieldError("category") ? <p className="qf-rf-field-err qf-rf-field-err--block">{fieldError("category")}</p> : null}

            {selectedMain && selectedMain.subcategories.length > 0 ? (
              <>
                <p className="qf-rf-qhint" style={{ marginTop: "1.1rem" }}>
                  Which {selectedMain.label.toLowerCase()} service do you offer?
                </p>
                <div className={`qf-rf-subcategory-grid${fieldError("subCategory") ? " has-error" : ""}`} ref={bindField("subCategory")}>
                  {selectedMain.subcategories.map((sub) => {
                    const selected = f.subCategory === sub.label;
                    const minRate = CATEGORY_MIN_RATE[sub.category];
                    return (
                      <button
                        type="button"
                        key={sub.label}
                        className={`qf-rf-subcategory-card${selected ? " is-selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => selectSubcategory(sub.label)}
                      >
                        <span className="qf-rf-subcategory-card-title">{sub.label}</span>
                        {minRate ? (
                          <span className="qf-rf-subcategory-card-rate">
                            Starting from ₹{minRate.toLocaleString("en-IN")}/sqft
                          </span>
                        ) : null}
                        {selected ? (
                          <span className="qf-rf-subcategory-card-check" aria-hidden="true">✓</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {fieldError("subCategory") ? <p className="qf-rf-field-err qf-rf-field-err--block">{fieldError("subCategory")}</p> : null}
              </>
            ) : null}
          </div>
        );
      case 2:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">Step 3 of 6</span>
            <h2>Where do you serve clients?</h2>
            <p className="qf-rf-qhint">Pick your city and your business base area. You can update this later from your dashboard.</p>

            {/* 1. City selection */}
            <div className={`qf-rf-chips${fieldError("city") ? " has-error" : ""}`} ref={bindField("city")}>
              {activeCities.length === 0 ? (
                <p className="qf-rf-qhint">{citiesLoading ? "Loading cities…" : NO_ACTIVE_CITIES_MESSAGE}</p>
              ) : (
                activeCities.map((city) => {
                  const selected = f.city === city;
                  return (
                    <button
                      type="button"
                      key={city}
                      className={`qf-rf-chip${selected ? " is-selected" : ""}`}
                      aria-pressed={selected}
                      // Switching city clears the base area picked for the previous
                      // city (incl. Google identity + coords) and pre-fills state.
                      onClick={() => {
                        setF((c) => ({
                          ...c,
                          city,
                          baseArea: "",
                          baseAreaNormalized: "",
                          googlePlaceId: "",
                          formattedAddress: "",
                          sublocality: "",
                          neighborhood: "",
                          baseLatitude: null,
                          baseLongitude: null,
                          stateName: "Maharashtra",
                          coversFullCity: false,
                        }));
                        setError("");
                        setTouched((prev) => ({ ...prev, city: true }));
                      }}
                    >
                      {city}
                    </button>
                  );
                })
              )}
            </div>
            {fieldError("city") ? <p className="qf-rf-field-err qf-rf-field-err--block">{fieldError("city")}</p> : null}

            {/* Serve entire city checkbox/card */}
            {hasCitySelected ? (
              <div className="qf-rf-coverage-wrap" style={{ marginTop: "1rem" }}>
                <label className={`qf-rf-coverage-card${f.coversFullCity ? " is-selected" : ""}`}>
                  <input
                    type="checkbox"
                    checked={f.coversFullCity}
                    onChange={(e) => {
                      set("coversFullCity", e.target.checked);
                    }}
                    className="qf-rf-coverage-checkbox"
                  />
                  <div className="qf-rf-coverage-info">
                    <strong className="qf-rf-coverage-title">Serve entire city</strong>
                    <span className="qf-rf-coverage-desc">
                      Receive client matches from any area in this city. Nearby requests will still be prioritised first.
                    </span>
                  </div>
                </label>
                {f.coversFullCity ? (
                  <p className="qf-rf-coverage-helper">
                    “Your profile will be eligible across the city. Your business base area is still used to prioritise nearby requests.”
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* 2. Google business base area / locality (manual fallback preserved) */}
            <p className="qf-vrf-subhead">Business base area / locality</p>
            {(() => {
              const baseTouched = touched.baseArea || showErrors;
              const baseValid = baseAreaValue.length >= 2;
              const baseInvalid = baseTouched && !baseValid;
              const wrapperClass = `qf-rf-field${baseInvalid ? " has-error" : ""}${baseValid ? " is-valid" : ""}`;
              return (
                <label className={wrapperClass} ref={bindField("baseArea")}>
                  <span>Business base area / locality</span>
                  <div className="qf-rf-input-wrapper">
                    <GooglePlaceAutocomplete
                      value={f.baseArea}
                      city={f.city}
                      mode="locality"
                      onManualChange={onBaseAreaManual}
                      onPlaceSelected={onBaseAreaPlace}
                      onBlur={() => setTouched((prev) => ({ ...prev, baseArea: true }))}
                      placeholder={hasCitySelected ? "e.g. Baner, Kharadi" : "Select a city first"}
                      disabled={!hasCitySelected}
                      autoComplete="off"
                    />
                    {baseValid ? (
                      <span className="qf-rf-input-icon qf-rf-input-icon--valid">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#19a55a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </span>
                    ) : baseInvalid ? (
                      <span className="qf-rf-input-icon qf-rf-input-icon--invalid">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b4231a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </span>
                    ) : null}
                  </div>
                  {baseInvalid && fieldError("baseArea") ? (
                    <span className="qf-rf-field-err">{fieldError("baseArea")}</span>
                  ) : null}
                  {f.baseLatitude != null && f.baseLongitude != null ? (
                    <span className="qf-rf-loc-note qf-rf-loc-note--ok" style={{ marginTop: "0.25rem" }}>
                      Base location set from your selected area.
                    </span>
                  ) : (
                    <span className="qf-rf-loc-note" style={{ marginTop: "0.25rem" }}>
                      Pick a suggestion for precise matching, or type your area manually.
                    </span>
                  )}
                </label>
              );
            })()}

            {/* 3. Office / Business Address (profile/contact only — not matching) */}
            <p className="qf-vrf-subhead">Office / Business Address</p>
            <div className="qf-rf-fields">
              {renderInputField({
                label: "Office / Business Address Line 1",
                fieldKey: "addressLine1",
                placeholder: "Shop / building, street",
                autoComplete: "address-line1",
              })}
              {renderInputField({
                label: "Address Line 2 (optional)",
                fieldKey: "addressLine2",
                placeholder: "Area, locality",
                autoComplete: "address-line2",
              })}
              {renderInputField({
                label: "Landmark (optional)",
                fieldKey: "landmark",
                placeholder: "Near…",
              })}
              {renderInputField({
                label: "State",
                fieldKey: "state",
                placeholder: "Maharashtra",
                autoComplete: "address-level1",
                customOnChange: (val) => set("stateName", val),
              })}
            </div>
          </div>
        );
      case 3:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">Step 4 of 6</span>
            <h2>Improve your client matching</h2>
            <p className="qf-rf-qhint">
              Sharing location helps QuickFurno match you with nearby client enquiries.
            </p>

            <div className="qf-vrf-loc-card">
              <span className="qf-vrf-loc-icon">
                <QFIcon name="pin" />
              </span>
              <div className="qf-vrf-loc-text">
                <strong>Allow location for better matching</strong>
                <small>Used only for matching — never shown publicly as exact GPS.</small>
              </div>
              <button
                type="button"
                className="qf-rf-btn qf-rf-btn--primary qf-rf-btn--full"
                onClick={requestLocation}
                disabled={loc.status === "requesting"}
              >
                {loc.status === "requesting"
                  ? "Requesting location…"
                  : loc.status === "granted"
                    ? "Location captured ✓"
                    : "Allow location for better matching"}
              </button>
            </div>

            {loc.status === "granted" ? (
              <p className="qf-rf-loc-note qf-rf-loc-note--ok">
                Location captured — accuracy ~{loc.accuracy != null ? Math.round(loc.accuracy) : "—"} m.
                We&apos;ll match you with nearby clients.
              </p>
            ) : (
              <p className="qf-rf-loc-note">
                Prefer not to share location? You can continue — your business base area is enough.
              </p>
            )}
          </div>
        );
      case 4:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">Step 5 of 6</span>
            <h2>Tell us your business strength</h2>
            <p className="qf-rf-qhint">This helps us understand your capacity, experience, and project fit.</p>

            <ChipGroup label="Years of experience" options={EXPERIENCE_OPTIONS} value={f.yearsExperience} onPick={(v) => set("yearsExperience", v)} />
            <ChipGroup label="Team size" options={TEAM_OPTIONS} value={f.teamSize} onPick={(v) => set("teamSize", v)} />
            <ChipGroup label="Monthly project capacity" options={CAPACITY_OPTIONS} value={f.monthlyCapacity} onPick={(v) => set("monthlyCapacity", v)} />

            <div className="qf-vrf-group" ref={bindField("rate")}>
              <span className="qf-vrf-group-label">Starting ₹/sqft rate</span>
              {usesSqftRate ? (
                <>
                  <p className="qf-rf-loc-note" style={{ marginTop: "0.1rem" }}>
                    Enter your approximate starting rate per sqft. This helps clients understand your
                    starting range.
                  </p>
                  <div className={`qf-vrf-rate-input${(touched.rate || showErrors) && !rateValid ? " has-error" : ""}${rateValid && f.rateValue !== "" ? " is-valid" : ""}`}>
                    <span className="qf-vrf-rate-prefix">₹</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={f.rateValue}
                      onChange={(e) => {
                        set("rateValue", e.target.value.replace(/\D/g, "").slice(0, 6));
                        setTouched((prev) => ({ ...prev, rate: true }));
                      }}
                      onBlur={() => setTouched((prev) => ({ ...prev, rate: true }))}
                      placeholder={minRate != null ? String(minRate) : "0"}
                      aria-label="Starting rate per square foot"
                    />
                    {rateValid && f.rateValue !== "" ? (
                      <span className="qf-rf-input-icon qf-rf-input-icon--valid" style={{ position: "static", marginRight: "0.25rem" }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#19a55a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </span>
                    ) : (touched.rate || showErrors) && !rateValid ? (
                      <span className="qf-rf-input-icon qf-rf-input-icon--invalid" style={{ position: "static", marginRight: "0.25rem" }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b4231a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </span>
                    ) : null}
                    <span className="qf-vrf-rate-suffix">/sqft</span>
                  </div>
                  <p className="qf-vrf-rate-min">Recommended minimum: ₹{minRate}/sqft</p>
                  {(touched.rate || showErrors) && !rateValid ? (
                    <p className="qf-vrf-rate-error">Minimum starting rate for this category is ₹{minRate}/sqft.</p>
                  ) : null}
                </>
              ) : (
                <p className="qf-rf-loc-note" style={{ marginTop: "0.1rem" }}>
                  Rate varies by project for this category.
                </p>
              )}
            </div>

            <ChipGroup label="Showroom / factory / studio" options={BUSINESS_TYPE_OPTIONS} value={f.businessType} onPick={(v) => set("businessType", v)} />
          </div>
        );
      default:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">Step 6 of 6</span>
            <h2>Review your application</h2>
            <p className="qf-rf-qhint">
              Please check your details before submitting. Our team will verify your profile and
              contact you on WhatsApp.
            </p>
            <dl className="qf-rf-summary">
              <SummaryRow label="Business" value={f.businessName || "—"} />
              <SummaryRow label="Owner" value={f.ownerName || "—"} />
              <SummaryRow label="WhatsApp" value={f.phone || "—"} />
              <SummaryRow label="Email" value={f.email || "—"} />
              <SummaryRow label="Category" value={selectedMain?.label || "—"} />
              {f.subCategory ? <SummaryRow label="Specialisation" value={f.subCategory} /> : null}
              <SummaryRow label="City" value={cityValue || "—"} />
              <SummaryRow
                label="Coverage"
                value={f.coversFullCity ? `Entire ${cityValue}` : "Base area only"}
              />
              {String(f.addressLine1 ?? "").trim() ? (
                <SummaryRow
                  label="Office address"
                  value={[
                    String(f.addressLine1 ?? "").trim(),
                    String(f.addressLine2 ?? "").trim(),
                    String(f.landmark ?? "").trim()
                  ].filter(Boolean).join(", ")}
                />
              ) : null}
              {String(f.stateName ?? "").trim() ? <SummaryRow label="State" value={String(f.stateName ?? "").trim()} /> : null}
              <SummaryRow label="Base area" value={baseAreaValue || "—"} />
              <SummaryRow label="Location" value={loc.status === "granted" ? "Shared" : "Not shared"} />
              {f.yearsExperience ? <SummaryRow label="Experience" value={f.yearsExperience} /> : null}
              {f.teamSize ? <SummaryRow label="Team size" value={f.teamSize} /> : null}
              {f.monthlyCapacity ? <SummaryRow label="Capacity" value={f.monthlyCapacity} /> : null}
              {formattedRate ? <SummaryRow label="Starting ₹/sqft rate" value={formattedRate} /> : null}
              {f.businessType ? <SummaryRow label="Setup" value={f.businessType} /> : null}
            </dl>
            <p className="qf-rf-qhint" style={{ marginTop: "0.9rem" }}>
              After verification, our team will share suitable matching options for your city,
              category and base area.
            </p>
          </div>
        );
    }
  }
}

function ChipGroup({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: string[];
  value: string;
  onPick: (value: string) => void;
}) {
  return (
    <div className="qf-vrf-group">
      <span className="qf-vrf-group-label">{label}</span>
      <div className="qf-rf-chips">
        {options.map((option) => {
          const selected = value === option;
          return (
            <button
              type="button"
              key={option}
              className={`qf-rf-chip${selected ? " is-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => onPick(selected ? "" : option)}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
