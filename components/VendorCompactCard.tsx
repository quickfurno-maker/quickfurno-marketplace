"use client";

import Image from "next/image";
import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { useVendorCompare } from "@/components/VendorCompare";
import { CONTACT_TEL, whatsappLink } from "@/lib/config";
import {
  enquiryServiceForCategory,
  getVendorListingMeta,
  getVendorPortfolio,
  getVendorServiceChips,
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
  const serviceChips = getVendorServiceChips(vendor);
  const visibleChips = serviceChips.slice(0, 3);
  const hiddenChipCount = Math.max(serviceChips.length - visibleChips.length, 0);
  const enquiryService = enquiryServiceForCategory(vendor.category);
  const profileHref = `/vendors/${vendor.slug}`;

  const compare = useVendorCompare();
  const selectedForCompare = compare?.isSelected(vendor.slug) ?? false;

  const thumbnailSrc = portfolio[0] || "/assets/quickfurno/images/hero/hero-interior-diorama.svg";

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
              sizes="(max-width: 759px) 90px, 110px"
              className="qf-vcard-thumb-img"
              priority={priority}
            />
          </Link>
        </div>

        {/* Right: Vendor Details */}
        <div className="qf-vcard-info-container">
          <div className="qf-vcard-title-row">
            <h3 className="qf-vcard-title">
              <Link href={profileHref}>{vendor.businessName}</Link>
            </h3>
            {vendor.verified && (
              <span className="qf-vcard-verified-badge" title="Business details reviewed & verified">
                Verified ✓
              </span>
            )}
          </div>

          <p className="qf-vcard-category-text">
            {showCategory ? `${vendor.category} · ` : ""}
            {vendor.subCategory}
          </p>

          <div className="qf-vcard-rating-row">
            <span className="qf-vcard-rating-stars">
              {trust.ratingLabel} ★
            </span>
            <span className="qf-vcard-reviews-count">
              ({vendor.reviews > 0 ? `${vendor.reviews} reviews` : "New"})
            </span>
            <span className="qf-vcard-bullet">·</span>
            <span className="qf-vcard-locality-text">
              {meta.locality} {meta.distance ? `(${meta.distance})` : ""}
            </span>
          </div>

          <div className="qf-vcard-status-row">
            <span className="qf-vcard-status-badge">
              {meta.openStatus}
            </span>
          </div>

          <div className="qf-vcard-trust-lines">
            <span className="qf-vcard-trust-tag">Fast response</span>
            <span className="qf-vcard-bullet">·</span>
            <span className="qf-vcard-trust-tag">Business details reviewed</span>
            {vendor.verified && (
              <>
                <span className="qf-vcard-bullet">·</span>
                <span className="qf-vcard-trust-tag">Profile verified</span>
              </>
            )}
          </div>

          <div className="qf-vcard-price-row">
            <span className="qf-vcard-price-label">Starting rate: </span>
            <strong className="qf-vcard-price-value">
              {trust.startingPrice.replace("Starting at", "").trim()}
            </strong>
          </div>
        </div>
      </div>

      {/* Bottom/Right: Action Buttons */}
      <div className="qf-vcard-actions-row">
        <div className="qf-vcard-main-buttons">
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
        </div>

        <div className="qf-vcard-sub-actions">
          <a
            className="qf-vcard-action-btn qf-vcard-action-btn--wa"
            href={whatsappLink(`Hi QuickFurno, I want a quote from ${vendor.businessName}.`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
          <Link className="qf-vcard-link-profile" href={profileHref}>
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
