"use client";

import { FormEvent, useState } from "react";
import { submitVendorRegistration } from "@/app/actions";
import { SERVICES } from "@/lib/config";
import GooglePlaceAutocomplete from "@/components/location/GooglePlaceAutocomplete";
import { isPlaceCompatibleWithSelectedCity } from "@/lib/google-maps/normalizePlace";
import type { NormalizedGooglePlace } from "@/lib/google-maps/types";
import { useActiveCities } from "@/lib/locations/useActiveCities";

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
  const [selectedPlace, setSelectedPlace] = useState<NormalizedGooglePlace | null>(null);
  const { cities: activeCities, records: activeCityRecords } = useActiveCities();

  function updateField(field: keyof VendorFormState, value: string) {
    if (field === "address" || field === "city") setSelectedPlace(null);
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectGoogleOffice(place: NormalizedGooglePlace) {
    const city = activeCityRecords.find((item) => item.name.toLowerCase() === form.city.toLowerCase());
    const labels = city?.acceptedCityLabels ?? [form.city];
    if (!form.city || !isPlaceCompatibleWithSelectedCity(place, form.city, labels) ||
      !place.placeId || !place.city || !place.formattedAddress || place.lat == null || place.lng == null) {
      setSelectedPlace(null);
      setError("Choose an exact Google Places address inside your selected city.");
      return;
    }
    setSelectedPlace(place);
    setForm((current) => ({ ...current, address: place.formattedAddress ?? "" }));
    setError("");
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
    if (!selectedPlace?.placeId || !selectedPlace.city || !selectedPlace.formattedAddress ||
      selectedPlace.lat == null || selectedPlace.lng == null) {
      setError("Select your business address from Google Places suggestions before applying.");
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
        // Captured for Core admin review only: not matching authority at signup.
        google_place_id: selectedPlace.placeId,
        google_city: selectedPlace.city,
        formatted_address: selectedPlace.formattedAddress,
        office_latitude: selectedPlace.lat,
        office_longitude: selectedPlace.lng,
        area_normalized: selectedPlace.areaNormalized ?? undefined,
        sublocality: selectedPlace.sublocality ?? undefined,
        neighborhood: selectedPlace.neighborhood ?? undefined,
        service_categories: [form.serviceCategory],
        experience: form.experience.trim() || undefined,
        portfolio_urls: form.projectImage.trim() ? [form.projectImage.trim()] : [],
        message: messageParts.join("\n") || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setSuccess("Vendor application received. Your Google-selected business location is pending Core verification.");
      setForm(initialVendorForm);
      setSelectedPlace(null);
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
            {activeCities.map((city) => <option key={city} value={city}>{city}</option>)}
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
          <span>Exact Google business / office location</span>
          <GooglePlaceAutocomplete
            value={form.address}
            city={form.city}
            mode="address"
            onManualChange={(value) => updateField("address", value)}
            onPlaceSelected={selectGoogleOffice}
            disabled={!form.city}
            placeholder={form.city ? "Search building, shop, society or street" : "Select your city first"}
          />
          <small>{selectedPlace?.placeId ? "Google location selected; Core verification pending." : "Select a Google suggestion. Typed addresses are not verified."}</small>
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
