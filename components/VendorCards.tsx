"use client";

import { useMemo, useState } from "react";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { FilterChips, type FilterChipItem } from "@/components/FilterChips";
import { VendorCompactCard } from "@/components/VendorCompactCard";
import { VendorCompareProvider } from "@/components/VendorCompare";
import {
  cities,
  enquiryServiceForCategory,
  getVendorListingMeta,
  getVendorsByCategory,
  rankVendors,
  vendorFilterCategories,
  vendorResponseScore,
  visibleVendors,
  type QuickFurnoCategory,
  type Vendor,
} from "@/lib/quickfurno-data";

type VendorFilter = (typeof vendorFilterCategories)[number];
type SortMode = "ranked" | "rating" | "reviews" | "response";

const listingFilterChips: FilterChipItem[] = [
  { key: "top-rated", label: "Top Rated" },
  { key: "verified", label: "Verified" },
  { key: "quick-response", label: "Quick Response" },
  { key: "near-me", label: "Near Me" },
  { key: "budget", label: "Budget Friendly" },
  { key: "premium", label: "Premium Teams" },
  { key: "available", label: "Available Today" },
];

const sortLabels: Record<SortMode, string> = {
  ranked: "Sort by",
  rating: "Rating",
  reviews: "Reviews",
  response: "Response",
};

function matchesQuery(vendor: Vendor, query: string) {
  if (!query.trim()) return true;
  const text = [
    vendor.businessName,
    vendor.category,
    vendor.subCategory,
    vendor.city,
    vendor.description,
    getVendorListingMeta(vendor).locality,
  ]
    .join(" ")
    .toLowerCase();
  return text.includes(query.trim().toLowerCase());
}

function applyFilters(vendor: Vendor, filters: string[], selectedCity: string) {
  const meta = getVendorListingMeta(vendor);
  if (selectedCity !== "All" && vendor.city !== selectedCity) return false;
  if (filters.includes("top-rated") && vendor.rating < 4.6) return false;
  if (filters.includes("verified") && !vendor.verified) return false;
  if (filters.includes("quick-response") && vendorResponseScore(vendor) < 70) return false;
  if (filters.includes("near-me") && selectedCity !== "All" && vendor.city !== selectedCity) return false;
  if (filters.includes("budget") && vendor.activePaidPlan && !meta.trustSignals.includes("Budget friendly")) return false;
  if (filters.includes("premium") && !vendor.activePaidPlan) return false;
  if (filters.includes("available") && !/available|open|responds/i.test(meta.openStatus)) return false;
  return true;
}

function sortVendors(vendors: Vendor[], sortMode: SortMode) {
  if (sortMode === "ranked") return rankVendors(vendors);
  return [...vendors].sort((a, b) => {
    if (sortMode === "rating") return b.rating - a.rating;
    if (sortMode === "reviews") return b.reviews - a.reviews;
    return vendorResponseScore(b) - vendorResponseScore(a);
  });
}

