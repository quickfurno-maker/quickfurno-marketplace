import type { Metadata } from "next";
import Link from "next/link";
import { CategoryCards } from "@/components/CategoryCards";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { HeroVisual } from "@/components/HeroVisual";
import { HowItWorks } from "@/components/HowItWorks";
import { StatsBand } from "@/components/StatsBand";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { Testimonials } from "@/components/Testimonials";
import { VendorCards } from "@/components/VendorCards";
import { clientFaqs, whyChooseQuickFurno } from "@/lib/quickfurno-data";

export const metadata: Metadata = {
  title: "QuickFurno | Get 4 Verified Home-Service Quotes in Pune & Mumbai",
  description:
    "Compare verified interior designers, carpenters, modular factories, painters, sofa and civil-work experts with ratings, project images and transparent rates.",
  openGraph: {
    title: "QuickFurno | Verified home-service vendors",
    description:
      "Tell QuickFurno your requirement and get connected with verified home-service vendors near you.",
    url: "https://quickfurno.com",
    siteName: "QuickFurno",
    type: "website",
  },
};

export default function HomePage() {
  return (
    <>
      <Header />
      <main>
        <section className="hero-section section-pad-top">
          <div className="container hero-grid">
            <div className="hero-copy">
              <span className="hero-urgency hero-rise" style={{ "--rise-delay": "0ms" } as React.CSSProperties}>
                <i aria-hidden="true">⚡</i> Get 4 free quotes in 24 hours · No spam
              </span>
              <h1 className="hero-headline hero-rise" style={{ "--rise-delay": "90ms" } as React.CSSProperties}>
                Find <span className="hl">verified</span> interior &amp; home-service vendors{" "}
                <span className="hl">near you</span>
              </h1>
              <p className="hero-sub hero-rise" style={{ "--rise-delay": "210ms" } as React.CSSProperties}>
                Compare trusted carpenters, interior designers, modular factories, painters, sofa
                makers and civil-work vendors in Pune &amp; Mumbai — with{" "}
                <strong>transparent rates</strong> and <strong>free enquiry</strong>.
              </p>

              <div
                className="hero-cta-row hero-rise"
                style={{ "--rise-delay": "320ms" } as React.CSSProperties}
              >
                <EnquiryModalTrigger className="btn btn-primary btn-shine">
                  Get Free Quotes
                </EnquiryModalTrigger>
                <Link href="#verified-vendors" className="btn btn-secondary">
                  Explore Vendors
                </Link>
              </div>

              <ul
                className="hero-trust-strip hero-rise"
                style={{ "--rise-delay": "430ms" } as React.CSSProperties}
                aria-label="QuickFurno trust indicators"
              >
                <li>Verified vendors</li>
                <li>Transparent rates</li>
                <li>Free client enquiry</li>
                <li>Pune &amp; Mumbai</li>
              </ul>

              <div
                className="hero-social-proof hero-rise"
                style={{ "--rise-delay": "540ms" } as React.CSSProperties}
              >
                <span className="avatar-stack" aria-hidden="true">
                  {["AP", "SK", "RM", "VJ"].map((i, idx) => (
                    <span key={i} className={`avatar-stack-item avatar-stack-item--${idx + 1}`}>
                      {i}
                    </span>
                  ))}
                </span>
                <span className="hero-social-text">
                  <strong>Trusted by 1,200+ homeowners</strong>
                  <span>
                    <b>4.8</b> <i aria-hidden="true">★★★★★</i> average rating
                  </span>
                </span>
              </div>
            </div>

            <div className="hero-form-wrap hero-rise" style={{ "--rise-delay": "260ms" } as React.CSSProperties}>
              <HeroVisual />
            </div>
          </div>
          <div className="container hero-stats-wrap" data-reveal>
            <StatsBand />
          </div>
        </section>

        <section id="services" className="section-block">
          <div className="container section-heading" data-reveal>
            <span className="eyebrow">Popular home-service categories</span>
            <h2>Find the right expert by category, rate and project quality.</h2>
            <p>
              QuickFurno keeps the client journey simple: choose a service, compare verified vendors,
              and request quotes without getting spammed.
            </p>
          </div>
          <div className="container">
            <CategoryCards />
          </div>
        </section>

        <section id="how-it-works" className="section-block section-warm">
          <div className="container section-heading" data-reveal>
            <span className="eyebrow">How QuickFurno Works</span>
            <h2>From requirement to shortlist in four clear steps.</h2>
          </div>
          <div className="container">
            <HowItWorks />
          </div>
        </section>

        <section id="verified-vendors" className="section-block">
          <div className="container section-heading section-heading--split" data-reveal>
            <div>
              <span className="eyebrow">Featured verified vendors</span>
              <h2>Top-rated studios on QuickFurno right now.</h2>
              <p>
                A preview of our highest-rated active vendors. Pick a category to see every
                verified vendor near you.
              </p>
            </div>
            <Link href="#services" className="btn btn-primary">
              Browse by category
            </Link>
          </div>
          <div className="container">
            <VendorCards limit={5} />
          </div>
        </section>

        <section className="section-block section-warm">
          <div className="container section-heading" data-reveal>
            <span className="eyebrow">Why clients choose QuickFurno</span>
            <h2>A more controlled way to find home-service experts.</h2>
          </div>
          <div className="container choose-grid" data-reveal-group>
            {whyChooseQuickFurno.map((item) => (
              <article className="choose-card" key={item}>
                <span aria-hidden="true">✓</span>
                <h3>{item}</h3>
                <p>Designed to help homeowners compare confidently before starting a project.</p>
              </article>
            ))}
          </div>
        </section>

        <section id="reviews" className="section-block">
          <div className="container section-heading" data-reveal>
            <span className="eyebrow">Client testimonials</span>
            <h2>Homeowners want clarity, not endless follow-ups.</h2>
          </div>
          <div className="container">
            <Testimonials />
          </div>
        </section>

        <section id="faq" className="section-block section-warm">
          <div className="container faq-layout" data-reveal>
            <div className="section-heading section-heading--left">
              <span className="eyebrow">FAQ</span>
              <h2>Questions clients ask before submitting a requirement.</h2>
              <p>Quick answers for quote flow, verification and city availability.</p>
            </div>
            <FAQ items={clientFaqs} />
          </div>
        </section>

        <section className="final-cta">
          <div className="container final-cta-card" data-reveal>
            <span className="eyebrow">Ready to start?</span>
            <h2>Ready to start your home project?</h2>
            <p>Tell QuickFurno your requirement and get matched with verified vendors in Pune or Mumbai.</p>
            <div className="hero-cta-row">
              <EnquiryModalTrigger className="btn btn-primary">
                Start Enquiry
              </EnquiryModalTrigger>
              <a className="btn btn-outline" href="https://wa.me/91XXXXXXXXXX">
                WhatsApp Us
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <StickyMobileCTA />
    </>
  );
}
