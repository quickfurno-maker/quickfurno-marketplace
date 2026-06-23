import type { Metadata } from "next";
import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { HomeCategoryGrid } from "@/components/home/HomeCategoryGrid";
import {
  ClientCTASection,
  CoverageSection,
  FeaturedFlows,
  HomeHowItWorksSection,
  HomeTestimonials,
  StatsStrip,
  WhyChooseSection,
} from "@/components/home/HomeSections";
import { QFIcon } from "@/components/QuickFurnoIcons";

// Phase 1A hero trust badges (visual; matches final design direction).
const heroBadges = [
  { icon: "shield" as const, label: "Verified Professionals" },
  { icon: "tag" as const, label: "Upfront Pricing" },
  { icon: "clock" as const, label: "On-Time Guarantee" },
  { icon: "lock" as const, label: "Secure Payments" },
];

// Floating trust badges overlapping the hero image (desktop only).
const heroMiniCards = [
  { icon: "shield" as const, label: "Verified Experts" },
  { icon: "home" as const, label: "Premium Interiors" },
  { icon: "tag" as const, label: "Best Price Match" },
];

export const metadata: Metadata = {
  title: "QuickFurno | Find Verified Home-Service Vendors Near You",
  description:
    "Find verified carpenters, interior designers, painters, sofa makers and renovation experts near you with QuickFurno.",
  openGraph: {
    title: "QuickFurno | Verified home-service vendors near you",
    description:
      "Tell QuickFurno your requirement and get connected with trusted local experts.",
    url: "https://quickfurno.in",
    siteName: "QuickFurno",
    type: "website",
  },
};

export default function HomePage() {
  return (
    <>
      <Header />
      <main className="qf-home-page">
        <div className="qf-home-app-shell">
          <section className="qf-hero-section qf-hero-clean">
            <div className="qf-hero-copy">
              <span className="qf-hero-eyebrow">Trusted Home Services</span>
              <h1>
                Beautiful homes.
                <br />
                <em>Expertly done.</em>
              </h1>
              <p>
                Book verified professionals for every corner of your home. Fast,
                reliable &amp; hassle-free.
              </p>
            </div>

            <div className="qf-hero-visual">
              <img
                src="/assets/quickfurno/images/hero/hero-interior-diorama.svg"
                alt="Premium home interior styled by QuickFurno vendors"
              />
              <div className="qf-hero-mini-cards" aria-hidden="true">
                {heroMiniCards.map((card) => (
                  <span key={card.label} className="qf-hero-mini-card">
                    <span className="qf-hero-mini-icon">
                      <QFIcon name={card.icon} />
                    </span>
                    {card.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="qf-hero-actions">
              <EnquiryModalTrigger
                className="qf-hero-cta-primary"
                source="Homepage hero"
              >
                Book Now <QFIcon name="arrow" />
              </EnquiryModalTrigger>
              <Link href="#categories" className="qf-hero-cta-secondary">
                Explore Services
              </Link>
            </div>

            <div className="qf-hero-trust" aria-label="QuickFurno trust badges">
              {heroBadges.map((badge) => (
                <span key={badge.label} className="qf-hero-trust-item">
                  <QFIcon name={badge.icon} />
                  {badge.label}
                </span>
              ))}
            </div>
          </section>

          <section className="qf-home-section" id="categories">
            <div className="qf-section-head qf-section-head--row">
              <div>
                <h2>Popular Home Services</h2>
                <p>Choose a service and book verified professionals near you.</p>
              </div>
              <Link href="#featured" className="qf-section-link">
                View all <QFIcon name="arrow" />
              </Link>
            </div>
            <HomeCategoryGrid />
          </section>

          <FeaturedFlows />
          <StatsStrip />
          <HomeHowItWorksSection />
          <WhyChooseSection />
          <HomeTestimonials />
          <CoverageSection />
          <ClientCTASection />
        </div>
      </main>
      <Footer />
      <StickyMobileCTA />
    </>
  );
}
