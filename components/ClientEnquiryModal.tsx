"use client";

import {
  ButtonHTMLAttributes,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { submitLead } from "@/app/actions";
import { trackEvent } from "@/lib/config";
import { enquiryServiceForCategory } from "@/lib/quickfurno-data";
import { mainCategories } from "@/lib/categories";
import { QFIcon } from "@/components/QuickFurnoIcons";
// Phase 2 hardening: cities come from the admin-managed active-city source of
// truth (same hook vendor registration uses), never a hardcoded list.
import { useActiveCities, NO_ACTIVE_CITIES_MESSAGE } from "@/lib/locations/useActiveCities";
// Google area enhancement; manual fallback preserved. The Area / Locality input
// upgrades to Google Places suggestions when a public key is present, and stays a
// plain input (unchanged behaviour) whenever Google is missing or blocked.
import GooglePlaceAutocomplete from "@/components/location/GooglePlaceAutocomplete";
import { isPlaceCompatibleWithSelectedCity } from "@/lib/google-maps/normalizePlace";
import type { NormalizedGooglePlace } from "@/lib/google-maps/types";

// ---------------------------------------------------------------------------
// "Requirement First" guided multi-step enquiry flow.
// One question per screen, Typeform-style, mapped to the SAME lead fields the
// backend already expects (submitLead / leadService.createLead). No Supabase,
// type, or API changes — the extra context folds into the existing
// `requirement` text field, and `service_category` keeps the canonical service
// string so lead↔vendor matching keeps working.
//
// Category structure is the single source of truth in lib/categories.ts so the
// homepage cards, vendor registration and this form never drift apart:
//   Interior (Interior Designers · Carpenters · Modular Factory · Premium
//   Interiors) · Sofa · Painter · Civil Work.
// ---------------------------------------------------------------------------

type IconName = Parameters<typeof QFIcon>[0]["name"];

const INTERIOR_ID = "interior";

// Icons for the four Interior subcategories (the shared category source only
// carries icons for the main tiles).
const SUBCATEGORY_ICONS: Record<string, IconName> = {
  "Interior Designers": "home",
  Carpenters: "hammer",
  "Modular Factory": "kitchen",
  "Premium Interiors": "grid",
};

// Minimum starting rate shown on each Interior subcategory card. Display-only
// guidance for the client form — kept local here so it never touches the shared
// category source, vendor registration or vendor card logic.
const SUBCATEGORY_RATES: Record<string, string> = {
  "Interior Designers": "Starting from ₹1,000/sqft",
  Carpenters: "Starting from ₹200/sqft",
  "Modular Factory": "Starting from ₹1,000/sqft",
  "Premium Interiors": "Starting from ₹1,200/sqft",
};

const RF_TIMELINES: { label: string; icon: IconName }[] = [
  { label: "Within One Month", icon: "bolt" },
  { label: "One–Two Months", icon: "clock" },
  { label: "Two–Three Months", icon: "clock" },
  { label: "After Three Months", icon: "search" },
];

const PHASES = ["Need", "Details", "Match"] as const;
const LAST_STEP = 6; // 0..5 questions + 6 = match/summary
const PHASE_PERCENT = [33, 66, 100];

type RFState = {
  categoryId: string;
  categoryLabel: string;
  subcategory: string;
  serviceRequired: string;
  city: string;
  area: string;
  pincode: string;
  budgetMin: string;
  budgetMax: string;
  budgetNotSure: boolean;
  timeline: string;
  name: string;
  phone: string;
  whatsappSame: boolean;
  whatsapp: string;
  message: string;
  lat: number | null;
  lng: number | null;
  shareConsent: boolean;
  // ── Phase 2: Google area enhancement (manual fallback preserved) ──────────
  // Optional structured location captured from Google Places or browser GPS.
  // These map to the Phase 1 optional CreateLeadInput fields; when empty they
  // are simply omitted from the payload, so the manual flow is unchanged.
  googlePlaceId: string;
  formattedAddress: string;
  areaNormalized: string;
  sublocality: string;
  neighborhood: string;
  locationAccuracyMeters: number | null;
  locationSource: "" | "manual" | "browser_gps" | "google_place" | "reverse_geocode";
  locationCapturedAt: string;
};

const initialState: RFState = {
  categoryId: "",
  categoryLabel: "",
  subcategory: "",
  serviceRequired: "",
  city: "",
  area: "",
  pincode: "",
  budgetMin: "",
  budgetMax: "",
  budgetNotSure: false,
  timeline: "",
  name: "",
  phone: "",
  whatsappSame: true,
  whatsapp: "",
  message: "",
  lat: null,
  lng: null,
  shareConsent: false,
  // Phase 2 structured-location defaults (empty = manual-only, unchanged flow).
  googlePlaceId: "",
  formattedAddress: "",
  areaNormalized: "",
  sublocality: "",
  neighborhood: "",
  locationAccuracyMeters: null,
  locationSource: "",
  locationCapturedAt: "",
};

const inrFormatter = new Intl.NumberFormat("en-IN");

// Indian mobile: exactly 10 digits, first digit 6-9.
const PHONE_RE = /^[6-9]\d{9}$/;

/**
 * Strip everything but digits and normalise a pasted Indian number down to a
 * bare 10-digit mobile (e.g. "+91 98765 43210" or "098765 43210" → "9876543210").
 */
function cleanPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(digits.length - 10);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

function isPhoneValid(digits: string): boolean {
  return PHONE_RE.test(digits);
}

/** Inline tick / cross shown inside a field (same look as the vendor form). */
function ValidationIcon({ state }: { state: "valid" | "invalid" | "none" }) {
  if (state === "valid") {
    return (
      <span className="qf-rf-input-icon qf-rf-input-icon--valid" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#19a55a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  if (state === "invalid") {
    return (
      <span className="qf-rf-input-icon qf-rf-input-icon--invalid" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b4231a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    );
  }
  return null;
}

/** Read UTM params + the current page URL for lead-source tracking. */
function readTrackingContext() {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const pick = (key: string) => params.get(key)?.trim() || undefined;
  return {
    source_url: window.location.href,
    utm_source: pick("utm_source"),
    utm_medium: pick("utm_medium"),
    utm_campaign: pick("utm_campaign"),
    utm_term: pick("utm_term"),
    utm_content: pick("utm_content"),
  };
}

type EnquiryModalOptions = {
  title?: string;
  serviceCategory?: string;
  city?: string;
  area?: string;
  requirement?: string;
  source?: string;
  // Phase 1 preferred-vendor routing. When leadIntent === "preferred_vendor" the
  // enquiry is routed FIRST to the picked vendor (see leadService.createLead).
  // Defaults (undefined / "general_auto_match") keep the normal auto-match flow.
  leadIntent?: "general_auto_match" | "preferred_vendor";
  targetVendorId?: string;
  targetVendorName?: string;
  targetVendorCategory?: string;
  targetVendorSubcategory?: string;
};

const OPEN_EVENT = "quickfurno:open-enquiry-modal";

type EnquiryModalContextValue = {
  openModal: (options?: EnquiryModalOptions) => void;
};

const EnquiryModalContext = createContext<EnquiryModalContextValue | null>(null);

/**
 * Best-effort map of an incoming category/service string (passed by triggers
 * across the site) to one of the four approved main categories — and, for
 * Interior, the closest subcategory — so the modal opens pre-filled.
 */
function presetFromCategory(value?: string): { categoryId: string; sub?: string } | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes("paint")) return { categoryId: "painter" };
  if (v.includes("sofa") || v.includes("uphol")) return { categoryId: "sofa" };
  if (v.includes("civil") || v.includes("renovat") || v.includes("masonry")) return { categoryId: "civil-work" };
  if (v.includes("modular") || v.includes("kitchen") || v.includes("wardrobe"))
    return { categoryId: INTERIOR_ID, sub: "Modular Factory" };
  if (v.includes("carpen") || v.includes("furniture")) return { categoryId: INTERIOR_ID, sub: "Carpenters" };
  if (v.includes("premium")) return { categoryId: INTERIOR_ID, sub: "Premium Interiors" };
  if (v.includes("interior") || v.includes("ceiling") || v.includes("turnkey") || v.includes("design"))
    return { categoryId: INTERIOR_ID, sub: "Interior Designers" };
  return null;
}

