import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { categories, categorySlug, type QuickFurnoCategory } from "@/lib/quickfurno-data";
import { HOME_FAQ, PUNE_AREAS } from "@/lib/homepage-content";
import { categoryImage, heroImage, optionalRealImage } from "@/lib/homepage-images";
import { getPublicVendorCountsByCategory } from "@/services/publicVendorService";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { MadeInPune } from "@/components/home/MadeInPune";
import { whatsappLink } from "@/lib/config";

// ============================================================================
// QuickFurno — Pune launch homepage
//
// Port of the approved "Desktop 1440 / Mobile 390" mockup boards. Styling
// lives in app/home-pune-launch.css (qfp-* scoped). Honesty rules carried
// over from the launch brief: no invented stats, ratings or testimonials, and
// every service card is derived from the canonical category registry — the
// homepage cannot introduce a category the marketplace does not have.
// ============================================================================

const LAUNCH_IMG = "/assets/quickfurno/images/launch";

// --------------------------------------------------------------------------
// Inline icons (stroke icons from the mockup, kept local so the page has no
// dependency on the legacy icon set's colours).
// --------------------------------------------------------------------------
type IconProps = { size?: number; stroke?: string; width?: number };

function ArrowIcon({ size = 14, stroke = "currentColor", width = 2.4 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
function ShieldIcon({ size = 17, stroke = "#5EBE8B", width = 2.4 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}
function PinIcon({ size = 17, stroke = "#FFB13D", width = 2.4 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function BoltIcon({ size = 17, stroke = "#FFB13D", width = 2.4 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function GridIcon({ size = 18, stroke = "#746D61" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function HomeIcon({ size = 18, stroke = "#C93A0E" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 11.5 12 5l8 6.5" /><path d="M6 10.5V19h12v-8.5" /><path d="M9.5 19v-4.5h5V19" />
    </svg>
  );
}
function ChatIcon({ size = 26 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.5 8.5 0 0 1-11.9 7.8L3 20.5l1.3-4.1A8.5 8.5 0 1 1 21 11.5z" />
      <line x1="8.5" y1="11.5" x2="8.5" y2="11.5" /><line x1="12" y1="11.5" x2="12" y2="11.5" /><line x1="15.5" y1="11.5" x2="15.5" y2="11.5" />
    </svg>
  );
}
/** 24-point green rosette with a white tick — the "verified" mark from the mockup. */
// --------------------------------------------------------------------------
// Service card copy. Keyed by the canonical category name so a typo here is a
// type error, and iteration always happens over the registry (never this map).
// --------------------------------------------------------------------------
type Sub = { label: string; icon: GlyphName };
type ServiceMeta = {
  desc: string;
  short: string;
  cta: string;
  alt: string;
  /** Qualitative pill, top-left of the photo. Never a count — see below. */
  badge: string;
  badgeIcon: GlyphName;
  /** The three sub-categories shown in the bar under the photo. */
  subs: [Sub, Sub, Sub];
  /** Optional per-photo crop focus (CSS object-position), e.g. "center 30%". */
  pos?: string;
};

// ---------------------------------------------------------------------------
// One line-icon set, shared by the card badges and the sub-category bars.
// Glyphs repeat ACROSS cards on purpose (a repair and a renovation are the
// same spanner) but never twice WITHIN one card, which is what would read as
// a mistake. Every glyph is drawn on the same 24px box at the same weight so
// the bars line up optically.
// ---------------------------------------------------------------------------
type GlyphName =
  | "plan" | "cube" | "check" | "kitchen" | "wardrobe" | "cabinet"
  | "sofa" | "recliner" | "wrench" | "hand" | "home" | "villa"
  | "sparkle" | "ceiling" | "bulb" | "led" | "roller" | "brush"
  | "texture" | "building" | "brick" | "beam" | "crown" | "shield" | "factory"
  | "rupee" | "users";

const GLYPHS: Record<GlyphName, ReactNode> = {
  plan: <><rect x="3" y="3" width="18" height="18" rx="1.5" /><path d="M3 10h11M14 3v18" /></>,
  cube: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8.4 12.2l2.4 2.4 4.7-5" /></>,
  kitchen: <><rect x="3" y="4" width="18" height="5" rx="1" /><rect x="3" y="11" width="18" height="10" rx="1" /><path d="M12 11v10M8 15h1.5M14.5 15H16" /></>,
  wardrobe: <><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M12 3v18M9.5 11v2M14.5 11v2" /></>,
  cabinet: <><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M4 9.5h16M4 15h16M10.5 6.8h3M10.5 12.2h3M10.5 17.6h3" /></>,
  sofa: <><path d="M5 12V9.5A2.5 2.5 0 0 1 7.5 7h9A2.5 2.5 0 0 1 19 9.5V12" /><path d="M3.5 12.5A1.5 1.5 0 0 1 5 11h14a1.5 1.5 0 0 1 1.5 1.5V18h-17z" /><path d="M6 18v2M18 18v2" /></>,
  recliner: <><rect x="6" y="7" width="12" height="9" rx="2" /><path d="M6 10H4.5a1.5 1.5 0 0 0 0 3H6M18 10h1.5a1.5 1.5 0 0 1 0 3H18M8 16v3M16 16v3" /></>,
  wrench: <><path d="M15.4 3.6a5 5 0 0 0-6.1 6.1l-5.7 5.7a2 2 0 0 0 2.8 2.8l5.7-5.7a5 5 0 0 0 6.1-6.1l-2.8 2.8-2.5-.6-.6-2.5z" /></>,
  hand: <><path d="M9 11V5.6a1.5 1.5 0 0 1 3 0V11" /><path d="M12 10.6V4.9a1.5 1.5 0 0 1 3 0V11" /><path d="M15 11V7.6a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7 6 6 0 0 1-5.2-3L4 14.6a1.6 1.6 0 0 1 2.6-1.8L9 15" /></>,
  home: <><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M9.5 21v-6h5v6" /></>,
  villa: <><path d="M2 11 7 6.5 12 11M12 11l5-4.5 5 4.5" /><path d="M4 11v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9" /><path d="M10 21v-5h4v5" /></>,
  sparkle: <><path d="M12 3.5l1.9 5.4 5.4 1.9-5.4 1.9-1.9 5.4-1.9-5.4L4.7 10.8l5.4-1.9z" /><path d="M18.6 16.4l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6z" /></>,
  ceiling: <><path d="M3 5h18" /><path d="M6 5v3.5h12V5" /><path d="M12 8.5V13" /><path d="M9 13h6l-1.5 4.5h-3z" /></>,
  bulb: <><path d="M9 17.4a5.5 5.5 0 1 1 6 0V19a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z" /><path d="M10 22h4" /></>,
  led: <><rect x="2.5" y="9" width="19" height="6" rx="3" /><path d="M7 12h.01M12 12h.01M17 12h.01" /></>,
  roller: <><rect x="3.5" y="4" width="13" height="5" rx="1.5" /><path d="M16.5 6.5h3A1.5 1.5 0 0 1 21 8v3a1.5 1.5 0 0 1-1.5 1.5H12A1.5 1.5 0 0 0 10.5 14v1.5" /><rect x="8.5" y="15.5" width="4" height="6" rx="1.2" /></>,
  brush: <><rect x="8" y="2.5" width="8" height="6" rx="1.2" /><path d="M12 8.5v4" /><path d="M9.5 12.5h5V20a2.5 2.5 0 0 1-5 0z" /></>,
  texture: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M6 10c2-2 4-2 6 0s4 2 6 0M6 15c2-2 4-2 6 0s4 2 6 0" /></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" /></>,
  brick: <><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 12h18M9 5v7M15 12v7" /></>,
  beam: <><path d="M3 6h18M3 18h18" /><path d="M7 6v12M17 6v12" /><path d="M7 6l10 12" /></>,
  crown: <><path d="M3 17 5 7l4.5 4L12 4l2.5 7L19 7l2 10z" /><path d="M3.6 20.5h16.8" /></>,
  shield: <><path d="M12 3l7.5 3v6c0 4.2-3 7.6-7.5 9-4.5-1.4-7.5-4.8-7.5-9V6z" /><path d="M8.8 12.2l2.2 2.2 4.2-4.4" /></>,
  factory: <><path d="M3 21V10l6 3.5V10l6 3.5V6h6v15z" /><path d="M7 17h2M13 17h2M18 17h2" /></>,
  rupee: <><path d="M7 5h10M7 9.2h10" /><path d="M14 5c0 2.6-2.1 4.2-4.9 4.2H7l8.2 9.8" /></>,
  users: <><circle cx="9.2" cy="8.2" r="3.2" /><path d="M3 19.6a6.3 6.3 0 0 1 12.4 0" /><path d="M16.4 5.4a3.2 3.2 0 0 1 0 5.7M17.8 14.4a6.3 6.3 0 0 1 3.4 5.2" /></>,
};

function Glyph({ name, size = 18 }: { name: GlyphName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  );
}

const SERVICE_META: Record<QuickFurnoCategory, ServiceMeta> = {
  "Interior Designers": {
    desc: "Complete home interiors — design to handover.",
    short: "Complete home interiors",
    cta: "Explore Designers",
    alt: "Two interior designers in their studio with material samples, colour swatches and floor plans",
    // The board read "25+ Experts". There are four live designers, so that
    // badge would have put a fabricated number on the busiest page of the
    // site, against the no-invented-stats rule the rest of this file follows.
    badge: "Verified Profiles",
    badgeIcon: "shield",
    subs: [
      { label: "Space Planning", icon: "plan" },
      { label: "3D Designs", icon: "cube" },
      { label: "Turnkey Execution", icon: "check" },
    ],
  },
  "Modular Factory": {
    desc: "Factory-finish kitchens & wardrobes.",
    short: "Kitchens & wardrobes",
    cta: "Explore Modular",
    alt: "Technician inspecting a sage-green cabinet shutter in a modular furniture factory",
    pos: "center 30%",
    badge: "Factory Finish",
    badgeIcon: "factory",
    subs: [
      { label: "Modular Kitchens", icon: "kitchen" },
      { label: "Wardrobes", icon: "wardrobe" },
      { label: "Custom Cabinets", icon: "cabinet" },
    ],
  },
  Carpenters: {
    desc: "Custom furniture & woodwork.",
    short: "Furniture & woodwork",
    cta: "Find Carpenters",
    alt: "Carpenter sanding a custom cabinet",
    badge: "Skilled Professionals",
    badgeIcon: "wrench",
    subs: [
      { label: "Furniture", icon: "sofa" },
      { label: "Repairs", icon: "wrench" },
      { label: "Custom Work", icon: "hand" },
    ],
  },
  "Premium Interiors": {
    desc: "Premium design & execution.",
    short: "Design & execution",
    cta: "Explore Premium",
    alt: "Luxurious premium living room",
    badge: "Luxury Spaces",
    badgeIcon: "crown",
    subs: [
      { label: "Residential", icon: "home" },
      { label: "Villas", icon: "villa" },
      { label: "Premium Finish", icon: "sparkle" },
    ],
  },
  Sofa: {
    desc: "New sofa sales & upholstery.",
    short: "Sofas & upholstery",
    cta: "Explore Sofas",
    alt: "Sofa maker welcoming you to a showroom of fabric and leather sofas",
    badge: "Wide Collection",
    badgeIcon: "sofa",
    subs: [
      { label: "New Sofas", icon: "sofa" },
      { label: "Custom Upholstery", icon: "hand" },
      { label: "Recliners", icon: "recliner" },
    ],
  },
  Painter: {
    desc: "Interior & exterior painting.",
    short: "Interior & exterior",
    cta: "Book a Painter",
    alt: "Painter rolling beige paint onto a wall",
    badge: "Trusted Pros",
    badgeIcon: "brush",
    subs: [
      { label: "Interior Painting", icon: "roller" },
      { label: "Exterior Painting", icon: "building" },
      { label: "Texture Finish", icon: "texture" },
    ],
  },
  "Civil Work": {
    desc: "Renovations, masonry & repairs.",
    short: "Renovation & repairs",
    cta: "Get Started",
    alt: "Mason beside fresh brickwork",
    badge: "All Types",
    badgeIcon: "building",
    subs: [
      { label: "Renovation", icon: "wrench" },
      { label: "Masonry", icon: "brick" },
      { label: "Structural Work", icon: "beam" },
    ],
  },
  "False Ceiling": {
    desc: "POP & gypsum ceilings, cove lighting.",
    short: "POP & gypsum ceilings",
    cta: "Explore Ceilings",
    alt: "Installer finishing a layered POP false ceiling with warm cove lighting",
    pos: "center 30%",
    badge: "Modern Designs",
    badgeIcon: "bulb",
    subs: [
      { label: "POP Ceiling", icon: "ceiling" },
      { label: "Cove Lighting", icon: "bulb" },
      { label: "LED Integration", icon: "led" },
    ],
  },
};

const FEATURED_CATEGORY: QuickFurnoCategory = "Interior Designers";
const FEATURED = categories.find((c) => c.name === FEATURED_CATEGORY) ?? categories[0];
// Display order from the approved mockup. Only used for SORTING the registry:
// a category missing from this list still renders (at the end), and nothing
// here can add a category the registry does not have.
const DISPLAY_ORDER: QuickFurnoCategory[] = ["Modular Factory", "Carpenters", "Premium Interiors", "False Ceiling", "Sofa", "Painter", "Civil Work"];
const orderOf = (name: QuickFurnoCategory) => {
  const index = DISPLAY_ORDER.indexOf(name);
  return index === -1 ? DISPLAY_ORDER.length : index;
};
const OTHER_SERVICES = categories
  .filter((c) => c.name !== FEATURED.name)
  .sort((a, b) => orderOf(a.name) - orderOf(b.name));

const FALLBACK_CATEGORY_IMAGE = (slug: string) => `/assets/quickfurno/images/categories/${slug}.svg`;

// Verification steps — same four checks as lib/homepage-content VERIFY_STEPS,
// with the tighter one-line copy from the approved mockup.

// Areas: the mockup shows 11 pills + "+ N more" on desktop, 7 + "+ N more" on
// mobile. The remaining pills are revealed by a CSS-only toggle (no client JS).
const AREAS_VISIBLE_DESKTOP = 11;
const AREAS_VISIBLE_MOBILE = 7;

// ============================================================================
// Sections
// ============================================================================

// ---- Hero ------------------------------------------------------------------
// Board: kicker rule, two-tone headline, a four-point trust row, and the
// enquiry bar that laps over the foot of the photo.

const HERO_POINTS: { icon: GlyphName; label: string }[] = [
  { icon: "shield", label: "Verified Professionals" },
  { icon: "rupee", label: "Free to Enquire" },
  { icon: "users", label: "Up to 3 Matches" },
  { icon: "check", label: "No Obligation" },
];

function Hero() {
  const hero = heroImage("/assets/quickfurno/images/vendors/premium-living-room.svg");
  return (
    <section className="qfp-hero qfp2-hero" aria-labelledby="qfp-hero-title">
      <div className="qfp-hero-media" aria-hidden="true">
        {/* sizes = the width the photo is actually DRAWN at. On phones the
            band shows half the picture, so the photo renders ~2x the screen
            width (not 100vw) — telling the browser "100vw" made it fetch a
            small file and stretch it, which looked blurry. */}
        <Image
          src={hero.src}
          alt=""
          fill
          priority
          quality={85}
          sizes="(max-width: 760px) 200vw, (max-width: 1160px) 1160px, 100vw"
        />
      </div>
      <div className="qfp-hero-shade" aria-hidden="true" />
      <div className="qfp-shell qfp-hero-inner">
        <div className="qfp-hero-copy">
          <span className="qfp-hero-kicker">
            <i aria-hidden="true" />
            Trusted home professionals in Pune
          </span>
          {/* The {" "} are load-bearing: JSX drops the whitespace before a
              <br/> on its own line, and the phone rules hide those breaks, so
              without them the headline reads "righthome professional." */}
          <h1 id="qfp-hero-title">
            Find the right{" "}
            <br />
            <span>home&nbsp;professional.</span>{" "}
            <br />
            <span>Faster.</span>
          </h1>
          <p className="qfp-hero-lede">
            Tell us what you need. Get matched with up to 3 verified Pune professionals, compare
            profiles and quotes, and choose with confidence.
          </p>
          <ul className="qfp-hero-points" aria-label="Why QuickFurno">
            {HERO_POINTS.map((point) => (
              <li key={point.label}>
                <i aria-hidden="true">
                  <Glyph name={point.icon} size={19} />
                </i>
                {point.label}
              </li>
            ))}
          </ul>
          {/* data-quote-bar: the trigger reads this bar's <select> (service) and
              [data-quote-area] input at click time and opens the modal pre-filled. */}
          <div className="qfp-quote" aria-label="Start an enquiry" data-quote-bar>
            <label className="qfp-quote-field qfp-quote-field--service">
              <GridIcon />
              <select defaultValue="" aria-label="Select service">
                <option value="">What do you need?</option>
                {categories.map((category) => (
                  <option key={category.name} value={category.name}>{category.name}</option>
                ))}
              </select>
            </label>
            <label className="qfp-quote-field qfp-quote-field--area">
              <PinIcon size={18} stroke="#746D61" width={2} />
              {/* A datalist rather than a <select>: the board draws a dropdown,
                  but the marketplace accepts localities outside the listed set
                  and the FAQ says so. Suggestions plus free text keeps both. */}
              <input
                type="text"
                placeholder="Kharadi, Baner, Pune"
                aria-label="Your locality"
                autoComplete="off"
                list="qfp-area-options"
                data-quote-area
              />
              <datalist id="qfp-area-options">
                {PUNE_AREAS.map((area) => (
                  <option key={area} value={area} />
                ))}
              </datalist>
            </label>
            <EnquiryModalTrigger className="qfp-btn qfp-btn--primary qfp-quote-btn" source="Homepage hero quote bar">
              Get up to 3 matches <ArrowIcon size={16} stroke="#fff" />
            </EnquiryModalTrigger>
          </div>

        </div>
      </div>
      <div className="qfp-hero-areas" aria-label="Pune service areas">
        <div className="qfp-hero-areas-track">
          {[...PUNE_AREAS, ...PUNE_AREAS].map((area, index) => (
            <span className="qfp-hero-area-chip" key={`${area}-${index}`} aria-hidden={index >= PUNE_AREAS.length}>
              <i className="qfp-hero-area-live" aria-hidden="true" />
              <PinIcon size={13} stroke="currentColor" width={2} />
              {area}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// One card shape for all eight categories. Interior Designers leads the grid
// but is not visually oversized. Desktop keeps the richer card treatment;
// phone layouts intentionally simplify each tile to photo + title + action.
// Live count pills use literal Teams and disappear when the live count is zero.
/** null = count unavailable; zero = no live Team pill. */
function countLabel(count: number | null): string | null {
  if (count === null || count <= 0) return null;
  return `${count} ${count === 1 ? "Team" : "Teams"}`;
}

function ServiceCard({ name, count }: { name: QuickFurnoCategory; count: number | null }) {
  const meta = SERVICE_META[name];
  const slug = categorySlug(name);
  const image = categoryImage(slug, FALLBACK_CATEGORY_IMAGE(slug));
  const label = countLabel(count);
  return (
    <Link href={`/category/${slug}`} className="qfp-card">
      <span className="qfp-card-face">
        <span className="qfp-card-media">
          <Image
            src={image.src}
            alt={meta.alt}
            fill
            sizes="(max-width: 760px) 50vw, (max-width: 1100px) 50vw, 300px"
            style={meta.pos ? { objectPosition: meta.pos } : undefined}
          />
        </span>
        <span className="qfp-card-scrim" aria-hidden="true" />
        <span className="qfp-card-top">
          <span className="qfp-card-badge">
            <Glyph name={meta.badgeIcon} size={15} />
            {meta.badge}
          </span>
          {label ? <span className="qfp-card-count">{label}</span> : null}
        </span>
        <span className="qfp-card-copy">
          <span className="qfp-card-title">{name}</span>
          <span className="qfp-card-desc qfp-card-desc-long">{meta.desc}</span>
          <span className="qfp-card-desc qfp-card-desc-short">{meta.short}</span>
          <span className="qfp-card-btn">
            {meta.cta}
            <ArrowIcon size={16} stroke="#fff" />
          </span>
        </span>
      </span>
      {/* Informational, deliberately not links: sub-category routes do not
          exist yet, and three anchors all pointing at the same category page
          would be noise for a screen reader and for search. They become links
          the day those pages do. */}
      <span className="qfp-card-subs">
        {meta.subs.map((sub) => (
          <span className="qfp-card-sub" key={sub.label}>
            <Glyph name={sub.icon} size={19} />
            <span>{sub.label}</span>
          </span>
        ))}
      </span>
    </Link>
  );
}

const FAQ_ICONS = [
  "faq-enquiry-chat",
  "faq-matching-people",
  "faq-public-profile-eye",
  "faq-location-pin",
  "faq-obligation-document",
  "faq-work-tools",
];

const ICON = "/assets/quickfurno/images/icons";

// Wording kept to what the marketplace actually does - no promises about
// homeowner vetting or lead volume, neither of which QuickFurno controls.
const VENDOR_POINTS: { icon: string; title: string; body: string }[] = [
  { icon: "vendor-quality-enquiries", title: "Real enquiries", body: "Enquiries arrive from Pune homeowners with their requirement attached." },
  { icon: "vendor-verified-customers", title: "Reviewed listings", body: "Every public profile is reviewed and approved before it goes live." },
  { icon: "vendor-grow-business", title: "Grow in Pune", body: "Appear in Pune's marketplace and receive matches when you are eligible." },
];

// ============================================================================
// Canvas port (v2 sections)
//
// How it works, Why QuickFurno, Pune localities, FAQ, For professionals and
// the footer are built from the approved canvas boards. Styling is the
// self-contained qfp2-* block at the end of app/home-pune-launch.css so the
// rebuild never fights the older qfp-* rules.
//
// HONESTY: every count and claim below is checked against the database and the
// codebase. 28 vendors exist, 0 carry a rating, 0 carry a completed-project
// count, no background check runs anywhere, and PUNE_AREAS holds 20 entries —
// so the boards' "5,000+ pros", "50,000+ projects", "4.8/5", "past work &
// reviews" and "39 more localities" are all absent here.
// ============================================================================
const REAL = "/assets/quickfurno/images/real";

type GlyphKey = "chat" | "people" | "doc" | "eye" | "pin" | "wrench" | "bulb" | "bars" | "shield" | "trend" | "rupee" | "grid" | "home2" | "mail2" | "check2";

const G2: Record<GlyphKey, ReactNode> = {
  chat: <><path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1.2-4.4A8 8 0 1 1 21 12z" /><circle cx="8.5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="15.5" cy="12" r="1" /></>,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" /><circle cx="17" cy="8.5" r="2.4" /><path d="M16 14.6c3 .3 5 2 5 5.4" /></>,
  doc: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 12h6" /><path d="M9 16h5" /></>,
  eye: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.6" /></>,
  pin: <><path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z" /><circle cx="12" cy="10" r="2.4" /></>,
  wrench: <path d="M9.9 9.9a4.7 4.7 0 0 1 6.2-6.2l-3 3 1 3.2 3.2 1 3-3a4.7 4.7 0 0 1-6.2 6.2L6.7 20.9a2.4 2.4 0 0 1-3.4-3.4z" />,
  bulb: <><path d="M9.2 17.5a6 6 0 1 1 5.6 0" /><path d="M9.5 18h5" /><path d="M10.5 21h3" /></>,
  bars: <><path d="M5 20V13" /><path d="M12 20V7" /><path d="M19 20v-9" /></>,
  shield: <><path d="M12 3 4.6 6v6.1c0 4.2 3 7.7 7.4 8.9 4.4-1.2 7.4-4.7 7.4-8.9V6z" /><path d="m9 12 2 2 4-4" /></>,
  trend: <><path d="M3 17 9.5 10.5l3.5 3.5L21 6" /><path d="M15 6h6v6" /></>,
  rupee: <><path d="M6 4h12" /><path d="M6 9h12" /><path d="M16 4c0 3.3-2.5 5-6 5h-4l9 11" /></>,
  grid: <><circle cx="6" cy="6" r="1.6" /><circle cx="12" cy="6" r="1.6" /><circle cx="18" cy="6" r="1.6" /><circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" /><circle cx="6" cy="18" r="1.6" /><circle cx="12" cy="18" r="1.6" /><circle cx="18" cy="18" r="1.6" /></>,
  home2: <><path d="M4 10.5 12 4l8 6.5V20H4z" /><path d="M10 20v-5h4v5" /></>,
  mail2: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.6 6.5 8.4 6 8.4-6" /></>,
  check2: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.4 2.4 4.6-4.8" /></>,
};

function G({ name, size = 20, stroke = "#C9430E", width = 1.9, fill = "none" }: { name: GlyphKey; size?: number; stroke?: string; width?: number; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={name === "grid" ? stroke : fill} stroke={name === "grid" ? "none" : stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {G2[name]}
    </svg>
  );
}

function Tick({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#3FA96A" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

// "Why QuickFurno" — the board's four benefit cards. Board wording claimed
// background checks, verified pricing, verified customer reviews and ratings;
// none of those exist, so each line says what the marketplace actually does.
const WHY_POINTS: { glyph: GlyphKey; title: string; body: string }[] = [
  { glyph: "shield", title: "Reviewed profiles", body: "Every public profile is reviewed and approved before it is listed." },
  { glyph: "doc", title: "Clear information", body: "Services, coverage and contact details are checked before a profile goes live." },
  { glyph: "people", title: "Compare with confidence", body: "Get up to 3 matches, compare profiles and quotes, then choose what suits you best." },
  { glyph: "rupee", title: "No obligation to hire", body: "Explore, compare and connect for free. You stay in control at every step." },
];

// The board's stat strip read 5,000+ pros / 50,000+ projects / 4.8 rating.
// All three are invented, so the strip carries product facts instead.
const WHY_STATS: { glyph: GlyphKey; value: string; label: string }[] = [
  { glyph: "grid", value: String(categories.length), label: "Service categories live in Pune" },
  { glyph: "people", value: "Up to 3", label: "Matches per enquiry" },
  { glyph: "rupee", value: "₹0", label: "Homeowner fee, always" },
];

const WHY_CHECKS = ["Business details check", "Service details check", "Coverage & categories", "Approved before listing"];

// Locality photo chips. Only the first ARES_WITH_PHOTOS have artwork; the rest
// of PUNE_AREAS is summarised in the badge below the grid.
const AREA_PHOTOS: Record<string, string> = {
  Kharadi: "loc-kharadi",
  "Viman Nagar": "loc-viman-nagar",
  "Koregaon Park": "loc-koregaon-park",
  Baner: "loc-baner",
  Wakad: "loc-wakad",
  Hinjewadi: "loc-hinjewadi",
  Magarpatta: "loc-magarpatta",
  Kothrud: "loc-kothrud",
  Aundh: "loc-aundh",
  Hadapsar: "loc-hadapsar",
  "Pimpri-Chinchwad": "loc-pimpri-chinchwad",
};

// Three of the eight category photos, staggered, with a floating label on
// each — the board's collage, built from photos already in the repo rather
// than a new composite asset.

// Photo and pill icon share a file name, so one entry drives both.

function ServicesHeading() {
  return (
    <div className="qfp2-svc-head" data-reveal>
      <span className="qfp2-kicker">Our services</span>
      <h2>
        Home services.
        <br />
        <span>One marketplace.</span>
      </h2>
    </div>
  );
}

// Restored with the How it works section: the rebuild in c6cfb34 dropped this
// alternate homeowner entry point, taking the homepage from five conversion
// routes to four. It is for the visitor who does not know which category their
// job belongs to, which is a real share of enquiries.
function NotSureCard() {
  return (
    <EnquiryModalTrigger className="qfp-notsure" source="Homepage not-sure card" modalTitle="Tell us about your home">
      <span className="qfp-notsure-glow" aria-hidden="true" />
      <span className="qfp-notsure-copy">
        <span className="qfp-notsure-kicker">LET&apos;S BUILD TOGETHER</span>
        <span className="qfp-notsure-title">Not sure where to start?</span>
        <span className="qfp-notsure-desc">Tell us about your home — we&apos;ll route your request to the right service.</span>
        <span className="qfp-notsure-desc qfp-notsure-desc--short">We&apos;ll route your request.</span>
        <span className="qfp-notsure-btn">Get Matched <ArrowIcon stroke="#fff" /></span>
      </span>
      <span className="qfp-notsure-arrow" aria-hidden="true"><ArrowIcon size={17} stroke="#fff" /></span>
      <span className="qfp-notsure-media" aria-hidden="true">
        <Image src={`${LAUNCH_IMG}/notsure-plant.jpg`} alt="" fill sizes="240px" />
      </span>
    </EnquiryModalTrigger>
  );
}

async function Services() {
  const ordered = [FEATURED, ...OTHER_SERVICES];
  // One fetch for all eight. Null means the table was unreachable, in which
  // case every card hides its count rather than claiming zero.
  const counts = await getPublicVendorCountsByCategory(ordered.map((c) => c.name));
  return (
    <section className="qfp-section qfp-services qfp2-services" id="services">
      <span id="categories" aria-hidden="true" />
      <div className="qfp-shell">
        <ServicesHeading />
        {/* Eight equal cards, 4x2. FEATURED now means "leads the grid", not
            "is twice the size" - the board treats every category the same. */}
        <div className="qfp-service-grid" data-reveal-group>
          {ordered.map((category) => (
            <ServiceCard
              key={category.name}
              name={category.name}
              count={counts ? counts.get(category.name) ?? 0 : null}
            />
          ))}
        </div>
        {/* Eight categories fill 4x2 exactly, so this reads as a full-width
            band under the grid rather than a spare cell. */}
        <NotSureCard />
      </div>
    </section>
  );
}

// Native browser UI keeps the three-step story sharp at every resolution.
// The conversion claims stay within product facts: free homeowner enquiry,
// up to 3 eligible matches, reviewed profiles, and homeowner choice.
const HOW_IT_WORKS: { icon: ReactNode; title: string; body: string; visual: "request" | "matches" | "profiles" }[] = [
  {
    icon: <ChatIcon />,
    title: "Tell us what you need",
    body: "Share your service, Pune location and a few project details.",
    visual: "request",
  },
  {
    icon: <G name="people" size={26} stroke="#fff" width={2} />,
    title: "Get matched with eligible Teams",
    body: "We shortlist up to 3 active Teams by service, location and eligibility.",
    visual: "matches",
  },
  {
    icon: <G name="check2" size={26} stroke="#fff" width={2} />,
    title: "Compare & choose",
    body: "Compare reviewed profiles and quotes. You choose who to hire.",
    visual: "profiles",
  },
];

const HOW_SERVICE_OPTIONS = ["Interior design", "Carpentry", "Painting", "Civil work"] as const;

const HOW_TEAM_MATCHES = [
  { name: "UrbanNest", position: "qfp-how-team--one", meta: "Eligible match", image: "/assets/quickfurno/images/real/categories/interior-designers-v2.webp" },
  { name: "Studio A", position: "qfp-how-team--two", meta: "Eligible match", image: "/assets/quickfurno/images/real/categories/premium-interiors-v2.webp" },
  { name: "Craftline", position: "qfp-how-team--three", meta: "Eligible match", image: "/assets/quickfurno/images/real/categories/carpenters-v2.webp" },
] as const;

const HOW_PROFILE_ROWS = [
  { name: "UrbanNest", image: "/assets/quickfurno/images/real/categories/interior-designers-v2.webp" },
  { name: "Studio A", image: "/assets/quickfurno/images/real/categories/premium-interiors-v2.webp" },
  { name: "Craftline", image: "/assets/quickfurno/images/real/categories/carpenters-v2.webp" },
] as const;

function HowRequestPreview() {
  return (
    <div className="qfp-flow-request-ui" aria-label="Illustration of a QuickFurno home-service enquiry">
      <div className="qfp-flow-ui-top">
        <span><i aria-hidden="true"><G name="chat" size={15} stroke="currentColor" width={2} /></i>QuickFurno request</span>
        <small>Step 1 of 2</small>
      </div>
      <div className="qfp-flow-request-body">
        <small>Service needed</small>
        <strong>What does your home need?</strong>
        <div className="qfp-flow-service-options">
          {HOW_SERVICE_OPTIONS.map((service, index) => (
            <span className={index === 0 ? "is-selected" : undefined} key={service}>
              <i aria-hidden="true">{String(index + 1).padStart(2, "0")}</i>{service}
            </span>
          ))}
        </div>
        <div className="qfp-flow-project-field">
          <G name="check2" size={15} stroke="currentColor" width={2} />
          <span>Budget &amp; timeline</span>
        </div>
        <div className="qfp-flow-request-foot">
          <span><G name="home2" size={16} stroke="currentColor" width={2} /><i><small>Location</small><strong>Baner, Pune</strong></i></span>
          <b>Continue <ArrowIcon size={15} stroke="currentColor" /></b>
        </div>
      </div>
    </div>
  );
}

function HowMatchMap() {
  return (
    <div className="qfp-flow-match-ui" aria-label="Illustration of a Baner homeowner matched with three eligible Teams">
      <div className="qfp-flow-match-head">
        <span><G name="people" size={16} stroke="currentColor" width={2} />Matches ready</span>
        <strong>3 eligible Teams</strong>
      </div>
      <div className="qfp-flow-match-canvas">
        <i className="qfp-flow-route qfp-flow-route--one" aria-hidden="true" />
        <i className="qfp-flow-route qfp-flow-route--two" aria-hidden="true" />
        <i className="qfp-flow-route qfp-flow-route--three" aria-hidden="true" />
        <Image
          className="qfp-flow-map-bg"
          src="/assets/quickfurno/maps/pune-baner-osm.webp"
          alt=""
          fill
          sizes="(max-width: 760px) 330px, 420px"
          unoptimized
        />
        <span className="qfp-flow-map-tint" aria-hidden="true" />
        <small className="qfp-flow-map-credit">© OpenStreetMap contributors</small>
        <span className="qfp-flow-client-card">
          <Image
            className="qfp-flow-client-avatar"
            src="/assets/quickfurno/images/real/priya-sharma-avatar.webp"
            alt=""
            width={56}
            height={56}
            sizes="32px"
            unoptimized
          />
          <span><strong>Priya Sharma</strong><small>Baner, Pune</small></span>
        </span>
        {HOW_TEAM_MATCHES.map((team) => (
          <span className={`qfp-flow-team-card ${team.position}`} key={team.name}>
            <Image src={team.image} alt="" width={144} height={104} sizes="56px" unoptimized />
            <span><strong>{team.name}</strong><small>{team.meta}</small></span>
          </span>
        ))}
      </div>
      <div className="qfp-flow-match-meta">
        <G name="shield" size={15} stroke="currentColor" width={2} />
        Matched by service, location &amp; eligibility
      </div>
    </div>
  );
}

function HowProfileCompare() {
  return (
    <div className="qfp-flow-compare-ui" aria-label="Illustration of three reviewed Team profiles ready to compare">
      <div className="qfp-flow-ui-top">
        <span><i aria-hidden="true"><G name="check2" size={15} stroke="currentColor" width={2} /></i>Teams ready to compare</span>
        <small>3 matches</small>
      </div>
      <div className="qfp-flow-profile-list">
        {HOW_PROFILE_ROWS.map((profile, index) => (
          <span className="qfp-flow-profile-row" key={profile.name}>
            <Image src={profile.image} alt="" width={152} height={116} sizes="64px" unoptimized />
            <span>
              <strong>{profile.name}</strong>
              <small><G name="check2" size={12} stroke="currentColor" width={2.2} /> Reviewed profile</small>
            </span>
            <b>{index === 0 ? "View" : "Compare"}</b>
          </span>
        ))}
      </div>
      <div className="qfp-flow-compare-foot">
        <span>Compare profiles &amp; quotes</span>
        <strong>You choose who to hire</strong>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="qfp-section qfp-how qfp-flow" id="how-it-works">
      <span className="qfp-how-glow-a" aria-hidden="true" />
      <span className="qfp-how-glow-b" aria-hidden="true" />
      <div className="qfp-shell">
        <div className="qfp-head-center qfp-flow-head" data-reveal>
          <span className="qfp-kicker qfp-kicker--ruled">How it works</span>
          <h2>One request. <span>Three simple steps.</span></h2>
          <p className="qfp-how-lede">Tell us what your home needs. We can match you with up to 3 eligible Teams, then you compare and choose — all in one place.</p>
        </div>

        <ol className="qfp-flow-list" data-reveal-group>
          {HOW_IT_WORKS.map((step, index) => (
            <li className={`qfp-flow-step qfp-flow-step--${index + 1}`} key={step.title}>
              <div className="qfp-flow-copy">
                <div className="qfp-flow-step-meta">
                  <span className="qfp-flow-num" aria-hidden="true">0{index + 1}</span>
                  <span className="qfp-flow-icon">{step.icon}</span>
                </div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
              <div className={`qfp-flow-visual qfp-flow-visual--${step.visual}`}>
                {step.visual === "request" ? <HowRequestPreview /> : null}
                {step.visual === "matches" ? <HowMatchMap /> : null}
                {step.visual === "profiles" ? <HowProfileCompare /> : null}
              </div>
            </li>
          ))}
        </ol>

        <ul className="qfp-flow-trust" aria-label="QuickFurno process benefits">
          <li><G name="shield" size={18} stroke="currentColor" width={2} /><span>Free enquiry</span></li>
          <li><G name="people" size={18} stroke="currentColor" width={2} /><span>Up to 3 eligible matches</span></li>
          <li><G name="check2" size={18} stroke="currentColor" width={2} /><span>You choose who to hire</span></li>
        </ul>

        <div className="qfp-flow-convert">
          <EnquiryModalTrigger
            className="qfp-flow-cta"
            source="Homepage how it works"
            modalTitle="Tell us what your home needs"
          >
            Start free enquiry <ArrowIcon size={18} stroke="currentColor" />
          </EnquiryModalTrigger>
          <p>No homeowner fee. No obligation to hire.</p>
        </div>
      </div>
    </section>
  );
}

function TrustAndSafety() {
  const hero = optionalRealImage("why-hero-v2");
  return (
    <section className="qfp-section qfp2-why" id="why-quickfurno">
      <div className="qfp-shell qfp2-why-grid">
        <div className="qfp2-why-copy" data-reveal>
          <span className="qfp2-kicker">Why QuickFurno</span>
          <h2>
            Reviewed before listed.<br />
            <span>Yours to choose.</span>
          </h2>
          <p className="qfp2-why-lede">
            Every professional on QuickFurno is reviewed and approved before listing. You compare profiles and quotes and choose the right expert — with no homeowner fee and no obligation to hire.
          </p>
          <ul className="qfp2-why-points">
            {WHY_POINTS.map((point) => (
              <li key={point.title}>
                <i><G name={point.glyph} size={20} /></i>
                <span>
                  <strong>{point.title}</strong>
                  <em>{point.body}</em>
                </span>
              </li>
            ))}
          </ul>
          <ul className="qfp2-why-stats">
            {WHY_STATS.map((stat) => (
              <li key={stat.label}>
                <i><G name={stat.glyph} size={22} stroke="#E8551F" width={2} /></i>
                <span>
                  <strong>{stat.value}</strong>
                  <em>{stat.label}</em>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="qfp2-why-visual" data-reveal>
          {hero ? (
            <div className="qfp2-why-photo">
              <Image src={hero} alt="Two QuickFurno professionals reviewing plans" width={895} height={676} sizes="(max-width: 899px) 100vw, 560px" />
              <ul className="qfp2-why-checklist">
                {WHY_CHECKS.map((c) => (
                  <li key={c}><i><Tick size={11} /></i><span>{c}</span></li>
                ))}
              </ul>
              <span className="qfp2-why-note">
                <i><Tick size={13} /></i>
                Every public profile is reviewed and approved before it goes live.
              </span>
            </div>
          ) : (
            <span className="qfp-slot-empty" aria-hidden="true" />
          )}
        </div>
      </div>
    </section>
  );
}

function Areas() {
  const withPhotos = PUNE_AREAS.filter((a) => AREA_PHOTOS[a]);
  const remaining = PUNE_AREAS.length - withPhotos.length;
  return (
    <section className="qfp-section qfp2-areas" aria-labelledby="qfp-areas-title">
      <Image className="qfp2-areas-map" src={`${REAL}/areas/pune-map.webp`} alt="" aria-hidden="true" width={601} height={508} />
      <div className="qfp-shell">
        <div className="qfp2-head" data-reveal>
          <span className="qfp2-kicker">Where we work</span>
          <h2 id="qfp-areas-title">
            Pune localities <span>we cover.</span>
          </h2>
          <p>
            Pick your locality when you send an enquiry. You can select these and many more areas across Pune — a listed locality is not a guarantee of matching supply.
          </p>
        </div>
        <ul className="qfp2-area-cards" role="list">
          {withPhotos.map((area) => (
            <li key={area}>
              <span className="qfp2-area-card">
                <Image src={`${REAL}/areas/${AREA_PHOTOS[area]}.webp`} alt="" width={112} height={112} />
                <span className="qfp2-area-name">
                  <G name="pin" size={13} stroke="#E8551F" width={2.1} />
                  {area}
                </span>
                <b aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#E8551F" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round"><path d="m9 5 7 7-7 7" /></svg>
                </b>
              </span>
            </li>
          ))}
        </ul>
        {remaining > 0 ? (
          <p className="qfp2-areas-more">
            <G name="grid" size={18} stroke="#E8551F" />
            …and {remaining} more across Pune.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function FAQ() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: HOME_FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
  const photo = optionalRealImage("faq-homeowner-v2");
  const glyphs: GlyphKey[] = ["chat", "people", "eye", "pin", "doc", "wrench"];
  return (
    <section className="qfp-section qfp2-faq" id="faq">
      {photo ? (
        <div className="qfp2-faq-photo" aria-hidden="true">
          {/* The frame is 362x470 and the photo is filled to cover, so it is the
    HEIGHT that decides how much file is needed: 470 tall at this
    photo's shape is 440 wide, not the frame's 362. Asking for 380 got
    a file that had to be stretched 1.13x. */}
          <Image src={photo} alt="" width={800} height={869} sizes="(max-width: 899px) 0px, 440px" />
          <span className="qfp2-faq-fade-x" />
          <span className="qfp2-faq-fade-y" />
        </div>
      ) : null}
      <div className="qfp-shell">
        <div className="qfp2-faq-band">
          <div className="qfp2-head qfp2-head--left" data-reveal>
            <span className="qfp2-kicker">Good to know</span>
            <h2>
              Questions Pune<br />
              <span>homeowners ask</span>
            </h2>
            <p>Quick answers to help you get started with confidence.</p>
          </div>
          <div className="qfp2-faq-help" data-reveal>
            <span className="qfp2-faq-script">
              Still have a question?
              <svg width="66" height="36" viewBox="0 0 72 40" fill="none" stroke="#5B534A" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 6C24 -1 56 2 66 26" /><path d="M60 20.5 66.5 28 69.5 18" /></svg>
            </span>
            <span className="qfp2-faq-sub">We&rsquo;re here to help.</span>
            <a className="qfp2-faq-pill" href={whatsappLink()} target="_blank" rel="noopener noreferrer">
              <G name="chat" size={15} />
              Contact support
              <ArrowIcon size={14} stroke="#C9430E" />
            </a>
          </div>
        </div>
        <div className="qfp2-faq-grid">
          <div className="qfp2-faq-list">
            {HOME_FAQ.map((item, index) => (
              <details className="qfp2-faq-item" key={item.q}>
                <summary>
                  <i aria-hidden="true"><G name={glyphs[index] ?? "chat"} size={19} /></i>
                  <span>{item.q}</span>
                  <b aria-hidden="true">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                  </b>
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
          <aside className="qfp2-faq-card" data-reveal>
            {photo ? (
              <span className="qfp2-faq-card-banner">
                <Image src={photo} alt="" width={800} height={869} sizes="(max-width: 899px) 90vw, 0px" />
              </span>
            ) : null}
            <i className="qfp2-faq-bulb" aria-hidden="true"><G name="bulb" size={24} /></i>
            <h3>Still have<br />questions?</h3>
            <p>Our support team is here to help you with anything — from choosing the right service to understanding the process.</p>
            <a className="qfp2-faq-btn" href={whatsappLink()} target="_blank" rel="noopener noreferrer">
              <G name="chat" size={15} stroke="#fff" />
              Contact support
              <ArrowIcon size={14} stroke="#fff" />
            </a>
          </aside>
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </section>
  );
}

function VendorCTA() {
  const pro = optionalRealImage("vendor-pro-v2");
  const glyphs: GlyphKey[] = ["bars", "shield", "trend"];
  return (
    <section className="qfp-section qfp2-vendor" aria-labelledby="qfp-vendor-title">
      <div className="qfp-shell">
        <div className="qfp2-vendor-card" data-reveal>
          <div className="qfp2-vendor-inner">
            <div className="qfp2-vendor-copy">
              <span className="qfp2-kicker qfp2-kicker--start">For professionals</span>
              <h2 id="qfp-vendor-title">
                Grow your<br />
                home services business<br />
                <span>in Pune.</span>
              </h2>
              <p>Create a profile, get it reviewed and listed, and receive enquiries from Pune homeowners with their requirement attached.</p>
              <Link href="/vendors" className="qfp2-vendor-btn">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9.5" cy="8" r="3.4" /><path d="M3 20c0-3.5 2.9-5.6 6.5-5.6s6.5 2.1 6.5 5.6" /><path d="M19 7v6" /><path d="M22 10h-6" /></svg>
                Join as a vendor
                <ArrowIcon size={15} stroke="#fff" />
              </Link>
            </div>
            <ul className="qfp2-vendor-points">
              {VENDOR_POINTS.map((point, i) => (
                <li key={point.title}>
                  <i aria-hidden="true"><G name={glyphs[i] ?? "bars"} size={20} width={2.1} /></i>
                  <span>
                    <strong>{point.title}</strong>
                    <em>{point.body}</em>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="qfp2-vendor-figure">
            <span className="qfp2-vendor-blob" aria-hidden="true" />
            {pro ? <Image src={pro} alt="" width={620} height={1020} sizes="(max-width: 899px) 60vw, 300px" /> : null}
            <span className="qfp2-vendor-note">Be part of Pune&rsquo;s trusted home services community.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function BottomNav() {
  return (
    <nav className="qfp-bottom-nav" aria-label="Homepage mobile navigation">
      <Link href="/" className="qfp-bottom-item qfp-bottom-item--active" aria-current="page">
        <HomeIcon size={20} stroke="currentColor" />
        <span>Home</span>
      </Link>
      <Link href="#services" className="qfp-bottom-item">
        <GridIcon size={20} stroke="currentColor" />
        <span>Services</span>
      </Link>
      <EnquiryModalTrigger className="qfp-bottom-item qfp-bottom-quote" source="Homepage bottom navigation">
        <span className="qfp-bottom-quote-icon"><ChatIcon size={22} /></span>
        <span>Quote</span>
      </EnquiryModalTrigger>
      <Link href="/vendors" className="qfp-bottom-item">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></svg>
        <span>Vendors</span>
      </Link>
      <Link href="#contact" className="qfp-bottom-item">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        <span>More</span>
      </Link>
    </nav>
  );
}

export function PuneLaunchHomepage() {
  return (
    <div className="qfp-page">
      <Header />
      <main>
        <Hero />
        <Services />
        <HowItWorks />
        <TrustAndSafety />
        <MadeInPune />
        <Areas />
        <FAQ />
        <VendorCTA />
      </main>
      {/* The nav points at /#contact; the shared footer owns the contact block
          but cannot carry the id itself, or every page would ship a duplicate. */}
      <span id="contact" aria-hidden="true" />
      <Footer />
      <BottomNav />
    </div>
  );
}
