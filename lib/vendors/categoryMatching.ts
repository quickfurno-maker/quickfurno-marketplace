// ============================================================================
// QuickFurno — lib/vendors/categoryMatching.ts
// Phase 26A-2C: intelligent lead↔vendor category compatibility for the admin
// "Assign Anyway" smart override. PURE + dependency-free — safe on client and
// server. It only answers "are these categories the same or closely related?";
// it never decides money/eligibility (paid/credits/status stay separate).
// ============================================================================

export type CategoryMatchType = "exact" | "synonym" | "subcategory" | "none";

export interface CategoryMatchResult {
  compatible: boolean;
  matchType: CategoryMatchType;
  reason: string;
}

// Canonical service groups. Public category labels and enquiry service labels
// both fold into these groups so organic leads can match paid/trial vendors
// even when the two sides store different but equivalent labels.
export const CANONICAL_CATEGORY_GROUPS: Record<string, string[]> = {
  "Interior Designers": [
    "interior designers", "full home interior", "home interior",
    "interior design", "interior designer", "interior", "interiors",
    "false ceiling",
  ],
  Carpenters: [
    "carpenters", "carpentry", "carpenter", "custom furniture",
    "furniture", "woodwork", "wood work", "wardrobe",
  ],
  "Modular Factory": [
    "modular factory", "modular kitchen", "kitchen", "factory finish",
    "factory made furniture", "machine finish furniture", "modular furniture",
    "wardrobe",
  ],
  "Premium Interiors": [
    "premium interiors", "premium interior", "premium interior design",
    "luxury interior",
  ],
  Sofa: [
    "sofa", "sofa maker", "sofa makers", "custom sofa & upholstery",
    "custom sofa and upholstery", "upholstery", "recliner", "sofa repair",
  ],
  Painter: ["painter", "painting", "paint", "texture painting", "wall painting"],
  "Civil Work": [
    "civil work", "civil", "home renovation", "renovation", "tiling",
    "tile work", "masonry", "pop", "plumbing civil", "waterproofing",
  ],
};

// normalized label -> canonical group names. Some services (for example
// Wardrobe) legitimately sit in more than one supply group.
const LABEL_TO_GROUPS: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const [group, labels] of Object.entries(CANONICAL_CATEGORY_GROUPS)) {
    for (const label of labels) {
      const key = normalizeCategory(label);
      const groups = map.get(key) ?? [];
      if (!groups.includes(group)) map.set(key, [...groups, group]);
    }
  }
  return map;
})();

/** lowercase, trim, collapse whitespace, light singular/plural fold. */
export function normalizeCategory(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = value.trim().toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ");
  if (!text) return "";
  // Light plural fold so "carpenters" == "carpenter", "interiors" == "interior".
  if (text.length > 4 && text.endsWith("s") && !text.endsWith("ss")) text = text.slice(0, -1);
  return text;
}

export function getCanonicalCategoryGroups(value: unknown): string[] {
  const normalized = normalizeCategory(value);
  if (!normalized) return [];
  return LABEL_TO_GROUPS.get(normalized) ?? [];
}

export function categoriesShareCanonicalGroup(left: unknown, right: unknown): boolean {
  const leftGroups = getCanonicalCategoryGroups(left);
  if (leftGroups.length === 0) return false;
  const rightGroups = new Set(getCanonicalCategoryGroups(right));
  return leftGroups.some((group) => rightGroups.has(group));
}

function collectTerms(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const n = normalizeCategory(item);
        if (n) out.push(n);
      }
    } else {
      const n = normalizeCategory(value);
      if (n) out.push(n);
    }
  }
  return [...new Set(out)];
}

type LeadLike = {
  category?: unknown;
  subcategory?: unknown;
  service_required?: unknown;
} & Record<string, unknown>;

type VendorLike = {
  service_categories?: unknown;
  selected_category?: unknown;
  selected_subcategories?: unknown;
  specializations?: unknown;
} & Record<string, unknown>;

/**
 * Is the vendor's service offering compatible with what the lead needs?
 *   exact       — a lead label equals a vendor label
 *   synonym     — a lead label and a vendor label share a synonym group
 *   subcategory — the lead subcategory matches a vendor category/label
 *   none        — unrelated
 */
