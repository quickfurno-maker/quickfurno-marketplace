"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { activePaidVendors, vendorFilterCategories } from "@/lib/quickfurno-data";

type VendorFilter = (typeof vendorFilterCategories)[number];

export function VendorCards({ compact = false }: { compact?: boolean }) {
  const [activeFilter, setActiveFilter] = useState<VendorFilter>("All");

  const filteredVendors = useMemo(() => {
    return activePaidVendors
      .filter((vendor) => activeFilter === "All" || vendor.category === activeFilter)
      .sort((a, b) => {
        if (Boolean(b.featured) !== Boolean(a.featured)) return Number(Boolean(b.featured)) - Number(Boolean(a.featured));
        if (b.rating !== a.rating) return b.rating - a.rating;
        return b.reviews - a.reviews;
      });
  }, [activeFilter]);

  function trackCtaClick(label: string) {
    // Future integration: save click events to website_events table for analytics and daily AI agent report.
    console.info(`QuickFurno vendor CTA clicked: ${label}`);
  }

  return (
    <div className="vendor-marketplace">
      {!compact ? (
        <div className="filter-row" aria-label="Vendor category filters">
          {vendorFilterCategories.map((category) => (
            <button
              key={category}
              type="button"
              className={`filter-chip ${activeFilter === category ? "filter-chip--active" : ""}`}
              onClick={() => setActiveFilter(category)}
            >
              {category}
            </button>
          ))}
        </div>
      ) : null}

      {/* Future integration: fetch active paid vendors from Supabase vendors table where active_paid_plan = true. */}
      <div className={`vendor-grid ${compact ? "vendor-grid--compact" : ""}`}>
        {filteredVendors.map((vendor) => (
          <article className="vendor-card reveal-card" key={vendor.slug}>
            <div className={`project-visual ${vendor.imageTone}`} role="img" aria-label={`${vendor.businessName} project preview`}>
              <span>{vendor.category}</span>
            </div>
            <div className="vendor-card-body">
              <div className="vendor-card-top">
                <div>
                  <h3>{vendor.businessName}</h3>
                  <p>{vendor.city} • {vendor.subCategory}</p>
                </div>
                <span className="rating-badge">{vendor.rating} ★</span>
              </div>

              <div className="badge-row">
                {vendor.verified ? <span className="status-badge status-badge--verified">Verified</span> : null}
                <span className="status-badge status-badge--paid">Active paid vendor</span>
                {vendor.featured ? <span className="status-badge status-badge--featured">Featured</span> : null}
              </div>

              <p className="vendor-description">{vendor.description}</p>

              <dl className="vendor-meta-grid">
                <div>
                  <dt>Reviews</dt>
                  <dd>{vendor.reviews}</dd>
                </div>
                <div>
                  <dt>Rate</dt>
                  <dd>{vendor.rate}</dd>
                </div>
                <div>
                  <dt>Experience</dt>
                  <dd>{vendor.experience}</dd>
                </div>
                <div>
                  <dt>Response</dt>
                  <dd>{vendor.responseTime}</dd>
                </div>
              </dl>

              <div className="vendor-actions">
                <a className="btn btn-secondary btn-small" href="tel:+919999999999" onClick={() => trackCtaClick(`Call ${vendor.businessName}`)}>
                  Call
                </a>
                <a
                  className="btn btn-outline btn-small"
                  href={`https://wa.me/91XXXXXXXXXX?text=${encodeURIComponent(`I want a quote from ${vendor.businessName}`)}`}
                  onClick={() => trackCtaClick(`WhatsApp ${vendor.businessName}`)}
                >
                  WhatsApp
                </a>
                <Link className="btn btn-primary btn-small" href={`/vendors/${vendor.slug}`}>
                  View Profile
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
