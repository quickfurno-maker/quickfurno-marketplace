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
import { cities, enquiryServiceForCategory } from "@/lib/quickfurno-data";
import { mainCategories } from "@/lib/categories";
import { QFIcon } from "@/components/QuickFurnoIcons";

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

const RF_TIMELINES: { label: string; icon: IconName }[] = [
  { label: "Within one month", icon: "bolt" },
  { label: "One – two months", icon: "clock" },
  { label: "Two – three months", icon: "clock" },
  { label: "More than three months", icon: "search" },
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
};

const inrFormatter = new Intl.NumberFormat("en-IN");

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
  const [modalOptions, setModalOptions] = useState<EnquiryModalOptions>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [locStatus, setLocStatus] = useState<"" | "locating" | "captured" | "denied" | "unsupported">("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const openModal = useCallback((options: EnquiryModalOptions = {}) => {
    const preset = presetFromCategory(options.serviceCategory);
    const presetCat = preset ? mainCategories.find((c) => c.id === preset.categoryId) ?? null : null;

    let presetService = "";
    let presetSub = "";
    if (presetCat) {
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

    setError("");
    setSuccess(false);
    setSubmitting(false);
    setShowConfirm(false);
    setLocStatus("");
    setStep(0);
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
    trackEvent("requirement_flow_started", { source: options.source ?? "Requirement flow" });
  }, []);

  const contextValue = useMemo(() => ({ openModal }), [openModal]);

  const closeModal = useCallback(() => {
    setOpen(false);
    setShowConfirm(false);
    setError("");
    setSuccess(false);
    setSubmitting(false);
    setLocStatus("");
    setStep(0);
    setModalOptions({});
    setForm(initialState);
  }, []);

  function set<K extends keyof RFState>(field: K, value: RFState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
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
    switch (target) {
      case 0:
        return form.categoryId ? null : "Select a service category.";
      case 1:
        return form.subcategory ? null : "Select an interior service.";
      case 2:
        return form.city ? null : "Please select your city.";
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
        if (form.phone.replace(/\D/g, "").length < 10) return "Please enter a valid phone number.";
        if (!form.shareConsent)
          return "Please accept sharing your details with up to 3 verified teams to continue.";
        return null;
      default:
        return null;
    }
  }

  function goNext() {
    if (step >= LAST_STEP) return;
    const err = stepError(step);
    if (err) {
      setError(err);
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
    setStep(Math.max(prev, 0));
  }

  function requestClose() {
    if (success || !hasData()) {
      closeModal();
      return;
    }
    setShowConfirm(true);
  }

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocStatus("unsupported");
      return;
    }
    setLocStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((current) => ({ ...current, lat: pos.coords.latitude, lng: pos.coords.longitude }));
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

    if (!form.name.trim() || form.phone.replace(/\D/g, "").length < 10 || !form.city || !form.serviceRequired) {
      setError("Please complete your name, a valid phone number, city and service.");
      return;
    }

    if (!form.shareConsent) {
      setError("Please accept sharing your details with up to 3 verified teams to continue.");
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
      ...readTrackingContext(),
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
            <div className="qf-rf-fields">
              <label className="qf-rf-field">
                <span>City</span>
                <select value={form.city} onChange={(e) => set("city", e.target.value)}>
                  <option value="">Select city</option>
                  {cities.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </label>
              <label className="qf-rf-field">
                <span>Area / Locality</span>
                <input
                  value={form.area}
                  onChange={(e) => set("area", e.target.value)}
                  placeholder="e.g. Kharadi, Baner"
                  autoComplete="address-level2"
                />
              </label>
              <label className="qf-rf-field">
                <span>Pincode (optional)</span>
                <input
                  value={form.pincode}
                  onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="411014"
                  inputMode="numeric"
                  autoComplete="postal-code"
                />
              </label>
              <button type="button" className="qf-rf-loc-btn" onClick={useMyLocation}>
                <QFIcon name="pin" />
                {locStatus === "locating" ? "Getting location…" : "Use my current location"}
              </button>
              {locStatus === "captured" ? (
                <p className="qf-rf-loc-note qf-rf-loc-note--ok">Location captured — we&apos;ll match teams near you.</p>
              ) : null}
              {locStatus === "denied" ? (
                <p className="qf-rf-loc-note">No problem — your city and area above are enough.</p>
              ) : null}
              {locStatus === "unsupported" ? (
                <p className="qf-rf-loc-note">Location isn&apos;t available on this device — please enter city and area.</p>
              ) : null}
            </div>
          </div>
        );
      case 3:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">{`Question ${questionNumber} of ${totalQuestions}`}</span>
            <h3 id="qf-rf-title">What is your approximate budget?</h3>
            <p className="qf-rf-qhint">Enter your expected budget range. This helps us match you with the right team.</p>
            <div className="qf-rf-fields">
              <div className="qf-rf-budget-row">
                <label className="qf-rf-field">
                  <span>Minimum budget</span>
                  <div className="qf-rf-money">
                    <span className="qf-rf-money-prefix" aria-hidden="true">₹</span>
                    <input
                      value={form.budgetMin}
                      onChange={(e) => setBudgetValue("budgetMin", e.target.value)}
                      placeholder="50000"
                      inputMode="numeric"
                      aria-label="Minimum budget in rupees"
                    />
                  </div>
                </label>
                <label className="qf-rf-field">
                  <span>Up to</span>
                  <div className="qf-rf-money">
                    <span className="qf-rf-money-prefix" aria-hidden="true">₹</span>
                    <input
                      value={form.budgetMax}
                      onChange={(e) => setBudgetValue("budgetMax", e.target.value)}
                      placeholder="300000"
                      inputMode="numeric"
                      aria-label="Maximum budget in rupees"
                    />
                  </div>
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
            <div className="qf-rf-fields">
              <label className="qf-rf-field">
                <span>Name</span>
                <input
                  ref={nameInputRef}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                />
              </label>
              <label className="qf-rf-field">
                <span>Phone number</span>
                <input
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+91"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </label>
              <label className="qf-rf-check">
                <input
                  type="checkbox"
                  checked={form.whatsappSame}
                  onChange={(e) => set("whatsappSame", e.target.checked)}
                />
                <span>WhatsApp number same as phone</span>
              </label>
              {!form.whatsappSame ? (
                <label className="qf-rf-field">
                  <span>WhatsApp number</span>
                  <input
                    value={form.whatsapp}
                    onChange={(e) => set("whatsapp", e.target.value)}
                    placeholder="+91"
                    inputMode="tel"
                  />
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
              <label className="qf-rf-check qf-rf-consent">
                <input
                  type="checkbox"
                  checked={form.shareConsent}
                  onChange={(e) => set("shareConsent", e.target.checked)}
                />
                <span>
                  I agree to share my details with up to 3 verified teams so they
                  can contact me about my requirement. See our{" "}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>{" "}
                  and{" "}
                  <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>.
                </span>
              </label>
            </div>
          </div>
        );
      default:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">Review &amp; confirm</span>
            <h3 id="qf-rf-title">Get matched with verified teams</h3>
            <p className="qf-rf-qhint">We&apos;ll connect you with verified teams near your area.</p>
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
                  <p>Your requirement is submitted. QuickFurno will connect you with verified teams shortly.</p>
                </div>
              ) : (
                <div className="qf-rf-step" key={step}>
                  {renderStep()}
                </div>
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
                {step > 0 ? (
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
