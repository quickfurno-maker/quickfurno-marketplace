/**
 * Curated, license-clean (Unsplash) premium interior imagery.
 * Centralised here so real photos can be swapped/extended in one place.
 * `images.unsplash.com` is whitelisted in next.config.mjs for next/image optimisation.
 */
const u = (id: string, w = 1200) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

export const heroImage = u("1586023492125-27b2c045efd7", 1200); // bright modern living room

export const categoryImages: Record<string, string> = {
  "Interior Designers": u("1586023492125-27b2c045efd7"),
  "Carpenters": u("1600585152220-90363fe7e115"),
  "Modular Factory": u("1556909114-f6e7ad7d3136"),
  "Premium Interiors": u("1616594039964-ae9021a400a0"),
  "Sofa": u("1555041469-a586c61ea9bc"),
  "Painter": u("1562259949-e8e7689d7828"),
  "Civil Work": u("1503387762-592deb58ef4e"),
};

export function categoryImage(name: string): string {
  return categoryImages[name] ?? heroImage;
}
