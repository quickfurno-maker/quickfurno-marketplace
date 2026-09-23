// ============================================================================
// QuickFurno — Pune locality normalisation
//
// `vendors.areas_covered` is free text a vendor typed during signup, so the
// same locality arrives in several spellings. Today's table holds all of:
//
//     "Kharadi"  "kharadi"  "khardi"
//     "dhanori"  "Dhanori"
//     "piple saudagar"   (Pimple Saudagar)
//     "vishantwaadi"     (Vishrantwadi)
//
// Rendered raw, one vendor reads as serving "khardi" and the next "Kharadi",
// and an area filter built on the raw strings offers three Kharadis that each
// match a different subset. This maps what vendors typed onto the canonical
// Pune locality list the rest of the product uses.
//
// This is a DISPLAY and GROUPING helper. It never writes back — the vendor's
// own value stays as they entered it, and fixing the source data is a separate
// migration. An unrecognised locality is title-cased and passed through rather
// than dropped, so a genuinely new area still shows.
// ============================================================================

/** Canonical Pune localities, grouped the way the category page presents them. */
export const PUNE_ZONES: ReadonlyArray<{ zone: string; areas: readonly string[] }> = [
  {
    zone: "East Pune",
    areas: ["Kharadi", "Viman Nagar", "Kalyani Nagar", "Koregaon Park", "Mundhwa",
            "Keshav Nagar", "Wagholi", "Hadapsar", "Magarpatta", "Manjri",
            "Lohegaon", "Dhanori"],
  },
  {
    zone: "West Pune",
    areas: ["Baner", "Balewadi", "Aundh", "Pashan", "Sus", "Bavdhan", "Kothrud",
            "Karve Nagar", "Erandwane", "Warje", "Wakad", "Hinjewadi"],
  },
  {
    zone: "Central Pune",
    areas: ["Shivajinagar", "Deccan", "Model Colony", "Camp", "Swargate",
            "Yerawada", "Vishrantwadi"],
  },
  {
    zone: "South Pune",
    areas: ["Kondhwa", "NIBM", "Undri", "Wanowrie", "Bibwewadi", "Katraj",
            "Sinhagad Road", "Dhayari", "Ambegaon"],
  },
  {
    zone: "Pimpri–Chinchwad",
    areas: ["Pimpri-Chinchwad", "Pimple Saudagar", "Pimple Nilakh", "Pimple Gurav",
            "Ravet", "Tathawade", "Punawale", "Nigdi", "Akurdi", "Moshi"],
  },
] as const;

const CANONICAL: readonly string[] = PUNE_ZONES.flatMap((z) => z.areas);

/**
 * Misspellings and variants seen in the live vendors table, plus the obvious
 * near-misses for each. Keys are compared after `squash()`, so case, spacing
 * and punctuation do not need repeating here.
 */
const ALIASES: Record<string, string> = {
  khardi: "Kharadi",
  kharadhi: "Kharadi",
  karadi: "Kharadi",
  vimannagar: "Viman Nagar",
  kalyaninagar: "Kalyani Nagar",
  koregaonpark: "Koregaon Park",
  kp: "Koregaon Park",
  keshavnagar: "Keshav Nagar",
  plesaudagar: "Pimple Saudagar",
  piplesaudagar: "Pimple Saudagar",
  pimplesaudagar: "Pimple Saudagar",
  pimplenilakh: "Pimple Nilakh",
  pimplegurav: "Pimple Gurav",
  pimprichinchwad: "Pimpri-Chinchwad",
  pcmc: "Pimpri-Chinchwad",
  vishantwaadi: "Vishrantwadi",
  vishrantwaadi: "Vishrantwadi",
  vishrantwadi: "Vishrantwadi",
  dhanori: "Dhanori",
  lohgaon: "Lohegaon",
  magarpattacity: "Magarpatta",
  karvenagar: "Karve Nagar",
  sinhagadroad: "Sinhagad Road",
  modelcolony: "Model Colony",
  nibmroad: "NIBM",
  wanawadi: "Wanowrie",
  wanowri: "Wanowrie",
};

/** Lowercase, strip everything that is not a letter or digit. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const BY_SQUASHED = new Map<string, string>();
for (const area of CANONICAL) BY_SQUASHED.set(squash(area), area);
for (const [alias, area] of Object.entries(ALIASES)) BY_SQUASHED.set(alias, area);

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => (word.length <= 2 && word === word.toUpperCase()
      ? word                                    // keep NIBM, KP as typed
      : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join(" ");
}

/**
 * One locality string → its canonical form. Unknown values are title-cased and
 * returned, never dropped: a vendor serving a locality we have not listed yet
 * still shows something true rather than nothing.
 */
export function normalizeLocality(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return BY_SQUASHED.get(squash(trimmed)) ?? titleCase(trimmed);
}

/**
 * A vendor's `areas_covered` → canonical, de-duplicated, order preserved.
 * Dedupe is the point: ["Kharadi", "khardi"] is one area, not two.
 */
export function normalizeLocalities(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const area = normalizeLocality(typeof raw === "string" ? raw : null);
    if (!area || seen.has(area)) continue;
    seen.add(area);
    out.push(area);
  }
  return out;
}

/** The zone a canonical locality sits in, for grouping a filter list. */
export function zoneForLocality(area: string): string | null {
  const canonical = normalizeLocality(area);
  if (!canonical) return null;
  for (const { zone, areas } of PUNE_ZONES) {
    if (areas.includes(canonical)) return zone;
  }
  return null;
}

/**
 * How a vendor's coverage reads on a card: the first area, plus a count of the
 * rest. "Kharadi" / "Kharadi +2 areas" — never a twelve-item list in a 269px
 * card, and never "undefined" when a vendor filled nothing in.
 */
export function coverageLabel(areas: readonly string[]): string | null {
  if (areas.length === 0) return null;
  if (areas.length === 1) return areas[0];
  return `${areas[0]} +${areas.length - 1} ${areas.length === 2 ? "area" : "areas"}`;
}
