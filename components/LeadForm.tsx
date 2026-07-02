"use client";

import { FormEvent, useState } from "react";
import { submitLead } from "@/app/actions";
import { ENQUIRY_SERVICES } from "@/lib/config";
import { cities } from "@/lib/quickfurno-data";

type LeadFormState = {
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

const initialState: LeadFormState = {
  name: "",
  phone: "",
  city: "",
  serviceCategory: "",
  budgetRange: "",
  requirement: "",
};

export function LeadForm({ compact = false }: { compact?: boolean }) {
  const [form, setForm] = useState<LeadFormState>(initialState);
  const [shareConsent, setShareConsent] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField(field: keyof LeadFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

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
    if (!shareConsent) {
      setError("Please agree to share your enquiry with up to 3 verified vendors.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      city: form.city,
      service_category: form.serviceCategory,
      budget_range: form.budgetRange,
      requirement: form.requirement.trim() || undefined,
      source: compact ? "Homepage compact lead form" : "Homepage lead form",
      share_consent: shareConsent,
    };

    console.info("[lead form] submitting", {
      source: payload.source,
      city: payload.city,
      service_category: payload.service_category,
      has_budget_range: Boolean(payload.budget_range),
      has_requirement: Boolean(payload.requirement),
    });

    setSubmitting(true);
    try {
      const result = await submitLead(payload);
      if (!result.ok) {
        console.error("[lead form] submission failed", { code: result.code, error: result.error });
        setError(result.error);
        return;
      }

      console.info("[lead form] submission confirmed", {
        lead_id: result.data.id,
        is_duplicate: result.data.is_duplicate,
      });
      setSuccess("Thank you. QuickFurno will match you with 3 verified vendors shortly.");
      setForm(initialState);
      setShareConsent(false);
    } catch (err) {
      console.error("[lead form] submission error", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
      setError("We could not submit your enquiry. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form id="lead-form" className={`lead-form-card ${compact ? "lead-form-card--compact" : ""}`} onSubmit={handleSubmit}>
      <div className="form-card-header">
        <span className="eyebrow">Free client enquiry</span>
        <h2>Get matched with 3 verified vendors</h2>
        <p>Verified vendors • Fast response • No obligation</p>
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

      <div className="form-grid">
        <label>
          <span>Name</span>
          <input
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            placeholder="Your full name"
            autoComplete="name"
          />
        </label>

        <label>
          <span>Phone</span>
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
          <span>Service Category</span>
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

        <label>
          <span>Budget Range</span>
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
            rows={compact ? 3 : 4}
          />
        </label>
      </div>

      <label className="form-consent">
        <input
          type="checkbox"
          checked={shareConsent}
          onChange={(event) => setShareConsent(event.target.checked)}
        />
        <span>
          I agree that QuickFurno may share my enquiry and contact details with up to 3 verified vendors for my selected service.
        </span>
      </label>

      <button className="btn btn-primary form-submit" type="submit" disabled={submitting}>
        {submitting ? "Matching vendors..." : "Get 3 Verified Quotes"}
      </button>
    </form>
  );
}