export function isLeadVendorCategoryCompatible(lead: LeadLike, vendor: VendorLike): CategoryMatchResult {
  const leadPrimary = collectTerms(lead?.category, lead?.service_required);
  const leadSub = collectTerms(lead?.subcategory);
  const leadTerms = [...new Set([...leadPrimary, ...leadSub])];

  const vendorTerms = collectTerms(
    vendor?.service_categories,
    vendor?.selected_category,
    vendor?.selected_subcategories,
    vendor?.specializations,
  );

  if (leadTerms.length === 0 || vendorTerms.length === 0) {
    return { compatible: false, matchType: "none", reason: "No category information to compare" };
  }

  const vendorSet = new Set(vendorTerms);

  // 1) exact match on any primary term
  const exact = leadPrimary.find((term) => vendorSet.has(term));
  if (exact) return { compatible: true, matchType: "exact", reason: `Exact category match: ${exact}` };

  // 2) subcategory match (lead subcategory equals a vendor label)
  const subMatch = leadSub.find((term) => vendorSet.has(term));
  if (subMatch) return { compatible: true, matchType: "subcategory", reason: `Subcategory match: ${subMatch}` };

  // 3) synonym-group overlap
  const vendorGroups = new Map<string, string>(); // group -> vendor label
  for (const term of vendorTerms) {
    for (const group of getCanonicalCategoryGroups(term)) {
      if (!vendorGroups.has(group)) vendorGroups.set(group, term);
    }
  }
  for (const term of leadTerms) {
    const group = getCanonicalCategoryGroups(term).find((candidate) => vendorGroups.has(candidate));
    if (group) {
      return {
        compatible: true,
        matchType: "synonym",
        reason: `Related category (${group}): "${term}" ↔ "${vendorGroups.get(group)}"`,
      };
    }
  }

  return { compatible: false, matchType: "none", reason: "No related category or synonym match" };
}

// ---------------------------------------------------------------------------
// Phase 26A-2C: Interior parent-category group + fallback compatibility.
// During startup a lead should not stay unassigned just because exact
// subcategory vendors are scarce; any vendor in the SAME interior parent group
// is an acceptable manual fallback.
// ---------------------------------------------------------------------------
const INTERIOR_PARENT_LABELS = [
  "interior designers", "carpenters", "modular factory", "premium interiors",
  "full home interior", "home interior", "interiors", "interior",
  // common synonym-group members that still belong to the interior family
  "carpenter", "carpentry", "wood work", "woodwork", "furniture work", "wardrobe",
  "kitchen carpenter", "modular kitchen", "modular furniture", "turnkey interior",
  "complete interior",
];
const INTERIOR_PARENT_SET = new Set(INTERIOR_PARENT_LABELS.map(normalizeCategory));

/** Which interior subcategory a label maps to (or null if not interior). */
export function getInteriorSubcategory(value: unknown): string | null {
  const n = normalizeCategory(value);
  if (!n) return null;
  if (["interior designer", "interior", "home interior", "full home interior", "turnkey interior", "complete interior"].includes(n)) {
    return "Interior Designers";
  }
  if (["carpenter", "carpentry", "wood work", "woodwork", "furniture work", "wardrobe", "kitchen carpenter"].includes(n)) {
    return "Carpenters";
  }
  if (["modular factory", "modular kitchen", "modular furniture", "factory made furniture", "machine finish furniture"].includes(n)) {
    return "Modular Factory";
  }
  if (["premium interior"].includes(n) || n === "premium interiors") return "Premium Interiors";
  return INTERIOR_PARENT_SET.has(n) ? "Interior Designers" : null;
}

/** Is this label part of the Interior parent group? */
export function isInteriorParentCategory(value: unknown): boolean {
  return getInteriorSubcategory(value) !== null;
}

function leadTermList(lead: LeadLike): string[] {
  return collectTerms(lead?.category, lead?.service_required, lead?.subcategory);
}
function vendorTermList(vendor: VendorLike): string[] {
  return collectTerms(vendor?.service_categories, vendor?.selected_category, vendor?.selected_subcategories, vendor?.specializations);
}

/** Exact/synonym/subcategory match — the "best match" tier. */
export function isExactLeadVendorSubcategoryMatch(lead: LeadLike, vendor: VendorLike): boolean {
  return isLeadVendorCategoryCompatible(lead, vendor).compatible;
}

/**
 * Interior fallback: lead AND vendor both belong to the interior parent group,
 * but they are not an exact/synonym match. Used only when exact vendors are
 * scarce. Never a substitute for the hard money/status checks.
 */
