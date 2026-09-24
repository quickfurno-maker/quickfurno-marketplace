// ============================================================================
// QuickFurno — services/publicVendorService.ts   (SERVER ONLY)
//
// Phase 25A: public category listings + profile pages read approved/active
// vendors from the Supabase `vendors` table instead of static demo data. This
// service is the ONLY place that maps a private Supabase vendor row into the safe
// public `Vendor` shape rendered by <VendorCards /> / <VendorCompactCard />.
//
// Category matching: real vendor rows store trades in `service_categories`
// (e.g. "Full Home Interior", "Modular Kitchen", "Carpentry", "Wardrobe",
// "Tiling") — NOT the public category-page names. Those are vendor SERVICES,
// not public categories: we only use them to map a vendor onto the existing
// public category pages (see PUBLIC_CATEGORY_SERVICE_ALIASES). False Ceiling was
// promoted from a service to its own public category in the Pune launch update.
//
// Hard rules honoured here:
//   • adminClient() is used server-side only — the service role never reaches the
//     browser. We select("*") for defensive reads but ONLY whitelisted fields are
//     mapped out; phone / whatsapp / email / user_id / addresses / gst / payment
//     details are NEVER returned.
//   • Visibility via getVendorPublicVisibility (single source of truth):
//       - paid  approved+active            → shown
//       - trial approved+active            → shown only if trial visibility on
//       - free  approved+active            → shown only if show_free_vendors_publicly
//       - pending / rejected / suspended / inactive → never shown
//   • Free/unpaid vendors map to activePaidPlan=false → gated "Request Callback"
//     interest flow only. They never get the paid Call/WhatsApp/lead-assignment
//     path (no WhatsApp, no credits, no auto-assignment).
// ============================================================================
import { adminClient } from "@/lib/supabase";
import {
  loadMarketplaceRuntimeSettings,
  type MarketplaceRuntimeSettings,
} from "@/lib/lead-assignment/runtimeSettings";
import { getVendorPublicVisibility } from "@/lib/vendors/vendorVisibility";
import { normalizeStatus } from "@/lib/vendors/vendorEligibility";
import { type QuickFurnoCategory, type Vendor } from "@/lib/quickfurno-data";
import { normalizeLocalities } from "@/lib/locality";
import { LAUNCH_CITY, normalizeLaunchCity } from "@/lib/locations/launchCityPolicy";
import {
  getApprovedReviewsForVendor,
  getApprovedReviewStatsForVendors,
  type VendorReviewSummary,
} from "@/services/vendorReviewService";

type VendorRow = Record<string, unknown>;

/** Category → neutral image tone used by the card when a vendor has no imagery. */
const IMAGE_TONE_BY_CATEGORY: Record<QuickFurnoCategory, string> = {
  "Interior Designers": "warm-suite",
  "Premium Interiors": "warm-suite",
  "Modular Factory": "kitchen-line",
  Carpenters: "wood-craft",
  Sofa: "sofa-studio",
  Painter: "paint-finish",
  "Civil Work": "civil-reno",
  "False Ceiling": "warm-suite",
};

/**
 * Maps a public category page to the vendor `service_categories` values that
 * should surface a vendor there. Each list leads with the canonical PUBLIC
 * category name (what new registrations now store) and also keeps the legacy
 * enquiry-service values older rows may hold for backward compatibility:
 *   "Modular Kitchen" → Modular Factory · "Carpentry" → Carpenters ·
 *   "Full Home Interior" → Interior Designers/Premium Interiors ·
 *   "Painting" → Painter · "Home Renovation" → Civil Work ·
 *   "Custom Sofa & Upholstery" → Sofa.
 * These aliases are SERVICES, not categories — they only decide which existing
 * category page a vendor appears on. Overlap is intentional.
 */
