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
  HomeHowItWorksSection,
  HomeTestimonials,
  PopularServicesSection,
  TrustStrip,
  VendorCTASection,
  WhyChooseSection,
  trustBadges,
} from "@/components/home/HomeSections";
import { QFIcon } from "@/components/QuickFurnoIcons";

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
          <section className="qf-hero-section qf-hero-section--centered qf-hero-section--banner">
            <div className="qf-hero-media" aria-hidden="true">
              <div className="qf-hero-media-img" />
              <div className="qf-hero-media-scrim" />
              <span className="qf-hero-media-shine" />
            </div>
            <div className="qf-hero-copy">
              <span className="qf-hero-eyebrow">
                <i aria-hidden="true" /> Premium home interiors, made simple
              </span>
              <h1>
                Tell us your requirement and get connected with verified
                home-service vendors near you.
              </h1>
              <p>
                Trusted carpenters, interior designers, painters, sofa makers and
                renovation experts — matched to your city, budget and timeline.
              </p>

              <div className="qf-hero-actions">
                <EnquiryModalTrigger className="qf-gold-btn" source="Homepage hero">
                  Get Free Vendor Matches
                </EnquiryModalTrigger>
                <Link href="#categories" className="qf-teal-btn">
                  Explore Categories
                </Link>
              </div>

              <p className="qf-hero-rating">
                <b>4.8★</b> average rating · 1,200+ verified vendors · No brokerage
              </p>

              <div className="qf-trust-badges" aria-label="QuickFurno trust badges">
                {trustBadges.map((badge) => (
                  <span key={`${badge.title}-${badge.label}`}>
                    <QFIcon name={badge.icon} />
                    <b>{badge.title}</b>
                    <small>{badge.label}</small>
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="qf-home-section" id="categories">
            <div className="qf-section-head">
              <h2>Explore Home Services</h2>
              <p>Choose a service and compare verified vendors near you.</p>
            </div>
            <HomeCategoryGrid />
          </section>

          <TrustStrip />
          <HomeHowItWorksSection />
          <WhyChooseSection />
          <PopularServicesSection />
          <CoverageSection />
          <HomeTestimonials />
          <ClientCTASection />
          <VendorCTASection />
        </div>
      </main>
      <Footer />
      <StickyMobileCTA />
    </>
  );
}
