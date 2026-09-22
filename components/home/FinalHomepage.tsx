import Image from "next/image";
import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { categories, categorySlug, type QuickFurnoCategory } from "@/lib/quickfurno-data";
import type { Vendor } from "@/lib/quickfurno-data";
import { HomeMobileBottomNav } from "@/components/home/HomeMobileBottomNav";
import {
  AreasWeServe,
  FeaturedVendors,
  HomeFAQ,
  HowWeVerify,
  Testimonials,
  VendorJoinCTA,
} from "@/components/home/LaunchSections";
import { getPublicVendorsForCategory } from "@/services/publicVendorService";
import { loadMarketplaceRuntimeSettings } from "@/lib/lead-assignment/runtimeSettings";
// Real-photo slots: illustrated fallbacks are swapped for real project photos
// the moment they exist in public/assets/quickfurno/images/real/ (see the
// README in that folder). No code change needed to adopt photos.
import { categoryImage, heroImage } from "@/lib/homepage-images";

// Launch homepage: pull a handful of REAL approved vendors for the featured
// strip. Any failure (or an empty marketplace) renders no strip at all — the
// homepage never shows demo/fictional vendors (QF-UI-V2-06 principle).
const FEATURED_CATEGORIES: QuickFurnoCategory[] = [
  "Interior Designers",
  "Modular Factory",
  "Carpenters",
  "Painter",
];
const FEATURED_LIMIT = 6;

async function getFeaturedVendors(): Promise<Vendor[]> {
  try {
    const settings = await loadMarketplaceRuntimeSettings();
    const seen = new Set<string>();
    const featured: Vendor[] = [];
    for (const category of FEATURED_CATEGORIES) {
      const vendors = await getPublicVendorsForCategory(category, settings);
      if (!vendors) continue;
      for (const vendor of vendors) {
        if (seen.has(vendor.slug)) continue;
        seen.add(vendor.slug);
        featured.push(vendor);
        if (featured.length >= FEATURED_LIMIT) return featured;
      }
    }
    return featured;
  } catch {
    return [];
  }
}

const SERVICE_META: Record<QuickFurnoCategory, { subtitle: string; image: string }> = {
  "Interior Designers": { subtitle: "Complete home interiors", image: "/assets/quickfurno/images/categories/interior-designers.svg" },
  Carpenters: { subtitle: "Custom furniture & woodwork", image: "/assets/quickfurno/images/categories/carpenters.svg" },
  "Modular Factory": { subtitle: "Factory-finish modular work", image: "/assets/quickfurno/images/categories/modular-factory.svg" },
  "Premium Interiors": { subtitle: "Premium design & execution", image: "/assets/quickfurno/images/categories/premium-interiors.svg" },
  Sofa: { subtitle: "Custom sofas & upholstery", image: "/assets/quickfurno/images/categories/sofa.svg" },
  Painter: { subtitle: "Interior & exterior painting", image: "/assets/quickfurno/images/categories/painter.svg" },
  "Civil Work": { subtitle: "Renovation, masonry & repairs", image: "/assets/quickfurno/images/categories/civil-work.svg" },
  "False Ceiling": { subtitle: "POP & gypsum ceilings", image: "/assets/quickfurno/images/categories/false-ceiling.svg" },
};

// Homepage discovery is derived from the canonical marketplace category registry.
// No UI-only category/subcategory is allowed here.
const SERVICES = categories.map(({ name }) => ({
  title: name,
  category: name,
  ...SERVICE_META[name],
}));

const HOW_IT_WORKS = [
  {
    icon: "request" as const,
    title: "Tell Us What You Need",
    body: "Select your service and share a few details about your project.",
  },
  {
    icon: "user" as const,
    title: "Get Matched with Experts",
    body: "We connect you with up to 3 relevant verified professionals in Pune.",
  },
  {
    icon: "shield" as const,
    title: "Sit Back & Get It Done",
    body: "Compare profiles, choose your vendor and deal with them directly.",
  },
];
const TRUST_ITEMS = [
  ["shield", "Verified professionals"],
  ["compare", "Transparent matching"],
  ["star", "Quality-focused profiles"],
  ["chat", "Local support team"],
  ["pin", "Pune focused community"],
] as const;

