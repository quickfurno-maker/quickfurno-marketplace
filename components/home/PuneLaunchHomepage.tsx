import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { categories, categorySlug, type QuickFurnoCategory } from "@/lib/quickfurno-data";
import { HOME_FAQ, PUNE_AREAS, TESTIMONIALS } from "@/lib/homepage-content";
import { categoryImage, heroImage, resolveHomepageImage } from "@/lib/homepage-images";
import { getPublicVendorCountsByCategory } from "@/services/publicVendorService";
import { CONTACT, whatsappLink } from "@/lib/config";

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
function ShieldCheckIcon({ size = 18, stroke = "#C93A0E", width = 2 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.6-3.1 7.7-7 9-3.9-1.3-7-4.4-7-9V6l7-3z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
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
function CheckCircleIcon({ size = 26 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.5 11.2V12a9.5 9.5 0 1 1-5.6-8.7" /><polyline points="21.5 4.5 12 14 9 11" />
    </svg>
  );
}
/** 24-point green rosette with a white tick — the "verified" mark from the mockup. */
function VerifiedRosette({ size = 26 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <polygon
        points="12.00,0.80 14.56,2.44 17.60,2.30 19.00,5.00 21.70,6.40 21.56,9.44 23.20,12.00 21.56,14.56 21.70,17.60 19.00,19.00 17.60,21.70 14.56,21.56 12.00,23.20 9.44,21.56 6.40,21.70 5.00,19.00 2.30,17.60 2.44,14.56 0.80,12.00 2.44,9.44 2.30,6.40 5.00,5.00 6.40,2.30 9.44,2.44"
        fill="#1F9D5B"
      />
      <polyline points="7.2,12.4 10.4,15.6 17,9" fill="none" stroke="#FFFFFF" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function FooterChatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FF8A5C" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11.5a8 8 0 0 1-11.7 7.1L4 19.8l1.2-4.1A8 8 0 1 1 20 11.5Z" />
      <path d="M8.5 10.5h7" />
      <path d="M8.5 13.5h4.5" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FF8A5C" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7 L12 13 L2 7" />
    </svg>
  );
}

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

const HOW_IT_WORKS = [
  {
    icon: <ChatIcon />,
    title: "Tell us what you need",
    body: "Pick the service, your locality and the project details you want to share. Your phone number is requested at the contact step.",
  },
  {
    icon: <ShieldCheckIcon size={26} stroke="#fff" width={2} />,
    title: "We find eligible pros",
    body: "QuickFurno can assign up to 3 active pros at a time after category and marketplace eligibility checks; approved ranking signals determine order.",
  },
  {
    icon: <CheckCircleIcon />,
    title: "Compare & choose",
    body: "Review profiles and quotes side by side, then deal directly with the one you trust. No fee, no obligation.",
  },
];

// Verification steps — same four checks as lib/homepage-content VERIFY_STEPS,
// with the tighter one-line copy from the approved mockup.
const VERIFY_POINTS = [
  { title: "Business profile review", body: "Business details are reviewed before an approved profile is listed." },
  { title: "Service information review", body: "Services, coverage and submitted profile information are reviewed before listing." },
  { title: "Approved before listing", body: "Pending, rejected, suspended or hidden profiles are not shown as active public vendors." },
  { title: "Support channels", body: "Vendors can use WhatsApp and the dashboard support workspace when they need help." },
];

// The approved mockup's journey section: Pune live, the rest on the roadmap.
//
// This was reduced to Pune alone during the Pune-only launch hardening, which
// also added a CI rule banning the string "Mumbai" from every active surface.
// The launch IS Pune-only and stays that way — nothing here is selectable, and
// no lead or vendor can be created outside Pune. These names are a roadmap
// shown to a visitor, which is a different thing from a city the product will
// transact in, and the guard now draws that line instead of banning the word
// outright. See scripts/mvp/launch/validate-pune-only-launch.mjs.
const CITIES = [
  { name: "Pune", file: "pune", live: true },
  { name: "Delhi NCR", file: "delhi-ncr", live: false },
  { name: "Mumbai", file: "mumbai", live: false },
  { name: "Hyderabad", file: "hyderabad", live: false },
  { name: "Kolkata", file: "kolkata", live: false },
  { name: "Bengaluru", file: "bengaluru", live: false },
];

// Areas: the mockup shows 11 pills + "+ N more" on desktop, 7 + "+ N more" on
// mobile. The remaining pills are revealed by a CSS-only toggle (no client JS).
const AREAS_VISIBLE_DESKTOP = 11;
const AREAS_VISIBLE_MOBILE = 7;

const NAV_LINKS = [
  { href: "#services", label: "Services" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#why-quickfurno", label: "Why QuickFurno" },
  { href: "/vendors", label: "For professionals" },
];

function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={`qfp-logo${light ? " qfp-logo--light" : ""}`} aria-label="QuickFurno home">
      Quick<em>Furno</em>
    </Link>
  );
}

// ============================================================================
// Sections
// ============================================================================

function Header() {
  return (
    <header className="qfp-header">
      <div className="qfp-shell qfp-header-inner">
        <Logo />
        <nav className="qfp-nav" aria-label="Homepage navigation">
          {NAV_LINKS.map((link, index) => (
            <Link key={link.href} href={link.href} className={index === 0 ? "is-active" : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>
        <EnquiryModalTrigger className="qfp-btn qfp-btn--primary qfp-header-cta" source="Homepage header">
          Get up to 3 matches
        </EnquiryModalTrigger>
        <details className="qfp-menu">
          <summary className="qfp-menu-button" aria-label="Open navigation">
            <i /><i /><i />
          </summary>
          <nav className="qfp-menu-panel" aria-label="Mobile menu">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href}>{link.label}</Link>
            ))}
            <EnquiryModalTrigger className="qfp-btn qfp-btn--primary" source="Homepage mobile menu">
              Get up to 3 matches
            </EnquiryModalTrigger>
          </nav>
        </details>
      </div>
    </header>
  );
}

// ---- Hero ------------------------------------------------------------------
// Board: kicker rule, two-tone headline, a four-point trust row, the search
// bar, popular chips, and a feature band that laps over the foot of the photo.

const HERO_POINTS: { icon: GlyphName; label: string }[] = [
  { icon: "shield", label: "Verified Professionals" },
  { icon: "rupee", label: "Free to Enquire" },
  { icon: "users", label: "Up to 3 Matches" },
  { icon: "check", label: "No Obligation" },
];

// Consumer wording for six registry categories: LABEL is what a homeowner
// searches for, the href still resolves through categorySlug, and anything not
// in the registry is filtered out below - so a chip can never point at a
// category the marketplace does not actually have.
const POPULAR = (
  [
    { category: "Modular Factory", label: "Modular Kitchen" },
    { category: "Interior Designers", label: "Interior Designer" },
    { category: "Carpenters", label: "Carpenter" },
    { category: "Painter", label: "Painter" },
    { category: "Civil Work", label: "Civil Work" },
    { category: "Sofa", label: "Sofa" },
  ] as { category: QuickFurnoCategory; label: string }[]
).filter((item) => categories.some((c) => c.name === item.category));

const HERO_FEATURES: { icon: GlyphName; title: string; body: string }[] = [
  { icon: "home", title: "All Home Services", body: "Interiors, kitchens, painting, carpentry, civil work & more." },
  // Board said "Every professional is screened by our Pune team". The claim
  // this site can actually stand behind is the one the Trust section makes:
  // profiles are reviewed and approved before they are listed.
  { icon: "shield", title: "Verified & Reviewed", body: "Every public profile is reviewed before it goes live." },
  { icon: "rupee", title: "Transparent Quotes", body: "Compare quotes, profiles and previous work." },
  { icon: "users", title: "Local Experts", body: "Professionals working across Pune & PCMC." },
];

function Hero() {
  const hero = heroImage("/assets/quickfurno/images/vendors/premium-living-room.svg");
  return (
    <section className="qfp-hero" aria-labelledby="qfp-hero-title">
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
          <h1 id="qfp-hero-title">
            Find the right
            <br />
            <span>home&nbsp;professional.</span>
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
          <div className="qfp-hero-popular">
            <span className="qfp-hero-popular-label">Popular:</span>
            {POPULAR.map((item) => (
              <Link key={item.label} className="qfp-hero-chip" href={`/category/${categorySlug(item.category)}`}>
                {item.label}
              </Link>
            ))}
          </div>
          <small className="qfp-hero-note">
            Matches depend on category fit, eligibility and marketplace availability.
          </small>
        </div>
      </div>
      <div className="qfp-hero-features">
        <div className="qfp-shell qfp-hero-features-row">
          {HERO_FEATURES.map((feature) => (
            <div className="qfp-hero-feature" key={feature.title}>
              <i aria-hidden="true">
                <Glyph name={feature.icon} size={22} />
              </i>
              <div>
                <strong>{feature.title}</strong>
                <span>{feature.body}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// One card shape for all eight categories. The board drops the 2x2 featured
// tile, so Interior Designers is now the same card as the rest - it simply
// leads the grid. Photo runs the full pane, copy sits on it over a scrim, and
// the sub-category bar below is the part that does real work: it answers
// "what is actually in here?" before anyone has to click.
// Five of the eight categories have no publicly visible vendor yet. A card
// reading "0 pros" advertises an empty marketplace on the busiest page of the
// site, so zero renders as the state instead of the number. Set this to false
// to print a literal "0 pros".
const SOFTEN_ZERO_COUNT = true;

/** null = count unavailable (hide the pill entirely). */
function countLabel(count: number | null): string | null {
  if (count === null) return null;
  // Short on purpose: "Accepting enquiries" was wide enough to wrap under the
  // longer badges and not the shorter ones, so the top row came out uneven
  // across a grid row.
  if (count === 0) return SOFTEN_ZERO_COUNT ? "Enquiries open" : "0 pros";
  return `${count} ${count === 1 ? "pro" : "pros"}`;
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

function NotSureCard() {
  return (
    <EnquiryModalTrigger className="qfp-notsure" source="Homepage not-sure card" modalTitle="Tell us about your home">
      <span className="qfp-notsure-glow" aria-hidden="true" />
      <span className="qfp-notsure-copy">
        <span className="qfp-notsure-kicker">LET&apos;S BUILD TOGETHER</span>
        <span className="qfp-notsure-title">Not sure where to start?</span>
        <span className="qfp-notsure-desc">Tell us about your home - we&apos;ll route your request to the right service.</span>
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

// --------------------------------------------------------------------------
// Services heading — "blueprint" concept (chosen on the design canvas).
// A light architect's grid + a line-drawn floor plan labelled "Your home",
// with the three trust points pinned to it like design notes. On tablets and
// phones the plan becomes a faint corner sketch and the notes a simple list.
// --------------------------------------------------------------------------
// Trust points shown as a row of verified-badge cards under the heading on
// every screen size (swipeable on tablets and phones). All five are true
// today — see lib/homepage-content.ts and the FAQ.
const TRUST_POINTS: { title: string; body: string }[] = [
  { title: "Profiles reviewed", body: "Active public listings must pass marketplace controls" },
  { title: "Bounded matching", body: "Up to 3 active pros can be assigned at a time" },
  { title: "Free to enquire", body: "No homeowner fee to submit an enquiry" },
  { title: "Pune launch", body: "The marketplace launch is focused on Pune" },
  { title: "Governed contact sharing", body: "Client details follow assignment and consent controls" },
];

function BlueprintPlan() {
  const line = "#CDBB9B";
  return (
    <svg className="qfp-bp-svg" viewBox="0 0 640 350" fill="none" aria-hidden="true" focusable="false">
      <rect x="60" y="50" width="500" height="230" fill="rgba(255,255,255,0.55)" stroke={line} strokeWidth="2" />
      <line x1="300" y1="50" x2="300" y2="150" stroke={line} strokeWidth="2" />
      <line x1="60" y1="170" x2="200" y2="170" stroke={line} strokeWidth="2" />
      <line x1="250" y1="170" x2="300" y2="170" stroke={line} strokeWidth="2" />
      <line x1="200" y1="170" x2="200" y2="120" stroke={line} strokeWidth="1.5" />
      <path d="M200 120 A50 50 0 0 1 250 170" stroke={line} strokeWidth="1.2" strokeDasharray="4 4" />
      <line x1="380" y1="46" x2="480" y2="46" stroke={line} strokeWidth="1.5" />
      <line x1="380" y1="54" x2="480" y2="54" stroke={line} strokeWidth="1.5" />
      <rect x="370" y="200" width="150" height="44" rx="8" stroke={line} strokeWidth="1.5" />
      <line x1="420" y1="206" x2="420" y2="238" stroke={line} strokeWidth="1.2" />
      <line x1="470" y1="206" x2="470" y2="238" stroke={line} strokeWidth="1.2" />
      <rect x="410" y="150" width="70" height="30" rx="6" stroke={line} strokeWidth="1.2" />
      <rect x="90" y="72" width="110" height="76" rx="6" stroke={line} strokeWidth="1.5" />
      <line x1="90" y1="92" x2="200" y2="92" stroke={line} strokeWidth="1.2" />
      <path d="M60 250 L160 250 L160 280" stroke={line} strokeWidth="1.5" />
      <line x1="60" y1="300" x2="560" y2="300" stroke={line} strokeWidth="1.2" />
      <line x1="60" y1="294" x2="60" y2="306" stroke={line} strokeWidth="1.2" />
      <line x1="560" y1="294" x2="560" y2="306" stroke={line} strokeWidth="1.2" />
      <g className="qfp-bp-leaders">
        {[
          [145, 110],
          [430, 50],
          [445, 222],
        ].map(([x1, y1]) => (
          <g key={`${x1}-${y1}`}>
            <circle cx={x1} cy={y1} r="10" fill="rgba(240,74,26,0.15)" />
            <circle cx={x1} cy={y1} r="5" fill="#C93A0E" />
          </g>
        ))}
      </g>
    </svg>
  );
}

function ServicesHeading() {
  return (
    <>
      <div className="qfp-bp" data-reveal>
        <div className="qfp-bp-copy">
          <span className="qfp-bp-kicker">
            <i className="t" aria-hidden="true" /><i className="l" aria-hidden="true" />
            Our services
            <i className="l" aria-hidden="true" /><i className="t" aria-hidden="true" />
          </span>
          <h2>Home services.<br />One marketplace.</h2>
          <p>From interiors to painting, browse the Pune launch categories in one marketplace.</p>
        </div>
        <div className="qfp-bp-plan" aria-hidden="true">
          <BlueprintPlan />
          <span className="qfp-bp-home">YOUR HOME</span>
        </div>
      </div>
      <ol className="qfp-trust-row" aria-label="Why homeowners choose QuickFurno" data-reveal-group>
        {TRUST_POINTS.map((point) => (
          <li className="qfp-trust-card" key={point.title}>
            <VerifiedRosette size={26} />
            <div>
              <strong>{point.title}</strong>
              <span>{point.body}</span>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

async function Services() {
  const ordered = [FEATURED, ...OTHER_SERVICES];
  // One fetch for all eight. Null means the table was unreachable, in which
  // case every card hides its count rather than claiming zero.
  const counts = await getPublicVendorCountsByCategory(ordered.map((c) => c.name));
  return (
    <section className="qfp-section qfp-services" id="services">
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
        {/* Eight categories fill 4x2 exactly, so the "not sure" CTA no longer
            has a spare cell. It reads stronger as a full-width band anyway. */}
        <NotSureCard />
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="qfp-section qfp-how" id="how-it-works">
      <span className="qfp-how-glow-a" aria-hidden="true" />
      <span className="qfp-how-glow-b" aria-hidden="true" />
      <div className="qfp-shell">
        <div className="qfp-head-center" data-reveal>
          <span className="qfp-kicker">How it works</span>
          <h2>Three steps. Zero running around.</h2>
        </div>
        <ol className="qfp-steps" data-reveal-group>
          {HOW_IT_WORKS.map((step, index) => (
            <li className="qfp-step" key={step.title}>
              <div className="qfp-step-top">
                <span className="qfp-step-icon">{step.icon}</span>
                <span className="qfp-step-num" aria-hidden="true">0{index + 1}</span>
              </div>
              <div className="qfp-step-text">
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
              {index < HOW_IT_WORKS.length - 1 ? (
                <span className="qfp-step-next" aria-hidden="true"><ArrowIcon size={13} stroke="#C93A0E" width={2.6} /></span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function MadeInPune() {
  return (
    <section className="qfp-section qfp-cities" aria-labelledby="qfp-cities-title">
      <span className="qfp-cities-glow" aria-hidden="true" />
      <div className="qfp-shell">
        <div className="qfp-head-center" data-reveal>
          <span className="qfp-kicker qfp-kicker--coral">Our journey</span>
          <h2 id="qfp-cities-title">Made in Pune. Coming to your city next.</h2>
          <p className="qfp-cities-lead">We are building QuickFurno where we live — then bringing verified home professionals to more of India.</p>
        </div>
        <ul className="qfp-city-grid" data-reveal-group>
          {CITIES.map((city) => (
            <li className="qfp-city" key={city.name}>
              <span className="qfp-city-badge">
                <Image src={`${LAUNCH_IMG}/cities/${city.file}.jpg`} alt="" fill sizes="104px" />
              </span>
              <strong>{city.name}</strong>
              {city.live ? (
                <span className="qfp-city-status qfp-city-status--live"><i aria-hidden="true" />Live now</span>
              ) : (
                <span className="qfp-city-status">Coming soon</span>
              )}
            </li>
          ))}
        </ul>
        {/* Decorative skyline: the India skyline belongs with a roadmap that
            reaches beyond Pune, which is what this section shows again. */}
        <div className="qfp-cities-skyline" aria-hidden="true">
          <Image src={`${LAUNCH_IMG}/india-skyline.png`} alt="" width={2200} height={415} sizes="(max-width: 760px) 100vw, 1100px" />
        </div>
      </div>
    </section>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function TrustAndSafety() {
  const testimonial = TESTIMONIALS[0];
  // Was a hard-coded path to the illustrated placeholder, so unlike every
  // other image on this page it could not be swapped by dropping a file into
  // real/. It now uses the same slot mechanism: real/trust.(webp|jpg|…).
  const trust = resolveHomepageImage("trust", "/assets/quickfurno/images/vendors/premium-living-room.svg");
  return (
    <section className="qfp-section qfp-trust" id="why-quickfurno">
      <div className="qfp-shell qfp-trust-grid">
        <div className="qfp-trust-copy" data-reveal>
          <span className="qfp-kicker">Trust &amp; safety</span>
          <h2>Listed only after we say yes.</h2>
          <p className="qfp-trust-lead">
            Public profiles must pass QuickFurno&apos;s listing controls before they appear. Approval and active status are rechecked by the marketplace.
          </p>
          <ul className="qfp-verify-list">
            {VERIFY_POINTS.map((point) => (
              <li className="qfp-verify-item" key={point.title}>
                <VerifiedRosette />
                <div>
                  <strong>{point.title}</strong>
                  <span>{point.body}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="qfp-trust-visual" data-reveal>
          <div className="qfp-trust-photo">
            <Image src={trust.src} alt="" fill sizes="(max-width: 760px) 100vw, 564px" />
            <span className="qfp-trust-pill-label">PUNE LAUNCH</span>
          </div>
          {testimonial ? (
            <figure className="qfp-quote-card">
              <svg width="30" height="24" viewBox="0 0 30 24" fill="#C93A0E" opacity="0.25" aria-hidden="true">
                <path d="M0 24 L6 0 L14 0 L9 24 Z M16 24 L22 0 L30 0 L25 24 Z" />
              </svg>
              <blockquote>{testimonial.quote}</blockquote>
              <figcaption className="qfp-quote-who">
                <span className="qfp-quote-avatar" aria-hidden="true">{initials(testimonial.name)}</span>
                <div>
                  <strong>{testimonial.name}</strong>
                  <span>{testimonial.detail}</span>
                </div>
              </figcaption>
            </figure>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Areas() {
  const desktopHidden = Math.max(0, PUNE_AREAS.length - AREAS_VISIBLE_DESKTOP);
  const mobileHidden = Math.max(0, PUNE_AREAS.length - AREAS_VISIBLE_MOBILE);
  return (
    <section className="qfp-section qfp-areas" aria-labelledby="qfp-areas-title">
      <div className="qfp-shell">
        <h2 id="qfp-areas-title">
          <span className="qfp-areas-title-full">Serving {PUNE_AREAS.length}+ localities across Pune &amp; PCMC</span>
          <span className="qfp-areas-title-short">{PUNE_AREAS.length}+ localities across Pune &amp; PCMC</span>
        </h2>
        <input type="checkbox" id="qfp-areas-toggle" className="qfp-areas-toggle" aria-label="Show all localities" />
        <div className="qfp-area-pills" role="list">
          {PUNE_AREAS.map((area, index) => {
            const classes = ["qfp-area-pill"];
            if (index >= AREAS_VISIBLE_DESKTOP) classes.push("qfp-area-pill--d-extra");
            if (index >= AREAS_VISIBLE_MOBILE) classes.push("qfp-area-pill--m-extra");
            return <span className={classes.join(" ")} role="listitem" key={area}>{area}</span>;
          })}
          {desktopHidden > 0 ? (
            <label htmlFor="qfp-areas-toggle" className="qfp-area-pill qfp-area-more qfp-area-more--desktop">+ {desktopHidden} more</label>
          ) : null}
          {mobileHidden > 0 ? (
            <label htmlFor="qfp-areas-toggle" className="qfp-area-pill qfp-area-more qfp-area-more--mobile">+ {mobileHidden} more</label>
          ) : null}
        </div>
        <p className="qfp-areas-note">Your locality not listed? You can still submit an enquiry; assignment depends on marketplace eligibility and available supply.</p>
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
  return (
    <section className="qfp-section qfp-faq" id="faq">
      <div className="qfp-shell">
        <div className="qfp-head-center" data-reveal>
          <span className="qfp-kicker">Good to know</span>
          <h2>Questions Pune homeowners ask</h2>
        </div>
        <div className="qfp-faq-list">
          {HOME_FAQ.map((item) => (
            <details className="qfp-faq-item" key={item.q}>
              <summary>
                <span>{item.q}</span>
                <i aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </i>
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </section>
  );
}

function VendorCTA() {
  return (
    <section className="qfp-section qfp-vendor" aria-labelledby="qfp-vendor-title">
      <div className="qfp-shell">
        <div className="qfp-vendor-card" data-reveal>
          <div className="qfp-vendor-copy">
            <span className="qfp-kicker">For professionals</span>
            <h2 id="qfp-vendor-title">Run a home-services business in Pune?</h2>
            <p>Apply for a reviewed public profile and Client Matching eligibility. Assignments depend on approval, account eligibility, matching credits and demand.</p>
          </div>
          <Link href="/vendors" className="qfp-vendor-btn">
            Join as a vendor <ArrowIcon size={15} stroke="#14181D" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="qfp-footer" id="contact">
      <div className="qfp-shell">
        <div className="qfp-footer-grid">
          <div className="qfp-footer-brand">
            <Logo light />
            <p>A Pune-focused marketplace for homeowners and home-service professionals.</p>
            <span className="qfp-footer-made">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C9A876" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><path d="M3 9.5 L12 3 L21 9.5 L21 21 L3 21 Z" /></svg>
              Made with care for a better Pune
            </span>
          </div>
          <div className="qfp-footer-col qfp-footer-col--services">
            <h3>SERVICES</h3>
            {categories.map((category) => (
              <Link key={category.name} href={`/category/${categorySlug(category.name)}`}>{category.name}</Link>
            ))}
          </div>
          <div className="qfp-footer-col qfp-footer-col--company">
            <h3>COMPANY</h3>
            <Link href="#how-it-works">How it works</Link>
            <Link href="#why-quickfurno">Why QuickFurno</Link>
            <Link href="/vendors">For professionals</Link>
            <Link href="/privacy">Privacy policy</Link>
            <Link href="/terms">Terms &amp; conditions</Link>
          </div>
          <div className="qfp-footer-col qfp-footer-col--contact">
            <h3>CONTACT</h3>
            <a href={whatsappLink()} target="_blank" rel="noopener noreferrer"><FooterChatIcon />WhatsApp us</a>
            <a href={"mailto:" + CONTACT.email}><MailIcon />{CONTACT.email}</a>
            <span><PinIcon size={15} stroke="#FF8A5C" width={2} />Kharadi, Pune, Maharashtra</span>
          </div>
        </div>
        <div className="qfp-footer-bottom">
          <span>© 2026 QuickFurno. All rights reserved.</span>
          <span className="qfp-footer-tagline">Reviewed profiles | Up to 3 active matches | Free to enquire</span>
          <nav className="qfp-footer-legal" aria-label="Legal links">
            <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <Link href="/vendors">Vendor policy</Link>
          </nav>
        </div>
      </div>
    </footer>
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
        <MadeInPune />
        <TrustAndSafety />
        <Areas />
        <FAQ />
        <VendorCTA />
      </main>
      <Footer />
      <BottomNav />
    </div>
  );
}
