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

// Approved structure: Interior (4 subs) · Sofa · Painter · Civil Work.
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
];
