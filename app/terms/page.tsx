import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { CONTACT } from "@/lib/config";

export const metadata: Metadata = {
  title: "Terms of Service | QuickFurno",
  description:
    "The terms that apply when you use QuickFurno to get matched with verified home-service vendors.",
};

/*
  QF-UI-V2-09 — V2 visual system plus one matching-wording correction. The
  commercial model is preserved exactly: QuickFurno is a marketplace, it does not
  carry out vendor work, the project agreement stays between client and vendor,
  client enquiries are free, vendor verification exists and misuse controls
  remain. No new financial, refund or payment obligation is created.

  Section 2 previously said an enquiry "is shared with up to 3 verified vendors",
  which reads as a hard ceiling. The consent the client accepts allows QuickFurno
  to manually connect additional verified vendors where the first vendors are
  unavailable, non-responsive or unable to serve the requirement, so the wording
  now says "initially" and states that limited case.
*/
export default function TermsPage() {
  return (
    <>
      <Header />
      <main className="qf-legal-page">
        <div className="qf-legal-shell">
          <span className="qf-legal-eyebrow">Legal</span>
          <h1 className="qf-legal-title">Terms of Service</h1>
          <p className="qf-legal-updated">Last updated: 4 September 2026</p>

          <div className="qf-legal-body">
            <div className="qf-legal-note">
              <h2>What you are agreeing to</h2>
              <ul>
                <li>QuickFurno matches homeowners with verified vendors; it does not do the work.</li>
                <li>Client enquiries are free.</li>
                <li>Matching uses the service you need and your city and area.</li>
                <li>Any agreement, pricing and work scope is between you and the vendor.</li>
              </ul>
            </div>

            <section className="qf-legal-section">
              <h2>1. What QuickFurno does</h2>
              <p>
                QuickFurno is a marketplace that connects homeowners with verified home-service
                vendors in Pune and Mumbai. We help you share your requirement and get matched —
                we do not carry out the work ourselves.
              </p>
            </section>

            <section className="qf-legal-section">
              <h2>2. Enquiries &amp; matching</h2>
              <p>
                Client enquiries are free. One enquiry is shared with up to 3 verified vendors
                initially, matched on the service you need and your city and area. If those vendors
                are unavailable, non-responsive or unable to serve your requirement, QuickFurno may
                manually connect you with additional verified vendors. Vendors contact you directly
                with quotes; any agreement, pricing and work scope is between you and the vendor.
              </p>
            </section>

            <section className="qf-legal-section">
              <h2>3. Vendor responsibilities</h2>
              <p>
                Vendors are responsible for the accuracy of their business details, the quality of
                their work and their conduct with clients. QuickFurno verifies vendors before they
                go live but is not a party to the contract between a client and a vendor.
              </p>
            </section>

            <section className="qf-legal-section">
              <h2>4. Acceptable use</h2>
              <p>
                Please provide accurate details and use the platform only for genuine home-service
                requirements. We may remove enquiries or vendors that misuse the platform.
              </p>
            </section>

            <section className="qf-legal-section">
              <h2>5. Liability</h2>
              <p>
                QuickFurno is provided on an &quot;as is&quot; basis. To the extent permitted by law,
                we are not liable for the actions of vendors or clients or for the outcome of any
                work arranged through the platform.
              </p>
            </section>

            <section className="qf-legal-section">
              <h2>6. Contact</h2>
              <p>
                Questions about these terms? Contact us at{" "}
                <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
      <StickyMobileCTA />
    </>
  );
}
