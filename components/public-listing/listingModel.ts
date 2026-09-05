// ============================================================================
// QuickFurno — public listing display model  (QF-UI-V2-06)
//
// PURE. No React, no I/O, no Supabase. Unit-tested by
// scripts/mvp/suites/marketplace.mjs.
//
// WHY THIS FILE EXISTS
// --------------------
// The public `Vendor` shape carries several values that are DEFAULTS, not facts,
// for a real Supabase vendor row (services/publicVendorService.ts):
//
//   rating        -> 4.2 whenever the column is null   (and getVendorTrust()
//                    substitutes 4.7 on top of that when rating is 0)
//   reviews       -> always 0 (there is no review system yet)
//   responseTime  -> the literal string "Quick response expected"
//   experience    -> "Verified Team" when the column is null, which
//                    getVendorTrust() then renders as the invented "5+ years"
//   warranty      -> getVendorTrust() invents "Up to 10 years warranty" for
//                    ANY vendor on a paid plan
//   distance      -> getVendorListingMeta() invents "Nearby"
//   openStatus    -> getVendorListingMeta() invents "Responds in <responseTime>"
//   portfolio     -> getVendorPortfolio() returns STOCK per-category imagery,
//                    not anything the vendor uploaded
//
// This model is the boundary that stops all of that reaching the listing UI. It
// reads ONLY columns a vendor actually supplied and returns explicit nulls when
// a value is absent, so the card can hide the row instead of inventing one.
//
// It is a DISPLAY model only:
//   - no DB write, no eligibility change, no visibility change,
//   - no assignment change, no ranking-authority change,
//   - `activePaidPlan` is carried through untouched because the card's contact
//     authority keys off it, and it is decided upstream by
//     getVendorPublicVisibility() -> mapToPublicVendor().
//   - it never reads or exposes phone / whatsapp / email / user_id / gst /
//     address / payment fields; those never enter the public `Vendor` shape.
// ============================================================================
// NOTE: this module is intentionally DEPENDENCY-FREE (no "@/" alias, no React,
// no data module). The MVP suite loader imports it directly, and the suite's
// contract is that every module it imports is pure and dependency-free.
// The ranking function is injected by the caller so that ranking AUTHORITY
// stays in lib/quickfurno-data.ts and is never re-implemented here.

/** The subset of the public `Vendor` shape this model reads. Structural, so it
 *  accepts a real Vendor without importing the type. */
export type ListingVendorInput = {
  slug: string;
  businessName: string;
  city: string;
  category: string;
  rate?: string | null;
  description: string;
  verified?: boolean;
  activePaidPlan?: boolean;
  imageUrl?: string | null;
  serviceCategories?: string[];
  serviceAreaSummary?: string | null;
  businessHours?: string | null;
  portfolioImages?: string[];
};

/** A vendor reduced to facts we can actually stand behind. */
export type VendorListingView = {
  /** Vendor id for real rows (used for routing and preferred-vendor intent). */
  id: string;
  businessName: string;
  city: string;
  category: string;
  /** Real canonical services the vendor selected. May be empty. */
  services: string[];
  /** Approved public service-area summary, or null. */
  serviceArea: string | null;
  /** Approved public business hours, or null. */
  businessHours: string | null;
  /** Real listed starting price, or null when the vendor did not list one. */
  startingPrice: string | null;
  /** Count of the vendor's OWN uploaded portfolio images (never stock imagery). */
  portfolioCount: number;
  /** Vendor-supplied local approved image, or null -> initials avatar. */
  imageUrl: string | null;
  initials: string;
  description: string;
  verified: boolean;
  /** Drives the contact path. Preserved exactly from upstream authority. */
  activePaidPlan: boolean;
};

/**
 * True when a rate string is a real listed price rather than a placeholder.
 * Mirrors the existing `hasPrice` rule in getVendorTrust() so this phase does
 * not invent a second, different notion of "has a price".
 */
export function hasRealStartingPrice(rate: string | null | undefined): boolean {
  const text = (rate ?? "").trim();
  if (!text) return false;
  return /\d/.test(text) && !/request/i.test(text);
}

/** Normalises a real listed price for display; returns null when not real. */
export function formatStartingPrice(rate: string | null | undefined): string | null {
  if (!hasRealStartingPrice(rate)) return null;
  const text = (rate ?? "").trim();
  return text.startsWith("₹") ? text : `₹${text}`;
}

