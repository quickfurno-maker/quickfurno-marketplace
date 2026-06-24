import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CONTACT } from "@/lib/config";

export const metadata: Metadata = {
  title: "Terms of Service | QuickFurno",
  description:
    "The terms that apply when you use QuickFurno to get matched with verified home-service vendors.",
};

export default function TermsPage() {
  return (
    <>
      <Header />
      <main className="qf-legal-page">
        <section className="mx-auto max-w-3xl px-5 pt-12 pb-16">
          <p className="eyebrow">Legal</p>
          <h1 className="mt-4 text-3xl font-semibold text-ivory md:text-4xl">Terms of Service</h1>
          <p className="mt-3 font-sans text-sm text-muted">Last updated: 24 June 2026</p>

          <div className="qf-legal-body mt-8 space-y-6 font-sans text-sm leading-7 text-muted">
            <div>
              <h2 className="text-lg font-semibold text-ivory">1. What QuickFurno does</h2>
              <p>
                QuickFurno is a marketplace that connects homeowners with verified home-service
                vendors in Pune and Mumbai. We help you share your requirement and get matched —
                we do not carry out the work ourselves.
              </p>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ivory">2. Enquiries &amp; matching</h2>
              <p>
                Client enquiries are free. One enquiry is shared with up to 3 verified vendors who
                match your service and area. Vendors contact you directly with quotes; any
                agreement, pricing and work scope is between you and the vendor.
              </p>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ivory">3. Vendor responsibilities</h2>
              <p>
                Vendors are responsible for the accuracy of their business details, the quality of
                their work and their conduct with clients. QuickFurno verifies vendors before they
                go live but is not a party to the contract between a client and a vendor.
              </p>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ivory">4. Acceptable use</h2>
              <p>
                Please provide accurate details and use the platform only for genuine home-service
                requirements. We may remove enquiries or vendors that misuse the platform.
              </p>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ivory">5. Liability</h2>
              <p>
                QuickFurno is provided on an &quot;as is&quot; basis. To the extent permitted by law,
                we are not liable for the actions of vendors or clients or for the outcome of any
                work arranged through the platform.
              </p>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ivory">6. Contact</h2>
              <p>
                Questions about these terms? Contact us at{" "}
                <a className="text-gold" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>.
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
