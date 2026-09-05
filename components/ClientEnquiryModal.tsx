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
import {
  DISCARD_CONFIRM_BODY,
  DISCARD_CONFIRM_TITLE,
  formatServiceLabels,
} from "@/components/client-enquiry/enquiryDisplay";
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
// QF-UI-V2-08: the SUBCATEGORY_RATES table that used to live here was removed.
// It hardcoded ₹1,000 / ₹200 / ₹1,200 per sqft "Starting from" figures that no
// maintained business source backs, and presented them to homeowners as if they
// were QuickFurno market rates. No pricing guidance is shown in this flow.
const RF_TIMELINES: { label: string; icon: IconName }[] = [
  { label: "Within One Month", icon: "bolt" },
  { label: "One–Two Months", icon: "clock" },
  { label: "Two–Three Months", icon: "clock" },
  { label: "After Three Months", icon: "search" },
];

/**
 * QF-MOBILE-FORM — budget bands for the single-form redesign.
 *
 * The canonical payload has ALWAYS been the free-text `budget_range` string
 * produced by budgetSummary() from budgetMin / budgetMax / budgetNotSure. This
 * dropdown does NOT change that contract: each band simply writes the same
 * three state fields, so the submitted `budget_range` is byte-identical to what
 * the old two-number step produced for the same range, and "Not sure yet" keeps
 * the existing budgetNotSure semantics.
 */
const BUDGET_BANDS: { id: string; label: string; min: string; max: string; notSure: boolean }[] = [
  { id: "unsure", label: "Not sure yet", min: "", max: "", notSure: true },
  { id: "u50k", label: "Under ₹50,000", min: "10000", max: "50000", notSure: false },
  { id: "50k-2l", label: "₹50,000 – ₹2 lakh", min: "50000", max: "200000", notSure: false },
  { id: "2l-5l", label: "₹2 lakh – ₹5 lakh", min: "200000", max: "500000", notSure: false },
  { id: "5l-10l", label: "₹5 lakh – ₹10 lakh", min: "500000", max: "1000000", notSure: false },
  { id: "10l+", label: "₹10 lakh+", min: "1000000", max: "5000000", notSure: false },
];

/**
 * Property type. `property_type` is an EXISTING lead column that
 * services/leadService.ts already persists (`property_type: input.property_type
 * ?? null`) and that /enquiry has always sent; the homepage modal simply never
 * collected it. These are plain strings stored verbatim, exactly as the funnel
 * stores its own free-text value, so no storage semantics change.
 */
const PROPERTY_TYPES = ["1 BHK", "2 BHK", "3 BHK", "4+ BHK", "Villa", "Office", "Shop / Commercial", "Other"];

// QF-MOBILE-FORM: LAST_STEP is retained only because the modal still tracks a
// `step` value for the preferred-vendor `minStep` lock; PHASES/PHASE_PERCENT
// described the removed progress chrome and are gone.
const LAST_STEP = 6;

