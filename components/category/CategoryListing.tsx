"use client";

import { useMemo, useState } from "react";
import type { Vendor } from "@/lib/quickfurno-data";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { VendorCard } from "./VendorCard";
import { IconSearch, IconShield } from "./icons";

// ============================================================================
// The listing: facets, search, compare tray, and the honest empty state.
//
// Facets are built FROM THE VENDORS ON THE PAGE, never from a fixed list of
// Pune localities. Offering "Baner" as a filter on a page where no vendor
// covers Baner is a dead end that looks like a broken page; a filter only
// exists when something is behind it. The same goes for business type.
//
// Everything is client-side. Four vendors do not need a round trip, and a
// filter that re-fetches feels slower than one that does not.
// ============================================================================

const MAX_COMPARE = 3;

export type CategoryListingProps = {
  vendors: Vendor[];
  categoryName: string;
  enquiryService: string;
};

export function CategoryListing({ vendors, categoryName, enquiryService }: CategoryListingProps) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<string>("All");
  const [type, setType] = useState<string>("All");
  const [compare, setCompare] = useState<string[]>([]);

  const areaOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of vendors) for (const a of v.areas ?? []) counts.set(a, (counts.get(a) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([a]) => a);
  }, [vendors]);

  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of vendors) if (v.businessType) counts.set(v.businessType, (counts.get(v.businessType) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [vendors]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vendors.filter((v) => {
      if (area !== "All" && !(v.areas ?? []).includes(area)) return false;
      if (type !== "All" && v.businessType !== type) return false;
      if (!q) return true;
      const haystack = [v.businessName, ...(v.areas ?? []), v.businessType ?? ""].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [vendors, query, area, type]);

  const filtered = area !== "All" || type !== "All" || query.trim().length > 0;

  function toggleCompare(slug: string) {
    setCompare((current) =>
      current.includes(slug)
        ? current.filter((s) => s !== slug)
        : current.length >= MAX_COMPARE ? current : [...current, slug],
    );
  }

  // Nothing in this category at all. Six of the eight categories are in this
  // state, so it is a normal page rather than an error: say so plainly and
  // give the one action that still works.
  if (vendors.length === 0) {
    return (
      <div className="qfc-empty qfd-card">
        <span className="qfd-tile qfd-tile--lg" aria-hidden="true"><IconShield size={24} width={2} /></span>
        <h2 className="qfd-h2">No {categoryName.toLowerCase()} listed in Pune yet</h2>
        <p className="qfd-lede">
          We verify every business before it appears here, and none has cleared that check in this
          trade so far. Tell QuickFurno what you need anyway — our Pune team will look for someone
          suitable and come back to you.
        </p>
        <EnquiryModalTrigger
          className="qfd-btn qfd-btn--primary qfd-btn--lg"
          modalTitle={`Tell QuickFurno what you need`}
          serviceCategory={enquiryService}
          source={`Category empty: ${categoryName}`}
        >
          Tell us what you need
        </EnquiryModalTrigger>
        <p className="qfd-meta">Free for homeowners · no obligation</p>
      </div>
    );
  }

  return (
    <div className="qfc-listing">
      <div className="qfc-toolbar">
        <div className="qfc-search">
          <span className="qfc-search-ic" aria-hidden="true"><IconSearch size={17} width={2.2} /></span>
          <label htmlFor="qfc-q" className="qfd-sr">Search by business name or area</label>
          <input
            id="qfc-q"
            type="search"
            className="qfd-input qfc-search-input"
            placeholder="Search by business name or area"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="qfc-count" role="status">
          {shown.length} {shown.length === 1 ? "business" : "businesses"}
          {filtered && shown.length !== vendors.length ? ` of ${vendors.length}` : ""}
        </p>
      </div>

      {areaOptions.length > 1 ? (
        <Facet label="Area" value={area} options={areaOptions} onChange={setArea} />
      ) : null}
      {typeOptions.length > 1 ? (
        <Facet label="Type" value={type} options={typeOptions} onChange={setType} />
      ) : null}

      {shown.length === 0 ? (
        <div className="qfc-nomatch" role="status">
          <p className="qfd-h3">Nothing matches those filters</p>
          <p className="qfd-lede">
            All {vendors.length} verified {categoryName.toLowerCase()} in Pune are still here — widen
            the filters to see them.
          </p>
          <button
            type="button"
            className="qfd-btn qfd-btn--ghost qfd-btn--sm"
            onClick={() => { setArea("All"); setType("All"); setQuery(""); }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="qfc-cards">
          {shown.map((vendor) => (
            <VendorCard
              key={vendor.slug}
              vendor={vendor}
              compareOn={compare.includes(vendor.slug)}
              onCompare={toggleCompare}
              compareFull={compare.length >= MAX_COMPARE}
              categoryName={categoryName}
              enquiryService={enquiryService}
            />
          ))}
        </div>
      )}

      {compare.length >= 2 ? (
        <div className="qfc-tray" role="region" aria-label="Selected for comparison">
          <p className="qfc-tray-names">
            <strong>{compare.length} selected</strong>
            <span>
              {compare
                .map((slug) => vendors.find((v) => v.slug === slug)?.businessName)
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
          <div className="qfc-tray-actions">
            <button type="button" className="qfd-btn qfd-btn--quiet qfd-btn--sm" onClick={() => setCompare([])}>
              Clear
            </button>
            <EnquiryModalTrigger
              className="qfd-btn qfd-btn--primary qfd-btn--sm"
              modalTitle={`Send one enquiry to ${compare.length} ${categoryName.toLowerCase()}`}
              serviceCategory={enquiryService}
              source={`Category compare tray: ${categoryName}`}
            >
              Enquire to all {compare.length}
            </EnquiryModalTrigger>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Facet({
  label, value, options, onChange,
}: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="qfc-facet">
      <span className="qfd-label qfc-facet-label">{label}</span>
      <div className="qfd-chips" role="group" aria-label={`Filter by ${label.toLowerCase()}`}>
        {["All", ...options].map((option) => (
          <button
            key={option}
            type="button"
            className="qfd-chip qfc-facet-chip"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {option === "All" ? `All ${label.toLowerCase()}s` : option}
          </button>
        ))}
      </div>
    </div>
  );
}
