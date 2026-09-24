import type { Metadata } from "next";
import Image from "next/image";
import { Header } from "@/components/Header";
import "./vendors-pro.css";
import "./vendors-v2.css";
import {
  ApplyV2,
  AreasV2,
  CategoriesV2,
  DashboardV2,
  FaqV2,
  FooterV2,
  HeroV2,
  MatchingV2,
  PromiseV2,
  SupportV2,
  WhatYouGetV2,
  WhyV2,
} from "./vendors-v2";
import { FAQ_ITEMS } from "./vendors-content";

// ============================================================================
// QuickFurno — For professionals (/vendors)
//
// Ported from the approved Desktop 1280 / Mobile 390 canvas boards. Every
// section is one responsive implementation: mobile-first values from the 390
// board, the 1280 board's values in the `min-width: 900px` block of
// vendors-v2.css. Copy lives in vendors-content.ts, verbatim from the boards.
//
// HONESTY: every number and rule below is one the product actually enforces —
// at most 3 active pros per enquiry, category fit first then geography and the
// approved ranking order, homeowner consent before contact sharing, reviews
// only from matched homeowners. No invented counts, ratings or testimonials.
//
// "Made in Pune" is the only band still carrying the pre-redesign markup; it
// has not been through a board yet.
// ============================================================================

export const metadata: Metadata = {
  title: "Up to 3 pros per enquiry | Join QuickFurno in Pune",
  description:
    "Apply free to QuickFurno in Pune. Approved vendors can receive Client Matching assignments while their account remains eligible, including sufficient matching credits.",
  alternates: { canonical: "https://quickfurno.in/vendors" },
  openGraph: {
    title: "Up to 3 pros per enquiry | Join QuickFurno in Pune",
    description:
      "Free to apply. Eligible assignments are capped at 3 active pros at a time and follow QuickFurno's category, geography and fairness rules.",
    url: "https://quickfurno.in/vendors",
    siteName: "QuickFurno",
    type: "website",
  },
};

const CITIES = [
  { name: "Pune", image: "/assets/quickfurno/images/launch/cities/pune.jpg", live: true },
  { name: "Delhi NCR", image: "/assets/quickfurno/images/launch/cities/delhi-ncr.jpg" },
  { name: "Mumbai", image: "/assets/quickfurno/images/launch/cities/mumbai.jpg" },
  { name: "Hyderabad", image: "/assets/quickfurno/images/launch/cities/hyderabad.jpg" },
  { name: "Kolkata", image: "/assets/quickfurno/images/launch/cities/kolkata.jpg" },
  { name: "Bengaluru", image: "/assets/quickfurno/images/launch/cities/bengaluru.jpg" },
];

export default function VendorsPage() {
  // the structured data is generated from the same array the page renders, so
  // the two can never drift apart
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map(([, q, a]) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };

  return (
    <>
      <Header />
      <main className="qfv-page qv">
        <HeroV2 />
        <CategoriesV2 />
        <MatchingV2 />
        <DashboardV2 />
        <WhyV2 />
        <WhatYouGetV2 />
        <SupportV2 />
        <PromiseV2 />
        <AreasV2 />

        {/* ==================== MADE IN PUNE (not yet redesigned) ==================== */}
        <section className="qfv-cities qfv-section">
          <div className="qfv-shell">
            <div className="qfv-cities-head">
              <span className="qfv-kicker" style={{ color: "#FF8A5C" }}>
                Our journey
              </span>
              <h2 className="qfv-h2">Made in Pune. Coming to your city next.</h2>
              <p>
                We are building QuickFurno where we live — then bringing verified home professionals to more of India.
              </p>
            </div>
            <div className="qfv-city-grid">
              {CITIES.map((city) => (
                <div className="qfv-city" key={city.name}>
                  <span className="qfv-city-photo">
                    <Image src={city.image} alt={city.name} width={104} height={104} sizes="104px" />
                  </span>
                  <b>{city.name}</b>
                  {city.live ? (
                    <span className="qfv-city-live">
                      <i className="qfv-dot" style={{ width: 7, height: 7 }} />
                      Live now
                    </span>
                  ) : (
                    <span className="qfv-city-soon">Coming soon</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <Image
            className="qfv-cities-art"
            src="/assets/quickfurno/images/launch/india-skyline.png"
            alt=""
            width={1100}
            height={208}
            sizes="(max-width: 1100px) 100vw, 1100px"
          />
        </section>

        <FaqV2 />
        <ApplyV2 />
      </main>
      <FooterV2 />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
    </>
  );
}