const PUBLIC_CATEGORY_SERVICE_ALIASES: Record<QuickFurnoCategory, string[]> = {
  "Interior Designers": [
    "Interior Designers",
    "Full Home Interior",
    "Home Interior",
    "Interior",
    "Interiors",
    "Interior Design",
    "Interior Designer",
    "Modular Kitchen",
    "Wardrobe",
  ],
  "Premium Interiors": [
    "Full Home Interior",
    "Premium Interior",
    "Premium Interiors",
    "Interior",
    "Interiors",
    "Modular Kitchen",
    "Wardrobe",
  ],
  "Modular Factory": [
    "Modular Kitchen",
    "Modular",
    "Modular Factory",
    "Kitchen",
    "Wardrobe",
    "Factory Finish",
  ],
  Carpenters: [
    "Carpentry",
    "Carpenter",
    "Carpenters",
    "Wardrobe",
    "Custom Furniture",
    "Furniture",
    "Woodwork",
    "TV Unit",
  ],
  "Civil Work": [
    "Civil Work",
    "Civil",
    "Renovation",
    "Home Renovation",
    "Tiling",
    "Waterproofing",
  ],
  "False Ceiling": [
    "False Ceiling",
    "POP",
    "POP Ceiling",
    "Gypsum Ceiling",
    "Ceiling",
  ],
  Painter: ["Painter", "Painting", "Paint", "Texture", "Waterproofing"],
  Sofa: ["Sofa", "Sofa Maker", "Sofa Makers", "Custom Sofa & Upholstery", "Upholstery", "Recliner"],
};

/** Priority for resolving a vendor's single primary category (most specific first). */
const CATEGORY_RESOLUTION_PRIORITY: QuickFurnoCategory[] = [
  "Sofa",
  "Painter",
  "Civil Work",
  "Carpenters",
  "Modular Factory",
  "Interior Designers",
  "Premium Interiors",
  // Last on purpose: an interior or civil vendor who also ticks False Ceiling
  // keeps their main category; only ceiling-only vendors resolve here.
  "False Ceiling",
];

/**
 * Approved + active vendors for a public category page, mapped to the safe
 * `Vendor` shape. Returns `null` when the vendors table could not be read so the
 * caller can fall back to the static demo listing without crashing the page.
 * A successful-but-empty result returns `[]` (the "arriving soon" empty state).
 */
