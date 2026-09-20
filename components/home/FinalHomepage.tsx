import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { categories, categorySlug, type QuickFurnoCategory } from "@/lib/quickfurno-data";
import { HomeMobileBottomNav } from "@/components/home/HomeMobileBottomNav";

const CATEGORY_ICONS: Record<QuickFurnoCategory, Parameters<typeof QFIcon>[0]["name"]> = {
  "Interior Designers": "home",
  Carpenters: "hammer",
  "Modular Factory": "kitchen",
  "Premium Interiors": "star",
  Sofa: "sofa",
  Painter: "paint",
  "Civil Work": "civil",
};

const HOW_IT_WORKS = [
  {
    icon: "request" as const,
    title: "Tell us what you need",
    body: "Share your project details in a few minutes.",
  },
  {
    icon: "compare" as const,
    title: "Compare matched pros",
    body: "Get up to 3 relevant professional profiles.",
  },
  {
    icon: "shield" as const,
    title: "Choose with confidence",
    body: "Review profiles, approved reviews and project details.",
  },
];

const TRUST_POINTS = [
  {
    icon: "noFee" as const,
    title: "Free for homeowners",
    body: "Submit a requirement without paying QuickFurno.",
  },
  {
    icon: "compare" as const,
    title: "Up to 3 relevant matches",
    body: "A focused shortlist designed to reduce unnecessary calls.",
  },
  {
    icon: "shield" as const,
    title: "Verified-review profiles",
    body: "Approved reviews appear only after a verified QuickFurno interaction.",
  },
];

function Wordmark({ footer = false }: { footer?: boolean }) {
  return (
    <Link
      href="/"
      className={footer ? "qfh-wordmark qfh-wordmark--footer" : "qfh-wordmark"}
      aria-label="QuickFurno home"
    >
      <strong>QuickFurno</strong>
      <span>Homes. Handled Better.</span>
    </Link>
  );
}

function Header() {
  return (
    <header className="qfh-header">
      <div className="qfh-shell qfh-header-inner">
        <details className="qfh-mobile-menu">
          <summary className="qfh-mobile-menu-button" aria-label="Open navigation">
            <span className="qfh-mobile-menu-lines" aria-hidden="true"><i /><i /><i /></span>
          </summary>
          <nav className="qfh-mobile-menu-panel" aria-label="Mobile menu">
            <Link href="#services">Services</Link>
            <Link href="#how-it-works">How it works</Link>
            <Link href="/vendors">For Professionals</Link>
            <Link href="#why-quickfurno">About</Link>
          </nav>
        </details>

        <Wordmark />

        <nav className="qfh-desktop-nav" aria-label="Homepage navigation">
          <Link href="#services">Services <span aria-hidden="true">⌄</span></Link>
          <Link href="#how-it-works">How it works</Link>
          <Link href="/vendors">For Professionals</Link>
          <Link href="#why-quickfurno">About</Link>
        </nav>

        <div className="qfh-header-actions">
          <span className="qfh-location-pill"><QFIcon name="pin" /> Pune <span aria-hidden="true">⌄</span></span>
          <Link href="/vendors" className="qfh-header-search" aria-label="Browse professionals">
            <QFIcon name="search" />
          </Link>
          <EnquiryModalTrigger className="qfh-primary-btn qfh-header-quote" source="Homepage header">
            Find My Team
          </EnquiryModalTrigger>
          <Link href="/login" className="qfh-signin"><QFIcon name="user" /> Sign In</Link>
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
          <p className="qfh-kicker">Home projects, matched better</p>
          <h1 id="qfh-hero-title">
            Find the right team.
            <span>Build the home you want.</span>
          </h1>
          <p className="qfh-hero-lead">
            Tell us what you&apos;re planning. QuickFurno matches you with up to 3 relevant home
            professionals, so you can compare clearly and choose with confidence.
          </p>

          <div className="qfh-hero-actions">
            <EnquiryModalTrigger className="qfh-primary-btn qfh-hero-quote" source="Homepage hero">
              Find My Team <QFIcon name="arrow" />
            </EnquiryModalTrigger>
          </div>

          <div className="qfh-mini-trust" aria-label="QuickFurno marketplace facts">
            <span><QFIcon name="noFee" /><b>Free for homeowners</b></span>
            <span><QFIcon name="compare" /><b>Up to 3 relevant matches</b></span>
            <span><QFIcon name="shield" /><b>Verified-review profiles</b></span>
          </div>

          <div className="qfh-hero-script" aria-hidden="true">
            <em>A more beautiful home<br />is a happier you</em>
            <i />
          </div>
        </div>

        <div className="qfh-hero-media" aria-hidden="true">
          <span className="qfh-hero-photo-shade" />
          <p className="qfh-hero-media-note">
            Real homes. Relevant professionals. Better choices. <QFIcon name="arrow" />
          </p>
        </div>
      </div>
    </section>
  );
}