/** Up to two initials for the avatar fallback. */
export function vendorInitials(businessName: string): string {
  const words = (businessName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "QF";
  const letters = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "");
  return letters.join("") || "QF";
}

/** Reduce a public Vendor to the facts the listing is allowed to show. */
export function toListingView(vendor: ListingVendorInput): VendorListingView {
  const services = Array.isArray(vendor.serviceCategories)
    ? vendor.serviceCategories.filter((s) => typeof s === "string" && s.trim().length > 0)
    : [];

  const serviceArea =
    typeof vendor.serviceAreaSummary === "string" && vendor.serviceAreaSummary.trim()
      ? vendor.serviceAreaSummary.trim()
      : null;

  const businessHours =
    typeof vendor.businessHours === "string" && vendor.businessHours.trim()
      ? vendor.businessHours.trim()
      : null;

  return {
    id: vendor.slug,
    businessName: vendor.businessName,
    city: vendor.city,
    category: vendor.category,
    services,
    serviceArea,
    businessHours,
    startingPrice: formatStartingPrice(vendor.rate),
    // The vendor's OWN uploads only. getVendorPortfolio() is deliberately not
    // used here: it returns stock category imagery that is not this vendor's.
    portfolioCount: Array.isArray(vendor.portfolioImages) ? vendor.portfolioImages.length : 0,
    imageUrl: typeof vendor.imageUrl === "string" && vendor.imageUrl.startsWith("/") ? vendor.imageUrl : null,
    initials: vendorInitials(vendor.businessName),
    description: vendor.description,
    verified: Boolean(vendor.verified),
    activePaidPlan: Boolean(vendor.activePaidPlan),
  };
}

/** The only filters backed by real columns. */
export type ListingFilters = {
  query: string;
  /** "All" | "Pune" | "Mumbai" */
  city: string;
  /** Real vendor-uploaded portfolio images present. */
  hasPhotos: boolean;
  /** A real listed starting price present. */
  hasPrice: boolean;
};

export const emptyListingFilters: ListingFilters = {
  query: "",
  city: "All",
  hasPhotos: false,
  hasPrice: false,
};

/** Sort modes backed by real data. No rating / reviews / response sorts exist. */
export type ListingSort = "recommended" | "name";

/** Free-text match over fields the vendor actually supplied. */
export function matchesListingQuery(view: VendorListingView, query: string): boolean {
  const needle = (query ?? "").trim().toLowerCase();
  if (!needle) return true;
  return [
    view.businessName,
    view.category,
    view.city,
    view.serviceArea ?? "",
    view.description,
    ...view.services,
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

/** Apply the real-fact filters to a single view. */
export function matchesListingFilters(view: VendorListingView, filters: ListingFilters): boolean {
  if (filters.city !== "All" && view.city !== filters.city) return false;
  if (filters.hasPhotos && view.portfolioCount === 0) return false;
  if (filters.hasPrice && !view.startingPrice) return false;
  return matchesListingQuery(view, filters.query);
}

/**
 * Filter + sort the listing.
 *
 * "recommended" delegates to the INJECTED ranker, which the listing passes as
 * rankVendors() from lib/quickfurno-data.ts — unchanged. Ranking authority is
 * not touched or re-implemented by this phase.
 *
 * Recorded for the handoff: for real Supabase rows every rankVendors tiebreaker
 * after plan priority is a constant (rating 4.2, responseScore 55, reviews 0),
 * so real ordering reduces to paid-first then planPriority — the intended
 * visibility priority. That is why the demo-derived tiebreakers are harmless
 * here and were left alone.
 */
export function selectListingVendors<T extends ListingVendorInput>(
  vendors: T[],
  filters: ListingFilters,
  sort: ListingSort,
  rank: (input: T[]) => T[] = (input) => input,
): VendorListingView[] {
  const ordered = sort === "recommended" ? rank(vendors) : [...vendors];
  const views = ordered.map(toListingView).filter((view) => matchesListingFilters(view, filters));
  if (sort === "name") {
    views.sort((a, b) => a.businessName.localeCompare(b.businessName));
  }
  return views;
}

/** Result-count label. Always reflects what is actually rendered. */
export function resultCountLabel(count: number): string {
  return `${count} ${count === 1 ? "vendor" : "vendors"}`;
}
