"use client";

import { FormEvent, useState } from "react";
import { submitVendorRegistration } from "@/app/actions";
import { SERVICES } from "@/lib/config";
import { cities } from "@/lib/quickfurno-data";

type VendorFormState = {
  businessName: string;
  ownerName: string;
  phone: string;
  whatsappNumber: string;
  city: string;
  serviceCategory: string;
  subCategory: string;
  ratePerSqft: string;
  experience: string;
  address: string;
  projectImage: string;
  message: string;
};

const initialVendorForm: VendorFormState = {
  businessName: "",
  ownerName: "",
  phone: "",
  whatsappNumber: "",
  city: "",
  serviceCategory: "",
  subCategory: "",
  ratePerSqft: "",
  experience: "",
  address: "",
  projectImage: "",
  message: "",
};

export function VendorApplicationForm() {
  const [form, setForm] = useState<VendorFormState>(initialVendorForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField(field: keyof VendorFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError("");
    setSuccess("");

    if (!form.businessName.trim() || !form.ownerName.trim() || !form.phone.trim() || !form.city || !form.serviceCategory) {
      setError("Please fill business name, owner name, phone, city and service category.");
      return;
    }

    if (form.phone.replace(/\D/g, "").length < 10) {
      setError("Please enter a valid 10 digit phone number.");
      return;
    }

    setSubmitting(true);
    const messageParts = [
      form.whatsappNumber.trim() ? `WhatsApp number: ${form.whatsappNumber.trim()}` : "",
      form.subCategory.trim() ? `Sub-category: ${form.subCategory.trim()}` : "",
      form.ratePerSqft.trim() ? `Rate per sq.ft: ${form.ratePerSqft.trim()}` : "",
      form.address.trim() ? `Address: ${form.address.trim()}` : "",
      form.message.trim() ? `Message: ${form.message.trim()}` : "",
    ].filter(Boolean);

    try {
      const result = await submitVendorRegistration({
        business_name: form.businessName.trim(),
        owner_name: form.ownerName.trim(),
        phone: form.phone.trim(),
        city: form.city,
        service_categories: [form.serviceCategory],
        experience: form.experience.trim() || undefined,
        portfolio_urls: form.projectImage.trim() ? [form.projectImage.trim()] : [],
        message: messageParts.join("\n") || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setSuccess("Vendor application received. QuickFurno will review your profile and contact you shortly.");
      setForm(initialVendorForm);
    } catch (err) {
      console.error("[vendor application form] submission error", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
      setError("Unable to submit right now. Please check your internet connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="vendor-application-form reveal-card" onSubmit={handleSubmit}>
      <div className="form-card-header">
        <span className="eyebrow">Vendor onboarding</span>
        <h2>Submit Vendor Application</h2>
        <p>Apply for verification and lead package access.</p>
      </div>

      {error ? <p className="form-alert form-alert--error" role="alert">{error}</p> : null}
      {success ? <p className="form-alert form-alert--success" role="status">{success}</p> : null}

      <div className="form-grid">
        <label>
          <span>Business Name</span>
          <input value={form.businessName} onChange={(event) => updateField("businessName", event.target.value)} />
        </label>
        <label>
          <span>Owner Name</span>
          <input value={form.ownerName} onChange={(event) => updateField("ownerName", event.target.value)} />
        </label>
        <label>
          <span>Phone</span>
          <input value={form.phone} onChange={(event) => updateField("phone", event.target.value)} inputMode="tel" />
        </label>
        <label>
          <span>WhatsApp Number</span>
          <input value={form.whatsappNumber} onChange={(event) => updateField("whatsappNumber", event.target.value)} inputMode="tel" />
        </label>
        <label>
          <span>City</span>
          <select value={form.city} onChange={(event) => updateField("city", event.target.value)}>
            <option value="">Select city</option>
            {cities.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>
        </label>
        <label>
          <span>Service Category</span>
          <select value={form.serviceCategory} onChange={(event) => updateField("serviceCategory", event.target.value)}>
            <option value="">Select category</option>
            {SERVICES.map((service) => <option key={service} value={service}>{service}</option>)}
          </select>
        </label>
        <label>
          <span>Sub-category</span>
          <input value={form.subCategory} onChange={(event) => updateField("subCategory", event.target.value)} placeholder="Kitchen, wardrobe, texture paint..." />
        </label>
        <label>
          <span>Rate per sq.ft</span>
          <input value={form.ratePerSqft} onChange={(event) => updateField("ratePerSqft", event.target.value)} placeholder="Example: ₹1,250/sq.ft" />
        </label>
        <label>
          <span>Years of Experience</span>
          <input value={form.experience} onChange={(event) => updateField("experience", event.target.value)} />
        </label>
        <label>
          <span>Project Image Upload Placeholder</span>
          <input value={form.projectImage} onChange={(event) => updateField("projectImage", event.target.value)} placeholder="Future upload URL or file picker" />
        </label>
        <label className="form-grid-full">
          <span>Address</span>
          <input value={form.address} onChange={(event) => updateField("address", event.target.value)} />
        </label>
        <label className="form-grid-full">
          <span>Message</span>
          <textarea value={form.message} onChange={(event) => updateField("message", event.target.value)} rows={4} />
        </label>
      </div>

      <button type="submit" className="btn btn-primary form-submit" disabled={submitting}>
        {submitting ? "Submitting..." : "Submit Vendor Application"}
      </button>
    </form>
  );
}