/**
 * Resolve a client-picked vendor's canonical category into the modal's own
 * category structure (parent id/label + interior subcategory + enquiry service).
 * `targetVendorCategory` is one of the seven QuickFurnoCategory leaves: the four
 * interior leaves fold under the "interior" parent; Sofa / Painter / Civil Work
 * are their own main category. Returns null when the label can't be resolved, so
 * the caller safely falls back to the normal category picker.
 */
function resolvePreferredSelection(targetVendorCategory?: string): {
  categoryId: string;
  categoryLabel: string;
  subcategory: string;
  serviceRequired: string;
} | null {
  const wanted = targetVendorCategory?.trim().toLowerCase();
  if (!wanted) return null;

  // Leaf that is its own main category (Sofa / Painter / Civil Work).
  const leafMain = mainCategories.find((c) => c.category && c.category.toLowerCase() === wanted);
  if (leafMain && leafMain.category) {
    const leafCategory = leafMain.category;
    return {
      categoryId: leafMain.id,
      categoryLabel: leafMain.label,
      subcategory: "",
      serviceRequired: enquiryServiceForCategory(leafCategory),
    };
  }

  // Interior leaf (Interior Designers / Carpenters / Modular Factory / Premium Interiors).
  for (const main of mainCategories) {
    const sub = main.subcategories.find((s) => s.category.toLowerCase() === wanted);
    if (sub) {
      return {
        categoryId: main.id,
        categoryLabel: main.label,
        subcategory: sub.label,
        serviceRequired: enquiryServiceForCategory(sub.category),
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Trigger button — UNCHANGED public API. Every existing CTA keeps working.
// ---------------------------------------------------------------------------
export function EnquiryModalTrigger({
  children,
  type = "button",
  modalTitle,
  serviceCategory,
  city,
  area,
  requirement,
  source,
  leadIntent,
  targetVendorId,
  targetVendorName,
  targetVendorCategory,
  targetVendorSubcategory,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & EnquiryModalOptions & { modalTitle?: string }) {
  const context = useContext(EnquiryModalContext);
  const modalOptions = {
    title: modalTitle,
    serviceCategory,
    city,
    area,
    requirement,
    source,
    leadIntent,
    targetVendorId,
    targetVendorName,
    targetVendorCategory,
    targetVendorSubcategory,
  };

  return (
    <button
      {...props}
      type={type}
      data-enquiry-modal-trigger
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;

        if (context) {
          context.openModal(modalOptions);
          return;
        }

        window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: modalOptions }));
      }}
    >
      {children}
    </button>
  );
}

