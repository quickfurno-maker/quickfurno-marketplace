import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { VendorRegisterForm } from "@/components/VendorRegisterForm";

export const metadata = { title: "Become a partner — QuickFurno" };

export default function VendorRegisterPage() {
  return (
    <>
      <Header />
      <section className="mx-auto max-w-6xl px-5 pt-12 pb-8">
        <p className="eyebrow">Partner studios</p>
        <h1 className="mt-4 text-3xl font-semibold text-ivory md:text-4xl">Get matched to ready homeowners</h1>
        <p className="mt-3 max-w-xl font-sans text-muted">
          Apply once. After approval, buy a prepaid lead pack and start receiving exclusive,
          area-matched enquiries — capped at four studios per lead.
        </p>
      </section>
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <VendorRegisterForm />
      </section>
      <Footer />
    </>
  );
}
