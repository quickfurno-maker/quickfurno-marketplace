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
          The locked entry module: hero slider ~65% and the service launcher
          ~35% side by side from 1024px, stacked hero -> launcher -> trust on
          smaller screens. `id="categories"` stays on this block so the existing
          /#categories links from the header, footer and mobile nav still land
          on the service surface.
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
