// ============================================================================
// QuickFurno — public vendor profile display model  (QF-UI-V2-07)
//
// PURE and DEPENDENCY-FREE (no "@/" alias, no React, no data module) so the MVP
// suite loader can import it directly. Unit-tested by
// scripts/mvp/suites/marketplace.mjs.
//
// WHY THIS FILE EXISTS
// --------------------
// The same defaulted values that polluted the listing (QF-UI-V2-06) also reach
// the profile, and the profile compounded them with its own inventions:
//
//   rating         -> 4.2 default from mapToPublicVendor, rendered as "4.2/5"
//   reviews        -> always 0, rendered as "0 reviews"
//   experience     -> "Verified Team" default, rendered as
//                     "Verified Team experience" in the hero proof row
//   responseTime   -> "Quick response expected", rendered as a "response" stat
//   distance       -> getVendorListingMeta() invents "Nearby"
//   business hours -> the page invented "Mon - Sun, 10:00 am - 9:00 pm"
//   service areas  -> the page invented Baner/Wakad (Pune) or Andheri/Thane
//                     (Mumbai) whenever the vendor published none
//   "Premium"      -> a commercial package flag shown as a quality badge
//
// This model reads ONLY fields a vendor actually published and returns explicit
// nulls otherwise, so a section can be hidden rather than filled with fiction.
//
// It is a DISPLAY model only: no DB write, no eligibility/visibility/assignment
// /ranking/credit change. `activePaidPlan` is carried through untouched because
// the profile's action authority keys off it, and it is decided upstream by
// getVendorPublicVisibility() -> mapToPublicVendor().
// ============================================================================

/** The subset of the public `Vendor` shape the profile reads. Structural, so it
 *  accepts a real Vendor without importing the type. */
export type ProfileVendorInput = {
  slug: string;
  businessName: string;
  city: string;
  category: string;
  subCategory?: string;
  rate?: string | null;
  description?: string;
  verified?: boolean;
  activePaidPlan?: boolean;
  imageUrl?: string | null;
  coverImageUrl?: string | null;
  serviceCategories?: string[];
  serviceAreaSummary?: string | null;
  businessHours?: string | null;
  portfolioImages?: string[];
  source?: "supabase" | "static";
};

export type VendorPublicProfileView = {
  id: string;
  businessName: string;
  city: string;
  category: string;
  /** Real canonical services the vendor selected. May be empty. */
  services: string[];
  /** Approved public service-area summary split into tags, else []. */
  serviceAreas: string[];
  /** Raw approved service-area summary, or null. */
  serviceAreaSummary: string | null;
  /** Approved free-text public business hours, or null. NEVER invented. */
  businessHours: string | null;
  /** Real listed starting price, normalised, or null. */
  startingPrice: string | null;
  /** The vendor's OWN approved portfolio URLs (safe schemes only). */
  portfolio: string[];
  /** Approved profile image (local or approved external http(s)), or null. */
  profileImage: string | null;
  /** Approved cover image (local or approved external http(s)), or null. */
  coverImage: string | null;
  initials: string;
  description: string;
  verified: boolean;
  /** Drives action authority ONLY. Never surfaced as a quality badge. */
  activePaidPlan: boolean;
  /** Convenience flags so sections and nav can be hidden when empty. */
  hasStartingPrice: boolean;
  hasBusinessHours: boolean;
  hasServiceArea: boolean;
  hasPortfolio: boolean;
  hasProfileImage: boolean;
  hasCoverImage: boolean;
  hasServices: boolean;
};

/**
 * Accepts a local path or an ALREADY-APPROVED external http(s) URL, and nothing
 * else. Rejects javascript:, data:, vbscript:, file:, and protocol-relative
 * "//host" (which would silently inherit the page scheme).
 *
 * This does not widen what is approved — it only stops the public mapper from
 * discarding an approved external URL the vendor profile editor already accepts.
 * External URLs must be rendered with a plain <img>, never next/image (no host
 * allowlist) and never fetched server-side.
 */
export function safePublicImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (text.startsWith("//")) return null;
  if (text.startsWith("/")) return text;
  if (/^https?:\/\//i.test(text)) return text;
  return null;
}

