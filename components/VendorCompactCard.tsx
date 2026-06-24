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

  return (
    <article className={`qf-vcard${vendor.activePaidPlan ? " qf-vcard--premium" : ""}`}>
      {/* Portfolio preview strip (local assets) */}
      <div className="qf-vcard-portfolio">
        {portfolio.length > 0 ? (
          <Link className="qf-vcard-shots" href={profileHref} aria-label={`View ${vendor.businessName} portfolio`}>
            {portfolio.map((src, index) => (
              <span className="qf-vcard-shot" key={src + index}>
                <Image
                  src={src}
                  alt={`${vendor.businessName} ${vendor.category} project ${index + 1}`}
                  fill
                  sizes="(max-width: 759px) 33vw, 200px"
                  className="qf-vcard-shot-img"
                  priority={priority && index === 0}
                />
              </span>
            ))}
            <span className="qf-vcard-shot-count" aria-hidden="true">
              {portfolio.length} photos
            </span>
          </Link>
        ) : (
          <div className="qf-vcard-portfolio-empty" aria-label="Portfolio coming soon">
            <QFIcon name="grid" />
            <span>Portfolio coming soon</span>
          </div>
        )}
      </div>

      {/* Identity */}
      <div className="qf-vcard-head">
        <div className="qf-vcard-id">
          <h3>
            <Link href={profileHref}>{vendor.businessName}</Link>
          </h3>
          <p className="qf-vcard-meta">
            {showCategory ? `${vendor.category} · ` : ""}
            {vendor.subCategory}
          </p>
          <p className="qf-vcard-area">
            <QFIcon name="pin" />
            {meta.locality}
          </p>
        </div>
        <div className="qf-vcard-badges">
          {vendor.verified ? <span className="qf-vcard-badge qf-vcard-badge--verified">Verified ✓</span> : null}
          {vendor.activePaidPlan ? <span className="qf-vcard-badge qf-vcard-badge--premium">Premium</span> : null}
        </div>
      </div>

      {/* Trust snippets */}
      <div className="qf-vcard-trust" aria-label="Trust indicators">
        <span className="qf-vcard-snip qf-vcard-snip--rating">
          {trust.ratingLabel} <span aria-hidden="true">★</span>
          <small>{vendor.reviews > 0 ? `${vendor.reviews} reviews` : "New"}</small>
        </span>
        <span className="qf-vcard-snip">
          <QFIcon name="clock" />
          {trust.responseLabel}
        </span>
        <span className="qf-vcard-snip">
          <QFIcon name="briefcase" />
          {trust.experienceLabel}
        </span>
        <span className="qf-vcard-snip">
          <QFIcon name="shield" />
          {trust.warrantyLabel}
        </span>
      </div>

      {/* Service chips */}
      <div className="qf-vcard-chips" aria-label="Key services">
        {visibleChips.map((chip) => (
          <span key={`${chip.label}-${chip.price}`}>{chip.label}</span>
        ))}
        {hiddenChipCount > 0 ? <span className="qf-vcard-chip-more">+{hiddenChipCount} more</span> : null}
      </div>

      {/* Price chip */}
      <div className="qf-vcard-price">
        <span className="qf-vcard-price-tag">{trust.startingPrice}</span>
      </div>

      {/* Actions */}
      <div className="qf-vcard-cta">
        <div className="qf-vcard-cta-grid">
          <a className="qf-vcard-btn qf-vcard-btn--call" href={CONTACT_TEL}>
            Call Now
          </a>
          <a
            className="qf-vcard-btn qf-vcard-btn--wa"
            href={whatsappLink(`Hi QuickFurno, I want a quote from ${vendor.businessName}.`)}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
          <Link className="qf-vcard-btn qf-vcard-btn--profile" href={profileHref}>
            View Profile
          </Link>
          <EnquiryModalTrigger
            className="qf-vcard-btn qf-vcard-btn--enquiry"
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

        {compare ? (
          <button
            type="button"
            className={`qf-vcard-compare${selectedForCompare ? " is-active" : ""}`}
            aria-pressed={selectedForCompare}
            onClick={() => compare.toggle(vendor)}
          >
            <span className="qf-vcard-compare-box" aria-hidden="true">
              {selectedForCompare ? "✓" : ""}
            </span>
            {selectedForCompare ? "Added to compare" : "Compare"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
