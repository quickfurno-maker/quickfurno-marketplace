import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { LeadFunnel } from "@/components/LeadFunnel";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";

export const metadata: Metadata = {
  title: "Get free quotes — QuickFurno",
  description:
    "Tell QuickFurno about your project and get matched with up to 3 relevant eligible vendors in Pune. Free for homeowners.",
  // ?service= prefills the form but does not change the page, so every
  // category's enquiry link would otherwise look like a separate page.
  alternates: { canonical: "/enquiry" },
};

export default async function EnquiryPage({ searchParams }: { searchParams: Promise<{ service?: string }> }) {
  const { service } = await searchParams;
  return (
    <>
      <Header />

      {/*
        QF-UI-V2-09: the page shell moved onto the V2 public system. The old copy
        promised "Two minutes" (an unbacked estimate) and older verification wording —
        the lede now uses the governed eligible-vendor terminology. The
        ?service= prefill still flows straight through to LeadFunnel.
      */}
      <main className="qf-enqpage">
        <div className="qf-enqpage-shell">
          <div className="qf-enqpage-head">
            <span className="qf-enqpage-eyebrow">Free for homeowners</span>
            <h1 className="qf-enqpage-title">Tell us about your project</h1>
            <p className="qf-enqpage-lede">
              Share your requirement once. QuickFurno matches you with up to 3 relevant eligible
              vendors for your service and area.
            </p>
          </div>

          <LeadFunnel defaultService={service} />
        </div>
      </main>

      <Footer />
      <StickyMobileCTA />
    </>
  );
}