export function VendorCards({
  compact = false,
  category,
  excludeSlug,
  limit,
  mode = category && !compact ? "listing" : "preview",
}: {
  compact?: boolean;
  category?: QuickFurnoCategory;
  excludeSlug?: string;
  limit?: number;
  mode?: "listing" | "preview";
}) {
  const [activeFilter, setActiveFilter] = useState<VendorFilter>(category ?? "All");
  const [query, setQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState("All");
  const [activeChips, setActiveChips] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("ranked");

  const selectedCategory = category ?? (activeFilter === "All" ? undefined : activeFilter);
  const listingMode = mode === "listing";
  const showCategoryFilters = !listingMode && !compact && !category && !limit;

  const filteredVendors = useMemo(() => {
    const base = selectedCategory ? getVendorsByCategory(selectedCategory) : visibleVendors;
    const filtered = base.filter((vendor) => vendor.slug !== excludeSlug)
      .filter((vendor) => matchesQuery(vendor, query))
      .filter((vendor) => applyFilters(vendor, activeChips, selectedCity));
    const sorted = sortVendors(filtered, sortMode);
    return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
  }, [activeChips, excludeSlug, limit, query, selectedCategory, selectedCity, sortMode]);

  function toggleChip(key: string) {
    setActiveChips((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  function cycleSort() {
    setSortMode((current) => {
      if (current === "ranked") return "rating";
      if (current === "rating") return "reviews";
      if (current === "reviews") return "response";
      return "ranked";
    });
  }

  const categoryTitle = selectedCategory ?? "home-service vendors";
  const enquiryService = selectedCategory ? enquiryServiceForCategory(selectedCategory) : undefined;

  const content = (
    <div className={`vendor-marketplace-v2 ${listingMode ? "vendor-marketplace-v2--listing" : ""}`}>
      {listingMode ? (
        <div className="vendor-discovery-top">
          <div className="vendor-search-row">
            <label className="vendor-search-box">
              <span className="vendor-search-icon" aria-hidden="true">Search</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search carpenters, interior designers, painters..."
                aria-label="Search Teams"
              />
            </label>
            <label className="vendor-location-select">
              <span>Location</span>
              <select value={selectedCity} onChange={(event) => setSelectedCity(event.target.value)}>
                <option value="All">Pune & Mumbai</option>
                {cities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="vendor-listing-title-row">
            <div>
              <h1>{selectedCategory ? `${selectedCategory} near you` : "Teams near you"}</h1>
              <p>Compare Verified Teams, rates, ratings, and availability</p>
            </div>
            <span className="vendor-result-count">
              {filteredVendors.length} {filteredVendors.length === 1 ? "Team" : "Teams"}
            </span>
          </div>

          <div className="vendor-filter-scroll">
            <button
              type="button"
              className={`qf-filter-chip ${sortMode !== "ranked" ? "qf-filter-chip--active" : ""}`}
              onClick={cycleSort}
              aria-label="Cycle Team sort"
            >
              {sortLabels[sortMode]}
            </button>
            <FilterChips chips={listingFilterChips} activeKeys={activeChips} onToggle={toggleChip} />
          </div>
        </div>
      ) : null}

      {showCategoryFilters ? (
        <div className="filter-row" aria-label="Team category filters">
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
        <div className="vendor-empty-v2">
          <h3>New Verified Teams arriving soon</h3>
          <p>
            We are onboarding Verified Teams for this category. Submit a free enquiry and
            QuickFurno will match you with suitable experts near you.
          </p>
          <EnquiryModalTrigger
            className="btn btn-primary"
            modalTitle={`Get quotes from verified ${categoryTitle}`}
            serviceCategory={enquiryService}
            source="Empty category listing"
          >
            Get Free Quotes
          </EnquiryModalTrigger>
        </div>
      ) : null}

      <div className={`vendor-results-stack ${compact ? "vendor-results-stack--compact" : ""}`} data-reveal-group>
        {filteredVendors.map((vendor, index) => (
          <div key={vendor.slug} className="vendor-result-slot">
            {listingMode && index === 2 ? (
              <div className="vendor-native-banner">
                <div>
                  <strong>Need help choosing the right Team?</strong>
                  <span>QuickFurno can match you with Verified Teams near you.</span>
                </div>
                <EnquiryModalTrigger
                  className="qf-banner-link"
                  modalTitle={`Get quotes from verified ${categoryTitle}`}
                  serviceCategory={enquiryService}
                  source="Listing assistance banner"
                >
                  Get Free Assistance
                </EnquiryModalTrigger>
              </div>
            ) : null}
            <VendorCompactCard vendor={vendor} priority={index < 2} showCategory={!category} />
          </div>
        ))}
      </div>
    </div>
  );

  // Compare is scoped to the full listing experience only (not preview/related strips).
  return listingMode ? <VendorCompareProvider>{content}</VendorCompareProvider> : content;
}
