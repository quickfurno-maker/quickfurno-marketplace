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
import { cities } from "@/lib/quickfurno-data";
import { QFIcon } from "@/components/QuickFurnoIcons";

// ---------------------------------------------------------------------------
// "Requirement First" guided multi-step enquiry flow.
// One question per screen, Typeform-style, mapped to the SAME lead fields the
// backend already expects (submitLead / leadService.createLead). No Supabase,
// type, or API changes — the GPS coordinates and extra context fold into the
// existing `requirement` text field.
// ---------------------------------------------------------------------------

type IconName = Parameters<typeof QFIcon>[0]["name"];

type NeedTile = {
  id: string;
  label: string;
  icon: IconName;
  micro: string;
  /** Canonical service used for lead↔vendor matching (must match lib/config SERVICES). */
  service: string;
};

type ProjectTile = { label: string; service: string; icon: IconName };

// Step 1 — broad need. `service` is the safe canonical fallback for matching.
const NEEDS: NeedTile[] = [
  { id: "interiors", label: "Interiors", icon: "home", micro: "Design & turnkey homes", service: "Full Home Interior" },
  { id: "carpentry", label: "Carpentry", icon: "hammer", micro: "Wardrobes & woodwork", service: "Carpentry" },
  { id: "sofa", label: "Sofa", icon: "sofa", micro: "Custom sofas & upholstery", service: "Custom Sofa & Upholstery" },
  { id: "painting", label: "Painting", icon: "paint", micro: "Interior & exterior", service: "Painting" },
  { id: "civil", label: "Civil Work", icon: "civil", micro: "Renovation & masonry", service: "Home Renovation" },
  { id: "modular-kitchen", label: "Modular Kitchen", icon: "kitchen", micro: "Smart modular kitchens", service: "Modular Kitchen" },
  { id: "wardrobe", label: "Wardrobe", icon: "wardrobe", micro: "Fitted wardrobes", service: "Wardrobe" },
  { id: "other", label: "Other", icon: "more", micro: "Something else", service: "Other" },
];

// Step 2 — project type per need. Each maps back to a canonical service.
const PROJECT_TYPES: Record<string, ProjectTile[]> = {
  interiors: [
    { label: "Full Home Interior", service: "Full Home Interior", icon: "home" },
    { label: "Modular Kitchen", service: "Modular Kitchen", icon: "kitchen" },
    { label: "Wardrobe", service: "Wardrobe", icon: "wardrobe" },
    { label: "Living Room", service: "Full Home Interior", icon: "sofa" },
    { label: "Turnkey Interior", service: "Full Home Interior", icon: "grid" },
  ],
  carpentry: [
    { label: "Custom Furniture", service: "Custom Furniture", icon: "hammer" },
    { label: "Wardrobe", service: "Wardrobe", icon: "wardrobe" },
    { label: "TV Unit", service: "Custom Furniture", icon: "grid" },
    { label: "Kitchen Cabinet", service: "Modular Kitchen", icon: "kitchen" },
    { label: "Repair Work", service: "Carpentry", icon: "reno" },
  ],
  sofa: [
    { label: "New Sofa", service: "Custom Sofa & Upholstery", icon: "sofa" },
    { label: "Custom Sofa", service: "Custom Sofa & Upholstery", icon: "sofa" },
    { label: "Recliner", service: "Custom Sofa & Upholstery", icon: "sofa" },
    { label: "Sofa Repair", service: "Custom Sofa & Upholstery", icon: "reno" },
    { label: "Upholstery", service: "Custom Sofa & Upholstery", icon: "tag" },
  ],
  painting: [
    { label: "Interior Painting", service: "Painting", icon: "paint" },
    { label: "Exterior Painting", service: "Painting", icon: "paint" },
    { label: "Texture Wall", service: "Painting", icon: "paint" },
    { label: "Waterproofing", service: "Painting", icon: "pipe" },
    { label: "Touch-up / Repair", service: "Painting", icon: "reno" },
  ],
  civil: [
    { label: "Home Renovation", service: "Home Renovation", icon: "reno" },
    { label: "Bathroom Renovation", service: "Home Renovation", icon: "pipe" },
    { label: "Tiling / Flooring", service: "Home Renovation", icon: "floor" },
    { label: "Masonry Work", service: "Home Renovation", icon: "civil" },
    { label: "Structural Work", service: "Home Renovation", icon: "civil" },
  ],
  "modular-kitchen": [
    { label: "New Modular Kitchen", service: "Modular Kitchen", icon: "kitchen" },
    { label: "L-Shaped Kitchen", service: "Modular Kitchen", icon: "kitchen" },
    { label: "U-Shaped Kitchen", service: "Modular Kitchen", icon: "kitchen" },
    { label: "Parallel Kitchen", service: "Modular Kitchen", icon: "kitchen" },
    { label: "Island Kitchen", service: "Modular Kitchen", icon: "kitchen" },
  ],
  wardrobe: [
    { label: "Sliding Wardrobe", service: "Wardrobe", icon: "wardrobe" },
    { label: "Hinged Wardrobe", service: "Wardrobe", icon: "wardrobe" },
    { label: "Walk-in Wardrobe", service: "Wardrobe", icon: "wardrobe" },
    { label: "Loft / Storage", service: "Wardrobe", icon: "grid" },
    { label: "Repair / Rework", service: "Wardrobe", icon: "reno" },
  ],
  other: [
    { label: "General Enquiry", service: "Other", icon: "more" },
    { label: "Repair", service: "Other", icon: "reno" },
    { label: "Installation", service: "Other", icon: "grid" },
    { label: "Consultation", service: "Other", icon: "chat" },
    { label: "Something Else", service: "Other", icon: "more" },
  ],
};