export function isInteriorFallbackCompatible(lead: LeadLike, vendor: VendorLike): CategoryMatchResult {
  const leadInterior = leadTermList(lead).some(isInteriorParentCategory);
  const vendorInterior = vendorTermList(vendor).some(isInteriorParentCategory);
  if (!leadInterior || !vendorInterior) {
    return { compatible: false, matchType: "none", reason: "Category outside the interior group" };
  }
  const leadSub = leadTermList(lead).map(getInteriorSubcategory).find(Boolean) ?? "Interior";
  const vendorSub = vendorTermList(vendor).map(getInteriorSubcategory).find(Boolean) ?? "Interior";
  return {
    compatible: true,
    matchType: "synonym",
    reason: `Same interior parent group (lead ${leadSub} ↔ vendor ${vendorSub})`,
  };
}

// ---------------------------------------------------------------------------
// Phase 26A-2D: Parent category groups.
// One client is capped at 3 vendors PER PARENT CATEGORY GROUP (not globally and
// not per subcategory). All interior subcategories share one Interior cap;
// Sofa / Painting / Civil Work are separate groups. Unknown categories become
// their own group so they never collide with a mapped one. PURE + client-safe.
// ---------------------------------------------------------------------------
export const KNOWN_PARENT_CATEGORY_GROUPS = ["Interior", "Sofa", "Painting", "Civil Work"] as const;
export type KnownParentCategoryGroup = (typeof KNOWN_PARENT_CATEGORY_GROUPS)[number];

// Seed labels per group (normalised on load, so plural/case variants fold in).
const PARENT_GROUP_DEFINITIONS: Record<KnownParentCategoryGroup, string[]> = {
  Interior: [
    "full home interior", "home interior", "interiors", "interior", "interior designers",
    "interior designer", "premium interiors", "premium interior", "carpenters", "carpenter",
    "carpentry", "modular factory", "modular kitchen", "modular furniture", "wardrobe",
    "wood work", "woodwork", "furniture work", "false ceiling", "turnkey interior",
    "complete interior", "kitchen carpenter",
  ],
  Sofa: [
    "sofa", "sofa maker", "upholstery", "sofa repair", "sofa cleaning",
    "custom sofa & upholstery", "custom sofa and upholstery",
  ],
  Painting: ["painter", "painting", "wall painting", "texture painting"],
  "Civil Work": [
    "civil work", "renovation", "home renovation", "masonry", "tile work",
    "plumbing civil", "plumbing",
  ],
};

const LABEL_TO_PARENT_GROUP: Map<string, KnownParentCategoryGroup> = (() => {
  const map = new Map<string, KnownParentCategoryGroup>();
  for (const [group, labels] of Object.entries(PARENT_GROUP_DEFINITIONS) as [KnownParentCategoryGroup, string[]][]) {
    for (const label of labels) map.set(normalizeCategory(label), group);
  }
  return map;
})();

function titleCaseWords(normalized: string): string {
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The parent category GROUP for a category/service label (or array of labels).
 * Returns one of KNOWN_PARENT_CATEGORY_GROUPS, or — for unmapped categories — a
 * stable Title-Cased label so that category keeps its own separate group.
 * "General" is only returned when there is no category information at all.
 */
export function getParentCategoryGroup(value: unknown): string {
  const terms = collectTerms(value);
  for (const term of terms) {
    const group = LABEL_TO_PARENT_GROUP.get(term);
    if (group) return group;
  }
  // Interior backstop (covers synonym-only interior labels).
  for (const term of terms) {
    if (isInteriorParentCategory(term)) return "Interior";
  }
  const first = terms[0];
  return first ? titleCaseWords(first) : "General";
}

/** Does the vendor's service offering belong to the given parent category group? */
export function vendorMatchesParentGroup(vendor: VendorLike, group: string): boolean {
  const terms = vendorTermList(vendor);
  for (const term of terms) {
    if (getParentCategoryGroup(term) === group) return true;
  }
  return false;
}

export const CATEGORY_MATCHING_SMOKE_CASES = [
  ["Modular Kitchen", "Modular Factory"],
  ["Carpentry", "Carpenters"],
  ["Painting", "Painter"],
  ["Home Renovation", "Civil Work"],
  ["Premium Interior Design", "Premium Interiors"],
  ["Custom Sofa & Upholstery", "Sofa"],
  ["Full Home Interior", "Interior Designers"],
] as const;

export function verifyCategoryMatchingSmokeCases(): CategoryMatchResult[] {
  return CATEGORY_MATCHING_SMOKE_CASES.map(([leadService, vendorCategory]) =>
    isLeadVendorCategoryCompatible(
      { service_required: leadService },
      { service_categories: [vendorCategory] },
    ),
  );
}
