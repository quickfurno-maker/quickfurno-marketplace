import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { HomeHeroSlider } from "@/components/home/HomeHeroSlider";
import { HomeServiceLauncher } from "@/components/home/HomeServiceLauncher";
import {
  CoverageV2,
  FinalCTAV2,
  HowItWorksV2,
  TrustStripV2,
  WhyQuickFurnoV2,
} from "@/components/home/HomeSectionsV2";

// Metadata intent preserved from the pre-V2 homepage: same title shape, same
// description subject, same OG title/description/url/siteName/type.
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
        {/*
          The entry module, STACKED AT EVERY WIDTH:
            hero slider -> service launcher -> trust strip,
          each spanning the full public-container width.

          QF-UI-HOTFIX-01 removed the old desktop "hero ~65% / launcher ~35%
          side by side from 1024px" split. The launcher is no longer a narrow
          column pinned beside the hero; it is a full-width category surface
          below it, so the hero gets the whole width and the categories get a
          balanced multi-column grid instead of a stretched sidebar.

          The DOM order below already IS the visual order — the layout is
          governed purely by CSS in app/qf-public-v2.css, and
          scripts/ui/validate-mobile-form-focus.mjs fails CI if the
          side-by-side split or a different ordering returns.

          `id="categories"` stays on this block so the existing /#categories
          links from the header, footer and mobile nav still land on the
          service surface.
        */}
        <section className="qf-hero-v2" id="categories" aria-label="Find a home service">
          <div className="qf-pub-container">
            <div className="qf-hero-v2-grid">
              <HomeHeroSlider />
              <HomeServiceLauncher />
              <div className="qf-hero-v2-trust">
                <TrustStripV2 />
              </div>
            </div>
          </div>
        </section>

        <HowItWorksV2 />
        <WhyQuickFurnoV2 />
        <CoverageV2 />
        <FinalCTAV2 />
      </main>

      <Footer />
      <StickyMobileCTA />
    </>
  );
}
