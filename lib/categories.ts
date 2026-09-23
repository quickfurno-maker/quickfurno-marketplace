// ============================================================================
// QuickFurno — lib/categories.ts
// SINGLE SOURCE OF TRUTH for the public category structure.
// Used by BOTH the homepage category grid and the vendor registration Step 2 so
// the labels/structure never drift apart. Each leaf maps to a real marketplace
// category (`QuickFurnoCategory`) that has a /category/[slug] page; the canonical
// service tag for lead↔vendor matching is derived via enquiryServiceForCategory.
// ============================================================================
import type { QFIcon } from "@/components/QuickFurnoIcons";
import type { QuickFurnoCategory } from "@/lib/quickfurno-data";

type IconName = Parameters<typeof QFIcon>[0]["name"];

export type CategorySubItem = { label: string; category: QuickFurnoCategory };

export type MainCategory = {
  id: string;
  label: string;
  tagline: string;
  icon: IconName;
  /** Marketplace category page for leaf categories. Parent groups (e.g. Interior) omit it. */
  category?: QuickFurnoCategory;
  subcategories: CategorySubItem[];
};

// Approved structure: Interior (4 subs) · Sofa · Painter · Civil Work · False Ceiling.
export const mainCategories: MainCategory[] = [
  {
    id: "interior",
    label: "Interior",
    tagline: "Interior designers, carpenters, modular factories, and premium interiors.",
    icon: "home",
    subcategories: [
      { label: "Interior Designers", category: "Interior Designers" },
      { label: "Carpenters", category: "Carpenters" },
      { label: "Modular Factory", category: "Modular Factory" },
      { label: "Premium Interiors", category: "Premium Interiors" },
    ],
  },
  {
    id: "sofa",
    label: "Sofa",
    tagline: "Sofa makers, upholstery work, and recliner services.",
    icon: "sofa",
    category: "Sofa",
    subcategories: [],
  },
  {
    id: "painter",
    label: "Painter",
    tagline: "Interior, exterior, and texture painting.",
    icon: "paint",
    category: "Painter",
    subcategories: [],
  },
  {
    id: "civil-work",
    label: "Civil Work",
    tagline: "Renovation, masonry, and repair work.",
    icon: "civil",
    category: "Civil Work",
    subcategories: [],
  },
  {
    id: "false-ceiling",
    label: "False Ceiling",
    tagline: "POP and gypsum ceilings, cove lighting, and ceiling repair.",
    icon: "ceiling",
    category: "False Ceiling",
    subcategories: [],
  },
];

/**
 * Where a marketplace category sits in the Step 2 picker: the main category to
 * open, and the leaf to select inside it (empty when the main IS the leaf).
 *
 * Every "Become a vendor" link in the footer carries ?trade=<category-slug>,
 * and until now nothing read it — a carpenter following "Become a Vendor" from
 * the carpenters page landed on an empty picker and had to find their own trade
 * again. Returns null for an unknown category so the wizard simply starts blank
 * rather than guessing a trade on the vendor's behalf.
 */
export function signupSelectionForCategory(
  category: QuickFurnoCategory | null | undefined,
): { categoryId: string; subCategory: string } | null {
  if (!category) return null;
  for (const main of mainCategories) {
    if (main.category === category) return { categoryId: main.id, subCategory: "" };
    const sub = main.subcategories.find((item) => item.category === category);
    if (sub) return { categoryId: main.id, subCategory: sub.label };
  }
  return null;
}
