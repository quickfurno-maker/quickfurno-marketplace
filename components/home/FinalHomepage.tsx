import Image from "next/image";
import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { QFIcon } from "@/components/QuickFurnoIcons";
import {
  categories,
  categorySlug,
  type QuickFurnoCategory,
  type Vendor,
} from "@/lib/quickfurno-data";
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
  { icon: "request" as const, title: "Tell us what you need", body: "Share your project details in a few minutes." },
  { icon: "compare" as const, title: "Compare matched pros", body: "Get up to 3 relevant professional profiles." },
  { icon: "shield" as const, title: "Choose with confidence", body: "Review profiles, approved reviews and project details." },
];

function Wordmark() {
  return (
    <Link href="/" className="qfh-wordmark" aria-label="QuickFurno home">
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
            <Link href="#about">About</Link>
          </nav>
        </details>

        <Wordmark />

        <nav className="qfh-desktop-nav" aria-label="Homepage navigation">
          <Link href="#services">Services <span aria-hidden="true">⌄</span></Link>
          <Link href="#how-it-works">How it works</Link>
          <Link href="/vendors">For Professionals</Link>
          <Link href="#about">About</Link>
        </nav>

        <div className="qfh-header-actions">
          <span className="qfh-location-pill"><QFIcon name="pin" /> Pune <span aria-hidden="true">⌄</span></span>
          <Link href="/vendors" className="qfh-header-search" aria-label="Browse professionals"><QFIcon name="search" /></Link>
          <EnquiryModalTrigger className="qfh-primary-btn qfh-header-quote" source="Homepage header">Find My Team</EnquiryModalTrigger>
          <Link href="/login" className="qfh-signin"><QFIcon name="user" /> Sign In</Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="qfh-hero" aria-labelledby="qfh-hero-title">
      <div className="qfh-hero-image" aria-hidden="true">
        <Image
          src="/assets/quickfurno/images/hero/qf-homepage-reference-family.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="qfh-hero-room"
        />
      </div>
      <span className="qfh-hero-blend" aria-hidden="true" />

      <div className="qfh-shell qfh-hero-inner qfh-hero-grid">
        <div className="qfh-hero-copy">
          <p className="qfh-kicker">Home projects, matched better</p>
          <h1 id="qfh-hero-title">Find the right team.<span>Build the home you want.</span></h1>
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
            <em>A more beautiful home<br />is a happier you</em><i />
          </div>
        </div>

        <p className="qfh-hero-media-note">
          Real homes. Relevant professionals. Better choices. <QFIcon name="arrow" />
        </p>
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
              href={"/category/" + categorySlug(category.name)}
              className="qfh-category-item"
            >
              <span className="qfh-category-icon">
                <QFIcon name={CATEGORY_ICONS[category.name]} />
                <i aria-hidden="true" />
              </span>
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

function FeaturedProfessionals({ vendors }: { vendors: Vendor[] }) {
  if (vendors.length === 0) return null;

  return (
    <section className="qfh-featured" aria-labelledby="qfh-featured-title">
      <div className="qfh-shell">
        <div className="qfh-featured-head">
          <div>
            <h2 id="qfh-featured-title">Featured professionals</h2>
            <p>Verified. Reviewed. Ready to help.</p>
          </div>
          <Link href="/vendors" className="qfh-view-all">View all professionals <QFIcon name="arrow" /></Link>
        </div>

        <div className="qfh-featured-grid">
          {vendors.slice(0, 4).map((vendor) => {
            const image = vendor.coverImageUrl ?? vendor.portfolioImages?.[0] ?? vendor.imageUrl;
            const href = "/vendors/" + vendor.slug;
            return (
              <article className="qfh-pro-card" key={vendor.slug}>
                <Link href={href} className="qfh-pro-media" aria-label={"View " + vendor.businessName}>
                  {image ? (
                    image.startsWith("/") ? (
                      <Image src={image} alt="" fill sizes="(max-width: 760px) 82vw, 25vw" className="qfh-pro-image" />
                    ) : (
                      <img src={image} alt="" className="qfh-pro-image" />
                    )
                  ) : (
                    <span className="qfh-pro-placeholder" aria-hidden="true">
                      {vendor.businessName.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="qfh-pro-heart" aria-hidden="true">♡</span>
                </Link>

                <div className="qfh-pro-body">
                  <h3><Link href={href}>{vendor.businessName}</Link></h3>
                  {vendor.reviews > 0 && vendor.rating > 0 ? (
                    <p className="qfh-pro-rating">
                      <b>★ {vendor.rating.toFixed(1)}</b> <span>({vendor.reviews} reviews)</span>
                    </p>
                  ) : (
                    <p className="qfh-pro-rating qfh-pro-rating--new"><b>New on QuickFurno</b></p>
                  )}
                  <div className="qfh-pro-meta">
                    <span><QFIcon name="pin" /> {vendor.city}</span>
                    <Link href={href}>View Profile <QFIcon name="arrow" /></Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
function AboutStrip() {
  return (
    <section className="qfh-about" id="why-quickfurno">\n      <span id="about" className="qfh-anchor-alias" aria-hidden="true" />
      <div className="qfh-shell qfh-about-grid">
        <div>
          <p>For Homeowners</p>
          <h2>A focused shortlist, not a flood of calls.</h2>
          <span>Tell us what you need and compare relevant professionals.</span>
          <EnquiryModalTrigger className="qfh-light-btn" source="Homepage homeowner CTA">
            Start Your Project <QFIcon name="arrow" />
          </EnquiryModalTrigger>
        </div>
        <div>
          <p>For Professionals</p>
          <h2>Put your work in front of relevant homeowners.</h2>
          <span>Build your QuickFurno profile and grow through matched enquiries.</span>
          <Link className="qfh-light-btn" href="/vendors">
            Join QuickFurno <QFIcon name="arrow" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="qfh-footer" id="contact">
      <div className="qfh-shell qfh-footer-row">
        <Wordmark />
        <p>A focused home-services marketplace for Pune homeowners and professionals.</p>
        <nav aria-label="Footer links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="mailto:support@quickfurno.in">Support</a>
        </nav>
        <span>© 2026 QuickFurno</span>
      </div>
    </footer>
  );
}

export function FinalHomepage({ featuredVendors = [] }: { featuredVendors?: Vendor[] }) {
  return (
    <div className="qfh-page">
      <Header />
      <main>
        <Hero />
        <CategoryStrip />
        <HowItWorks />
        <FeaturedProfessionals vendors={featuredVendors} />
        <AboutStrip />
      </main>
      <Footer />
      <HomeMobileBottomNav />
    </div>
  );
}
