"use client";

import Image from "next/image";
import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { FreeVendorInterestButton } from "@/components/FreeVendorInterestButton";
import { CONTACT_TEL } from "@/lib/config";
import { enquiryServiceForCategory, type QuickFurnoCategory } from "@/lib/quickfurno-data";
import type { VendorListingView } from "./listingModel";

/**
 * One vendor in the public category listing.
 *
 * TRUTH RULES (QF-UI-V2-06):
 *   - Renders ONLY fields present on VendorListingView, i.e. only values the
 *     vendor actually supplied. No rating, no review count, no response time, no
 *     distance, no open/availability status, no experience, no warranty, no
 *     "background checked" — every one of those was a default or an invention.
 *   - A missing field is omitted entirely. Nothing says "Coming soon".
 *   - The thumbnail is the vendor's OWN approved local image, else an initials
 *     avatar. Stock category imagery is never presented as this vendor's work.
 *
 * CONTACT AUTHORITY (unchanged from VendorCompactCard):
 *   paid/trial (activePaidPlan true)  -> Send Enquiry (preferred_vendor) +
 *                                        Call QuickFurno (CONTACT_TEL) + profile
 *   free/unpaid (activePaidPlan false)-> FreeVendorInterestButton only + profile
 * The vendor's own phone / WhatsApp / email are never rendered; the tel: link is
 * QuickFurno's own switchboard number, exactly as before.
 */
export function VendorListingCard({
  vendor,
  priority = false,
  compareSelected,
  onToggleCompare,
  compareDisabled = false,
}: {
  vendor: VendorListingView;
  priority?: boolean;
  compareSelected?: boolean;
  onToggleCompare?: (vendor: VendorListingView) => void;
  compareDisabled?: boolean;
}) {
  const profileHref = `/vendors/${vendor.id}`;
  const enquiryService = enquiryServiceForCategory(vendor.category as QuickFurnoCategory);

  // Up to three factual chips. Each one is omitted when the vendor did not
  // supply the underlying value, so a sparse profile simply shows fewer chips.
  const facts: string[] = [];
  if (vendor.startingPrice) facts.push(`From ${vendor.startingPrice}`);
  if (vendor.portfolioCount > 0) {
    facts.push(`${vendor.portfolioCount} ${vendor.portfolioCount === 1 ? "photo" : "photos"}`);
  }
  if (vendor.businessHours) facts.push(vendor.businessHours);

  const location = vendor.serviceArea ? `${vendor.serviceArea} · ${vendor.city}` : vendor.city;

  return (
    <article className="qf-vl-card">
      <div className="qf-vl-card-body">
        <Link href={profileHref} className="qf-vl-card-media" aria-hidden="true" tabIndex={-1}>
          {vendor.imageUrl ? (
            <Image
              src={vendor.imageUrl}
              alt=""
              fill
              sizes="(max-width: 720px) 76px, 92px"
              className="qf-vl-card-img"
              priority={priority}
            />
          ) : (
            <span className="qf-vl-card-initials">{vendor.initials}</span>
          )}
        </Link>

        <div className="qf-vl-card-info">
          <h3 className="qf-vl-card-name">
            <Link href={profileHref}>{vendor.businessName}</Link>
          </h3>

          <p className="qf-vl-card-meta">
            {vendor.verified ? (
              <span className="qf-vl-verified">
                <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
                  <path
                    d="M8 1.4l1.8 1.1 2.1-.2.6 2 1.7 1.2-.9 1.9.3 2.1-2 .7-1.3 1.7-2-.6-2 .6-1.3-1.7-2-.7.3-2.1-.9-1.9L2.1 4.3l.6-2 2.1.2L8 1.4z"
                    fill="currentColor"
                  />
                  <path d="M5.6 8.1l1.6 1.6 3.2-3.4" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Verified
              </span>
            ) : null}
            <span className="qf-vl-card-location">{location}</span>
          </p>

          {vendor.services.length > 0 ? (
            <p className="qf-vl-card-services">{vendor.services.slice(0, 3).join(" · ")}</p>
          ) : null}

          <p className="qf-vl-card-desc">{vendor.description}</p>

          {facts.length > 0 ? (
            <ul className="qf-vl-card-facts">
              {facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="qf-vl-card-actions">
        {vendor.activePaidPlan ? (
          <EnquiryModalTrigger
            className="qf-pub-btn qf-pub-btn--primary qf-pub-btn--sm"
            modalTitle={`Get quote from ${vendor.businessName}`}
            serviceCategory={enquiryService}
            city={vendor.city}
            area={vendor.serviceArea ?? undefined}
            requirement={`I want a quote from ${vendor.businessName} for ${vendor.category}.`}
            source={`Vendor card enquiry: ${vendor.id}`}
            leadIntent="preferred_vendor"
            targetVendorId={vendor.id}
            targetVendorName={vendor.businessName}
            targetVendorCategory={vendor.category}
            targetVendorSubcategory={vendor.services[0] ?? vendor.category}
          >
            Send enquiry
          </EnquiryModalTrigger>
        ) : (
          <FreeVendorInterestButton
            className="qf-pub-btn qf-pub-btn--primary qf-pub-btn--sm"
            vendorId={vendor.id}
            vendorName={vendor.businessName}
            city={vendor.city}
            area={vendor.serviceArea}
            category={vendor.category}
            subcategory={vendor.services[0] ?? vendor.category}
          >
            Request callback
          </FreeVendorInterestButton>
        )}

        <Link href={profileHref} className="qf-pub-btn qf-pub-btn--secondary qf-pub-btn--sm">
          View profile
        </Link>

        {/* Contacting QuickFurno, never the vendor directly. Paid/trial only,
            matching the previous card's authority. */}
        {vendor.activePaidPlan ? (
          <a className="qf-vl-card-tel" href={CONTACT_TEL}>
            Call QuickFurno
          </a>
        ) : null}

        {onToggleCompare ? (
          <button
            type="button"
            className="qf-vl-card-compare"
            aria-pressed={Boolean(compareSelected)}
            disabled={compareDisabled && !compareSelected}
            onClick={() => onToggleCompare(vendor)}
          >
            {compareSelected ? "Added to compare" : "Compare"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
