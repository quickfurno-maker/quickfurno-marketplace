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

// Synonym groups from the Phase 26A-2C brief. Each canonical group lists the
// labels that should be treated as the same service family.
const SYNONYM_GROUPS: Record<string, string[]> = {
  "Full Home Interior": [
    "full home interior", "interiors", "interior", "interior designers",
    "premium interiors", "home interior", "turnkey interior", "complete interior",
  ],
  "Carpenters": [
    "carpenters", "carpenter", "carpentry", "wood work", "woodwork",
    "furniture work", "wardrobe", "kitchen carpenter",
  ],
  "Modular Factory": [
    "modular factory", "modular kitchen", "modular furniture",
    "factory made furniture", "machine finish furniture",
  ],
  "Sofa": ["sofa", "sofa maker", "upholstery", "sofa repair"],
  "Painter": ["painter", "painting", "wall painting", "texture painting"],
  "Civil Work": ["civil work", "renovation", "masonry", "plumbing civil", "tile work"],
};

// normalized label -> canonical group name
const LABEL_TO_GROUP: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [group, labels] of Object.entries(SYNONYM_GROUPS)) {
    for (const label of labels) map.set(normalizeCategory(label), group);
  }
  return map;
})();

/** lowercase, trim, collapse whitespace, light singular/plural fold. */
export function normalizeCategory(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return "";
  // Light plural fold so "carpenters" == "carpenter", "interiors" == "interior".
  if (text.length > 4 && text.endsWith("s") && !text.endsWith("ss")) text = text.slice(0, -1);
  return text;
}

function groupOf(normalized: string): string | null {
  if (!normalized) return null;
  return LABEL_TO_GROUP.get(normalized) ?? null;
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
    const group = groupOf(term);
    if (group && !vendorGroups.has(group)) vendorGroups.set(group, term);
  }
  for (const term of leadTerms) {
    const group = groupOf(term);
    if (group && vendorGroups.has(group)) {
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