const RF_BUDGETS = [
  "Under ₹50,000",
  "₹50,000 – ₹1 lakh",
  "₹1 lakh – ₹3 lakh",
  "₹3 lakh – ₹5 lakh",
  "₹5 lakh+",
  "Not sure yet",
];

const RF_TIMELINES: { label: string; icon: IconName }[] = [
  { label: "Immediately", icon: "bolt" },
  { label: "This week", icon: "clock" },
  { label: "This month", icon: "clock" },
  { label: "Just exploring", icon: "search" },
];

const PHASES = ["Need", "Details", "Match"] as const;
const LAST_STEP = 6; // 0..5 questions + 6 = match/summary
const PHASE_PERCENT = [33, 66, 100];

type RFState = {
  needId: string;
  needLabel: string;
  projectType: string;
  serviceRequired: string;
  city: string;
  area: string;
  pincode: string;
  budget: string;
  timeline: string;
  name: string;
  phone: string;
  whatsappSame: boolean;
  whatsapp: string;
  message: string;
  lat: number | null;
  lng: number | null;
};

const initialState: RFState = {
  needId: "",
  needLabel: "",
  projectType: "",
  serviceRequired: "",
  city: "",
  area: "",
  pincode: "",
  budget: "",
  timeline: "",
  name: "",
  phone: "",
  whatsappSame: true,
  whatsapp: "",
  message: "",
  lat: null,
  lng: null,
};

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

