"use client";

import { FormEvent, useState } from "react";
import { categories, cities } from "@/lib/quickfurno-data";

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
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField(field: keyof LeadFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

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

    setSubmitting(true);

    // Future integration: submit this lead to /api/leads, save in Supabase leads table, trigger n8n workflow, assign to 4 active paid vendors, and send WhatsApp alerts.
    await new Promise((resolve) => setTimeout(resolve, 700));

    setSubmitting(false);
    setSuccess("Thank you. QuickFurno will match you with 4 verified vendors shortly.");
    setForm(initialState);
  }

  return (
    <form id="lead-form" className={`lead-form-card ${compact ? "lead-form-card--compact" : ""}`} onSubmit={handleSubmit}>
      <div className="form-card-header">
        <span className="eyebrow">Free client enquiry</span>
        <h2>Get matched with 4 verified vendors</h2>
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
            {categories.map((category) => (
              <option key={category.name} value={category.name}>
                {category.name}
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

      <button className="btn btn-primary form-submit" type="submit" disabled={submitting}>
        {submitting ? "Matching vendors..." : "Get 4 Verified Quotes"}
      </button>
    </form>
  );
}
