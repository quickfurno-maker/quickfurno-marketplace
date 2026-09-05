"use client";

import { useId, useMemo, useState } from "react";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { MAX_COMPARE_VENDORS } from "@/lib/config";
import { rankVendors, type Vendor } from "@/lib/quickfurno-data";
import { VendorCompareV2 } from "./VendorCompareV2";
import { VendorListingCard } from "./VendorListingCard";
import {
  emptyListingFilters,
  resultCountLabel,
  selectListingVendors,
  type ListingFilters,
  type ListingSort,
  type VendorListingView,
} from "./listingModel";

/**
 * Client-side discovery for one category page (QF-UI-V2-06).
 *
 * Search, filtering, sorting and compare are all in-memory over the vendor list
 * the server already fetched and visibility-filtered. There is no new search
 * backend, no geolocation, no map SDK.
 *
 * Every control here is backed by a real column — search text, city, "has
 * photos" (the vendor's own uploads) and "price listed" (a real starting_price).
 * The removed chips (Top Rated / Quick Response / Near Me / Budget Friendly /
 * Premium Teams / Available Today) all read defaulted or invented values.
 */
export function VendorDiscovery({
  vendors,
  categoryName,
  enquiryService,
}: {
  vendors: Vendor[];
  categoryName: string;
  enquiryService?: string;
}) {
  const [filters, setFilters] = useState<ListingFilters>(emptyListingFilters);
  const [sort, setSort] = useState<ListingSort>("recommended");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const searchId = useId();
  const cityId = useId();
  const sortId = useId();

  const results = useMemo(
    // rankVendors is passed in unchanged: ranking authority stays in
    // lib/quickfurno-data.ts and is never re-implemented by the display model.
    () => selectListingVendors(vendors, filters, sort, rankVendors),
    [vendors, filters, sort],
  );

  const compareSelection = useMemo(
    () => compareIds.map((id) => results.find((v) => v.id === id)).filter(Boolean) as VendorListingView[],
    [compareIds, results],
  );

  function toggleCompare(vendor: VendorListingView) {
    setCompareIds((current) => {
      if (current.includes(vendor.id)) return current.filter((id) => id !== vendor.id);
      if (current.length >= MAX_COMPARE_VENDORS) return current;
      return [...current, vendor.id];
    });
  }

  const filtersActive =
    filters.query.trim() !== "" ||
    filters.city !== "All" ||
    filters.hasPhotos ||
    filters.hasPrice;

  return (
    <div className="qf-vl">
      <div className="qf-vl-controls">
        <div className="qf-vl-controls-row">
          <div className="qf-vl-search">
            <label htmlFor={searchId} className="qf-pub-sronly">
              Search vendors in {categoryName}
            </label>
            <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true" focusable="false">
              <circle cx="9" cy="9" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <path d="M13.2 13.2L17 17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <input
              id={searchId}
              type="search"
              value={filters.query}
              onChange={(event) => setFilters((f) => ({ ...f, query: event.target.value }))}
              placeholder="Search by name, service or area"
            />
          </div>

          <div className="qf-vl-select">
            <label htmlFor={cityId}>City</label>
            <select
              id={cityId}
              value={filters.city}
              onChange={(event) => setFilters((f) => ({ ...f, city: event.target.value }))}
            >
              <option value="All">All cities</option>
              <option value="Pune">Pune</option>
              <option value="Mumbai">Mumbai</option>
            </select>
          </div>

          <div className="qf-vl-select">
            <label htmlFor={sortId}>Sort</label>
            <select id={sortId} value={sort} onChange={(event) => setSort(event.target.value as ListingSort)}>
              <option value="recommended">Recommended</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>
        </div>

        <div className="qf-vl-controls-row qf-vl-controls-row--chips">
          <div className="qf-vl-chips">
            <button
              type="button"
              className="qf-vl-chip"
              aria-pressed={filters.hasPhotos}
              onClick={() => setFilters((f) => ({ ...f, hasPhotos: !f.hasPhotos }))}
            >
              Has photos
            </button>
            <button
              type="button"
              className="qf-vl-chip"
              aria-pressed={filters.hasPrice}
              onClick={() => setFilters((f) => ({ ...f, hasPrice: !f.hasPrice }))}
            >
              Price listed
            </button>
            {filtersActive ? (
              <button
                type="button"
                className="qf-vl-chip qf-vl-chip--clear"
                onClick={() => setFilters(emptyListingFilters)}
              >
                Clear
              </button>
            ) : null}
          </div>

          <p className="qf-vl-count" role="status">
            {resultCountLabel(results.length)}
          </p>
        </div>
      </div>

      {results.length === 0 ? (
        <div className="qf-vl-empty">
          {/* h2 for the same reason as the card name: this replaces the results
              directly under the page h1. The stylesheet already targets
              .qf-vl-empty h2 and h3 identically. */}
          <h2>
            {filtersActive
              ? "No vendors match these filters"
              : "No verified vendors are available in this category right now."}
          </h2>
          <p>
            {filtersActive
              ? "Clear the filters to see every vendor in this category, or tell QuickFurno what you need."
              : "Tell QuickFurno what you need and we can help with matching."}
          </p>
          <div className="qf-vl-empty-actions">
            {filtersActive ? (
              <button type="button" className="qf-pub-btn qf-pub-btn--secondary" onClick={() => setFilters(emptyListingFilters)}>
                Clear filters
              </button>
            ) : null}
            <EnquiryModalTrigger
              className="qf-pub-btn qf-pub-btn--primary"
              modalTitle={`Get matched with verified ${categoryName}`}
              serviceCategory={enquiryService}
              source={`Category empty state: ${categoryName}`}
            >
              Get Free Team Matches
            </EnquiryModalTrigger>
          </div>
        </div>
      ) : (
        <div className="qf-vl-results">
          {results.map((vendor, index) => (
            <VendorListingCard
              key={vendor.id}
              vendor={vendor}
              priority={index < 2}
              compareSelected={compareIds.includes(vendor.id)}
              compareDisabled={compareIds.length >= MAX_COMPARE_VENDORS}
              onToggleCompare={toggleCompare}
            />
          ))}
        </div>
      )}

      {compareSelection.length > 0 ? (
        <div className="qf-vl-comparebar" role="region" aria-label="Vendor comparison">
          <p>
            {compareSelection.length} of {MAX_COMPARE_VENDORS} selected
          </p>
          <div>
            <button type="button" className="qf-vl-comparebar-clear" onClick={() => setCompareIds([])}>
              Clear
            </button>
            <button
              type="button"
              className="qf-pub-btn qf-pub-btn--primary qf-pub-btn--sm"
              onClick={() => setCompareOpen(true)}
              disabled={compareSelection.length < 2}
            >
              Compare
            </button>
          </div>
        </div>
      ) : null}

      {compareOpen && compareSelection.length >= 2 ? (
        <VendorCompareV2
          vendors={compareSelection}
          onClose={() => setCompareOpen(false)}
          onRemove={(id) => setCompareIds((current) => current.filter((v) => v !== id))}
        />
      ) : null}
    </div>
  );
}
