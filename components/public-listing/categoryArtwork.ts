/**
 * QF-UI-V2-16 — neutral category artwork map.
 *
 * TRUTHFULNESS CONTRACT
 * These illustrations depict a SERVICE, never a vendor. They are only ever used
 * on category-level surfaces (the category page header and its empty/unavailable
 * state). They must NOT be used as:
 *   - a vendor listing thumbnail   (that stays: vendor's own image -> initials)
 *   - a vendor profile photo       (that stays: approved media -> neutral surface)
 *   - a project gallery item       (vendor-uploaded only; no synthesis)
 * so generic art can never be mistaken for a vendor's completed project, office,
 * workshop or logo.
 *
 * Pure and dependency-free (no `@/` alias) so the MVP suite can import it.
 * Keys are the EXISTING public taxonomy from lib/quickfurno-data.ts — this
 * module introduces no new business categories.
 */

const ART_DIR = "/assets/quickfurno/images/categories";

const ARTWORK_BY_CATEGORY: Record<string, string> = {
  "Interior Designers": `${ART_DIR}/interior-designers.svg`,
  Carpenters: `${ART_DIR}/carpenters.svg`,
  "Modular Factory": `${ART_DIR}/modular-factory.svg`,
  "Premium Interiors": `${ART_DIR}/premium-interiors.svg`,
  Sofa: `${ART_DIR}/sofa.svg`,
  Painter: `${ART_DIR}/painter.svg`,
  "Civil Work": `${ART_DIR}/civil-work.svg`,
};

/**
 * Local artwork for a category, or null when the name is not a known category.
 * Returning null (rather than a generic default) keeps the caller honest: a
 * surface with no matching artwork simply renders no artwork.
 */
export function categoryArtwork(categoryName: string): string | null {
  if (typeof categoryName !== "string") return null;
  return ARTWORK_BY_CATEGORY[categoryName.trim()] ?? null;
}

/** The categories that have artwork — used by tests to prove full coverage. */
export function categoriesWithArtwork(): string[] {
  return Object.keys(ARTWORK_BY_CATEGORY);
}
