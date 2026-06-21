"use client";

import {
  ButtonHTMLAttributes,
  FormEvent,
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
import { ENQUIRY_SERVICES, trackEvent } from "@/lib/config";
import { cities } from "@/lib/quickfurno-data";

type EnquiryFormState = {
  name: string;
  phone: string;
  city: string;
  serviceCategory: string;
  budgetRange: string;
  requirement: string;
};

const budgetOptions = [
  "Below ₹1 lakh",
  "₹1–3 lakh",
  "₹3–5 lakh",
  "₹5–10 lakh",
  "Above ₹10 lakh",
  "Not sure yet",
];

const initialState: EnquiryFormState = {
  name: "",
  phone: "",
  city: "",
  serviceCategory: "",
  budgetRange: "",
  requirement: "",
};

const OPEN_EVENT = "quickfurno:open-enquiry-modal";

type EnquiryModalContextValue = {
  openModal: () => void;
};

const EnquiryModalContext = createContext<EnquiryModalContextValue | null>(null);

export function EnquiryModalTrigger({
  children,
  type = "button",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useContext(EnquiryModalContext);

  return (
    <button
      {...props}
      type={type}
      data-enquiry-modal-trigger
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;

        if (context) {
          context.openModal();
          return;
        }

        window.dispatchEvent(new Event(OPEN_EVENT));
      }}
    >
      {children}
    </button>
  );
}

export function EnquiryModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EnquiryFormState>(initialState);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const openModal = useCallback(() => {
    setError("");
    setSuccess("");
    setSubmitting(false);
    setOpen(true);
  }, []);

  const contextValue = useMemo(() => ({ openModal }), [openModal]);

  function closeModal() {
    setOpen(false);
    setError("");
    setSuccess("");
    setSubmitting(false);
    setForm(initialState);
  }

  function updateField(field: keyof EnquiryFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const trigger = target.closest<HTMLElement>("[data-enquiry-modal-trigger]");
      if (!trigger) return;

      event.preventDefault();
      openModal();
    };

    window.addEventListener(OPEN_EVENT, openModal);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener(OPEN_EVENT, openModal);
      document.removeEventListener("click", onClick);
    };
  }, [openModal]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => nameInputRef.current?.focus(), 80);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.name.trim() || !form.phone.trim() || !form.city || !form.serviceCategory || !form.budgetRange) {
      setError("Please fill name, phone, city, service category and budget range.");
      return;
    }

    if (form.phone.replace(/\D/g, "").length < 10) {
      setError("Please enter a valid 10 digit phone number.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      city: form.city,
      service_category: form.serviceCategory,
      budget_range: form.budgetRange,
      requirement: form.requirement.trim() || undefined,
      source: "Homepage enquiry popup",
    };

    setSubmitting(true);
    try {
      const result = await submitLead(payload);
      if (!result.ok) {
        console.error("[enquiry modal] submission failed", { code: result.code, error: result.error });
        setError(result.error);
        return;
      }

      trackEvent("lead_submit", { source: "homepage_popup", service: payload.service_category });
      setSuccess("Thank you! Your enquiry has been received. Our team will connect you with matched studios shortly.");
      setForm(initialState);
    } catch (err) {
      console.error("[enquiry modal] submission error", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
      setError("We could not submit your enquiry. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <EnquiryModalContext.Provider value={contextValue}>
      {children}
      {open ? (
        <div
          className="enquiry-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <section
            className="enquiry-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="enquiry-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="enquiry-modal-close"
              aria-label="Close enquiry form"
              onClick={closeModal}
            >
              ×
            </button>

            <div className="form-card-header enquiry-modal-header">
              <span className="eyebrow">Free client enquiry</span>
              <h2 id="enquiry-modal-title">Get free interior quotes</h2>
              <p>Share your requirement. We&apos;ll match you with up to 4 verified studios in Pune & Mumbai.</p>
            </div>

            {error ? (
              <p className="form-alert form-alert--error" role="alert">
                {error}
              </p>
            ) : null}
            {success ? (
              <p className="form-alert form-alert--success" role="status">
                {success}
              </p>
            ) : null}

            {!success ? (
              <form className="enquiry-modal-form" onSubmit={handleSubmit}>
                <div className="form-grid">
                  <label>
                    <span>Full name</span>
                    <input
                      ref={nameInputRef}
                      value={form.name}
                      onChange={(event) => updateField("name", event.target.value)}
                      placeholder="Your full name"
                      autoComplete="name"
                    />
                  </label>

                  <label>
                    <span>Phone number</span>
                    <input
                      value={form.phone}
                      onChange={(event) => updateField("phone", event.target.value)}
                      placeholder="+91"
                      inputMode="tel"
                      autoComplete="tel"
                    />
                  </label>

                  <label>
                    <span>City</span>
                    <select value={form.city} onChange={(event) => updateField("city", event.target.value)}>
                      <option value="">Select city</option>
                      {cities.map((city) => (
                        <option key={city} value={city}>
                          {city}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Service required</span>
                    <select
                      value={form.serviceCategory}
                      onChange={(event) => updateField("serviceCategory", event.target.value)}
                    >
                      <option value="">Select service</option>
                      {ENQUIRY_SERVICES.map((service) => (
                        <option key={service} value={service}>
                          {service}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-grid-full">
                    <span>Budget range</span>
                    <select value={form.budgetRange} onChange={(event) => updateField("budgetRange", event.target.value)}>
                      <option value="">Select budget</option>
                      {budgetOptions.map((budget) => (
                        <option key={budget} value={budget}>
                          {budget}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-grid-full">
                    <span>Requirement</span>
                    <textarea
                      value={form.requirement}
                      onChange={(event) => updateField("requirement", event.target.value)}
                      placeholder="Tell us about your home project, location and timeline."
                      rows={3}
                    />
                  </label>
                </div>

                <button className="btn btn-primary form-submit" type="submit" disabled={submitting}>
                  {submitting ? "Submitting..." : "Submit Enquiry"}
                </button>
                <p className="enquiry-modal-trust">
                  Your details are shared only with matched verified studios. No spam. No resold leads.
                </p>
              </form>
            ) : (
              <button className="btn btn-primary form-submit" type="button" onClick={closeModal}>
                Close
              </button>
            )}
          </section>
        </div>
      ) : null}
    </EnquiryModalContext.Provider>
  );
}
