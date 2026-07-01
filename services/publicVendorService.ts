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
// "False Ceiling") — NOT the public category-page names. Those are vendor
// SERVICES, not public categories: we only use them to map a vendor onto the
// existing public category pages (see PUBLIC_CATEGORY_SERVICE_ALIASES). We never
// add them as new public categories.
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
import { getVendorBySlug, type QuickFurnoCategory, type Vendor } from "@/lib/quickfurno-data";

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
    "False Ceiling",
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
    "False Ceiling",
    "Civil",
    "Renovation",
    "Home Renovation",
    "Tiling",
    "POP",
    "Waterproofing",
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
      .order("rating", { ascending: false })
      .limit(250);

    if (error || !Array.isArray(data)) {
      console.warn("[public vendors] vendors table unavailable; falling back to static", {
        message: error?.message,
      });
      return null;
    }

    const rows = data as VendorRow[];
    const mapped = rows
      .filter((row) => matchesPublicCategory(row, category))
      .flatMap((row) => {
        const visibility = getVendorPublicVisibility(row, runtimeSettings);
        if (!visibility.isPubliclyVisible) return [];
        const vendor = mapToPublicVendor(row, category, visibility.visibilityType);
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
 * Public vendor profile for `/vendors/[id]`, resolved from Supabase first and the
 * static demo catalog second. Returns `null` when the vendor should not be shown
 * so the caller can `notFound()`:
 *   - Supabase row found + publicly visible → mapped safe Vendor.
 *   - Supabase row found but hidden (pending/rejected/suspended/inactive, or a
 *     free vendor while `show_free_vendors_publicly` is off) → null (404).
 *   - No Supabase row / read error → fall back to static `getVendorBySlug`
 *     (which applies the same free-visibility rule), else null.
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
      const visibility = getVendorPublicVisibility(row, runtimeSettings);
      if (!visibility.isPubliclyVisible) return null;
      return mapToPublicVendor(row, resolveVendorCategory(row), visibility.visibilityType);
    }
  } catch (error) {
    console.warn("[public vendor profile] unexpected error; falling back to static", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  // Static demo fallback (applies its own free-visibility rule). Tag it so the
  // profile page knows it may show the demo services/portfolio/reviews.
  const staticVendor = getVendorBySlug(key, {
    showFreeVendorsPublicly: runtimeSettings.show_free_vendors_publicly,
  });
  return staticVendor ? { ...staticVendor, source: "static" } : null;
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
): Vendor | null {
  const id = asText(row.id);
  if (!id) return null;

  const city = normalizeCity(row);
  // Paid + trial vendors use the standard (QuickFurno-brokered) contact path;
  // free/unpaid vendors get activePaidPlan=false so the card only exposes the
  // gated interest flow. This is a DISPLAY flag — lead-assignment eligibility is
  // decided separately and free vendors stay ineligible there.
  const activePaidPlan = visibilityType === "paid" || visibilityType === "trial";

  const ratingNum = Number(row.rating);
  const rating = Number.isFinite(ratingNum) && ratingNum > 0 ? ratingNum : 4.2;

  const startingPrice = asText(row.starting_price);
  const experience = asText(row.experience) ?? asText(row.years_experience) ?? "Verified Team";
  // Real, canonical public service labels the vendor actually provides. Legacy
  // service tags ("Modular Kitchen", "Carpentry", …) are folded to their public
  // category; ambiguous services (Wardrobe, False Ceiling) are dropped so the
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
    reviews: 0,
    rate: startingPrice ?? "Price on request",
    experience,
    responseTime: "Quick response expected",
    activePaidPlan,
    verified: normalizeStatus(row.status) === "approved",
    status: "active",
    description: `Verified local QuickFurno ${category.toLowerCase()} for home-service requirements in ${city}.`,
    imageTone: IMAGE_TONE_BY_CATEGORY[category] ?? "warm-suite",
    // Only expose LOCAL image paths. External/storage URLs are dropped so
    // next/image never renders a host that isn't whitelisted (would crash the
    // profile header); the card/header fall back to category imagery instead.
    imageUrl: localImageUrl(row.profile_image_url),
    source: "supabase",
    serviceCategories,
    portfolioImages: realPortfolioImages(row),
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
  for (const key of ["business_type", "category", "subcategory", "selected_category"]) {
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

/** Public city is constrained to Pune | Mumbai; anything else defaults to Pune. */
function normalizeCity(row: VendorRow): "Pune" | "Mumbai" {
  const raw = (asText(row.city) ?? asText(row.office_city) ?? "").toLowerCase();
  return raw.includes("mumbai") ? "Mumbai" : "Pune";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Accept only local `/…` image paths; drop external URLs (unconfigured next/image hosts crash). */
function localImageUrl(value: unknown): string | undefined {
  const text = asText(value);
  return text && text.startsWith("/") ? text : undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** True when a query failed only because an optional column (slug/public_slug) does not exist. */
function isMissingColumnError(error: { code?: string | null; message?: string | null }): boolean {
  return error?.code === "42703" || /column .* does not exist/i.test(error?.message ?? "");
}
