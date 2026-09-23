"use client";

import Link from "next/link";
import { useState } from "react";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { PUNE_ZONES } from "@/lib/locality";
import { IconArrow, IconCheck, IconChevron, IconPin } from "./icons";

// ============================================================================
// Category hero — dark band, breadcrumb, title, match bar, trust row.
//
// The canvas draws three controls in the match bar: service, area and
// timeline. Only two are here. `EnquiryModalOptions` can carry an area through
// to the modal but has no timeline field, so a timeline select on this bar
// would be a control that quietly discards what you picked and then asked you
// again inside the modal. Timeline is collected in the modal, once.
//
// The service control is deliberately not a control. You are already on this
// category's page; a select that could navigate you off it is a trap, and one
// that cannot is decoration.
// ============================================================================

const TRUST = [
  "Verified before listing",
  "Up to 3 matches from one enquiry",
  "Free for homeowners",
  "Your details stay private",
];

export type CategoryHeroProps = {
  categoryName: string;
  description: string;
  enquiryService: string;
  vendorCount: number;
  /** Localities that at least one listed vendor actually covers. */
  areas: string[];
};

export function CategoryHero({
  categoryName, description, enquiryService, vendorCount, areas,
}: CategoryHeroProps) {
  const [area, setArea] = useState("");

  // Group the vendor-covered areas under their Pune zone, so a long list reads
  // as a map rather than an alphabet.
  const grouped = PUNE_ZONES
    .map(({ zone, areas: zoneAreas }) => ({ zone, areas: zoneAreas.filter((a) => areas.includes(a)) }))
    .filter((g) => g.areas.length > 0);
  const ungrouped = areas.filter((a) => !grouped.some((g) => g.areas.includes(a)));

  return (
    <section className="qfd-section qfd-section--dark qfc-hero">
      <span className="qfd-glow qfd-glow--on-dark qfd-glow--tr" aria-hidden="true" />
      <span className="qfd-glow qfd-glow--amber qfd-glow--bl" aria-hidden="true" />

      <div className="qfd-wrap">
        <nav className="qfc-crumb" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span aria-hidden="true">›</span>
          <Link href="/#services">Services</Link>
          <span aria-hidden="true">›</span>
          <span aria-current="page">{categoryName}</span>
        </nav>

        <h1 className="qfd-hero qfc-title">{categoryName} in Pune</h1>

        <p className="qfc-sub">
          {description}
          {vendorCount > 0 ? (
            <>
              {" · "}
              <strong>
                {vendorCount} verified {vendorCount === 1 ? "business" : "businesses"} listed
              </strong>
            </>
          ) : null}
        </p>

        <div className="qfc-matchbar">
          <div className="qfc-matchbar-cell qfc-matchbar-cell--locked">
            <span className="qfd-label qfc-matchbar-label">Service</span>
            <span className="qfc-matchbar-value">
              <IconCheck size={14} width={3} /> {categoryName}
            </span>
          </div>

          <div className="qfc-matchbar-cell">
            <label className="qfd-label qfc-matchbar-label" htmlFor="qfc-area">Your area</label>
            <span className="qfc-matchbar-select">
              <IconPin size={15} width={2.1} />
              <select
                id="qfc-area"
                className="qfc-select"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              >
                <option value="">Choose your area in Pune</option>
                {grouped.map((g) => (
                  <optgroup key={g.zone} label={g.zone}>
                    {g.areas.map((a) => <option key={a} value={a}>{a}</option>)}
                  </optgroup>
                ))}
                {ungrouped.length > 0 ? (
                  <optgroup label="Elsewhere in Pune">
                    {ungrouped.map((a) => <option key={a} value={a}>{a}</option>)}
                  </optgroup>
                ) : null}
              </select>
              <IconChevron size={15} width={2.2} />
            </span>
          </div>

          <EnquiryModalTrigger
            className="qfd-btn qfd-btn--primary qfc-matchbar-cta"
            modalTitle={`Get matched with verified ${categoryName}`}
            serviceCategory={enquiryService}
            area={area || undefined}
            source={`Category hero: ${categoryName}`}
          >
            Get matched free
            <IconArrow size={17} width={2.5} />
          </EnquiryModalTrigger>
        </div>

        <ul className="qfc-trust">
          {TRUST.map((t) => (
            <li key={t} className="qfc-trust-item">
              <IconCheck size={13} width={3} /> {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
