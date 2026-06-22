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
  title: "QuickFurno | Get Verified Home-Service Vendors Near You",
  description:
    "Tell QuickFurno your requirement and get connected with verified interior, carpentry, modular, painting, sofa and civil-work vendors in Pune and Mumbai.",
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
        <section className="hero-section premium-home-hero section-pad-top">
          <div className="container hero-grid">
            <div className="hero-copy">
              <h1 className="hero-headline hero-rise">
                Tell us your requirement and get connected with{" "}
                <span className="hl">verified home-service vendors near you.</span>
              </h1>
              <p className="hero-sub hero-rise">
                QuickFurno matches homeowners in Pune and Mumbai with vetted interior designers,
                carpenters, modular factories, painters, sofa makers and civil-work experts, so
                you can compare rates, reviews and project fit before the first call.
              </p>

              <div className="hero-cta-row hero-rise">
                <EnquiryModalTrigger className="btn btn-primary btn-shine">
                  Get Free Quotes
                </EnquiryModalTrigger>
                <Link href="#verified-vendors" className="btn btn-secondary">
                  Explore Vendors
                </Link>
              </div>

              <ul className="hero-trust-strip hero-rise" aria-label="QuickFurno trust indicators">
                <li>No spam handoff</li>
                <li>Up to 4 matched vendors</li>
                <li>Free client enquiry</li>
                <li>Pune and Mumbai</li>
              </ul>

              <div className="hero-social-proof hero-rise">
                <span className="avatar-stack" aria-hidden="true">
                  {["AP", "SK", "RM", "VJ"].map((initials, idx) => (
                    <span key={initials} className={`avatar-stack-item avatar-stack-item--${idx + 1}`}>
                      {initials}
                    </span>
                  ))}
                </span>
                <span className="hero-social-text">
                  <strong>Trusted by 1,200+ homeowners</strong>
                  <span>
                    <b>4.8/5</b> average vendor experience rating
                  </span>
                </span>
              </div>
            </div>

            <div className="hero-form-wrap hero-rise">
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
            <h2>Choose the service. Compare the right experts.</h2>
            <p>
              Each category is built for fast shortlisting: clear starting rates, project context
              and verified vendor profiles without a directory-style maze.
            </p>
          </div>
          <div className="container market-intro-strip" data-reveal-group>
            <article>
              <strong>Requirement first</strong>
              <span>Tell us what you need before vendors start calling.</span>
            </article>
            <article>
              <strong>Verified profiles</strong>
              <span>Review ratings, response time, experience and project focus.</span>
            </article>
            <article>
              <strong>Controlled matching</strong>
              <span>Get a focused shortlist instead of unlimited spam.</span>
            </article>
          </div>
          <div className="container">
            <CategoryCards />
          </div>
        </section>

        <section id="how-it-works" className="section-block section-warm">
          <div className="container section-heading" data-reveal>
            <span className="eyebrow">How QuickFurno Works</span>
            <h2>A simple quote flow that protects your attention.</h2>
            <p>
              The marketplace stays clear and controlled from the moment you submit a
              requirement to the moment you compare vendors.
            </p>
          </div>
          <div className="container">
            <HowItWorks />
          </div>
        </section>

        <section id="verified-vendors" className="section-block featured-vendors-section">
          <div className="container section-heading section-heading--split" data-reveal>
            <div>
              <span className="eyebrow">Featured verified vendors</span>
              <h2>Premium vendor profiles, not anonymous listings.</h2>
              <p>
                Preview active paid vendors with ratings, starting rates, response time and
                category fit before you open a profile.
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
            <h2>Built for homeowners who want clarity before calls.</h2>
          </div>
          <div className="container choose-grid" data-reveal-group>
            {whyChooseQuickFurno.map((item) => (
              <article className="choose-card" key={item}>
                <span aria-hidden="true">OK</span>
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
            <p>
              The strongest signal is simple: clients want a shorter path from requirement to
              confident vendor conversation.
            </p>
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
            <h2>Start with one requirement. Get a verified shortlist.</h2>
            <p>Tell QuickFurno what you need and get connected with relevant vendors in Pune or Mumbai.</p>
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
