import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { categories, categorySlug, type QuickFurnoCategory } from "@/lib/quickfurno-data";
import { HOME_FAQ, PUNE_AREAS, TESTIMONIALS } from "@/lib/homepage-content";
import { categoryImage, heroImage } from "@/lib/homepage-images";

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
function GridIcon({ size = 18, stroke = "#8A8474" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function ShieldCheckIcon({ size = 18, stroke = "#F04A1A", width = 2 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.6-3.1 7.7-7 9-3.9-1.3-7-4.4-7-9V6l7-3z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </svg>
  );
}
function HomeIcon({ size = 18, stroke = "#F04A1A" }: IconProps) {
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
function PhoneIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FF8A5C" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
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
type ServiceMeta = {
  desc: string;
  short: string;
  cta: string;
  alt: string;
  mark: ReactNode;
  /** Optional per-photo crop focus (CSS object-position), e.g. "center 30%". */
  pos?: string;
};

const markProps = { width: 40, height: 40, viewBox: "0 0 48 48", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

const SERVICE_META: Record<QuickFurnoCategory, ServiceMeta> = {
  "Interior Designers": {
    desc: "Complete home interiors — design to handover.",
    short: "Complete home interiors — design to handover.",
    cta: "Explore Designers",
    alt: "Two interior designers in their studio with material samples, colour swatches and floor plans",
    mark: null,
  },
  "Modular Factory": {
    desc: "Factory-finish kitchens & wardrobes.",
    short: "Kitchens & wardrobes",
    cta: "Explore Modular",
    alt: "Technician inspecting a sage-green cabinet shutter in a modular furniture factory",
    pos: "center 30%",
    mark: (
      <svg {...markProps}><rect x="10" y="12" width="28" height="24" rx="2" /><line x1="24" y1="12" x2="24" y2="36" /><line x1="19" y1="18" x2="19" y2="20" /><line x1="29" y1="18" x2="29" y2="20" /></svg>
    ),
  },
  Carpenters: {
    desc: "Custom furniture & woodwork.",
    short: "Furniture & woodwork",
    cta: "Find Carpenters",
    alt: "Carpenter sanding a custom cabinet",
    mark: (
      <svg {...markProps}><path d="M17 13 V25 M31 13 V25" /><path d="M15 25 H33 V28 H15 Z" /><path d="M18 28 V37 M30 28 V37" /></svg>
    ),
  },
  "Premium Interiors": {
    desc: "Premium design & execution.",
    short: "Design & execution",
    cta: "Explore Premium",
    alt: "Luxurious premium living room",
    mark: (
      <svg {...markProps}><path d="M24 10 l4.2 8.6 9.3 1.1 -6.8 6.4 1.7 9.2 -8.4 -4.5 -8.4 4.5 1.7 -9.2 -6.8 -6.4 9.3 -1.1 z" /></svg>
    ),
  },
  Sofa: {
    desc: "Custom sofas & upholstery.",
    short: "Sofas & upholstery",
    cta: "Explore Sofas",
    alt: "Custom beige fabric sofa",
    mark: (
      <svg {...markProps}><path d="M13 27 v-4 a3 3 0 0 1 3 -3 h16 a3 3 0 0 1 3 3 v4" /><path d="M10 27 a3 3 0 0 1 3 -3 h22 a3 3 0 0 1 3 3 v7 h-28 z" /><path d="M14 34 v3 M34 34 v3" /></svg>
    ),
  },
  Painter: {
    desc: "Interior & exterior painting.",
    short: "Interior & exterior",
    cta: "Book a Painter",
    alt: "Painter rolling beige paint onto a wall",
    mark: (
      <svg {...markProps}><rect x="11" y="12" width="20" height="9" rx="2" /><path d="M31 16 h6 v7 l-13 3 v6" /><rect x="21" y="33" width="6" height="8" rx="1.5" /></svg>
    ),
  },
  "Civil Work": {
    desc: "Renovation, masonry & repairs.",
    short: "Renovation & repairs",
    cta: "Get Started",
    alt: "Mason beside fresh brickwork",
    mark: (
      <svg {...markProps}><rect x="10" y="14" width="28" height="20" rx="1" /><line x1="10" y1="24" x2="38" y2="24" /><line x1="24" y1="14" x2="24" y2="24" /><line x1="17" y1="24" x2="17" y2="34" /><line x1="31" y1="24" x2="31" y2="34" /></svg>
    ),
  },
  "False Ceiling": {
    desc: "POP & gypsum ceilings, cove lighting.",
    short: "POP & gypsum ceilings",
    cta: "Explore Ceilings",
    alt: "Layered false ceiling with warm cove lighting",
    mark: (
      <svg {...markProps}><path d="M8 13 H40" /><path d="M13 13 V19 H35 V13" /><path d="M17 23 H31" /><path d="M24 19 V27" /><path d="M20 27 H28 L26 32 H22 Z" /></svg>
    ),
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
    body: "Pick the service, your locality and a rough budget. Takes about a minute — no phone number until the end.",
  },
  {
    icon: <ShieldCheckIcon size={26} stroke="#fff" width={2} />,
    title: "We match verified experts",
    body: "Up to 3 relevant, verified Pune professionals — matched to your trade, area and budget, not a broadcast list.",
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
  { title: "Business identity check", body: "Real business details, reviewed before the profile goes public." },
  { title: "Work profile review", body: "Services, experience and work photos checked against reality." },
  { title: "Approved before listing", body: "Pending, rejected or suspended vendors never appear in matches." },
  { title: "Local support team", body: "A Pune-based team on phone, WhatsApp and email throughout." },
];

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
          Get three teams
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
              Get three teams
            </EnquiryModalTrigger>
          </nav>
        </details>
      </div>
    </header>
  );
}

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
          <h1 id="qfp-hero-title">
            Pune&apos;s finest home professionals.<br />{" "}
            <span>One enquiry away.</span>
          </h1>
          <div className="qfp-hero-badges" aria-label="Why QuickFurno">
            <span className="qfp-hero-badge">
              <ShieldIcon />
              <span className="qfp-badge-full">Aadhaar + GST verified<b>*</b></span>
              <span className="qfp-badge-short">Aadhaar + GST<b>*</b></span>
            </span>
            <span className="qfp-hero-badge">
              <PinIcon />
              <span className="qfp-badge-full">Nearby vendors</span>
              <span className="qfp-badge-short">Nearby</span>
            </span>
            <span className="qfp-hero-badge">
              <BoltIcon />
              Instant service
            </span>
          </div>
          <small className="qfp-hero-note">*Verification level varies by vendor.</small>
          {/* data-quote-bar: the trigger reads this bar's <select> (service) and
              [data-quote-area] input at click time and opens the modal pre-filled. */}
          <div className="qfp-quote" aria-label="Start an enquiry" data-quote-bar>
            <label className="qfp-quote-field qfp-quote-field--service">
              <GridIcon />
              <select defaultValue="" aria-label="Select service">
                <option value="">What do you need done?</option>
                {categories.map((category) => (
                  <option key={category.name} value={category.name}>{category.name}</option>
                ))}
              </select>
            </label>
            <label className="qfp-quote-field qfp-quote-field--area">
              <PinIcon size={18} stroke="#8A8474" width={2} />
              <input type="text" placeholder="Kharadi, Baner…" aria-label="Your locality" autoComplete="off" data-quote-area />
            </label>
            <EnquiryModalTrigger className="qfp-btn qfp-btn--primary qfp-quote-btn" source="Homepage hero quote bar">
              Get three teams <ArrowIcon size={16} stroke="#fff" />
            </EnquiryModalTrigger>
          </div>
        </div>
      </div>
    </section>
  );
}

function ServiceCard({ name }: { name: QuickFurnoCategory }) {
  const meta = SERVICE_META[name];
  const slug = categorySlug(name);
  const image = categoryImage(slug, FALLBACK_CATEGORY_IMAGE(slug));
  return (
    <Link href={`/category/${slug}`} className="qfp-card">
      <div className="qfp-card-media">
        <Image
          src={image.src}
          alt={meta.alt}
          fill
          sizes="(max-width: 760px) 50vw, (max-width: 1100px) 50vw, 282px"
          style={meta.pos ? { objectPosition: meta.pos } : undefined}
        />
      </div>
      <div className="qfp-card-body">
        <span className="qfp-card-accent" aria-hidden="true" />
        <h3>{name}</h3>
        <p className="qfp-card-desc-long">{meta.desc}</p>
        <p className="qfp-card-desc-short">{meta.short}</p>
        <span className="qfp-card-cta"><i><ArrowIcon stroke="#F04A1A" /></i>{meta.cta}</span>
        {meta.mark ? <span className="qfp-card-mark" aria-hidden="true">{meta.mark}</span> : null}
      </div>
    </Link>
  );
}

function FeaturedServiceCard() {
  const name = FEATURED.name;
  const meta = SERVICE_META[name];
  const slug = categorySlug(name);
  const image = categoryImage(slug, FALLBACK_CATEGORY_IMAGE(slug));
  return (
    <Link href={`/category/${slug}`} className="qfp-card qfp-card--featured">
      <div className="qfp-card-media">
        <Image src={image.src} alt={meta.alt} fill priority sizes="(max-width: 760px) 100vw, (max-width: 1100px) 100vw, 588px" />
        <span className="qfp-card-tag">MOST BOOKED</span>
      </div>
      <div className="qfp-card-body">
        <span className="qfp-card-accent" aria-hidden="true" />
        <h3>{name}</h3>
        <p className="qfp-card-desc-long">{meta.desc}</p>
        <span className="qfp-card-cta"><i><ArrowIcon stroke="#fff" /></i>{meta.cta}</span>
        <div className="qfp-card-perks" aria-label="What interior designers cover">
          <span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F04A1A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1.5" /><line x1="3" y1="10" x2="14" y2="10" /><line x1="14" y1="3" x2="14" y2="21" /></svg>
            Space Planning
          </span>
          <span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F04A1A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 l8 4.5 v9 L12 21 4 16.5 v-9 z" /><path d="M4 7.5 L12 12 l8 -4.5 M12 12 V21" /></svg>
            3D Designs
          </span>
          <span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F04A1A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8.5 12.2 l2.4 2.4 4.6 -5" /></svg>
            End-to-End Execution
          </span>
        </div>
      </div>
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
        <span className="qfp-notsure-desc">Tell us about your home — we&apos;ll route you to the right verified experts.</span>
        <span className="qfp-notsure-desc qfp-notsure-desc--short">We&apos;ll route you to the right expert.</span>
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
  { title: "Verified professionals", body: "Every profile reviewed before listing" },
  { title: "Quality assurance", body: "Work photos & experience checked" },
  { title: "Hassle-free experience", body: "One enquiry, up to 3 matches" },
  { title: "Free for homeowners", body: "No fee to enquire or compare" },
  { title: "Local Pune support", body: "Phone, WhatsApp & email help" },
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
            <circle cx={x1} cy={y1} r="5" fill="#F04A1A" />
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
          <h2>One home.<br />Every expert.</h2>
          <p>From full interiors to a fresh coat of paint — every trade, one trusted marketplace.</p>
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

function Services() {
  return (
    <section className="qfp-section qfp-services" id="services">
      <span id="categories" aria-hidden="true" />
      <div className="qfp-shell">
        <ServicesHeading />
        <div className="qfp-service-grid" data-reveal-group>
          <FeaturedServiceCard />
          {OTHER_SERVICES.map((category) => (
            <ServiceCard key={category.name} name={category.name} />
          ))}
          <NotSureCard />
        </div>
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
                <span className="qfp-step-next" aria-hidden="true"><ArrowIcon size={13} stroke="#F04A1A" width={2.6} /></span>
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
        {/* Decorative skyline of Indian landmarks: the "coming to your city"
            promise, sitting on the bottom edge of the section like a horizon. */}
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
  return (
    <section className="qfp-section qfp-trust" id="why-quickfurno">
      <div className="qfp-shell qfp-trust-grid">
        <div className="qfp-trust-copy" data-reveal>
          <span className="qfp-kicker">Trust &amp; safety</span>
          <h2>Listed only after we say yes.</h2>
          <p className="qfp-trust-lead">
            No anonymous listings, no pay-to-appear. Every profile on QuickFurno has been reviewed and approved by our Pune team.
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
            <Image src={`${LAUNCH_IMG}/team-pune.jpg`} alt="QuickFurno team reviewing a vendor profile" fill sizes="(max-width: 760px) 100vw, 564px" />
            <span className="qfp-trust-pill-label">PUNE HOMES, DONE RIGHT</span>
          </div>
          {testimonial ? (
            <figure className="qfp-quote-card">
              <svg width="30" height="24" viewBox="0 0 30 24" fill="#F04A1A" opacity="0.25" aria-hidden="true">
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
        <p className="qfp-areas-note">Your locality not listed? Send an enquiry anyway — we cover most of Pune.</p>
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
            <p>Get a verified public profile and receive relevant homeowner enquiries in your trade and area. Free to apply.</p>
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
            <p>Pune&apos;s trusted marketplace for verified home-service professionals. Better spaces, happier lives.</p>
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
            <a href="tel:+917447863602"><PhoneIcon />+91 74478 63602</a>
            <a href="mailto:support@quickfurno.in"><MailIcon />support@quickfurno.in</a>
            <span><PinIcon size={15} stroke="#FF8A5C" width={2} />Kharadi, Pune, Maharashtra</span>
          </div>
        </div>
        <div className="qfp-footer-bottom">
          <span>© 2026 QuickFurno. All rights reserved.</span>
          <span className="qfp-footer-tagline">Verified professionals · Up to 3 matches · Free for homeowners</span>
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
