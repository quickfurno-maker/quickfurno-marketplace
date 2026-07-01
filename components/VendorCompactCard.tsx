"use client";

import Image from "next/image";
import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { FreeVendorInterestButton } from "@/components/FreeVendorInterestButton";
import { useVendorCompare } from "@/components/VendorCompare";
import { CONTACT_TEL, whatsappLink } from "@/lib/config";
import {
  enquiryServiceForCategory,
  getVendorListingMeta,
  getVendorPortfolio,
  getVendorTrust,
  type Vendor,
} from "@/lib/quickfurno-data";

export function VendorCompactCard({
  vendor,
  priority = false,
  showCategory = false,
}: {
  vendor: Vendor;
  priority?: boolean;
  showCategory?: boolean;
}) {
  const meta = getVendorListingMeta(vendor);
  const trust = getVendorTrust(vendor);
  const portfolio = getVendorPortfolio(vendor);
  const enquiryService = enquiryServiceForCategory(vendor.category);
  const profileHref = `/vendors/${vendor.slug}`;

  const compare = useVendorCompare();
  const selectedForCompare = compare?.isSelected(vendor.slug) ?? false;

  const thumbnailSrc = portfolio[0] || "/assets/quickfurno/images/hero/hero-interior-diorama.svg";

  // Availability text: "Available today" only if existing data supports it, otherwise "Quick response expected"
  const isOpen = /available\s+today|open/i.test(meta.openStatus);
  const availabilityText = isOpen ? "Available today" : "Quick response expected";

  // Starting rate: Price on request if missing
  const startingRateDisplay = trust.startingPrice.replace("Starting at", "").trim();
  const startingRateText = startingRateDisplay || "Price on request";
  const isPaidOrTrialEligible = vendor.activePaidPlan;

  return (
    <article className={`qf-vcard${vendor.activePaidPlan ? " qf-vcard--premium" : ""}`}>
      <div className="qf-vcard-main">
        {/* Left: Image Thumbnail */}
        <div className="qf-vcard-thumb-container">
          <Link href={profileHref} className="qf-vcard-thumb-link" aria-label={`View ${vendor.businessName} profile`}>
            <Image
              src={thumbnailSrc}
              alt={`${vendor.businessName} thumbnail`}
              fill
              sizes="(max-width: 759px) 92px, 110px"
              className="qf-vcard-thumb-img"
              priority={priority}
            />
          </Link>
        </div>

        {/* Right: Vendor Details */}
        <div className="qf-vcard-info-container">
          {/* Vendor name */}
          <h3 className="qf-vcard-title">
            <Link href={profileHref}>{vendor.businessName}</Link>
          </h3>

          {/* Verified & Category Row */}
          <div className="qf-vcard-meta-row">
            {vendor.verified && (
              <span className="qf-vcard-verified-badge" title="Business details reviewed & verified">
                Verified ✓
              </span>
            )}
            {vendor.verified && <span className="qf-vcard-bullet">·</span>}
            <span className="qf-vcard-category-text">
              {showCategory ? `${vendor.category} · ` : ""}
              {vendor.subCategory}
            </span>
          </div>

          {/* Rating + Reviews */}
          <div className="qf-vcard-rating-row">
            <span className="qf-vcard-rating-stars">
              {trust.ratingLabel} ★
            </span>
            <span className="qf-vcard-bullet">·</span>
            <span className="qf-vcard-reviews-count">
              {vendor.reviews > 0 ? `${vendor.reviews} reviews` : "Reviews coming soon"}
            </span>
          </div>

          {/* Area/city + distance */}
          <div className="qf-vcard-locality-row">
            <span>{meta.locality}</span>
            {meta.distance && (
              <>
                <span className="qf-vcard-bullet">·</span>
                <span>{meta.distance}</span>
              </>
            )}
          </div>

          {/* Availability + Trust compact line */}
          <div className="qf-vcard-status-row">
            <span>{availabilityText}</span>
            <span className="qf-vcard-bullet">·</span>
            <span>Fast response</span>
            {vendor.verified && (
              <>
                <span className="qf-vcard-bullet">·</span>
                <span>Profile verified</span>
              </>
            )}
          </div>

          {/* Starting rate */}
          <div className="qf-vcard-price-row">
            <span className="qf-vcard-price-label">Starting rate: </span>
            <strong className="qf-vcard-price-value">{startingRateText}</strong>
          </div>
        </div>
      </div>

      {/* Bottom/Right: Action Buttons */}
      <div className="qf-vcard-actions-row">
        <div className="qf-vcard-main-buttons">
          {isPaidOrTrialEligible ? (
            <>
              <a className="qf-vcard-action-btn qf-vcard-action-btn--call" href={CONTACT_TEL}>
                Call Now
              </a>
              <EnquiryModalTrigger
                className="qf-vcard-action-btn qf-vcard-action-btn--enquiry"
                modalTitle={`Get quote from ${vendor.businessName}`}
                serviceCategory={enquiryService}
                city={vendor.city}
                area={meta.locality.split(",")[0]}
                requirement={`I want a quote from ${vendor.businessName} for ${vendor.category}.`}
                source={`Vendor card enquiry: ${vendor.slug}`}
              >
                Send Enquiry
              </EnquiryModalTrigger>
            </>
          ) : (
            <FreeVendorInterestButton
              className="qf-vcard-action-btn qf-vcard-action-btn--enquiry"
              vendorId={vendor.slug}
              vendorName={vendor.businessName}
              city={vendor.city}
              area={meta.locality.split(",")[0]}
              category={vendor.category}
              subcategory={vendor.subCategory}
            >
              Request Callback
            </FreeVendorInterestButton>
          )}
        </div>

        <div className="qf-vcard-sub-actions">
          {isPaidOrTrialEligible ? (
            <a
              className="qf-vcard-sub-btn qf-vcard-sub-btn--wa"
              href={whatsappLink(`Hi QuickFurno, I want a quote from ${vendor.businessName}.`)}
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp
            </a>
          ) : (
            <FreeVendorInterestButton
              className="qf-vcard-sub-btn qf-vcard-sub-btn--wa"
              vendorId={vendor.slug}
              vendorName={vendor.businessName}
              city={vendor.city}
              area={meta.locality.split(",")[0]}
              category={vendor.category}
              subcategory={vendor.subCategory}
            >
              Contact through QuickFurno
            </FreeVendorInterestButton>
          )}
          <Link className="qf-vcard-sub-btn qf-vcard-sub-btn--profile" href={profileHref}>
            View Profile
          </Link>
          {compare ? (
            <button
              type="button"
              className={`qf-vcard-action-compare${selectedForCompare ? " is-active" : ""}`}
              aria-pressed={selectedForCompare}
              onClick={() => compare.toggle(vendor)}
            >
              <span className="qf-vcard-compare-checkbox">
                {selectedForCompare ? "✓" : ""}
              </span>
              <span>Compare</span>
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
