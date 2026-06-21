import type { Metadata } from "next";
import Link from "next/link";
import { CategoryCards } from "@/components/CategoryCards";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { HowItWorks } from "@/components/HowItWorks";
import { LeadForm } from "@/components/LeadForm";
import { PortfolioGallery } from "@/components/PortfolioGallery";
import { PricingEstimator } from "@/components/PricingEstimator";
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

const trustBadges = ["Verified vendors", "Fast response", "Transparent rates", "Pune & Mumbai"];

export default function HomePage() {
  return (
    <>
      <Header />
      <main>
        <section className="hero-section section-pad-top">
          <div className="container hero-grid">
            <div className="hero-copy">
              <span className="eyebrow">Client-first marketplace</span>
              <h1>Tell us your requirement and get connected with verified home-service vendors near you.</h1>
              <p>
                Compare verified interior designers, carpenters, modular factories, painters and
                civil-work experts with ratings, project images and transparent rates.
              </p>

              <div className="hero-cta-row">
                <Link href="#lead-form" className="btn btn-primary">
                  Get 4 Verified Quotes
                </Link>
                <Link href="#verified-vendors" className="btn btn-secondary">
                  Browse Vendors
                </Link>
                <a className="btn btn-outline" href="https://wa.me/91XXXXXXXXXX">
                  WhatsApp Us
                </a>
              </div>

              <div className="trust-badge-row" aria-label="QuickFurno trust indicators">
                {trustBadges.map((badge) => (
                  <span key={badge}>{badge}</span>
                ))}
              </div>

              <div className="hero-preview-strip" aria-label="QuickFurno project previews">
                {["Living room", "Kitchen", "Wardrobe"].map((label, index) => (
                  <div className={`mini-preview mini-preview-${index + 1}`} key={label}>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="hero-form-wrap">
              <LeadForm />
            </div>
          </div>
        </section>

        <section id="services" className="section-block">
          <div className="container section-heading">
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
          <div className="container section-heading">
            <span className="eyebrow">How QuickFurno Works</span>
            <h2>From requirement to shortlist in four clear steps.</h2>
          </div>
          <div className="container">
            <HowItWorks />
          </div>
        </section>

        <section id="verified-vendors" className="section-block">
          <div className="container section-heading section-heading--split">
            <div>
              <span className="eyebrow">Verified vendor cards</span>
              <h2>Compare active paid vendors before you enquire.</h2>
              <p>
                Only vendors with an active paid plan appear on the client marketplace preview.
              </p>
            </div>
            <Link href="#lead-form" className="btn btn-primary">
              Get 4 Verified Quotes
            </Link>
          </div>
          <div className="container">
            <VendorCards />
          </div>
        </section>

        <section id="pricing-estimate" className="section-block section-warm">
          <div className="container">
            <PricingEstimator />
          </div>
        </section>

        <section id="projects" className="section-block">
          <div className="container section-heading">
            <span className="eyebrow">Portfolio Gallery</span>
            <h2>Preview the kind of work clients can compare.</h2>
            <p>
              These premium project cards are placeholders for future vendor project images.
            </p>
          </div>
          <div className="container">
            <PortfolioGallery />
          </div>
        </section>

        <section className="section-block section-warm">
          <div className="container section-heading">
            <span className="eyebrow">Why clients choose QuickFurno</span>
            <h2>A more controlled way to find home-service experts.</h2>
          </div>
          <div className="container choose-grid">
            {whyChooseQuickFurno.map((item) => (
              <article className="choose-card reveal-card" key={item}>
                <span aria-hidden="true">✓</span>
                <h3>{item}</h3>
                <p>Designed to help homeowners compare confidently before starting a project.</p>
              </article>
            ))}
          </div>
        </section>

        <section id="reviews" className="section-block">
          <div className="container section-heading">
            <span className="eyebrow">Client testimonials</span>
            <h2>Homeowners want clarity, not endless follow-ups.</h2>
          </div>
          <div className="container">
            <Testimonials />
          </div>
        </section>

        <section id="faq" className="section-block section-warm">
          <div className="container faq-layout">
            <div className="section-heading section-heading--left">
              <span className="eyebrow">FAQ</span>
              <h2>Questions clients ask before submitting a requirement.</h2>
              <p>Quick answers for quote flow, verification and city availability.</p>
            </div>
            <FAQ items={clientFaqs} />
          </div>
        </section>

        <section className="final-cta">
          <div className="container final-cta-card">
            <span className="eyebrow">Ready to start?</span>
            <h2>Ready to start your home project?</h2>
            <p>Tell QuickFurno your requirement and get matched with verified vendors in Pune or Mumbai.</p>
            <div className="hero-cta-row">
              <Link href="#lead-form" className="btn btn-primary">
                Get 4 Verified Quotes
              </Link>
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
