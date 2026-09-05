"use client";

import { useState } from "react";
import { vendorSubmitProfileChangeRequest } from "@/app/actions";
import { VendorIcon } from "../icons";
import { VendorProfileImageField, VendorProfilePortfolioField } from "./VendorProfileMedia";
import {
  ALLOWED_PROFILE_CATEGORIES,
  PROFILE_LIMITS,
  serializeList,
  splitListInput,
  type VendorPublicProfileValues,
} from "./profileModel";

/**
 * The public-profile editor.
 *
 * It is a plain <form action={vendorSubmitProfileChangeRequest}> posting the ten
 * whitelisted field names verbatim. The chip and portfolio managers exist only
 * to build nicer values for `services_offered` and `portfolio_image_urls`; both
 * serialize back into those exact fields as newline-joined text, which is what
 * the server already parses. No new contract, no JSON payload, no new action.
 *
 * Nothing here goes live. Submitting creates a pending
 * vendor_profile_change_requests row; the live vendors row is only ever written
 * by an admin approval.
 */
export function VendorProfileEditor({ current }: { current: VendorPublicProfileValues }) {
  return (
    <form action={vendorSubmitProfileChangeRequest} className="qf-vendor-v2-profile-editor">
      <Section
        title="Business identity"
        hint="How your business is named and categorised on QuickFurno."
      >
        <TextField
          name="public_business_name"
          label="Public business name"
          defaultValue={current.businessName}
          maxLength={PROFILE_LIMITS.businessName}
          hint="The name clients see on your listing."
        />

        <label className="qf-vendor-v2-profile-field">
          <span className="qf-vendor-v2-profile-label">Public category</span>
          <select
            name="public_category"
            defaultValue={current.category}
            className="qf-vendor-v2-profile-input"
          >
            <option value="">Select a category</option>
            {ALLOWED_PROFILE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <span className="qf-vendor-v2-profile-hint">
            Clients browse by category, so pick the one that matches your main work.
          </span>
        </label>
      </Section>

      <Section title="About &amp; services" hint="What you do, in your own words.">
        <DescriptionField defaultValue={current.description} />
        <ServicesField defaultValue={current.services} />
      </Section>

      <Section
        title="Pricing, hours &amp; service area"
        hint="Helps clients judge fit before they enquire."
      >
        <TextField
          name="starting_price"
          label="Starting price"
          defaultValue={current.startingPrice}
          maxLength={PROFILE_LIMITS.startingPrice}
          hint="e.g. Modular kitchens from ₹1.5L"
        />
        <TextField
          name="business_hours"
          label="Business hours"
          defaultValue={current.businessHours}
          maxLength={PROFILE_LIMITS.businessHours}
          hint="e.g. Mon–Sat, 9:30 AM–7:00 PM"
        />
        <TextField
          name="service_area_summary"
          label="Service area summary"
          defaultValue={current.serviceAreaSummary}
          maxLength={PROFILE_LIMITS.serviceAreaSummary}
          hint="e.g. Kharadi, Viman Nagar, Baner and nearby Pune areas"
        />
      </Section>

      <Section
        title="Photos &amp; portfolio"
        hint="Paste image links. QuickFurno does not host uploads yet."
      >
        <div className="qf-vendor-v2-profile-media-pair">
          <VendorProfileImageField
            name="profile_image_url"
            label="Profile photo link"
            hint="A square logo or headshot works best."
            shape="avatar"
            defaultValue={current.profileImageUrl}
          />
          <VendorProfileImageField
            name="cover_image_url"
            label="Cover photo link"
            hint="A wide banner shown at the top of your listing."
            shape="cover"
            defaultValue={current.coverImageUrl}
          />
        </div>
        <VendorProfilePortfolioField
          name="portfolio_image_urls"
          defaultValue={current.portfolioImageUrls}
        />
      </Section>

      <div className="qf-vendor-v2-profile-submit">
        <button type="submit" className="qf-vendor-v2-btn qf-vendor-v2-btn--primary">
          Submit changes for review
        </button>
        <p className="qf-vendor-v2-profile-hint">
          Your current public profile stays live until QuickFurno approves these changes.
        </p>
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="qf-vendor-v2-panel qf-vendor-v2-profile-section">
      <header className="qf-vendor-v2-profile-section-head">
        <h2 className="qf-vendor-v2-panel-title">{title}</h2>
        <p className="qf-vendor-v2-profile-section-hint">{hint}</p>
      </header>
      <div className="qf-vendor-v2-profile-section-body">{children}</div>
    </section>
  );
}

function TextField({
  name,
  label,
  defaultValue,
  maxLength,
  hint,
}: {
  name: string;
  label: string;
  defaultValue: string;
  maxLength: number;
  hint: string;
}) {
  const hintId = `qf-hint-${name}`;
  return (
    <label className="qf-vendor-v2-profile-field">
      <span className="qf-vendor-v2-profile-label">{label}</span>
      <input
        name={name}
        type="text"
        defaultValue={defaultValue}
        maxLength={maxLength}
        className="qf-vendor-v2-profile-input"
        aria-describedby={hintId}
      />
      <span className="qf-vendor-v2-profile-hint" id={hintId}>
        {hint}
      </span>
    </label>
  );
}

/** Description with a live, announced character counter. */
function DescriptionField({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const max = PROFILE_LIMITS.description;
  const remaining = max - value.length;

  return (
    <label className="qf-vendor-v2-profile-field">
      <span className="qf-vendor-v2-profile-label">Public description</span>
      <textarea
        name="public_description"
        rows={6}
        value={value}
        maxLength={max}
        onChange={(event) => setValue(event.target.value)}
        className="qf-vendor-v2-profile-input qf-vendor-v2-profile-textarea"
        aria-describedby="qf-hint-description qf-count-description"
      />
      <span className="qf-vendor-v2-profile-fieldfoot">
        <span className="qf-vendor-v2-profile-hint" id="qf-hint-description">
          Tell clients what your business specialises in and what makes your work suitable for
          their project.
        </span>
        <output
          className="qf-vendor-v2-profile-count"
          id="qf-count-description"
          aria-live="polite"
          data-low={remaining <= 50 ? "true" : undefined}
        >
          {value.length} / {max}
        </output>
      </span>
    </label>
  );
}

/**
 * Services chip editor.
 *
 * Entries are split on comma as well as newline, because the server does the
 * same — typing "Kitchens, wardrobes" would otherwise show as one chip here and
 * arrive as two services there.
 */
function ServicesField({ defaultValue }: { defaultValue: string[] }) {
  const [services, setServices] = useState<string[]>(defaultValue);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const full = services.length >= PROFILE_LIMITS.maxServices;

  function add() {
    const parts = splitListInput(draft);
    if (parts.length === 0) return;

    const next = services.slice();
    let rejected: string | null = null;
    for (const part of parts) {
      if (next.length >= PROFILE_LIMITS.maxServices) {
        rejected = `You can list up to ${PROFILE_LIMITS.maxServices} services.`;
        break;
      }
      const value = part.slice(0, PROFILE_LIMITS.serviceLength);
      if (next.some((item) => item.toLowerCase() === value.toLowerCase())) {
        rejected = `"${value}" is already listed.`;
        continue;
      }
      next.push(value);
    }

    setServices(next);
    setDraft("");
    setError(rejected);
  }

  return (
    <div className="qf-vendor-v2-profile-field">
      {/* The exact contract field, newline-joined. */}
      <input type="hidden" name="services_offered" value={serializeList(services)} />

      <div className="qf-vendor-v2-profile-labelrow">
        <span className="qf-vendor-v2-profile-label" id="qf-services-label">
          Services offered
        </span>
        <span className="qf-vendor-v2-profile-count">
          {services.length} / {PROFILE_LIMITS.maxServices}
        </span>
      </div>

      {services.length > 0 ? (
        <ul className="qf-vendor-v2-profile-chips" aria-labelledby="qf-services-label">
          {services.map((service) => (
            <li key={service} className="qf-vendor-v2-profile-chip">
              <span>{service}</span>
              <button
                type="button"
                aria-label={`Remove ${service}`}
                onClick={() => setServices((current) => current.filter((item) => item !== service))}
              >
                <VendorIcon name="close" size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="qf-vendor-v2-profile-chipadd">
        <input
          type="text"
          value={draft}
          disabled={full}
          maxLength={PROFILE_LIMITS.serviceLength}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder={full ? "Maximum services added" : "e.g. Modular kitchens"}
          className="qf-vendor-v2-profile-input"
          aria-describedby="qf-services-help"
        />
        <button
          type="button"
          className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet"
          onClick={add}
          disabled={full || draft.trim().length === 0}
        >
          Add
        </button>
      </div>

      <p className="qf-vendor-v2-profile-hint" id="qf-services-help" role={error ? "alert" : undefined}>
        {error ?? "Press Enter to add. Up to 12 services, 80 characters each."}
      </p>
    </div>
  );
}
