"use client";

import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import type { Vendor } from "@/lib/quickfurno-data";
import { coverageLabel } from "@/lib/locality";
import {
  IconArrow, IconCheck, IconClock, IconPin, IconStar, IconUsers,
  businessTypeIcon,
} from "./icons";

// ============================================================================
// One vendor on the category listing.
//
// Everything shown here is something the vendor entered themselves or the
// product enforces. Three rules this card follows, each of them a decision
// rather than a style choice:
//
//   1. `rating` is 0 for every vendor in the table today, because the reviews
//      system has never had a row. Rendering "0.0 ★" would read as a terrible
//      score rather than an absent one, so no-reviews gets its own honest line.
//   2. No vendor has uploaded a photo (there is no upload path in the product),
//      so the monogram is the normal case, not the fallback. It is designed to
//      look deliberate rather than broken.
//   3. A fact the vendor left blank is omitted. Nothing is invented to fill
//      the row out, and the card stays level when facts are missing.
// ============================================================================

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Deterministic tint per vendor, so a card keeps the same one between visits. */
function tone(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export type VendorCardProps = {
  vendor: Vendor;
  compareOn: boolean;
  onCompare: (slug: string) => void;
  compareFull: boolean;
  categoryName: string;
  enquiryService: string;
};

export function VendorCard({ vendor, compareOn, onCompare, compareFull, categoryName, enquiryService }: VendorCardProps) {
  const areas = vendor.areas ?? [];
  const coverage = coverageLabel(areas);
  const hasReviews = vendor.reviews > 0 && vendor.rating > 0;
  const compareDisabled = compareFull && !compareOn;

  const facts: Array<{ key: string; icon: React.ReactNode; label: string }> = [];
  if (vendor.businessType) {
    facts.push({ key: "type", icon: businessTypeIcon(vendor.businessType), label: vendor.businessType });
  }
  if (vendor.teamSize) {
    facts.push({ key: "team", icon: <IconUsers size={13} width={2.1} />, label: `Team of ${vendor.teamSize}` });
  }
  if (vendor.experience) {
    facts.push({ key: "exp", icon: <IconClock size={13} width={2.1} />, label: vendor.experience });
  }
  if (vendor.monthlyCapacity) {
    // "1–5 projects" -> "1–5/month". The long form pushes every fact onto its
    // own row in a 280px card and makes the card twice as tall as it needs.
    const capacity = vendor.monthlyCapacity.replace(/\s*projects?\s*$/i, "");
    facts.push({ key: "cap", icon: <IconStar size={12} />, label: `${capacity}/month` });
  }

  return (
    <article className="qfd-card qfc-card">
      <div className="qfc-card-media">
        <span
          className="qfc-mono"
          style={{ ["--qfc-tone" as string]: `${tone(vendor.slug)}deg` }}
          aria-hidden="true"
        >
          {initials(vendor.businessName)}
        </span>
        {vendor.verified ? (
          <span className="qfc-mono-tick" aria-hidden="true">
            <IconCheck size={13} width={3} />
          </span>
        ) : null}
      </div>

      <div className="qfc-card-body">
        <div className="qfc-card-head">
          <h3 className="qfd-h3 qfc-card-name">
            <Link href={`/vendors/${vendor.slug}`} className="qfc-card-link">
              {vendor.businessName}
            </Link>
          </h3>

          <div className="qfc-card-meta">
            {vendor.verified ? (
              <span className="qfc-verified">
                <IconShieldTick /> Verified
              </span>
            ) : null}
            {coverage ? (
              <span className="qfc-where">
                <IconPin size={13} width={2.1} /> {coverage}
              </span>
            ) : null}
            {typeof vendor.serviceRadiusKm === "number" ? (
              <span className="qfc-where">covers {vendor.serviceRadiusKm} km</span>
            ) : null}
          </div>

          {hasReviews ? (
            <p className="qfc-rating">
              <span className="qfc-stars" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((i) => (
                  <IconStar key={i} size={14} className={i < Math.round(vendor.rating) ? "qfc-star-on" : "qfc-star-off"} />
                ))}
              </span>
              <strong>{vendor.rating.toFixed(1)}</strong>
              <span className="qfc-rating-count">
                {vendor.reviews} verified {vendor.reviews === 1 ? "review" : "reviews"}
              </span>
            </p>
          ) : (
            <p className="qfc-norating">
              <strong>No reviews yet</strong>
              <span> · only homeowners matched here can leave one</span>
            </p>
          )}

          {facts.length > 0 ? (
            <ul className="qfc-facts">
              {facts.map((f) => (
                <li key={f.key} className="qfc-fact">
                  <span className="qfc-fact-ic" aria-hidden="true">{f.icon}</span>
                  {f.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="qfc-card-actions">
          <div className="qfc-rate">
            <span className="qfd-label qfc-rate-label">Starting from</span>
            <strong className="qfc-rate-value">{vendor.rate}</strong>
            <span className="qfc-rate-note">rate set by the vendor</span>
          </div>

          <div className="qfc-buttons">
            {/* Goes through the existing preferred-vendor path, so this vendor
                is prioritised on the lead rather than a fresh auto-match. */}
            <EnquiryModalTrigger
              className="qfd-btn qfd-btn--primary qfd-btn--sm"
              modalTitle={`Send your enquiry to ${vendor.businessName}`}
              serviceCategory={enquiryService}
              source={`Category card: ${categoryName}`}
              leadIntent="preferred_vendor"
              targetVendorId={vendor.slug}
              targetVendorName={vendor.businessName}
              targetVendorCategory={vendor.category}
              targetVendorSubcategory={vendor.subCategory}
            >
              Send enquiry
              <IconArrow size={16} width={2.4} />
            </EnquiryModalTrigger>
            <Link href={`/vendors/${vendor.slug}`} className="qfd-btn qfd-btn--ghost qfd-btn--sm">
              View profile
            </Link>
          </div>

          <label className={`qfc-compare${compareDisabled ? " qfc-compare--off" : ""}`}>
            <input
              type="checkbox"
              className="qfd-check"
              checked={compareOn}
              disabled={compareDisabled}
              onChange={() => onCompare(vendor.slug)}
            />
            <span className="qfd-check-box" aria-hidden="true">
              <IconCheck size={13} width={3.4} />
            </span>
            <span>{compareDisabled ? "Compare is full (3)" : "Add to compare"}</span>
          </label>
        </div>
      </div>
    </article>
  );
}

/** Small filled tick used only inside the Verified chip. */
function IconShieldTick() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true" focusable="false">
      <path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.3-7 9-4.1-1.7-7-4.8-7-9V6Z" />
      <path d="m9 12 2 2 4-4.5" />
    </svg>
  );
}