function HomeHeader() {
  return (
    <header className="qfh-header">
      <div className="qfh-shell qfh-header-inner">
        <details className="qfh-mobile-menu">
          <summary className="qfh-mobile-menu-button" aria-label="Open navigation">
            <span className="qfh-mobile-menu-lines" aria-hidden="true"><i /><i /><i /></span>
          </summary>
          <nav className="qfh-mobile-menu-panel" aria-label="Mobile menu">
            <Link href="/">Home</Link>
            <Link href="#services">Services</Link>
            <Link href="#how-it-works">How It Works</Link>
            <Link href="/vendors">For Vendors</Link>
            <Link href="#why-quickfurno">About</Link>
          </nav>
        </details>
        <Link href="/" className="qfh-logo" aria-label="QuickFurno home">
          <Image src="/assets/quickfurno/logos/quickfurno-logo.svg" alt="QuickFurno" width={310} height={70} priority />
        </Link>
        <nav className="qfh-desktop-nav" aria-label="Homepage navigation">
          <Link href="/">Home</Link>
          <Link href="#services">Services</Link>
          <Link href="#how-it-works">How It Works</Link>
          <Link href="/vendors">For Vendors</Link>
          <Link href="#why-quickfurno">About</Link>
        </nav>
        <div className="qfh-header-actions">
          <span className="qfh-location-pill"><QFIcon name="pin" /> Pune</span>
          <EnquiryModalTrigger className="qfh-primary-btn qfh-header-quote" source="Homepage header">
            Get a Free Quote
          </EnquiryModalTrigger>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="qfh-hero" aria-labelledby="qfh-hero-title">
      <div className="qfh-shell qfh-hero-grid">
        <div className="qfh-hero-copy">
          <p className="qfh-kicker">Pune&apos;s trusted home-services marketplace</p>
          <h1 id="qfh-hero-title">
            <span>Better Spaces</span>
            <span className="qfh-hero-accent"><b>Happier</b> <em>Lives</em></span>
          </h1>
          <p className="qfh-hero-lead">
            Connect with verified professionals for your home interior, renovation and maintenance
            needs — all in one place.
          </p>
          {/* data-quote-bar: the trigger inside reads this bar's select at
              click time and opens the modal with the service pre-filled
              (see EnquiryModalTrigger's quote-bar convention). */}
          <div className="qfh-quote-bar" aria-label="Start a free quote" data-quote-bar>
            <label className="qfh-select-field">
              <QFIcon name="grid" />
              <select defaultValue="" aria-label="Select service">
                <option value="" disabled>Select Service</option>
                {SERVICES.map((service) => (
                  <option key={service.title} value={service.title}>{service.title}</option>
                ))}
              </select>
            </label>
            <div className="qfh-location-field"><QFIcon name="pin" /><span>Pune</span></div>
            <EnquiryModalTrigger className="qfh-primary-btn qfh-hero-quote" source="Homepage hero quote bar">
              Get a Free Quote <QFIcon name="arrow" />
            </EnquiryModalTrigger>
          </div>
          <div className="qfh-mini-trust" aria-label="QuickFurno benefits">
            <span><QFIcon name="shield" />Verified Professionals</span>
            <span><QFIcon name="compare" />Best-fit Match</span>
            <span><QFIcon name="noFee" />Free for Homeowners</span>
            <span><QFIcon name="pin" />Local Pune Experts</span>
          </div>
        </div>
        <div className="qfh-hero-media" aria-hidden="true">
          <Image
            src={heroImage("/assets/quickfurno/images/vendors/premium-living-room.svg").src}
            alt=""
            fill
            priority
            sizes="(max-width: 760px) 62vw, 48vw"
            className="qfh-hero-room"
          />
          <p className="qfh-dream-note">Your Dream Home<br />Starts Here!</p>
          <div className="qfh-pune-card">
            <span className="qfh-pune-card-icon"><QFIcon name="home" /></span>
            <div><strong>Serving Pune Homes</strong><small>Local experts · Real people · Lasting spaces</small></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatsStrip() {
  const stats = [
    ["user", "Verified", "Professionals"],
    ["compare", "Up to 3", "Relevant Matches"],
    ["star", "Profile-led", "Comparison"],
    ["pin", "100%", "Pune Focused"],
    ["noFee", "₹0", "For Homeowners"],
  ] as const;
  return (
    <section className="qfh-stats" aria-label="QuickFurno marketplace facts">
      <div className="qfh-shell qfh-stats-grid">
        {stats.map(([icon, value, label]) => (
          <div className="qfh-stat" key={`${value}-${label}`}>
            <span className="qfh-stat-icon"><QFIcon name={icon} /></span>
            <span><strong>{value}</strong><small>{label}</small></span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Services() {
  return (
    <section className="qfh-section qfh-services" id="services">
      <span id="categories" className="qfh-anchor-alias" aria-hidden="true" />
      <div className="qfh-shell">
        <div className="qfh-section-head qfh-section-head--center">
          <p className="qfh-section-label">Our services</p>
          <h2>Everything for a More Beautiful Home</h2>
          <p>From design to execution, find trusted experts for every home need in Pune.</p>
        </div>
        <div className="qfh-services-headline-row">
          <h3>Popular Services in Pune</h3>
          {/* Launch fix: the old "View All" here linked to #services — i.e. to
              itself. All seven services are already on this grid, so the link
              was a dead end and is gone. */}
        </div>
        <div className="qfh-service-grid">
          {SERVICES.map((service) => (
            <Link
              key={service.title}
              href={`/category/${categorySlug(service.category)}`}
              className="qfh-service-card"
            >
              <div className="qfh-service-media">
                <Image
                  src={categoryImage(categorySlug(service.category), service.image).src}
                  alt=""
                  fill
                  sizes="(max-width: 760px) 150px, 14vw"
                />
              </div>
              <div className="qfh-service-copy">
                <strong>{service.title}</strong>
                <small>{service.subtitle}</small>
                <span aria-hidden="true"><QFIcon name="arrow" /></span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="qfh-section qfh-how" id="how-it-works">
      <div className="qfh-shell">
        <div className="qfh-section-head qfh-section-head--center">
          <p className="qfh-section-label">How it works</p>
          <h2>Get Your Home Project Done in 3 Simple Steps</h2>
        </div>
        <ol className="qfh-steps">
          {HOW_IT_WORKS.map((step, index) => (
            <li className="qfh-step" key={step.title}>
              <span className="qfh-step-number">{index + 1}</span>
              <span className="qfh-step-icon"><QFIcon name={step.icon} /></span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function WhyQuickFurno() {
  return (
    <section className="qfh-section qfh-why" id="why-quickfurno">
      <div className="qfh-shell">
        <div className="qfh-why-grid">
          <div>
            <h2>Why Pune Homeowners Trust QuickFurno</h2>
            <div className="qfh-trust-points">
              {TRUST_ITEMS.map(([icon, label]) => (
                <div className="qfh-trust-point" key={label}>
                  <span><QFIcon name={icon} /></span>
                  <strong>{label}</strong>
                </div>
              ))}
            </div>
          </div>
          <Testimonials />
        </div>
      </div>
    </section>
  );
}
function PuneCTA() {
  return (
    <section className="qfh-pune-cta">
      <div className="qfh-shell qfh-pune-cta-inner">
        <Image
          src="/assets/quickfurno/images/city/pune-line-art.svg"
          alt=""
          width={700}
          height={260}
          className="qfh-pune-lineart"
          aria-hidden="true"
        />
        <div className="qfh-pune-cta-copy">
          <h2>Building a Better Pune</h2>
          <p>One Home at a Time.</p>
          <small>Local Homes. Local Professionals. A Brighter Pune.</small>
        </div>
        <EnquiryModalTrigger className="qfh-primary-btn qfh-pune-cta-btn" source="Homepage Pune CTA">
          Get Started Today <QFIcon name="arrow" />
        </EnquiryModalTrigger>
      </div>
    </section>
  );
}

function HomeFooter() {
  return (
    <footer className="qfh-footer" id="contact">
      <div className="qfh-shell qfh-footer-grid">
        <div className="qfh-footer-brand">
          <Image src="/assets/quickfurno/logos/quickfurno-logo.svg" alt="QuickFurno" width={310} height={70} />
          <p>Verified home-service professionals for Pune homeowners.</p>
        </div>
        <div className="qfh-footer-col">
          <h3>Quick Links</h3>
          <Link href="/">Home</Link>
          <Link href="#services">Services</Link>
          <Link href="#how-it-works">How It Works</Link>
          <Link href="/vendors">For Vendors</Link>
          <Link href="#why-quickfurno">About</Link>
        </div>
        <div className="qfh-footer-col">
          <h3>Popular Services</h3>
          {SERVICES.map((service) => (
            <Link key={service.category} href={`/category/${categorySlug(service.category)}`}>
              {service.title}
            </Link>
          ))}
        </div>
        <div className="qfh-footer-col qfh-footer-contact">
          <h3>Contact</h3>
          <a href="tel:+917447863602">+91 74478 63602</a>
          <a href="mailto:support@quickfurno.in">support@quickfurno.in</a>
          <span>Pune, Maharashtra</span>
        </div>
        <div className="qfh-footer-pune">
          <span><QFIcon name="home" /></span>
          <strong>Pune&apos;s Home Transformation Partner</strong>
          <small>Trusted. Local. Reliable.</small>
        </div>
      </div>
      <div className="qfh-shell qfh-footer-bottom">
        <span>© 2026 QuickFurno. All rights reserved.</span>
        <nav aria-label="Legal links">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms & Conditions</Link>
        </nav>
        <span>Made with ♥ for a Better Pune</span>
      </div>
    </footer>
  );
}

export async function FinalHomepage() {
  const featuredVendors = await getFeaturedVendors();
  return (
    <div className="qfh-page">
      <HomeHeader />
      <main>
        <Hero />
        <StatsStrip />
        <Services />
        <FeaturedVendors vendors={featuredVendors} />
        <HowItWorks />
        <HowWeVerify />
        <WhyQuickFurno />
        <AreasWeServe />
        <HomeFAQ />
        <VendorJoinCTA />
        <PuneCTA />
      </main>
      <HomeFooter />
      <HomeMobileBottomNav />
    </div>
  );
}