function CategoryStrip() {
  return (
    <section className="qfh-category-section" id="services" aria-labelledby="qfh-category-title">
      <span id="categories" className="qfh-anchor-alias" aria-hidden="true" />
      <div className="qfh-shell">
        <div className="qfh-category-head">
          <h2 id="qfh-category-title">Explore by category</h2>
          <Link href="#services" className="qfh-view-all">View all services <QFIcon name="arrow" /></Link>
        </div>
        <div className="qfh-category-grid">
          {categories.map((category) => (
            <Link
              key={category.name}
              href={`/category/${categorySlug(category.name)}`}
              className="qfh-category-item"
            >
              <span className="qfh-category-icon"><QFIcon name={CATEGORY_ICONS[category.name]} /></span>
              <strong>{category.name}</strong>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="qfh-how" id="how-it-works">
      <div className="qfh-shell qfh-how-grid">
        <div className="qfh-how-title">
          <h2>How it works</h2>
          <p>Get started in minutes</p>
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
    <section className="qfh-proof" id="why-quickfurno">
      <div className="qfh-shell">
        <div className="qfh-proof-head">
          <p className="qfh-section-label">A simpler way to compare</p>
          <h2>Fewer calls. Better choices.</h2>
          <p>
            QuickFurno is designed around a focused shortlist instead of sending your requirement
            everywhere. You stay in control of who you choose.
          </p>
        </div>
        <div className="qfh-proof-grid">
          {TRUST_POINTS.map((point) => (
            <article className="qfh-proof-card" key={point.title}>
              <span><QFIcon name={point.icon} /></span>
              <h3>{point.title}</h3>
              <p>{point.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function DualCTA() {
  return (
    <section className="qfh-dual-cta">
      <div className="qfh-shell qfh-dual-cta-grid">
        <div className="qfh-dual-panel">
          <p>For homeowners</p>
          <h2>From ideas to a clearer shortlist.</h2>
          <span>Tell us what you need and compare relevant professionals.</span>
          <EnquiryModalTrigger className="qfh-light-btn" source="Homepage homeowner CTA">
            Start Your Project <QFIcon name="arrow" />
          </EnquiryModalTrigger>
        </div>
        <div className="qfh-dual-panel">
          <p>For professionals</p>
          <h2>Put your work in front of the right homeowners.</h2>
          <span>Build your QuickFurno profile and grow through relevant enquiries.</span>
          <Link className="qfh-light-btn" href="/vendors">
            Join as a Professional <QFIcon name="arrow" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="qfh-footer" id="contact">
      <div className="qfh-shell qfh-footer-grid">
        <div className="qfh-footer-brand">
          <Wordmark footer />
          <p>A focused home-services marketplace for Pune homeowners and local professionals.</p>
        </div>
        <div className="qfh-footer-col">
          <h3>Explore</h3>
          <Link href="#services">Services</Link>
          <Link href="#how-it-works">How it works</Link>
          <Link href="/vendors">For Professionals</Link>
        </div>
        <div className="qfh-footer-col">
          <h3>Categories</h3>
          {categories.map((category) => (
            <Link key={category.name} href={`/category/${categorySlug(category.name)}`}>{category.name}</Link>
          ))}
        </div>
        <div className="qfh-footer-col qfh-footer-contact">
          <h3>Contact</h3>
          <a href="tel:+917447863602">+91 74478 63602</a>
          <a href="mailto:support@quickfurno.in">support@quickfurno.in</a>
          <span>Pune, Maharashtra</span>
        </div>
      </div>
      <div className="qfh-shell qfh-footer-bottom">
        <span>© 2026 QuickFurno. All rights reserved.</span>
        <nav aria-label="Legal links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </div>
    </footer>
  );
}

export function FinalHomepage() {
  return (
    <div className="qfh-page">
      <Header />
      <main>
        <Hero />
        <CategoryStrip />
        <HowItWorks />
        <WhyQuickFurno />
        <DualCTA />
      </main>
      <Footer />
      <HomeMobileBottomNav />
    </div>
  );
}