export async function getPublicVendorsForCategory(
  category: QuickFurnoCategory,
  settings?: MarketplaceRuntimeSettings,
): Promise<Vendor[] | null> {
  try {
    const runtimeSettings = settings ?? (await loadMarketplaceRuntimeSettings());

    const { data, error } = await adminClient()
      .from("vendors")
      .select("*")
      .ilike("city", LAUNCH_CITY)
      .order("rating", { ascending: false })
      .limit(250);

    if (error || !Array.isArray(data)) {
      console.warn("[public vendors] vendors table unavailable; falling back to static", {
        message: error?.message,
      });
      return null;
    }

    const rows = data as VendorRow[];
    const candidates = rows
      .filter((row) => matchesPublicCategory(row, category))
      .flatMap((row) => {
        const visibility = getVendorPublicVisibility(row, runtimeSettings);
        return visibility.isPubliclyVisible ? [{ row, visibilityType: visibility.visibilityType }] : [];
      });
    const reviewStats = await getApprovedReviewStatsForVendors(
      candidates.map(({ row }) => asText(row.id)).filter((id): id is string => Boolean(id)),
    );
    const mapped = candidates.flatMap(({ row, visibilityType }) => {
      const id = asText(row.id);
      const stats = id ? reviewStats.get(id) : undefined;
      const vendor = mapToPublicVendor(row, category, visibilityType, stats ? { ...stats, reviews: [] } : undefined);
      return vendor ? [vendor] : [];
    });

    // Temporary safe debug aid (no phone/email/secrets/private notes).
    console.info("[public vendors] category match", {
      category,
      totalFetched: rows.length,
      visibleCount: mapped.length,
      showFreeVendorsPublicly: runtimeSettings.show_free_vendors_publicly,
      sampleServices: rows.slice(0, 5).map((row) => row.service_categories),
    });

    return mapped;
  } catch (error) {
    console.warn("[public vendors] unexpected error; falling back to static", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

/**
 * Live public vendor count per category, for the homepage cards.
 *
 * Shares matchesPublicCategory and getVendorPublicVisibility with
 * getPublicVendorsForCategory above ON PURPOSE, against a single fetch rather
 * than one per category. If the two ever drifted apart, a card would advertise
 * a number the category page does not actually list — worse than no number at
 * all, and exactly the kind of thing nobody notices until a customer does.
 *
 * Returns null when the table is unreachable so callers can hide the count
 * instead of rendering a confident zero.
 */
export async function getPublicVendorCountsByCategory(
  categories: readonly QuickFurnoCategory[],
  settings?: MarketplaceRuntimeSettings,
): Promise<Map<QuickFurnoCategory, number> | null> {
  try {
    const runtimeSettings = settings ?? (await loadMarketplaceRuntimeSettings());

    const { data, error } = await adminClient()
      .from("vendors")
      .select("*")
      .ilike("city", LAUNCH_CITY)
      .limit(500);

    if (error || !Array.isArray(data)) {
      console.warn("[public vendor counts] vendors table unavailable", { message: error?.message });
      return null;
    }

    const visible = (data as VendorRow[]).filter(
      (row) => getVendorPublicVisibility(row, runtimeSettings).isPubliclyVisible,
    );

    const counts = new Map<QuickFurnoCategory, number>();
    for (const category of categories) {
      counts.set(category, visible.filter((row) => matchesPublicCategory(row, category)).length);
    }

    console.info("[public vendor counts]", Object.fromEntries(counts));
    return counts;
  } catch (error) {
    console.warn("[public vendor counts] unexpected error", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

/**
 * Public vendor profile for `/vendors/[id]`. Resolved from Supabase ONLY.
 * Returns `null` whenever the vendor must not be shown, so the caller 404s:
 *   - Supabase row found + publicly visible → mapped safe Vendor.
 *   - Supabase row found but hidden (pending/rejected/suspended/inactive, or a
 *     free vendor while `show_free_vendors_publicly` is off) → null (404).
 *   - No Supabase row → null (404).
 *   - Read failure → null (404), i.e. FAIL CLOSED.
 *
 * QF-UI-V2-07: the static demo fallback was REMOVED. It previously resolved an
 * unknown id, or any read failure, against the demo catalog and returned it
 * tagged `source: "static"`, so a direct URL could publish a fictional business
 * as a live "QuickFurno Verified Vendor" complete with invented rating, rates
 * and portfolio. A lookup miss and a read failure are not distinguishable here
 * (fetchVendorRowByColumn returns null for both), so this fails closed rather
 * than guessing — publishing fiction is strictly worse than a 404.
 */
export async function getPublicVendorProfileBySlugOrId(
  slugOrId: string,
  settings?: MarketplaceRuntimeSettings,
): Promise<Vendor | null> {
  const key = (slugOrId ?? "").trim();
  if (!key) return null;

  const runtimeSettings = settings ?? (await loadMarketplaceRuntimeSettings());

  try {
    // Our public links use the vendor id (uuid). Only query by id for uuids to
    // avoid a uuid-cast error, and try optional slug columns otherwise — each
    // guarded so a not-yet-existing column simply yields "not found".
    const row = isUuid(key)
      ? await fetchVendorRowByColumn("id", key)
      : (await fetchVendorRowByColumn("slug", key)) ?? (await fetchVendorRowByColumn("public_slug", key));

    if (row) {
      if (!normalizeCity(row)) return null;
      const visibility = getVendorPublicVisibility(row, runtimeSettings);
      if (!visibility.isPubliclyVisible) return null;
      const id = asText(row.id);
      if (!id) return null;
      const reviewSummary = await getApprovedReviewsForVendor(id);
      return mapToPublicVendor(row, resolveVendorCategory(row), visibility.visibilityType, reviewSummary);
    }
  } catch (error) {
    console.warn("[public vendor profile] unexpected error; failing closed (404)", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  // No static demo fallback. See the doc comment above: an unresolved lookup
  // fails closed to null (404) so demo data can never masquerade as a real
  // public vendor profile.
  return null;
}

/** Fetch a single vendor row by an exact column match. Returns null on "not found"
 *  AND on error (a missing optional column is swallowed quietly). */
async function fetchVendorRowByColumn(column: string, value: string): Promise<VendorRow | null> {
  const { data, error } = await adminClient()
    .from("vendors")
    .select("*")
    .eq(column, value)
    .limit(1);

  if (error) {
    if (!isMissingColumnError(error)) {
      console.warn("[public vendor profile] lookup failed", { column, message: error.message });
    }
    return null;
  }
  return (data?.[0] as VendorRow) ?? null;
}

/** Map ONE Supabase vendor row to the safe public Vendor shape (or null if invalid). */
function mapToPublicVendor(
  row: VendorRow,
  category: QuickFurnoCategory,
  visibilityType: string,
  reviewSummary?: VendorReviewSummary,
): Vendor | null {
  const id = asText(row.id);
  if (!id) return null;

  const city = normalizeCity(row);
  if (!city) return null;
  // Paid + trial vendors use the standard (QuickFurno-brokered) contact path;
  // free/unpaid vendors get activePaidPlan=false so the card only exposes the
  // gated interest flow. This is a DISPLAY flag — lead-assignment eligibility is
  // decided separately and free vendors stay ineligible there.
  const activePaidPlan = visibilityType === "paid" || visibilityType === "trial";

  // Public rating truth comes only from APPROVED vendor_reviews rows.
  // The legacy vendors.rating column is not treated as evidence.
  const rating = reviewSummary?.averageRating ?? 0;
  const reviewCount = reviewSummary?.reviewCount ?? 0;

  const startingPrice = asText(row.starting_price);
  const publicDescription = asText(row.public_description);
  const serviceAreaSummary = asText(row.public_service_area_summary);
  const businessHours = asText(row.public_business_hours);
  const experience = asText(row.experience) ?? asText(row.years_experience) ?? "Verified Team";
  // Real, canonical public service labels the vendor actually provides. Legacy
  // service tags ("Modular Kitchen", "Carpentry", …) are folded to their public
  // category; ambiguous services (e.g. Wardrobe) are dropped so the
  // profile never invents services the vendor did not choose.
  const serviceCategories = canonicalServiceLabels(row);
  const subCategory = serviceCategories[0] ?? category;

  return {
    slug: id,
    businessName: asText(row.business_name) ?? asText(row.owner_name) ?? "Verified QuickFurno Vendor",
    city,
    category,
    subCategory,
    rating,
    reviews: reviewCount,
    reviewItems: reviewSummary?.reviews ?? [],
    rate: startingPrice ?? "Price on request",
    experience,
    responseTime: "Quick response expected",
    activePaidPlan,
    verified: normalizeStatus(row.status) === "approved",
    status: "active",
    description: publicDescription ?? `Verified local QuickFurno ${category.toLowerCase()} for home-service requirements in ${city}.`,
    imageTone: IMAGE_TONE_BY_CATEGORY[category] ?? "warm-suite",
    // QF-UI-V2-07: expose the APPROVED profile/cover URL as stored — a local
    // `/path` or an approved http(s) URL. These were previously dropped unless
    // local, so an approved external link the vendor profile editor accepts
    // never appeared publicly. Consumers decide how to render: the profile uses
    // a plain <img> for external URLs (never next/image, which would need a host
    // allowlist, and never a server-side fetch), while the listing card keeps
    // its own local-only guard so next/image there is unaffected.
    // publicImageUrl still rejects javascript:/data:/protocol-relative URLs.
    imageUrl: publicImageUrl(row.profile_image_url),
    coverImageUrl: publicImageUrl(row.cover_image_url),
    businessHours,
    serviceAreaSummary,
    source: "supabase",
    serviceCategories,
    portfolioImages: realPortfolioImages(row),
    // Operating facts the vendor entered themselves. Previously dropped here,
    // which is why the listing card could only show a name and a price while
    // the data sat in the row. Localities are normalised because the same area
    // arrives spelled three ways ("Kharadi" / "kharadi" / "khardi").
    areas: normalizeLocalities(row.areas_covered),
    businessType: asText(row.business_type) ?? null,
    teamSize: asText(row.team_size) ?? null,
    serviceRadiusKm: typeof row.service_radius_km === "number" ? row.service_radius_km : null,
    monthlyCapacity: asText(row.monthly_capacity) ?? null,
  };
}

/** Direct legacy service-tag → canonical public category map (for older vendor rows). */
const LEGACY_SERVICE_TO_CANONICAL: Record<string, QuickFurnoCategory> = {
  "modular kitchen": "Modular Factory",
  carpentry: "Carpenters",
  "full home interior": "Interior Designers",
  "home interior": "Interior Designers",
  "interior design": "Interior Designers",
  "interior designer": "Interior Designers",
  "premium interior design": "Premium Interiors",
  "premium interior": "Premium Interiors",
  painting: "Painter",
  "home renovation": "Civil Work",
  renovation: "Civil Work",
  "custom sofa & upholstery": "Sofa",
  upholstery: "Sofa",
  pop: "False Ceiling",
  "pop ceiling": "False Ceiling",
  "gypsum ceiling": "False Ceiling",
};

const CANONICAL_CATEGORY_BY_KEY = new Map<string, QuickFurnoCategory>(
  (Object.keys(PUBLIC_CATEGORY_SERVICE_ALIASES) as QuickFurnoCategory[]).map((c) => [normalizeText(c), c]),
);

/** Distinct canonical public category labels the vendor's service_categories map to. */
function canonicalServiceLabels(row: VendorRow): string[] {
  const seen = new Set<QuickFurnoCategory>();
  const labels: QuickFurnoCategory[] = [];
  for (const raw of coerceServiceValues(row.service_categories)) {
    const key = normalizeText(raw);
    const canonical = CANONICAL_CATEGORY_BY_KEY.get(key) ?? LEGACY_SERVICE_TO_CANONICAL[key];
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      labels.push(canonical);
    }
  }
  return labels;
}

/** Real vendor-uploaded portfolio image URLs (http(s) or local paths only). */
function realPortfolioImages(row: VendorRow): string[] {
  return coerceServiceValues(row.portfolio_urls)
    .filter((url) => /^https?:\/\//i.test(url) || url.startsWith("/"))
    .slice(0, 12);
}

/** Resolve a vendor's own primary category from its service values (defaults to Interior Designers). */
function resolveVendorCategory(row: VendorRow): QuickFurnoCategory {
  for (const category of CATEGORY_RESOLUTION_PRIORITY) {
    if (matchesPublicCategory(row, category)) return category;
  }
  return "Interior Designers";
}

/**
 * True when the vendor's service values map onto the given public category. Uses
 * loose, bidirectional substring matching against the alias list so real trade
 * names ("Full Home Interior", "Modular Kitchen", …) surface on the right pages.
 */
function matchesPublicCategory(row: VendorRow, publicCategory: QuickFurnoCategory): boolean {
  // Premium Interiors is a PRICE TIER, not a trade.
  //
  // It used to share the aliases "Interior" and "Interiors" with Interior
  // Designers, so the two pages returned an identical list of vendors. A
  // category that answers exactly the same as another category is not a
  // category, it is a second door into the same room — and a homeowner who
  // picks "Premium Interiors" is telling you something about budget, not about
  // trade. So membership is decided by the vendor's own published rate.
  if (publicCategory === "Premium Interiors") {
    const rate = startingRatePerSqft(row);
    if (rate === null || rate < PREMIUM_MIN_RATE_PER_SQFT) return false;
    // Still has to be interior work — a premium-priced painter is not this.
    return matchesByAlias(row, "Interior Designers") || matchesByAlias(row, "Modular Factory");
  }
  return matchesByAlias(row, publicCategory);
}

/** The per-sqft floor for the Premium Interiors page. */
const PREMIUM_MIN_RATE_PER_SQFT = 1200;

/**
 * A vendor's published rate as a plain per-sqft number, or null.
 *
 * Only a per-sqft rate can be compared: "Under ₹50,000" and "₹50,000 – ₹1 lakh"
 * are project budgets, not rates, and treating "50,000" as a sqft price would
 * put a budget vendor at the top of the premium page.
 */
function startingRatePerSqft(row: VendorRow): number | null {
  const raw = asText(row.starting_price);
  if (!raw || !/sq\s*\.?\s*ft/i.test(raw)) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const value = Number(digits);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The original alias matcher, unchanged, now reachable on its own. */
function matchesByAlias(row: VendorRow, publicCategory: QuickFurnoCategory): boolean {
  const aliases = PUBLIC_CATEGORY_SERVICE_ALIASES[publicCategory].map(normalizeText).filter(Boolean);
  const values = extractVendorServiceValues(row).map(normalizeText).filter(Boolean);
  if (values.length === 0 || aliases.length === 0) return false;
  return values.some((value) =>
    aliases.some((alias) => value.includes(alias) || alias.includes(value)),
  );
}

/**
 * All service-like text values on a vendor row, read defensively (columns and
 * shapes vary: text[]/jsonb array, JSON string, comma string, or single text).
 * `selected_category` is read only if it happens to exist on the row — never
 * selected directly.
 */
function extractVendorServiceValues(row: VendorRow): string[] {
  const values: string[] = [
    ...coerceServiceValues(row.service_categories),
    ...coerceServiceValues(row.services),
    ...coerceServiceValues(row.selected_subcategories),
  ];
  // `business_type` is NOT in this list, and must not be added back. It
  // describes the vendor's PREMISES — "Factory", "Showroom",
  // "Home-based / On-site" — not the trade they practise. Feeding it to a
  // matcher that compares substrings bidirectionally made every vendor whose
  // business_type is "Factory" match the "Modular Factory" category, because
  // that category lists "Factory Finish" as an alias and
  // "factory finish".includes("factory") is true. Two interior designers were
  // being listed on /category/modular-factory as verified modular factories.
  for (const key of ["category", "subcategory", "selected_category"]) {
    const single = asText(row[key]);
    if (single) values.push(single);
  }
  return values;
}

/** Coerce a service field into a list of strings across all shapes it may take. */
function coerceServiceValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(coerceServiceValues);
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.flatMap(coerceServiceValues);
      if (parsed && typeof parsed === "object") return Object.values(parsed).flatMap(coerceServiceValues);
      if (typeof parsed === "string" && parsed.trim()) return [parsed.trim()];
    } catch {
      // not valid JSON — fall through to comma split
    }
  }
  return text.split(",").map((part) => part.trim()).filter(Boolean);
}

/** Public city is Pune-only during launch; unsupported explicit cities fail closed. */
function normalizeCity(row: VendorRow): "Pune" | null {
  const serviceCity = asText(row.city);
  if (serviceCity) return normalizeLaunchCity(serviceCity);
  return normalizeLaunchCity(row.office_city);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Accept a local `/…` path or an approved http(s) URL; reject everything else.
 * Protocol-relative `//host` is rejected because it silently inherits the page
 * scheme, and javascript:/data:/file: are rejected outright. This does not widen
 * what an admin has approved — it only stops approved external URLs being
 * discarded on the way out.
 */
function publicImageUrl(value: unknown): string | undefined {
  const text = asText(value);
  if (!text) return undefined;
  if (text.startsWith("//")) return undefined;
  if (text.startsWith("/")) return text;
  return /^https?:\/\//i.test(text) ? text : undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** True when a query failed only because an optional column (slug/public_slug) does not exist. */
function isMissingColumnError(error: { code?: string | null; message?: string | null }): boolean {
  return error?.code === "42703" || /column .* does not exist/i.test(error?.message ?? "");
}