type RFState = {
  categoryId: string;
  categoryLabel: string;
  subcategory: string;
  serviceRequired: string;
  city: string;
  area: string;
  budgetMin: string;
  budgetMax: string;
  budgetNotSure: boolean;
  timeline: string;
  propertyType: string;
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
  budgetMin: "",
  budgetMax: "",
  budgetNotSure: false,
  timeline: "",
  propertyType: "",
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [locStatus, setLocStatus] = useState<"" | "locating" | "captured" | "denied" | "unsupported">("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // First step the client may navigate back to. 0 for the normal flow; for a
  // resolved preferred-vendor flow it is the first step the client still has to
  // fill, so category/subcategory (and prefilled city) stay locked/hidden.
  const [minStep, setMinStep] = useState(0);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // QF-UI-HOTFIX-01: the Escape handler needs the LATEST requestClose (which
  // reads `success` and the form) without those values becoming effect
  // dependencies. A ref keeps the listener stable, so typing can never tear the
  // listener — or the focus/scroll lifecycle — down and back up.
  const requestCloseRef = useRef<() => void>(() => {});

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
    2: ["city", "area"],
    3: ["budgetMin", "budgetMax"],
    5: ["name", "phone", "whatsapp", "consent"],
  };

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

  // ── QF-MOBILE-FORM — single-form helpers ──────────────────────────────────
  // The wizard's per-step rules are the SAME rules; they are simply evaluated
  // together now. stepError() stays the single source of truth so the form and
  // any remaining step affordance can never disagree.

  /** Which budget band the current min/max/notSure state corresponds to. */
  function currentBudgetBandId(): string {
    if (form.budgetNotSure) return "unsure";
    const band = BUDGET_BANDS.find(
      (b) => !b.notSure && b.min === form.budgetMin && b.max === form.budgetMax,
    );
    return band ? band.id : "";
  }

  /** Write a band back into the canonical min/max/notSure fields. */
  function selectBudgetBand(id: string) {
    const band = BUDGET_BANDS.find((b) => b.id === id);
    setError("");
    setForm((current) => ({
      ...current,
      budgetNotSure: band ? band.notSure : false,
      budgetMin: band ? band.min : "",
      budgetMax: band ? band.max : "",
    }));
  }

  /**
   * The whole form, in the order the fields are shown. Returns the first
   * problem, or null when the enquiry may be submitted. Every rule is delegated
   * to stepError(), so the validation contract is unchanged.
   */
  function formError(): string | null {
    for (const target of [0, 1, 2, 3, 4, 5]) {
      // Interior is the only category with a subcategory requirement.
      if (target === 1 && !isInterior) continue;
      const err = stepError(target);
      if (err) return err;
    }
    return null;
  }

  /** Mark every field touched so inline messages appear on a failed submit. */
  function markAllTouched() {
    const next: Record<string, boolean> = {};
    for (const fields of Object.values(STEP_FIELDS)) {
      for (const field of fields ?? []) next[field] = true;
    }
    setTouched((current) => ({ ...current, ...next }));
  }



  function requestClose() {
    if (success || !hasData()) {
      closeModal();
      return;
    }
    setShowConfirm(true);
  }

  // Keep the Escape listener pointed at the current closure without making it a
  // dependency of any effect. Assigned on every render; read only on Escape.
  requestCloseRef.current = requestClose;

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

  // A Google prediction was picked: fill structured location and update city only
  // when it is safe (a city we actually serve). Pincode is no longer captured.
  //
  // STRICT CITY CONSISTENCY: if the client already chose a city and the picked
  // place clearly belongs to a different city, we DO NOT overwrite ANY field
  // (area/city/lat/lng/placeId/formattedAddress/areaNormalized) — we surface a
  // message and let them pick again or type an area manually. This prevents ever
  // saving city = X with coordinates from another city.
  function onAreaPlaceSelected(place: NormalizedGooglePlace) {
    if (form.city && !isPlaceCompatibleWithSelectedCity(place, form.city)) {
      setError(`Please select an area within ${form.city}.`);
      return; // keep the form exactly as-is; manual typing remains available
    }
    setError("");
    setForm((current) => {
      // Only accept a place city that is one of the admin-managed active cities
      // (case-insensitive), and store it in the canonical casing from that list.
      const matchedCity = place.city
        ? activeCities.find((c) => c.toLowerCase() === place.city!.toLowerCase())
        : undefined;
      const nextCity = matchedCity ?? current.city;
      return {
        ...current,
        area: place.area ?? current.area,
        city: nextCity,
        // Coordinates belong to THIS place only. If the newly picked place has no
        // coordinates we store null — never retain the previous place's coords,
        // so place identity + area + coordinates stay internally consistent.
        lat: place.lat,
        lng: place.lng,
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

  // Page scroll lock + initial focus + return focus. OPEN/CLOSE LIFECYCLE ONLY.
  //
  // QF-UI-V2-08: this locked document.body, which does NOTHING here. QF-UI-V2-05
  // gave body `overflow-x: clip` precisely so it is not a scroll container, and
  // `html` is the scrolling element — measured: with the modal open and
  // body.style.overflow = "hidden", a dispatched wheel still scrolled the page
  // from 0 to 960. The lock therefore targets documentElement, restores the
  // previous INLINE values on close (so the stylesheet's own overflow-x
  // returns), and compensates the scrollbar width only while the modal is
  // mounted, so nothing shifts on open and no padding is left behind on close.
  //
  // QF-UI-HOTFIX-01 — THE MOBILE KEYBOARD BUG. This effect used to depend on
  // [open, showConfirm, success, form]. `form` changes on EVERY keystroke, so
  // React tore the effect down and rebuilt it after every character: cleanup
  // called opener.focus(), which blurred the field being typed into and closed
  // the mobile keyboard, then the re-run refocused the dialog and the keyboard
  // reopened. The scroll lock was also released and re-applied each time.
  //
  // The dependency list is now [open] alone, so the opener is captured once, the
  // dialog is focused once, and focus is handed back ONLY when the modal really
  // closes. Nothing in here may ever depend on form/step/touched/submitting/
  // success/showConfirm again — the guard in
  // scripts/ui/validate-mobile-form-focus.mjs fails CI if it does.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousPaddingRight = root.style.paddingRight;
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    if (scrollbarWidth > 0) root.style.paddingRight = `${scrollbarWidth}px`;

    // Remember whatever opened the modal so focus can be handed back on close,
    // and move focus into the dialog so keyboard users are not left on <body>.
    const opener = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 60);

    return () => {
      root.style.overflow = previousOverflow;
      root.style.paddingRight = previousPaddingRight;
      window.clearTimeout(focusTimer);
      // `isConnected` guards the case where the trigger unmounted while the
      // modal was open — focusing a detached node silently sends focus to body.
      if (opener && opener.isConnected && typeof opener.focus === "function") {
        opener.focus();
      }
    };
  }, [open]);

  // Escape handling, deliberately SEPARATE from the focus/scroll lifecycle.
  //
  // This effect may re-run (it reads `showConfirm`), and that is safe precisely
  // because its cleanup does one thing: remove the listener. It must never
  // restore opener focus, refocus the dialog, or touch the scroll lock — doing
  // any of those here would reintroduce the keyboard bug through the back door.
  // `requestCloseRef` keeps the handler current without pulling `form` or
  // `success` into these dependencies.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (showConfirm) {
        setShowConfirm(false);
        return;
      }
      requestCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, showConfirm]);

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

    // QF-MOBILE-FORM: the whole form is on screen, so validate the whole form.
    // formError() delegates to the SAME per-step rules the wizard used, so no
    // requirement was relaxed by removing the step gates; a failing submit now
    // reveals every inline message at once instead of one screen at a time.
    const invalid = formError();
    if (invalid) {
      markAllTouched();
      setError(invalid);
      return;
    }

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
    };

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      city: form.city,
      area: form.area.trim() || undefined,
      service_category: form.serviceRequired,
      // Structured subcategory (e.g. the chosen interior service). Additive —
      // persisted via leadService; does not change category-selection behavior.
      subcategory: form.subcategory || undefined,
      budget_range: budgetText || undefined,
      timeline: form.timeline || undefined,
      // EXISTING lead column, already persisted by services/leadService.ts and
      // already sent by /enquiry. The homepage modal simply never collected it.
      property_type: form.propertyType || undefined,
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
        setSuccessMessage("Your requirement has been submitted. QuickFurno will connect you with up to 3 relevant verified vendors.");
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

  // QF-MOBILE-FORM: the phase/percent/question-counter helpers went with the
  // wizard. A single form has no steps to count.
  const interiorCategory = mainCategories.find((c) => c.id === INTERIOR_ID);
  const subcategoryOptions = interiorCategory?.subcategories ?? [];

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

  /**
   * QF-MOBILE-FORM — ONE continuous form.
   *
   * This replaces the six-question wizard presentation. It is PRESENTATION ONLY:
   * every value, handler, validation rule and submission path is the one the
   * wizard already used, so the payload, consent, preferred-vendor routing,
   * location metadata and tracking are unchanged.
   *
   * Field order is fixed and mobile-first:
   *   service -> city -> area -> name -> phone -> whatsapp -> budget ->
   *   property type -> timeline -> message -> consent -> submit.
   * Desktop pairs related fields into two columns purely with CSS, so the wide
   * layout never dictates the mobile structure.
   */
  function renderSingleForm() {
    const cityUi = fieldUi("city", { valid: Boolean(form.city), value: form.city, error: "Please select your city." });
    const hasCoordinates =
      form.lat != null && form.lng != null && Number.isFinite(form.lat) && Number.isFinite(form.lng);
    const areaUi = fieldUi("area", {
      valid: form.area.trim().length > 0 || hasCoordinates,
      value: form.area,
      error: "Enter your area/locality or use your current location.",
    });
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
    const serviceError = Boolean(touched.service) && !form.categoryId;
    const subError = Boolean(touched.service) && isInterior && !form.subcategory;
    const budgetError = Boolean(touched.budgetMin) && currentBudgetBandId() === "";
    const timelineError = Boolean(touched.timeline) && !form.timeline;

    return (
      <div className="qf-sf">
        {/* Service. The category source of truth is unchanged — these are the
            same mainCategories the tile grid used, rendered as a select. In the
            preferred-vendor flow the category is fixed by the vendor, so the
            picker is hidden exactly as the wizard hid those steps. */}
        {minStep === 0 ? (
          <label className={`qf-sf-field${serviceError ? " has-error" : ""}`} htmlFor="qf-sf-service">
            <span className="qf-sf-label">Service needed</span>
            <select
              id="qf-sf-service"
              value={form.categoryId}
              onChange={(e) => {
                const cat = mainCategories.find((c) => c.id === e.target.value);
                if (cat) selectCategory(cat);
                markTouched("service");
              }}
              onBlur={() => markTouched("service")}
            >
              <option value="">Select a service</option>
              {mainCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
            {serviceError ? <span className="qf-rf-field-err">Select a service.</span> : null}
          </label>
        ) : null}

        {/* Interior is the only category with a subcategory; this second select
            appears only once Interior is chosen. */}
        {minStep === 0 && isInterior ? (
          <label className={`qf-sf-field${subError ? " has-error" : ""}`} htmlFor="qf-sf-sub">
            <span className="qf-sf-label">Interior service</span>
            <select
              id="qf-sf-sub"
              value={form.subcategory}
              onChange={(e) => {
                const sub = subcategoryOptions.find((o) => o.label === e.target.value);
                if (sub) selectSubcategory(sub);
                markTouched("service");
              }}
              onBlur={() => markTouched("service")}
            >
              <option value="">Select an interior service</option>
              {subcategoryOptions.map((sub) => (
                <option key={sub.label} value={sub.label}>
                  {sub.label}
                </option>
              ))}
            </select>
            {subError ? <span className="qf-rf-field-err">Select an interior service.</span> : null}
          </label>
        ) : null}

        <label className={`qf-sf-field${cityUi.showError ? " has-error" : ""}`} htmlFor="qf-sf-city">
          <span className="qf-sf-label">City</span>
          <select
            id="qf-sf-city"
            value={form.city}
            onChange={(e) => {
              set("city", e.target.value);
              markTouched("city");
            }}
            onBlur={() => markTouched("city")}
            disabled={citiesLoading && activeCities.length === 0}
          >
            <option value="">{citiesLoading && !citiesLoaded ? "Loading cities…" : "Select your city"}</option>
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

        {/* Area keeps the Google enhancement AND the manual fallback verbatim. */}
        <label className={`qf-sf-field qf-sf-area${areaUi.showError ? " has-error" : ""}`}>
          <span className="qf-sf-label">Area / locality</span>
          <div className="qf-rf-input-wrapper">
            <GooglePlaceAutocomplete
              value={form.area}
              city={form.city}
              mode="locality"
              onManualChange={onAreaManualChange}
              onPlaceSelected={onAreaPlaceSelected}
              onBlur={() => markTouched("area")}
              placeholder="e.g. Kharadi, Baner, Andheri"
              autoComplete="off"
            />
            <ValidationIcon state={areaUi.iconState} />
          </div>
          {areaUi.showError ? <span className="qf-rf-field-err">{areaUi.error}</span> : null}
        </label>

        <div className="qf-sf-locrow">
          <button type="button" className="qf-sf-loc" onClick={useMyLocation}>
            <QFIcon name="pin" />
            {locStatus === "locating" ? "Getting location…" : "Use my current location"}
          </button>
          {locStatus === "captured" ? (
            <p className="qf-sf-note qf-sf-note--ok">Location captured — we&apos;ll use this to match relevant verified vendors.</p>
          ) : null}
          {locStatus === "denied" ? (
            <p className="qf-sf-note">No problem — your city and area above are enough.</p>
          ) : null}
          {locStatus === "unsupported" ? (
            <p className="qf-sf-note">Your browser does not support location — your city and area are enough.</p>
          ) : null}
        </div>

        <label className={`qf-sf-field${nameUi.showError ? " has-error" : ""}`} htmlFor="qf-sf-name">
          <span className="qf-sf-label">Your name</span>
          <div className="qf-rf-input-wrapper">
            <input
              id="qf-sf-name"
              ref={nameInputRef}
              value={form.name}
              onChange={(e) => {
                set("name", e.target.value);
                markTouched("name");
              }}
              onBlur={() => markTouched("name")}
              placeholder="e.g. Rahul Sharma"
              autoComplete="name"
            />
            <ValidationIcon state={nameUi.iconState} />
          </div>
          {nameUi.showError ? <span className="qf-rf-field-err">{nameUi.error}</span> : null}
        </label>

        <label className={`qf-sf-field${phoneUi.showError ? " has-error" : ""}`} htmlFor="qf-sf-phone">
          <span className="qf-sf-label">Phone number</span>
          <div className="qf-rf-input-wrapper">
            <input
              id="qf-sf-phone"
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

        <label className="qf-sf-check qf-sf-field--full">
          <input type="checkbox" checked={form.whatsappSame} onChange={(e) => onWhatsappSameChange(e.target.checked)} />
          <span>WhatsApp number same as phone</span>
        </label>

        {!form.whatsappSame ? (
          <label className={`qf-sf-field${whatsappUi.showError ? " has-error" : ""}`} htmlFor="qf-sf-wa">
            <span className="qf-sf-label">WhatsApp number</span>
            <div className="qf-rf-input-wrapper">
              <input
                id="qf-sf-wa"
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

        {/* Budget — ONE band select that writes the canonical
            budgetMin / budgetMax / budgetNotSure fields, so budgetSummary() and
            the submitted `budget_range` string are unchanged. */}
        <label className={`qf-sf-field${budgetError ? " has-error" : ""}`} htmlFor="qf-sf-budget">
          <span className="qf-sf-label">Budget</span>
          <select
            id="qf-sf-budget"
            value={currentBudgetBandId()}
            onChange={(e) => {
              selectBudgetBand(e.target.value);
              markTouched("budgetMin");
            }}
            onBlur={() => markTouched("budgetMin")}
          >
            <option value="">Select a budget range</option>
            {BUDGET_BANDS.map((band) => (
              <option key={band.id} value={band.id}>
                {band.label}
              </option>
            ))}
          </select>
          {budgetError ? <span className="qf-rf-field-err">Select a budget range.</span> : null}
        </label>

        <label className="qf-sf-field" htmlFor="qf-sf-property">
          <span className="qf-sf-label">Property type</span>
          <select
            id="qf-sf-property"
            value={form.propertyType}
            onChange={(e) => set("propertyType", e.target.value)}
          >
            <option value="">Select property type</option>
            {PROPERTY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        {/* Timeline remains a submitted payload field; it is a select now. */}
        <label className={`qf-sf-field${timelineError ? " has-error" : ""}`} htmlFor="qf-sf-timeline">
          <span className="qf-sf-label">When do you want to start?</span>
          <select
            id="qf-sf-timeline"
            value={form.timeline}
            onChange={(e) => {
              set("timeline", e.target.value);
              markTouched("timeline");
            }}
            onBlur={() => markTouched("timeline")}
          >
            <option value="">Select a timeline</option>
            {RF_TIMELINES.map((tile) => (
              <option key={tile.label} value={tile.label}>
                {tile.label}
              </option>
            ))}
          </select>
          {timelineError ? <span className="qf-rf-field-err">Select your project timeline.</span> : null}
        </label>

        <label className="qf-sf-field qf-sf-field--full" htmlFor="qf-sf-message">
          <span className="qf-sf-label">Message / details (optional)</span>
          <textarea
            id="qf-sf-message"
            value={form.message}
            onChange={(e) => set("message", e.target.value)}
            placeholder="Anything else the teams should know?"
            rows={3}
          />
        </label>

        {/* Consent — the SAME legal text and the same share_consent semantics,
            in a compact row instead of a large card. Never pre-checked. */}
        <label className={`qf-sf-consent${consentError ? " has-error" : ""}`}>
          <input
            type="checkbox"
            checked={form.shareConsent}
            onChange={(e) => {
              set("shareConsent", e.target.checked);
              markTouched("consent");
            }}
          />
          <span>
            I agree that QuickFurno may share my enquiry and contact details with up to 3 verified vendors initially. If vendors are unavailable, non-responsive, or unable to serve my requirement, QuickFurno may manually connect me with additional verified vendors to fulfil my request.{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            {" · "}
            <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>
          </span>
        </label>
        {consentError ? (
          <span className="qf-rf-field-err qf-rf-field-err--block">
            Please accept sharing your details with up to 3 verified vendors to continue.
          </span>
        ) : null}
      </div>
    );
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
            ref={dialogRef}
            tabIndex={-1}
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

              {/* QF-MOBILE-FORM: the wizard phase strip and progress bar are
                  gone. One continuous form needs no step indicator, and on a
                  390px screen that chrome was pushing the first field below the
                  fold. A short title + one line of context replaces them. */}
              {!success ? (
                <div className="qf-sf-intro">
                  <h3 id="qf-rf-title">Tell us about your project</h3>
                  <p>
                    Share your requirement once. QuickFurno will match you with up to 3 relevant
                    verified vendors.
                  </p>
                </div>
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
                  <p>{successMessage || "Your requirement has been submitted. QuickFurno will connect you with up to 3 relevant verified vendors."}</p>
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
                        {/* DISPLAY ONLY: the vendor's category and subcategory often
                            resolve to the same label ("Carpenters / Carpenters"), so
                            equal labels collapse to one. The stored
                            targetVendorCategory / targetVendorSubcategory values are
                            unchanged and still submitted separately. */}
                        Service:{" "}
                        {formatServiceLabels(
                          modalOptions.targetVendorCategory || form.serviceRequired,
                          modalOptions.targetVendorSubcategory,
                        ) || "—"}
                      </div>
                      {form.area || form.city ? (
                        <div style={{ color: "#4b5563" }}>
                          Area: {[form.area, form.city].filter(Boolean).join(", ")}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {renderSingleForm()}
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
              <footer className="qf-rf-footer qf-sf-footer">
                <button
                  type="button"
                  className="qf-rf-btn qf-rf-btn--primary qf-sf-cta"
                  disabled={submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? "Submitting…" : "Get Free Team Matches"}
                </button>
                <p className="qf-sf-trust">Free for homeowners · Up to 3 verified vendors · Your details stay private</p>
              </footer>
            )}

            {showConfirm ? (
              <div className="qf-rf-confirm" role="alertdialog" aria-label="Confirm close">
                <div className="qf-rf-confirm-card">
                  <h4>{DISCARD_CONFIRM_TITLE}</h4>
                  <p>{DISCARD_CONFIRM_BODY}</p>
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
