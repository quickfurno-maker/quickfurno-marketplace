import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { LeadFunnel } from "@/components/LeadFunnel";

export const metadata = { title: "Get free quotes — QuickFurno" };

export default function EnquiryPage({ searchParams }: { searchParams: { service?: string } }) {
  return (
    <>
      <Header />
      <section className="mx-auto max-w-6xl px-5 pt-12 pb-10">
        <p className="eyebrow">Free for homeowners</p>
        <h1 className="mt-4 text-3xl font-semibold text-ivory md:text-4xl">Tell us about your project</h1>
        <p className="mt-3 max-w-xl font-sans text-muted">
          Two minutes. You&apos;ll see Verified Teams that match your area, then we connect you with up to 3.
        </p>
      </section>
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <LeadFunnel defaultService={searchParams.service} />
      </section>
      <Footer />
    </>
  );
}