/** True when a rate string is a real listed price rather than a placeholder. */
export function hasRealStartingPrice(rate: string | null | undefined): boolean {
  const text = (rate ?? "").trim();
  if (!text) return false;
  return /\d/.test(text) && !/request/i.test(text);
}

/** Normalises a real listed price for display; null when not real. */
export function formatStartingPrice(rate: string | null | undefined): string | null {
  if (!hasRealStartingPrice(rate)) return null;
  const text = (rate ?? "").trim();
  return text.startsWith("₹") ? text : `₹${text}`;
}

/** Up to two initials for the avatar fallback. */
export function vendorInitials(businessName: string): string {
  const words = (businessName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "QF";
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "QF";
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Reduce a public Vendor to the facts the profile is allowed to show. */
export function toProfileView(vendor: ProfileVendorInput): VendorPublicProfileView {
  const services = Array.isArray(vendor.serviceCategories)
    ? vendor.serviceCategories.filter((s) => typeof s === "string" && s.trim().length > 0)
    : [];

  const serviceAreaSummary = cleanText(vendor.serviceAreaSummary);
  // Split only on the vendor's own separators — this must faithfully represent
  // the stored string, never add a locality the vendor did not publish.
  const serviceAreas = serviceAreaSummary
    ? serviceAreaSummary.split(",").map((a) => a.trim()).filter(Boolean)
    : [];

  const portfolio = (Array.isArray(vendor.portfolioImages) ? vendor.portfolioImages : [])
    .map(safePublicImageUrl)
    .filter((url): url is string => url !== null);

  const profileImage = safePublicImageUrl(vendor.imageUrl);
  const coverImage = safePublicImageUrl(vendor.coverImageUrl);
  const startingPrice = formatStartingPrice(vendor.rate);
  const businessHours = cleanText(vendor.businessHours);

  const description =
    cleanText(vendor.description) ??
    `${vendor.businessName} is a verified QuickFurno vendor for ${vendor.category.toLowerCase()} services in ${vendor.city}.`;

  return {
    id: vendor.slug,
    businessName: vendor.businessName,
    city: vendor.city,
    category: vendor.category,
    services,
    serviceAreas,
    serviceAreaSummary,
    businessHours,
    startingPrice,
    portfolio,
    profileImage,
    coverImage,
    initials: vendorInitials(vendor.businessName),
    description,
    verified: Boolean(vendor.verified),
    activePaidPlan: Boolean(vendor.activePaidPlan),
    hasStartingPrice: startingPrice !== null,
    hasBusinessHours: businessHours !== null,
    hasServiceArea: serviceAreas.length > 0,
    hasPortfolio: portfolio.length > 0,
    hasProfileImage: profileImage !== null,
    hasCoverImage: coverImage !== null,
    hasServices: services.length > 0,
  };
}

export type ProfileSectionId = "overview" | "services" | "portfolio" | "details";

/**
 * Section anchors, with empty sections omitted so a sparse profile does not
 * advertise sections that turn out to be placeholders.
 */
export function profileSections(view: VendorPublicProfileView): { id: ProfileSectionId; label: string }[] {
  const sections: { id: ProfileSectionId; label: string }[] = [{ id: "overview", label: "Overview" }];
  if (view.hasServices) sections.push({ id: "services", label: "Services" });
  if (view.hasPortfolio) sections.push({ id: "portfolio", label: "Portfolio" });
  if (view.hasStartingPrice || view.hasBusinessHours || view.hasServiceArea) {
    sections.push({ id: "details", label: "Details" });
  }
  return sections;
}

/** Up to four published facts for the hero. Never padded with placeholders. */
export function profileQuickFacts(view: VendorPublicProfileView): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  if (view.startingPrice) facts.push({ label: "Starting from", value: view.startingPrice });
  if (view.hasServiceArea) facts.push({ label: "Service area", value: view.serviceAreas.join(", ") });
  if (view.businessHours) facts.push({ label: "Business hours", value: view.businessHours });
  if (view.hasPortfolio) {
    facts.push({
      label: "Project photos",
      value: `${view.portfolio.length} ${view.portfolio.length === 1 ? "photo" : "photos"}`,
    });
  }
  if (facts.length < 4 && view.hasServices) {
    facts.push({
      label: "Listed services",
      value: `${view.services.length} ${view.services.length === 1 ? "service" : "services"}`,
    });
  }
  return facts.slice(0, 4);
}
