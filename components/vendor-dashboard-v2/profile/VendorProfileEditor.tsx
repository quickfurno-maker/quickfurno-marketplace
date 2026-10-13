"use client";

import { useState } from "react";
import { vendorSubmitProfileChangeRequest } from "@/app/actions";
import { VendorProfileImageField, VendorProfilePortfolioField } from "./VendorProfileMedia";
import {
  PROFILE_LIMITS,
  type VendorPublicProfileValues,
} from "./profileModel";

/**
 * The public-profile editor.
 *
 * Public descriptions, prices, hours, and approved media links may be
 * proposed here. Matching-sensitive category and services changes are routed
 * to the separately governed service-coverage review below.
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

        <div className="qf-vendor-v2-profile-field">
          <span className="qf-vendor-v2-profile-label">Approved category</span>
          <p className="qf-vendor-v2-profile-hint">{current.category || "Not set"}</p>
          <a href="#qf-vendor-service-coverage" className="qf-vendor-v2-profile-hint">
            Request a category or service coverage change through separate Core review
          </a>
        </div>
      </Section>

      <Section title="About &amp; services" hint="What you do, in your own words.">
        <DescriptionField defaultValue={current.description} />
        <div className="qf-vendor-v2-profile-field">
          <span className="qf-vendor-v2-profile-label">Approved services</span>
          <p className="qf-vendor-v2-profile-hint">{current.services.length ? current.services.join(", ") : "Not set"}</p>
          <p className="qf-vendor-v2-profile-hint">To change matching services, submit a service coverage request below.</p>
        </div>
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
