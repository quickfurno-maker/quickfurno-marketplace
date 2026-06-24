import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CONTACT } from "@/lib/config";

export const metadata: Metadata = {
  title: "Privacy Policy | QuickFurno",
  description:
    "How QuickFurno collects, uses and shares your enquiry details with verified home-service vendors.",
};

export default function PrivacyPage() {
  return (
    <>
      <Header />
      <main className="qf-legal-page">
        <section className="mx-auto max-w-3xl px-5 pt-12 pb-16">
          <p className="eyebrow">Legal</p>
          <h1 className="mt-4 text-3xl font-semibold text-ivory md:text-4xl">Privacy Policy</h1>
          <p className="mt-3 font-sans text-sm text-muted">Last updated: 24 June 2026</p>

          <div className="qf-legal-body mt-8 space-y-6 font-sans text-sm leading-7 text-muted">
            <div>
              <h2 className="text-lg font-semibold text-ivory">1. What we collect</h2>
              <p>
                When you submit a requirement, we collect the details you provide — your name,
                phone number, city, area, the service you need, budget, timeline and any notes.
                If you allow it, we also capture your approximate location and how you reached us
                (source page and campaign tags) to match you with relevant vendors.
              </p>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ivory">2. How we use your details</h2>
              <p>
                We use your enquiry to connect you with verified home-service vendors near you.
                One enquiry is shared with up to 3 verified vendors so they can contact you with
                quotes. We never sell your details or share them with an open marketplace.
              </p>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ivory">3. Lead sharing consent</h2>
              <p>
                By submitting an enquiry and accepting our consent checkbox, you agree that your
                contact details may be shared with up to 3 verified vendors matched to your
                requirement, so they can reach out to you by phone, WhatsApp or call.
              </p>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ivory">4. Vendor information</h2>
              <p>
                Vendors who register provide business details and service areas for verification.
                Exact GPS location, where shared, is used only for matching nearby leads and is not
                displayed publicly.
              </p>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ivory">5. Data retention &amp; your rights</h2>
              <p>
                You can ask us to update or delete your details at any time. To do so, contact us at{" "}
                <a className="text-gold" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>.
              </p>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ivory">6. Contact</h2>
              <p>
                QuickFurno · {CONTACT.address} · {CONTACT.phone} ·{" "}
                <a className="text-gold" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