export function EnquiryModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<RFState>(initialState);
  // Admin-managed active cities (single source of truth for city options AND the
  // supported-city check after a Google place is picked). Never hardcoded here.
  const { cities: activeCities, loading: citiesLoading, loaded: citiesLoaded } = useActiveCities();
  const [modalOptions, setModalOptions] = useState<EnquiryModalOptions>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [locStatus, setLocStatus] = useState<"" | "locating" | "captured" | "denied" | "unsupported">("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // First step the client may navigate back to. 0 for the normal flow; for a
  // resolved preferred-vendor flow it is the first step the client still has to
  // fill, so category/subcategory (and prefilled city) stay locked/hidden.
  const [minStep, setMinStep] = useState(0);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const openModal = useCallback((options: EnquiryModalOptions = {}) => {
    // Preferred-vendor flow: the vendor's category/subcategory are the source of
    // truth (not the free-text serviceCategory). Resolve them into the modal's
    // own structure; fall back to the normal preset when they can't be resolved.
    const isPreferred = options.leadIntent === "preferred_vendor" && Boolean(options.targetVendorId);
    const preferredSelection = isPreferred ? resolvePreferredSelection(options.targetVendorCategory) : null;

    const preset = preferredSelection ? null : presetFromCategory(options.serviceCategory);
    const presetCat = preferredSelection
      ? mainCategories.find((c) => c.id === preferredSelection.categoryId) ?? null
      : preset
        ? mainCategories.find((c) => c.id === preset.categoryId) ?? null
        : null;

    let presetService = "";
    let presetSub = "";
    if (preferredSelection) {
      presetService = preferredSelection.serviceRequired;
      presetSub = preferredSelection.subcategory;
    } else if (presetCat) {
      if (presetCat.category) {
        presetService = enquiryServiceForCategory(presetCat.category);
      } else if (preset?.sub) {
        const subItem = presetCat.subcategories.find((s) => s.label === preset.sub);
        if (subItem) {
          presetSub = subItem.label;
          presetService = enquiryServiceForCategory(subItem.category);
        }
      }
    }

    // Option A: skip category/subcategory (and city, when the vendor prefills it)
    // for a resolved preferred-vendor flow — land on the first field the client
    // still has to complete (budget when city is known, else the city/area step).
    const hasCity = Boolean(options.city && options.city.trim());
    const startStep = preferredSelection ? (hasCity ? 3 : 2) : 0;

    setError("");
    setSuccess(false);
    setSuccessMessage("");
    setSubmitting(false);
    setShowConfirm(false);
    setLocStatus("");
    setTouched({});
    setMinStep(preferredSelection ? startStep : 0);
    setStep(startStep);
    setModalOptions(options);
    setForm({
      ...initialState,
      city: options.city ?? "",
      area: options.area ?? "",
      message: options.requirement ?? "",
      categoryId: presetCat?.id ?? "",
      categoryLabel: presetCat?.label ?? "",
      subcategory: presetSub,
      serviceRequired: presetService,
    });
    setOpen(true);
    if (preferredSelection) {
      // Safe debug only — never logs the client's name/phone.
      console.info("[requirement flow] preferred-vendor prefill", {
        source: options.source ?? "Vendor CTA",
        category: preferredSelection.categoryLabel,
        subcategory: options.targetVendorSubcategory ?? presetSub ?? null,
        has_city: hasCity,
        has_area: Boolean(options.area && options.area.trim()),
        start_step: startStep,
      });
    }
    trackEvent("requirement_flow_started", {
      source: options.source ?? "Requirement flow",
      intent: isPreferred ? "preferred_vendor" : "general_auto_match",
    });
  }, []);

  const contextValue = useMemo(() => ({ openModal }), [openModal]);

  const closeModal = useCallback(() => {
    setOpen(false);
    setShowConfirm(false);
    setError("");
    setSuccess(false);
    setSuccessMessage("");
    setSubmitting(false);
    setLocStatus("");
    setTouched({});
    setStep(0);
    setMinStep(0);
    setModalOptions({});
    setForm(initialState);
  }, []);

  function set<K extends keyof RFState>(field: K, value: RFState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function markTouched(field: string) {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }

  // Fields validated inline (tick/cross + per-field message) per step. Tile/chip
  // steps (category, subcategory, timeline) keep the concise banner instead.
  const STEP_FIELDS: Record<number, string[]> = {
    2: ["city", "area", "pincode"],
    3: ["budgetMin", "budgetMax"],
    5: ["name", "phone", "whatsapp", "consent"],
  };

  function markStepTouched(target: number) {
    const fields = STEP_FIELDS[target];
    if (!fields) return;
    setTouched((prev) => {
      const next = { ...prev };
      fields.forEach((f) => {
        next[f] = true;
      });
      return next;
    });
  }

  const isInterior = form.categoryId === INTERIOR_ID;

  function selectCategory(cat: (typeof mainCategories)[number]) {
    setForm((current) =>
      current.categoryId === cat.id
        ? current
        : {
            ...current,
            categoryId: cat.id,
            categoryLabel: cat.label,
            // Interior needs a subcategory before the canonical service is known;
            // the other three map straight to their service.
            subcategory: "",
            serviceRequired: cat.category ? enquiryServiceForCategory(cat.category) : "",
          },
    );
  }

  function selectSubcategory(sub: { label: string; category: Parameters<typeof enquiryServiceForCategory>[0] }) {
    setForm((current) => ({
      ...current,
      subcategory: sub.label,
      serviceRequired: enquiryServiceForCategory(sub.category),
    }));
  }

  function setBudgetValue(field: "budgetMin" | "budgetMax", raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 9);
    setForm((current) => ({ ...current, [field]: digits, budgetNotSure: false }));
    markTouched(field);
  }

  function onPhoneChange(raw: string) {
    const cleaned = cleanPhone(raw);
    // Keep WhatsApp synced to phone only while the "same as phone" box is ticked.
    setForm((current) => ({
      ...current,
      phone: cleaned,
      whatsapp: current.whatsappSame ? cleaned : current.whatsapp,
    }));
    markTouched("phone");
  }

  function onWhatsappChange(raw: string) {
    setForm((current) => ({ ...current, whatsapp: cleanPhone(raw) }));
    markTouched("whatsapp");
  }

  function onWhatsappSameChange(checked: boolean) {
    setForm((current) => ({
      ...current,
      whatsappSame: checked,
      // Ticking the box copies the cleaned phone number into WhatsApp.
      whatsapp: checked ? current.phone : current.whatsapp,
    }));
  }

  function toggleNotSure() {
    setForm((current) =>
      current.budgetNotSure
        ? { ...current, budgetNotSure: false }
        : { ...current, budgetNotSure: true, budgetMin: "", budgetMax: "" },
    );
  }

  function budgetSummary() {
    if (form.budgetNotSure) return "Not sure yet";
    const min = parseInt(form.budgetMin, 10);
    const max = parseInt(form.budgetMax, 10);
    if (!form.budgetMin && !form.budgetMax) return "";
    if (Number.isNaN(min) || Number.isNaN(max)) return "";
    return `₹${inrFormatter.format(min)} – ₹${inrFormatter.format(max)}`;
  }

  function hasData() {
    return Boolean(
      form.categoryId ||
        form.subcategory ||
        form.city ||
        form.area ||
        form.pincode ||
        form.budgetMin ||
        form.budgetMax ||
        form.budgetNotSure ||
        form.timeline ||
        form.name ||
        form.phone ||
        form.message ||
        (!form.whatsappSame && form.whatsapp),
    );
  }

  /** Validation message for a step, or null when the step is complete. */
  function stepError(target: number): string | null {
    // Preferred-vendor flow: category + subcategory are prefilled from the vendor,
    // so those steps always pass (the client never navigates to them).
    if (minStep > 0 && (target === 0 || target === 1)) return null;
    switch (target) {
      case 0:
        return form.categoryId ? null : "Select a service category.";
      case 1:
        return form.subcategory ? null : "Select an interior service.";
      case 2: {
        if (!form.city) return "Please select your city.";
        if (form.pincode !== "" && form.pincode.length !== 6) return "Enter a valid 6-digit pincode.";
        // Location completeness: require at least one location signal so future
        // matching has something to work with — manual area OR browser-GPS coords
        // (a Google selection provides one/both). Google is never required.
        const hasArea = form.area.trim().length > 0;
        const hasCoordinates =
          form.lat != null && form.lng != null && Number.isFinite(form.lat) && Number.isFinite(form.lng);
        if (!hasArea && !hasCoordinates) return "Enter your area/locality or use your current location.";
        return null;
      }
      case 3: {
        if (form.budgetNotSure) return null;
        const hasMin = form.budgetMin.trim() !== "";
        const hasMax = form.budgetMax.trim() !== "";
        if (!hasMin && !hasMax) return "Enter your budget range or select Not sure yet.";
        const min = parseInt(form.budgetMin, 10);
        const max = parseInt(form.budgetMax, 10);
        if (!hasMin || Number.isNaN(min) || min <= 0) return "Enter a valid minimum budget.";
        if (!hasMax || Number.isNaN(max) || max <= 0) return "Enter a valid maximum budget.";
        if (max < min) return "Maximum budget should be higher than minimum budget.";
        return null;
      }
      case 4:
        return form.timeline ? null : "Select your project timeline.";
      case 5:
        if (form.name.trim().length < 2) return "Please enter your name.";
        if (!isPhoneValid(form.phone)) return "Enter a valid 10-digit mobile number.";
        if (!form.whatsappSame && !isPhoneValid(form.whatsapp))
          return "Enter a valid 10-digit WhatsApp number.";
        if (!form.shareConsent)
          return "Please accept sharing your details with up to 3 verified vendors to continue.";
        return null;
      default:
        return null;
    }
  }

  function goNext() {
    if (step >= LAST_STEP) return;
    const err = stepError(step);
    if (err) {
      // Input-based steps surface inline per-field tick/cross + messages;
      // tile/chip steps keep the concise banner.
      if (STEP_FIELDS[step]) {
        markStepTouched(step);
        setError("");
      } else {
        setError(err);
      }
      return;
    }
    setError("");
    // Interior is the only category with a subcategory step — skip step 1 for
    // Sofa / Painter / Civil Work.
    let next = step + 1;
    if (step === 0 && !isInterior) next = 2;
    next = Math.min(next, LAST_STEP);
    trackEvent("requirement_step_completed", { step: next, phase: PHASES[phaseFor(step)] });
    setStep(next);
  }

  function goBack() {
    setError("");
    let prev = step - 1;
    if (step === 2 && !isInterior) prev = 0;
    // Never step back past minStep — in the preferred-vendor flow this keeps the
    // prefilled category/subcategory (and city) steps locked away from the client.
    setStep(Math.max(prev, minStep, 0));
  }

  function requestClose() {
    if (success || !hasData()) {
      closeModal();
      return;
    }
    setShowConfirm(true);
  }

  // ── Phase 2: Area / Locality — Google area enhancement (manual fallback) ────
  // Manual typing keeps the exact old behaviour (free-text area) and never
  // leaves stale structured metadata that disagrees with the typed text.
  //   CASE A (browser GPS captured): keep GPS lat/lng/accuracy/source/timestamp;
  //           only refresh the area text (and clear any Google identity fields).
  //   CASE B (previous Google place, or no GPS): clear ALL Google-derived data,
  //           INCLUDING the now-stale locationCapturedAt, and mark source manual.
  function onAreaManualChange(value: string) {
    // Clear any stale "select an area within <city>" mismatch banner the moment
    // the client starts typing a manual area (this handler is only wired to the
    // step-2 area field, so it never touches submission errors on other steps).
    setError("");
    setForm((current) => {
      const keepGpsCoords =
        current.locationSource === "browser_gps" &&
        current.lat != null &&
        current.lng != null &&
        Number.isFinite(current.lat) &&
        Number.isFinite(current.lng);

      const base = {
        ...current,
        area: value,
        areaNormalized: value.trim().toLowerCase(),
        // Google place identity never survives manual editing of the area text.
        googlePlaceId: "",
        formattedAddress: "",
        sublocality: "",
        neighborhood: "",
      };

      if (keepGpsCoords) {
        // CASE A — GPS coords/source/accuracy/timestamp remain valid.
        return base;
      }

      // CASE B — drop every Google-derived signal, including the stale timestamp.
      return {
        ...base,
        lat: null,
        lng: null,
        locationAccuracyMeters: null,
        locationSource: "manual",
        locationCapturedAt: "",
      };
    });
    markTouched("area");
  }

  // A Google prediction was picked: fill structured location, and update pincode
  // / city only when they are safe (valid pincode; city we actually serve).
  //
  // STRICT CITY CONSISTENCY (Part 4): if the client already chose a city and the
  // picked place clearly belongs to a different city, we DO NOT overwrite ANY
  // field (area/pincode/city/lat/lng/placeId/formattedAddress/areaNormalized) —
  // we surface a message and let them pick again or type an area manually. This
  // prevents ever saving city = X with coordinates from another city.
  function onAreaPlaceSelected(place: NormalizedGooglePlace) {
    if (form.city && !isPlaceCompatibleWithSelectedCity(place, form.city)) {
      setError(`Please select an area within ${form.city}.`);
      return; // keep the form exactly as-is; manual typing remains available
    }
    setError("");
    setForm((current) => {
      const nextPincode =
        place.postalCode && /^\d{6}$/.test(place.postalCode) ? place.postalCode : current.pincode;
      // Only accept a place city that is one of the admin-managed active cities
      // (case-insensitive), and store it in the canonical casing from that list.
      const matchedCity = place.city
        ? activeCities.find((c) => c.toLowerCase() === place.city!.toLowerCase())
        : undefined;
      const nextCity = matchedCity ?? current.city;
      return {
        ...current,
        area: place.area ?? current.area,
        pincode: nextPincode,
        city: nextCity,
        lat: place.lat ?? current.lat,
        lng: place.lng ?? current.lng,
        googlePlaceId: place.placeId ?? "",
        formattedAddress: place.formattedAddress ?? "",
        areaNormalized: place.areaNormalized ?? (place.area ? place.area.toLowerCase() : ""),
        sublocality: place.sublocality ?? "",
        neighborhood: place.neighborhood ?? "",
        locationAccuracyMeters: null, // a precise place is not a GPS accuracy radius
        locationSource: "google_place",
        locationCapturedAt: new Date().toISOString(),
      };
    });
    markTouched("area");
    markTouched("city");
  }

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocStatus("unsupported");
      return;
    }
    setLocStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Keep existing behaviour (store lat/lng) and additionally tag the
        // structured source + accuracy + timestamp. No reverse geocoding here.
        setForm((current) => ({
          ...current,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          locationAccuracyMeters: Number.isFinite(pos.coords.accuracy)
            ? pos.coords.accuracy
            : current.locationAccuracyMeters,
          locationSource: "browser_gps",
          locationCapturedAt: new Date().toISOString(),
        }));
        setLocStatus("captured");
      },
      () => setLocStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  // Open-via-event bridge (used when a trigger renders outside the provider tree).
  useEffect(() => {
    const onOpenEvent = (event: Event) => {
      openModal(event instanceof CustomEvent ? event.detail : {});
    };
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => window.removeEventListener(OPEN_EVENT, onOpenEvent);
  }, [openModal]);

  // Body scroll lock + Escape handling while open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (showConfirm) {
        setShowConfirm(false);
        return;
      }
      requestClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showConfirm, success, form]);

  // Focus the name field when the contact step appears; reset scroll on step change.
  useEffect(() => {
    if (!open) return;
    bodyRef.current?.scrollTo({ top: 0 });
    if (step === 5) {
      const t = window.setTimeout(() => nameInputRef.current?.focus(), 120);
      return () => window.clearTimeout(t);
    }
  }, [step, open]);

  async function handleSubmit() {
    if (submitting) return;
    setError("");

    if (!form.name.trim() || !isPhoneValid(form.phone) || !form.city || !form.serviceRequired) {
      setError("Please complete your name, a valid 10-digit mobile number, city and service.");
      return;
    }

    if (!form.whatsappSame && !isPhoneValid(form.whatsapp)) {
      setError("Enter a valid 10-digit WhatsApp number.");
      return;
    }

    if (!form.shareConsent) {
      setError("Please accept sharing your details with up to 3 verified vendors to continue.");
      return;
    }

    const requirementParts = [
      form.categoryLabel ? `Category: ${form.categoryLabel}` : "",
      form.subcategory ? `Service: ${form.subcategory}` : "",
      form.pincode ? `Pincode: ${form.pincode}` : "",
      form.whatsappSame ? "WhatsApp: same as phone" : form.whatsapp ? `WhatsApp: ${form.whatsapp}` : "",
      form.message.trim() ? `Notes: ${form.message.trim()}` : "",
      form.lat != null && form.lng != null ? `GPS: ${form.lat.toFixed(5)}, ${form.lng.toFixed(5)}` : "",
    ].filter(Boolean);

    const budgetText = budgetSummary();

    // Phase 1 preferred-vendor routing: when a specific paid/trial vendor CTA
    // opened this modal, route the lead FIRST to that vendor (see
    // leadService.createLead). General CTAs keep normal QuickFurno auto-matching.
    const isPreferred = modalOptions.leadIntent === "preferred_vendor" && Boolean(modalOptions.targetVendorId);
    const preferredPayload = isPreferred
      ? {
          lead_intent: "preferred_vendor" as const,
          target_vendor_id: modalOptions.targetVendorId,
          target_vendor_name: modalOptions.targetVendorName,
          target_vendor_category: modalOptions.targetVendorCategory,
          target_vendor_subcategory: modalOptions.targetVendorSubcategory,
        }
      : {};

    // Google area enhancement; manual fallback preserved. These structured
    // location fields are optional (Phase 1 CreateLeadInput); each is omitted
    // when empty, so a manual-only submission looks exactly like before.
    const locationPayload = {
      latitude: form.lat ?? undefined,
      longitude: form.lng ?? undefined,
      location_accuracy_meters: form.locationAccuracyMeters ?? undefined,
      location_source: form.locationSource || undefined,
      location_captured_at: form.locationCapturedAt || undefined,
      google_place_id: form.googlePlaceId || undefined,
      formatted_address: form.formattedAddress || undefined,
      area_normalized: form.areaNormalized || undefined,
      sublocality: form.sublocality || undefined,
      neighborhood: form.neighborhood || undefined,
      postal_code: form.pincode || undefined,
    };

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      city: form.city,
      area: form.area.trim() || undefined,
      service_category: form.serviceRequired,
      budget_range: budgetText || undefined,
      timeline: form.timeline || undefined,
      requirement: requirementParts.join(" | ") || undefined,
      source: modalOptions.source ?? "Requirement flow",
      location_consent: form.lat != null && form.lng != null,
      share_consent: form.shareConsent,
      ...locationPayload,
      ...readTrackingContext(),
      ...preferredPayload,
    };

    setSubmitting(true);
    try {
      const result = await submitLead(payload);
      if (!result.ok) {
        console.error("[requirement flow] submission failed", { code: result.code, error: result.error });
        setError(result.error);
        return;
      }

      trackEvent("lead_submit", { source: payload.source, service: payload.service_category });
      trackEvent("requirement_flow_submitted", {
        source: payload.source,
        service: payload.service_category,
        budget: payload.budget_range,
        timeline: payload.timeline,
      });

      // Minimal success-copy variants (no layout change).
      if (isPreferred) {
        const vendorName = modalOptions.targetVendorName || result.data.preferred_vendor?.vendor_name || "this vendor";
        setSuccessMessage(
          result.data.preferred_vendor?.assigned
            ? `Your enquiry has been sent to ${vendorName}. If needed, QuickFurno may connect you with up to 2 more suitable verified vendors after some time.`
            : `Your request for ${vendorName} has been received. QuickFurno will check this vendor's availability first. If they are unavailable, we will connect you with better matching verified vendors.`,
        );
      } else {
        setSuccessMessage("Your requirement has been submitted. QuickFurno will connect you with up to 3 verified vendors near you.");
      }
      setSuccess(true);
    } catch (err) {
      console.error("[requirement flow] submission error", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
      setError("We could not submit your requirement. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function phaseFor(target: number) {
    if (target <= 0) return 0;
    if (target >= LAST_STEP) return 2;
    return 1;
  }

  const phaseIndex = phaseFor(step);
  const percent = PHASE_PERCENT[phaseIndex];
  const interiorCategory = mainCategories.find((c) => c.id === INTERIOR_ID);
  const subcategoryOptions = interiorCategory?.subcategories ?? [];

  // "Question X of Y" — Interior has 6 questions, the others 5 (no subcategory).
  const totalQuestions = isInterior ? 6 : 5;
  const questionNumber = isInterior ? step + 1 : step === 0 ? 1 : step;

  function budgetMinError(): string | null {
    if (form.budgetNotSure) return null;
    const hasMin = form.budgetMin.trim() !== "";
    const hasMax = form.budgetMax.trim() !== "";
    if (!hasMin && !hasMax) return "Enter your budget range or select Not sure yet.";
    const min = parseInt(form.budgetMin, 10);
    if (!hasMin || Number.isNaN(min) || min <= 0) return "Enter a valid minimum budget.";
    return null;
  }

  function budgetMaxError(): string | null {
    if (form.budgetNotSure) return null;
    const hasMin = form.budgetMin.trim() !== "";
    const hasMax = form.budgetMax.trim() !== "";
    if (!hasMin && !hasMax) return null; // surfaced under the minimum field
    const min = parseInt(form.budgetMin, 10);
    const max = parseInt(form.budgetMax, 10);
    if (!hasMax || Number.isNaN(max) || max <= 0) return "Enter a valid maximum budget.";
    if (max < min) return "Maximum budget should be higher than minimum budget.";
    return null;
  }

  /**
   * Resolve the inline validation state for a field: a green tick once it holds
   * a valid value, a red cross + message after it's been touched (or Next was
   * pressed), and nothing while it's pristine. Optional fields never show a
   * cross when empty.
   */
  function fieldUi(name: string, opts: { valid: boolean; value: string; error: string | null; optional?: boolean }) {
    const isTouched = Boolean(touched[name]);
    const hasValue = opts.value.trim() !== "";
    let state: "valid" | "invalid" | "none" = "none";
    if (opts.valid && hasValue) state = "valid";
    else if (!opts.valid && isTouched && (!opts.optional || hasValue)) state = "invalid";
    return {
      className: `qf-rf-field${state === "invalid" ? " has-error" : ""}${state === "valid" ? " is-valid" : ""}`,
      iconState: state,
      showError: state === "invalid" && Boolean(opts.error),
      error: opts.error,
    };
  }

  function renderStep() {
    switch (step) {
      case 0:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">{`Question ${questionNumber} of ${totalQuestions}`}</span>
            <h3 id="qf-rf-title">What service do you need?</h3>
            <p className="qf-rf-qhint">Pick the category closest to your project.</p>
            <div className="qf-rf-tiles">
              {mainCategories.map((cat) => {
                const selected = form.categoryId === cat.id;
                return (
                  <button
                    type="button"
                    key={cat.id}
                    className={`qf-rf-tile${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => selectCategory(cat)}
                  >
                    <span className="qf-rf-tile-icon">
                      <QFIcon name={cat.icon} />
                    </span>
                    <span className="qf-rf-tile-label">{cat.label}</span>
                    <small className="qf-rf-tile-micro">{cat.tagline}</small>
                    {selected ? <span className="qf-rf-tile-check" aria-hidden="true">✓</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      case 1:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">{`Question ${questionNumber} of ${totalQuestions}`}</span>
            <h3 id="qf-rf-title">Which interior service?</h3>
            <p className="qf-rf-qhint">Choose the option closest to your project.</p>
            <div className="qf-rf-tiles">
              {subcategoryOptions.map((sub) => {
                const selected = form.subcategory === sub.label;
                return (
                  <button
                    type="button"
                    key={sub.label}
                    className={`qf-rf-tile${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => selectSubcategory(sub)}
                  >
                    <span className="qf-rf-tile-icon">
                      <QFIcon name={SUBCATEGORY_ICONS[sub.label] ?? "home"} />
                    </span>
                    <span className="qf-rf-tile-label">{sub.label}</span>
                    {SUBCATEGORY_RATES[sub.label] ? (
                      <span className="qf-rf-tile-rate">{SUBCATEGORY_RATES[sub.label]}</span>
                    ) : null}
                    {selected ? <span className="qf-rf-tile-check" aria-hidden="true">✓</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      case 2:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">{`Question ${questionNumber} of ${totalQuestions}`}</span>
            <h3 id="qf-rf-title">Where do you need the service?</h3>
            {(() => {
              const cityUi = fieldUi("city", { valid: Boolean(form.city), value: form.city, error: "Please select your city." });
              // Area is required UNLESS browser-GPS coordinates satisfy the
              // location requirement. Google selection is never required; manual
              // typing stays first-class.
              const hasCoordinates =
                form.lat != null && form.lng != null && Number.isFinite(form.lat) && Number.isFinite(form.lng);
              const areaUi = fieldUi("area", {
                valid: form.area.trim().length > 0 || hasCoordinates,
                value: form.area,
                error: "Enter your area/locality or use your current location.",
              });
              const pincodeValid = form.pincode === "" || form.pincode.length === 6;
              const pincodeUi = fieldUi("pincode", {
                valid: pincodeValid,
                value: form.pincode,
                error: "Enter a valid 6-digit pincode.",
                optional: true,
              });
              return (
                <div className="qf-rf-fields">
                  <label className={cityUi.className}>
                    <span>City</span>
                    <select
                      value={form.city}
                      onChange={(e) => {
                        set("city", e.target.value);
                        markTouched("city");
                      }}
                      onBlur={() => markTouched("city")}
                      disabled={citiesLoading && activeCities.length === 0}
                    >
                      <option value="">
                        {citiesLoading && !citiesLoaded ? "Loading cities…" : "Select city"}
                      </option>
                      {/* Preserve a pre-filled city (e.g. preferred-vendor flow) even
                          if it isn't in the active list, so the value still shows. */}
                      {form.city && !activeCities.includes(form.city) ? (
                        <option value={form.city}>{form.city}</option>
                      ) : null}
                      {activeCities.map((city) => (
                        <option key={city} value={city}>
                          {city}
                        </option>
                      ))}
                    </select>
                    {citiesLoaded && activeCities.length === 0 ? (
                      <span className="qf-rf-field-err">{NO_ACTIVE_CITIES_MESSAGE}</span>
                    ) : cityUi.showError ? (
                      <span className="qf-rf-field-err">{cityUi.error}</span>
                    ) : null}
                  </label>
                  <label className={areaUi.className}>
                    <span>Area / Locality</span>
                    <div className="qf-rf-input-wrapper">
                      {/* Google area enhancement; manual fallback preserved.
                          Same label, wrapper, validation icon and placeholder —
                          only the input gains optional Google Places suggestions. */}
                      <GooglePlaceAutocomplete
                        value={form.area}
                        city={form.city}
                        mode="locality"
                        onManualChange={onAreaManualChange}
                        onPlaceSelected={onAreaPlaceSelected}
                        onBlur={() => markTouched("area")}
                        placeholder="e.g. Kharadi, Baner"
                        autoComplete="address-level2"
                      />
                      <ValidationIcon state={areaUi.iconState} />
                    </div>
                    {areaUi.showError ? <span className="qf-rf-field-err">{areaUi.error}</span> : null}
                  </label>
                  <label className={pincodeUi.className}>
                    <span>Pincode (optional)</span>
                    <div className="qf-rf-input-wrapper">
                      <input
                        value={form.pincode}
                        onChange={(e) => {
                          set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6));
                          markTouched("pincode");
                        }}
                        onBlur={() => markTouched("pincode")}
                        placeholder="411014"
                        inputMode="numeric"
                        autoComplete="postal-code"
                      />
                      <ValidationIcon state={pincodeUi.iconState} />
                    </div>
                    {pincodeUi.showError ? <span className="qf-rf-field-err">{pincodeUi.error}</span> : null}
                  </label>
              <button type="button" className="qf-rf-loc-btn" onClick={useMyLocation}>
                <QFIcon name="pin" />
                {locStatus === "locating" ? "Getting location…" : "Use my current location"}
              </button>
              {locStatus === "captured" ? (
                <p className="qf-rf-loc-note qf-rf-loc-note--ok">Location captured — we&apos;ll match you with Verified Teams near you.</p>
              ) : null}
              {locStatus === "denied" ? (
                <p className="qf-rf-loc-note">No problem — your city and area above are enough.</p>
              ) : null}
              {locStatus === "unsupported" ? (
                <p className="qf-rf-loc-note">Location isn&apos;t available on this device — please enter city and area.</p>
              ) : null}
                </div>
              );
            })()}
          </div>
        );
      case 3:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">{`Question ${questionNumber} of ${totalQuestions}`}</span>
            <h3 id="qf-rf-title">What is your approximate budget?</h3>
            <p className="qf-rf-qhint">Enter your expected budget range. This helps us match you with the right team.</p>
            {(() => {
              const minUi = fieldUi("budgetMin", {
                valid: budgetMinError() === null,
                value: form.budgetNotSure ? "x" : form.budgetMin,
                error: budgetMinError(),
              });
              const maxUi = fieldUi("budgetMax", {
                valid: budgetMaxError() === null,
                value: form.budgetNotSure ? "x" : form.budgetMax,
                error: budgetMaxError(),
              });
              // No tick/cross while "Not sure yet" is selected.
              const minIcon = form.budgetNotSure ? "none" : minUi.iconState;
              const maxIcon = form.budgetNotSure ? "none" : maxUi.iconState;
              return (
                <div className="qf-rf-fields">
                  <div className="qf-rf-budget-row">
                    <label className={form.budgetNotSure ? "qf-rf-field" : minUi.className}>
                      <span>Minimum budget</span>
                      <div className="qf-rf-money">
                        <span className="qf-rf-money-prefix" aria-hidden="true">₹</span>
                        <input
                          value={form.budgetMin}
                          onChange={(e) => setBudgetValue("budgetMin", e.target.value)}
                          onBlur={() => markTouched("budgetMin")}
                          placeholder="50000"
                          inputMode="numeric"
                          disabled={form.budgetNotSure}
                          aria-label="Minimum budget in rupees"
                        />
                        <ValidationIcon state={minIcon} />
                      </div>
                      {!form.budgetNotSure && minUi.showError ? (
                        <span className="qf-rf-field-err">{minUi.error}</span>
                      ) : null}
                    </label>
                    <label className={form.budgetNotSure ? "qf-rf-field" : maxUi.className}>
                      <span>Up to</span>
                      <div className="qf-rf-money">
                        <span className="qf-rf-money-prefix" aria-hidden="true">₹</span>
                        <input
                          value={form.budgetMax}
                          onChange={(e) => setBudgetValue("budgetMax", e.target.value)}
                          onBlur={() => markTouched("budgetMax")}
                          placeholder="300000"
                          inputMode="numeric"
                          disabled={form.budgetNotSure}
                          aria-label="Maximum budget in rupees"
                        />
                        <ValidationIcon state={maxIcon} />
                      </div>
                      {!form.budgetNotSure && maxUi.showError ? (
                        <span className="qf-rf-field-err">{maxUi.error}</span>
                      ) : null}
                    </label>
                  </div>
                  <div className="qf-rf-chips">
                    <button
                      type="button"
                      className={`qf-rf-chip${form.budgetNotSure ? " is-selected" : ""}`}
                      aria-pressed={form.budgetNotSure}
                      onClick={toggleNotSure}
                    >
                      Not sure yet
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      case 4:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">{`Question ${questionNumber} of ${totalQuestions}`}</span>
            <h3 id="qf-rf-title">When do you want to start?</h3>
            <p className="qf-rf-qhint">Choose the timeline closest to your plan.</p>
            <div className="qf-rf-tiles qf-rf-tiles--wide">
              {RF_TIMELINES.map((tile) => {
                const selected = form.timeline === tile.label;
                return (
                  <button
                    type="button"
                    key={tile.label}
                    className={`qf-rf-tile${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => set("timeline", tile.label)}
                  >
                    <span className="qf-rf-tile-icon">
                      <QFIcon name={tile.icon} />
                    </span>
                    <span className="qf-rf-tile-label">{tile.label}</span>
                    {selected ? <span className="qf-rf-tile-check" aria-hidden="true">✓</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      case 5:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">{`Question ${questionNumber} of ${totalQuestions}`}</span>
            <h3 id="qf-rf-title">Where should teams contact you?</h3>
            {(() => {
              const nameUi = fieldUi("name", {
                valid: form.name.trim().length >= 2,
                value: form.name,
                error: "Please enter your name.",
              });
              const phoneUi = fieldUi("phone", {
                valid: isPhoneValid(form.phone),
                value: form.phone,
                error: "Enter a valid 10-digit mobile number.",
              });
              const whatsappUi = fieldUi("whatsapp", {
                valid: isPhoneValid(form.whatsapp),
                value: form.whatsapp,
                error: "Enter a valid 10-digit WhatsApp number.",
              });
              const consentError = Boolean(touched.consent) && !form.shareConsent;
              return (
                <div className="qf-rf-fields">
                  <label className={nameUi.className}>
                    <span>Name</span>
                    <div className="qf-rf-input-wrapper">
                      <input
                        ref={nameInputRef}
                        value={form.name}
                        onChange={(e) => {
                          set("name", e.target.value);
                          markTouched("name");
                        }}
                        onBlur={() => markTouched("name")}
                        placeholder="Your full name"
                        autoComplete="name"
                      />
                      <ValidationIcon state={nameUi.iconState} />
                    </div>
                    {nameUi.showError ? <span className="qf-rf-field-err">{nameUi.error}</span> : null}
                  </label>
                  <label className={phoneUi.className}>
                    <span>Phone number</span>
                    <div className="qf-rf-input-wrapper">
                      <input
                        value={form.phone}
                        onChange={(e) => onPhoneChange(e.target.value)}
                        onBlur={() => markTouched("phone")}
                        placeholder="10-digit mobile number"
                        inputMode="numeric"
                        autoComplete="tel"
                        maxLength={10}
                      />
                      <ValidationIcon state={phoneUi.iconState} />
                    </div>
                    {phoneUi.showError ? <span className="qf-rf-field-err">{phoneUi.error}</span> : null}
                  </label>
                  <label className="qf-rf-check">
                    <input
                      type="checkbox"
                      checked={form.whatsappSame}
                      onChange={(e) => onWhatsappSameChange(e.target.checked)}
                    />
                    <span>WhatsApp number same as phone</span>
                  </label>
                  {!form.whatsappSame ? (
                    <label className={whatsappUi.className}>
                      <span>WhatsApp number</span>
                      <div className="qf-rf-input-wrapper">
                        <input
                          value={form.whatsapp}
                          onChange={(e) => onWhatsappChange(e.target.value)}
                          onBlur={() => markTouched("whatsapp")}
                          placeholder="10-digit WhatsApp number"
                          inputMode="numeric"
                          maxLength={10}
                        />
                        <ValidationIcon state={whatsappUi.iconState} />
                      </div>
                      {whatsappUi.showError ? <span className="qf-rf-field-err">{whatsappUi.error}</span> : null}
                    </label>
                  ) : null}
                  <label className="qf-rf-field">
                    <span>Message / details (optional)</span>
                    <textarea
                      value={form.message}
                      onChange={(e) => set("message", e.target.value)}
                      placeholder="Anything else the teams should know?"
                      rows={3}
                    />
                  </label>
                  <label className={`qf-rf-check qf-rf-consent${consentError ? " has-error" : ""}`}>
                    <input
                      type="checkbox"
                      checked={form.shareConsent}
                      onChange={(e) => {
                        set("shareConsent", e.target.checked);
                        markTouched("consent");
                      }}
                    />
                    <span>
                      I agree that QuickFurno may share my enquiry and contact details with up to 3 verified vendors initially. If vendors are unavailable, non-responsive, or unable to serve my requirement, QuickFurno may manually connect me with additional verified vendors to fulfil my request. See our{" "}
                      <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>{" "}
                      and{" "}
                      <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>.
                    </span>
                  </label>
                  {consentError ? (
                    <span className="qf-rf-field-err qf-rf-field-err--block">
                      Please accept sharing your details with up to 3 verified vendors to continue.
                    </span>
                  ) : null}
                </div>
              );
            })()}
          </div>
        );
      default:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">Review &amp; confirm</span>
            <h3 id="qf-rf-title">Get matched with Verified Teams</h3>
            <p className="qf-rf-qhint">We&apos;ll connect you with Verified Teams near your area.</p>
            <dl className="qf-rf-summary">
              <div>
                <dt>Service</dt>
                <dd>{form.categoryLabel || "—"}</dd>
              </div>
              {form.subcategory ? (
                <div>
                  <dt>Interior service</dt>
                  <dd>{form.subcategory}</dd>
                </div>
              ) : null}
              <div>
                <dt>Area</dt>
                <dd>{[form.area, form.city].filter(Boolean).join(", ") || form.city || "—"}</dd>
              </div>
              <div>
                <dt>Budget</dt>
                <dd>{budgetSummary() || "—"}</dd>
              </div>
              <div>
                <dt>Timeline</dt>
                <dd>{form.timeline || "—"}</dd>
              </div>
            </dl>
          </div>
        );
    }
  }

  return (
    <EnquiryModalContext.Provider value={contextValue}>
      {children}
      {open ? (
        <div
          className="qf-rf-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) requestClose();
          }}
        >
          <section
            className="qf-rf-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qf-rf-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="qf-rf-top">
              <div className="qf-rf-top-row">
                <span className="qf-rf-flow-name">Get Matched With Verified Teams</span>
                <button type="button" className="qf-rf-close" aria-label="Close" onClick={requestClose}>
                  ×
                </button>
              </div>

              {!success ? (
                <>
                  <div className="qf-rf-steps" aria-hidden="true">
                    {PHASES.map((label, i) => (
                      <div
                        key={label}
                        className={`qf-rf-phase${phaseIndex === i ? " is-active" : ""}${
                          phaseIndex > i ? " is-done" : ""
                        }`}
                      >
                        <span className="qf-rf-phase-dot">{phaseIndex > i ? "✓" : i + 1}</span>
                        <span className="qf-rf-phase-label">{label}</span>
                      </div>
                    ))}
                  </div>
                  <div
                    className="qf-rf-progress"
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Form progress"
                  >
                    <span className="qf-rf-progress-fill" style={{ width: `${percent}%` }} />
                  </div>
                </>
              ) : null}
            </header>

            <div className="qf-rf-body" ref={bodyRef}>
              {error ? (
                <p className="qf-rf-alert" role="alert">
                  {error}
                </p>
              ) : null}

              {success ? (
                <div className="qf-rf-success">
                  <span className="qf-rf-success-mark" aria-hidden="true">
                    ✓
                  </span>
                  <h3 id="qf-rf-title">Requirement submitted</h3>
                  <p>{successMessage || "Your requirement has been submitted. QuickFurno will connect you with up to 3 verified vendors near you."}</p>
                </div>
              ) : (
                <>
                  {minStep > 0 ? (
                    <div
                      className="qf-rf-preferred-summary"
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: "12px 14px",
                        marginBottom: 16,
                        background: "#f9fafb",
                        fontSize: 14,
                        lineHeight: 1.5,
                      }}
                    >
                      <strong style={{ display: "block", marginBottom: 4 }}>
                        You are requesting a quote from {modalOptions.targetVendorName || "this vendor"}
                      </strong>
                      <div style={{ color: "#4b5563" }}>
                        Service: {modalOptions.targetVendorCategory || form.serviceRequired || "—"}
                        {modalOptions.targetVendorSubcategory ? ` / ${modalOptions.targetVendorSubcategory}` : ""}
                      </div>
                      {form.area || form.city ? (
                        <div style={{ color: "#4b5563" }}>
                          Area: {[form.area, form.city].filter(Boolean).join(", ")}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="qf-rf-step" key={step}>
                    {renderStep()}
                  </div>
                </>
              )}
            </div>

            {success ? (
              <footer className="qf-rf-footer">
                <button type="button" className="qf-rf-btn qf-rf-btn--primary qf-rf-btn--full" onClick={closeModal}>
                  Done
                </button>
              </footer>
            ) : (
              <footer className="qf-rf-footer">
                {step > minStep ? (
                  <button type="button" className="qf-rf-btn qf-rf-btn--ghost" onClick={goBack}>
                    Back
                  </button>
                ) : (
                  <span className="qf-rf-footer-spacer" />
                )}
                {step < LAST_STEP ? (
                  <button type="button" className="qf-rf-btn qf-rf-btn--primary" onClick={goNext}>
                    Next
                  </button>
                ) : (
                  <button
                    type="button"
                    className="qf-rf-btn qf-rf-btn--primary"
                    disabled={submitting}
                    onClick={handleSubmit}
                  >
                    {submitting ? "Submitting…" : "Get Matched With Teams"}
                  </button>
                )}
              </footer>
            )}

            {showConfirm ? (
              <div className="qf-rf-confirm" role="alertdialog" aria-label="Confirm close">
                <div className="qf-rf-confirm-card">
                  <h4>Are you sure?</h4>
                  <p>Your requirement details will be lost.</p>
                  <div className="qf-rf-confirm-actions">
                    <button type="button" className="qf-rf-btn qf-rf-btn--ghost" onClick={() => setShowConfirm(false)}>
                      Keep editing
                    </button>
                    <button type="button" className="qf-rf-btn qf-rf-btn--danger" onClick={closeModal}>
                      Discard
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </EnquiryModalContext.Provider>
  );
}
