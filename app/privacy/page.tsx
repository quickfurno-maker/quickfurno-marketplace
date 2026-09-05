import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { CONTACT } from "@/lib/config";

export const metadata: Metadata = {
  title: "Privacy Policy | QuickFurno",
  description:
    "How QuickFurno collects, uses and shares your enquiry details with verified home-service vendors.",
};

/*
  QF-UI-V2-09 — V2 visual system plus factual corrections. This is NOT a rewritten
  legal policy and adds no new promises; it removes wording that contradicted the
  governed enquiry consent or claimed capabilities the product does not have:

    "verified home-service vendors near you"  -> matching is by service +
        city/area eligibility, not measured proximity.
    "One enquiry is shared with up to 3 ..."  -> the consent the client actually
        accepts says up to 3 verified vendors INITIALLY, and allows QuickFurno to
        manually connect additional verified vendors where vendors are
        unavailable, non-responsive or unable to serve the requirement. The old
        wording implied a hard ceiling the consent does not set.
    "used only for matching nearby leads"     -> same unsupported proximity claim.

  Sharing authority is neither broadened nor weakened: the text now mirrors the
  consent checkbox in ClientEnquiryModal / LeadFunnel exactly.
*/
export default function PrivacyPage() {
  return (
    <>
      <Header />
      <main className="qf-legal-page">
        <div className="qf-legal-shell">
          <span className="qf-legal-eyebrow">Legal</span>
          <h1 className="qf-legal-title">Privacy Policy</h1>
          <p className="qf-legal-updated">Last updated: 4 September 2026</p>

          <div className="qf-legal-body">
            <div className="qf-legal-note">
              <h2>How matching works</h2>
              <ul>
                <li>Vendors are matched using the service you need and your city and area.</li>
                <li>Your enquiry is shared with up to 3 verified vendors initially.</li>
                <li>
                  If those vendors are unavailable, non-responsive or unable to serve your
                  requirement, QuickFurno may manually connect you with additional verified vendors.
                </li>
                <li>We never sell your details or list them on an open marketplace.</li>
              </ul>
            </div>

            <section className="qf-legal-section">
              <h2>1. What we collect</h2>
              <p>
                When you submit a requirement, we collect the details you provide — your name,
                phone number, city, area, the service you need, budget, timeline and any notes.
                If you allow it, we also capture your approximate location and how you reached us
                (source page and campaign tags) to match you with relevant vendors.
              </p>
            </section>

            <section className="qf-legal-section">
              <h2>2. How we use your details</h2>
              <p>
                We use your enquiry to connect you with verified home-service vendors that match
                the service you need and your city and area. One enquiry is shared with up to 3
                verified vendors initially so they can contact you with quotes. If those vendors
                are unavailable, non-responsive or unable to serve your requirement, we may
                manually connect you with additional verified vendors. We never sell your details
                or share them with an open marketplace.
              </p>
            </section>

            <section className="qf-legal-section">
              <h2>3. Lead sharing consent</h2>
              <p>
                By submitting an enquiry and accepting our consent checkbox, you agree that your
                contact details may be shared with up to 3 verified vendors matched to your
                requirement, so they can reach out to you by phone, WhatsApp or call. You also
                agree that, where those vendors are unavailable, non-responsive or unable to serve
                your requirement, QuickFurno may manually connect you with additional verified
                vendors to fulfil your request.
              </p>
            </section>

            <section className="qf-legal-section">
              <h2>4. Vendor information</h2>
              <p>
                Vendors who register provide business details and service areas for verification.
                Location data, where shared, is used only to match vendors to the service areas
                they cover and is not displayed publicly.
              </p>
            </section>

            <section className="qf-legal-section">
              <h2>5. Data retention &amp; your rights</h2>
              <p>
                You can ask us to update or delete your details at any time. To do so, contact us at{" "}
                <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>.
              </p>
            </section>

            <section className="qf-legal-section">
              <h2>6. Contact</h2>
              <p>
                QuickFurno · {CONTACT.address} · {CONTACT.phone} ·{" "}
                <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
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
