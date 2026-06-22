"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { categoryImage } from "@/lib/images";
import { activePaidVendors, vendorFilterCategories } from "@/lib/quickfurno-data";
import type { QuickFurnoCategory } from "@/lib/quickfurno-data";

type VendorFilter = (typeof vendorFilterCategories)[number];

export function VendorCards({
  compact = false,
  category,
  limit,
}: {
  compact?: boolean;
  category?: QuickFurnoCategory;
  limit?: number;
}) {
  const [activeFilter, setActiveFilter] = useState<VendorFilter>(category ?? "All");

  const showFilters = !compact && !category && !limit;

  const filteredVendors = useMemo(() => {
    const selected = category ?? activeFilter;
    const sorted = activePaidVendors
      .filter((vendor) => selected === "All" || vendor.category === selected)
      .sort((a, b) => {
        if (Boolean(b.featured) !== Boolean(a.featured)) {
          return Number(Boolean(b.featured)) - Number(Boolean(a.featured));
        }
        if (b.rating !== a.rating) return b.rating - a.rating;
        return b.reviews - a.reviews;
      });
    return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
  }, [activeFilter, category, limit]);

  function trackCtaClick(label: string) {
    // Future integration: save click events to website_events table for analytics and daily AI agent report.
    console.info(`QuickFurno vendor CTA clicked: ${label}`);
  }

  return (
    <div className="vendor-marketplace">
      {showFilters ? (
        <div className="filter-row" aria-label="Vendor category filters">
          {vendorFilterCategories.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`filter-chip ${activeFilter === filter ? "filter-chip--active" : ""}`}
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
      ) : null}

      {filteredVendors.length === 0 ? (
        <div className="vendor-empty">
          <h3>New verified vendors arriving soon</h3>
          <p>
            We&apos;re onboarding verified vendors for this category. Submit a free enquiry and our
            team will match you with the right experts near you.
          </p>
          <EnquiryModalTrigger className="btn btn-primary">Get Free Quotes</EnquiryModalTrigger>
        </div>
      ) : null}

      {/* Future integration: fetch active paid vendors from Supabase vendors table where active_paid_plan = true. */}
      <div className={`vendor-grid ${compact ? "vendor-grid--compact" : ""}`} data-reveal-group>
        {filteredVendors.map((vendor, index) => (
          <article className="vendor-card" key={vendor.slug}>
            <div className="vendor-card-media">
              <Image
                src={categoryImage(vendor.category)}
                alt={`${vendor.businessName} ${vendor.category} project preview`}
                fill
                sizes="(max-width: 560px) 100vw, (max-width: 980px) 50vw, 360px"
                className="vendor-card-img"
                priority={index === 0}
              />
              <span className="vendor-card-shade" aria-hidden="true" />
              <div className="vendor-media-copy">
                <span>{vendor.category}</span>
                <strong>{vendor.city}</strong>
              </div>
            </div>

            <div className="vendor-card-body">
              <div className="vendor-card-top">
                <Avatar name={vendor.businessName} src={vendor.imageUrl} className="vendor-avatar" />
                <div className="vendor-card-id">
                  <h3>{vendor.businessName}</h3>
                  <p>{vendor.subCategory}</p>
                </div>
                <span className="rating-badge">{vendor.rating}/5</span>
              </div>

              <div className="badge-row">
                {vendor.verified ? <span className="status-badge status-badge--verified">Verified</span> : null}
                <span className="status-badge status-badge--paid">Active plan</span>
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
                <a
                  className="btn btn-secondary btn-small"
                  href="tel:+919999999999"
                  onClick={() => trackCtaClick(`Call ${vendor.businessName}`)}
                >
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
