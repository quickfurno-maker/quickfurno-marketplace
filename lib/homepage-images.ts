// ============================================================================
// QuickFurno — lib/homepage-images.ts (server only)
//
// REAL-PHOTO SLOTS for the launch homepage. The page ships with illustrated
// SVG fallbacks; the moment a real photo is dropped into
//
//     public/assets/quickfurno/images/real/
//
// under the documented name, the homepage picks it up automatically on the
// next deploy/build — no code change. See that folder's README.md for the
// exact file list to hand to whoever exports the photos.
//
// HONESTY RULE: no stock-photo fallbacks are bundled here. Until real project
// photos exist, the page keeps its clearly illustrative artwork rather than
// pretending someone else's interiors are QuickFurno work.
// ============================================================================
import fs from "fs";
import path from "path";

const REAL_URL_BASE = "/assets/quickfurno/images/real";
const REAL_FS_BASE = path.join(process.cwd(), "public", "assets", "quickfurno", "images", "real");
// webp preferred (smallest), then jpg/jpeg/png.
const EXTENSIONS = [".webp", ".jpg", ".jpeg", ".png"] as const;

export type HomepageImage = {
  /** URL to render (real photo when present, otherwise the fallback). */
  src: string;
  /** True when src is a real photo from the real/ folder (styling differs). */
  isPhoto: boolean;
};

/** First existing real/<name>.<ext>, as a public URL — or null. */
function findRealImage(name: string): string | null {
  for (const ext of EXTENSIONS) {
    try {
      if (fs.existsSync(path.join(REAL_FS_BASE, `${name}${ext}`))) {
        return `${REAL_URL_BASE}/${name}${ext}`;
      }
    } catch {
      // fs unavailable or unreadable — behave as "no real photo yet".
      return null;
    }
  }
  return null;
}

/** Resolve one homepage image slot against its illustrated fallback. */
export function resolveHomepageImage(slotName: string, fallbackSrc: string): HomepageImage {
  const real = findRealImage(slotName);
  return real ? { src: real, isPhoto: true } : { src: fallbackSrc, isPhoto: false };
}

/** Hero slot: real/hero.(webp|jpg|jpeg|png). */
export function heroImage(fallbackSrc: string): HomepageImage {
  return resolveHomepageImage("hero", fallbackSrc);
}

/** Service-card slot: real/categories/<slug>.(webp|jpg|jpeg|png). */
export function categoryImage(slug: string, fallbackSrc: string): HomepageImage {
  return resolveHomepageImage(`categories/${slug}`, fallbackSrc);
}
