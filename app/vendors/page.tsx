import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { MadeInPune } from "@/components/home/MadeInPune";
import { Icon } from "@/components/qf-icon";
import { categories, categorySlug } from "@/lib/quickfurno-data";
import "./vendors-pro.css";
import "./vendors-v2.css";
import {
  ApplyV2,
  AreasV2,
  CategoriesV2,
  DashboardV2,
  FaqV2,
  HeroV2,
  MatchingV2,
  PromiseV2,
  SupportV2,
  WhatYouGetV2,
  WhyV2,
} from "./vendors-v2";
import { FAQ_ITEMS } from "./vendors-content";

// The portal tabs this page sends professionals to. Both CTAs exist: the old
// page had signup only, and a returning vendor had nowhere to go.
const SIGNUP_HREF = "/vendor?mode=signup";
const LOGIN_HREF = "/vendor?mode=login";

// Trades come from the canonical registry, never a local copy, so a category
// added there is offered here too.
const TRADES = categories.map((category) => category.name);
const TRADE_SLUGS = TRADES.map((trade) => categorySlug(trade));

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
// "Made in Pune" is shared directly with the homepage, which is the design
// authority for that public journey band on every viewport.
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

  // The trades a professional can apply under, from the canonical registry.
  const tradesJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "QuickFurno categories in Pune",
    itemListElement: TRADES.map((trade, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: trade,
      url: `https://quickfurno.in/category/${TRADE_SLUGS[i]}`,
    })),
  };

  return (
    <div className="qv-vendors-page">
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

        <MadeInPune />

        <FaqV2 />
        <ApplyV2 />

        {/* Phones only. The page is long and the apply CTA would otherwise sit
            far below the fold for the whole scroll. */}
        <div className="qfv-sticky">
          <Link className="qfv-btn qfv-btn--primary" href={SIGNUP_HREF}>
            Apply free <Icon name="arrow" sw={2.1} />
          </Link>
          <Link className="qfv-btn qfv-btn--ghost" href={LOGIN_HREF}>
            Log in
          </Link>
        </div>
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tradesJsonLd) }} />
    </div>
  );
}