/** Best-effort map of a category/service string to a Need tile id (pre-selects step 1). */
function needFromCategory(value?: string): string | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes("paint")) return "painting";
  if (v.includes("sofa") || v.includes("uphol")) return "sofa";
  if (v.includes("modular") || v.includes("kitchen")) return "modular-kitchen";
  if (v.includes("wardrobe")) return "wardrobe";
  if (v.includes("carpen") || v.includes("furniture")) return "carpentry";
  if (v.includes("civil") || v.includes("renovat")) return "civil";
  if (v.includes("interior") || v.includes("ceiling") || v.includes("turnkey")) return "interiors";
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
    const presetNeedId = needFromCategory(options.serviceCategory);
    const presetNeed = NEEDS.find((n) => n.id === presetNeedId) ?? null;

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
      needId: presetNeed?.id ?? "",
      needLabel: presetNeed?.label ?? "",
      serviceRequired: presetNeed?.service ?? "",
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

  function selectNeed(need: NeedTile) {
    setForm((current) =>
      current.needId === need.id
        ? current
        : {
            ...current,
            needId: need.id,
            needLabel: need.label,
            serviceRequired: need.service,
            projectType: "", // options depend on the need — reset on change
          },
    );
  }

  function selectProjectType(tile: ProjectTile) {
    setForm((current) => ({ ...current, projectType: tile.label, serviceRequired: tile.service }));
  }

  function hasData() {
    return Boolean(
      form.needId ||
        form.projectType ||
        form.city ||
        form.area ||
        form.pincode ||
        form.budget ||
        form.timeline ||
        form.name ||
        form.phone ||
        form.message ||
        (!form.whatsappSame && form.whatsapp),
    );
  }

  function isStepValid(target: number) {
    switch (target) {
      case 0:
        return Boolean(form.needId);
      case 1:
        return Boolean(form.projectType);
      case 2:
        return Boolean(form.city);
      case 3:
        return Boolean(form.budget);
      case 4:
        return Boolean(form.timeline);
      case 5:
        return form.name.trim().length > 1 && form.phone.replace(/\D/g, "").length >= 10;
      default:
        return true;
    }
  }

  function goNext() {
    if (!isStepValid(step) || step >= LAST_STEP) return;
    trackEvent("requirement_step_completed", { step: step + 1, phase: PHASES[phaseFor(step)] });
    setError("");
    setStep((s) => Math.min(s + 1, LAST_STEP));
  }

  function goBack() {
    setError("");
    setStep((s) => Math.max(s - 1, 0));
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

    const requirementParts = [
      form.needLabel ? `Need: ${form.needLabel}` : "",
      form.projectType ? `Project type: ${form.projectType}` : "",
      form.pincode ? `Pincode: ${form.pincode}` : "",
      form.whatsappSame ? "WhatsApp: same as phone" : form.whatsapp ? `WhatsApp: ${form.whatsapp}` : "",
      form.message.trim() ? `Notes: ${form.message.trim()}` : "",
      form.lat != null && form.lng != null ? `GPS: ${form.lat.toFixed(5)}, ${form.lng.toFixed(5)}` : "",
    ].filter(Boolean);

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      city: form.city,
      area: form.area.trim() || undefined,
      service_category: form.serviceRequired,
      budget_range: form.budget || undefined,
      timeline: form.timeline || undefined,
      requirement: requirementParts.join(" | ") || undefined,
      source: modalOptions.source ?? "Requirement flow",
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
  const projectOptions = PROJECT_TYPES[form.needId] ?? [];

  function renderStep() {
    switch (step) {
      case 0:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">Question 1 of 6</span>
            <h3 id="qf-rf-title">What service do you need?</h3>
            <p className="qf-rf-qhint">Pick the category closest to your project.</p>
            <div className="qf-rf-tiles">
              {NEEDS.map((need) => {
                const selected = form.needId === need.id;
                return (
                  <button
                    type="button"
                    key={need.id}
                    className={`qf-rf-tile${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => selectNeed(need)}
                  >
                    <span className="qf-rf-tile-icon">
                      <QFIcon name={need.icon} />
                    </span>
                    <span className="qf-rf-tile-label">{need.label}</span>
                    <small className="qf-rf-tile-micro">{need.micro}</small>
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
            <span className="qf-rf-qcount">Question 2 of 6</span>
            <h3 id="qf-rf-title">What type of work are you planning?</h3>
            <p className="qf-rf-qhint">For {form.needLabel || "your project"}.</p>
            <div className="qf-rf-tiles">
              {projectOptions.map((tile) => {
                const selected = form.projectType === tile.label;
                return (
                  <button
                    type="button"
                    key={tile.label}
                    className={`qf-rf-tile${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => selectProjectType(tile)}
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
      case 2:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">Question 3 of 6</span>
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
                <p className="qf-rf-loc-note qf-rf-loc-note--ok">Location captured — we&apos;ll match vendors near you.</p>
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
            <span className="qf-rf-qcount">Question 4 of 6</span>
            <h3 id="qf-rf-title">What is your approximate budget?</h3>
            <div className="qf-rf-chips">
              {RF_BUDGETS.map((budget) => {
                const selected = form.budget === budget;
                return (
                  <button
                    type="button"
                    key={budget}
                    className={`qf-rf-chip${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => set("budget", budget)}
                  >
                    {budget}
                  </button>
                );
              })}
            </div>
          </div>
        );
      case 4:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">Question 5 of 6</span>
            <h3 id="qf-rf-title">When do you want to start?</h3>
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
            <span className="qf-rf-qcount">Question 6 of 6</span>
            <h3 id="qf-rf-title">Where should vendors contact you?</h3>
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
                  placeholder="Anything else vendors should know?"
                  rows={3}
                />
              </label>
            </div>
          </div>
        );
      default:
        return (
          <div className="qf-rf-question">
            <span className="qf-rf-qcount">Review &amp; confirm</span>
            <h3 id="qf-rf-title">Get matched with verified vendors</h3>
            <p className="qf-rf-qhint">We&apos;ll connect you with verified professionals near your area.</p>
            <dl className="qf-rf-summary">
              <div>
                <dt>Service</dt>
                <dd>{form.needLabel || "—"}</dd>
              </div>
              <div>
                <dt>Project type</dt>
                <dd>{form.projectType || "—"}</dd>
              </div>
              <div>
                <dt>Area</dt>
                <dd>{[form.area, form.city].filter(Boolean).join(", ") || form.city || "—"}</dd>
              </div>
              <div>
                <dt>Budget</dt>
                <dd>{form.budget || "—"}</dd>
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
                <span className="qf-rf-flow-name">Get Matched With Verified Vendors</span>
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
                  <p>Your requirement is submitted. QuickFurno will connect you with verified vendors shortly.</p>
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
                  <button
                    type="button"
                    className="qf-rf-btn qf-rf-btn--primary"
                    disabled={!isStepValid(step)}
                    onClick={goNext}
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="button"
                    className="qf-rf-btn qf-rf-btn--primary"
                    disabled={submitting}
                    onClick={handleSubmit}
                  >
                    {submitting ? "Submitting…" : "Get Matched With Vendors"}
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
