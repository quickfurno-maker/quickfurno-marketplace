import type { Metadata } from "next";
import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { HomeCategoryGrid } from "@/components/home/HomeCategoryGrid";
import { HomeSearchBar } from "@/components/home/HomeSearchBar";
import {
  ClientCTASection,
  HomeHowItWorksSection,
  HomeIllustration,
  PopularServicesSection,
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
          <section className="qf-hero-section">
            <div className="qf-hero-copy">
              <h1>Find verified home-service vendors near you</h1>
              <p>
                Tell us your requirement and get connected with trusted carpenters,
                interior designers, painters, sofa makers and renovation experts.
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

              <div className="qf-hero-actions">
                <EnquiryModalTrigger className="qf-gold-btn">Get Free Quotes</EnquiryModalTrigger>
                <Link href="#services" className="qf-teal-btn">
                  Explore Categories
                </Link>
              </div>
            </div>
            <HomeIllustration />
          </section>

          <HomeSearchBar />

          <section className="qf-home-section" id="services">
            <div className="qf-section-head">
              <h2>Explore Home Services</h2>
              <p>Choose a service and compare verified vendors near you.</p>
            </div>
            <HomeCategoryGrid />
          </section>

          <WhyChooseSection />
          <HomeHowItWorksSection />
          <ClientCTASection />
          <PopularServicesSection />
          <VendorCTASection />
        </div>
      </main>
      <Footer />
      <StickyMobileCTA />
    </>
  );
}
