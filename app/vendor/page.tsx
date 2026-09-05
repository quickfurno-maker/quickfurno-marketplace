import type { Metadata } from "next";
import { FAQ } from "@/components/FAQ";
import { VendorPortal } from "@/components/vendor/VendorPortal";
import { VendorPortalFooter } from "@/components/vendor/VendorPortalFooter";
import { VendorPortalHeader } from "@/components/vendor/VendorPortalHeader";

const steps = [
  {
    title: "Create your account / apply",
    copy: "Sign up with your business email and details. This creates your vendor login and submits your profile for review.",
  },
  {
    title: "QuickFurno verifies",
    copy: "Our team reviews your profile quality, service fit, and contact details before enabling marketplace access.",
  },
  {
    title: "Account becomes eligible",
    copy: "Lead access depends on your account being approved and active, with a package and credits in place.",
  },
  {
    title: "Manage matched enquiries",
    copy: "Once eligible, relevant client requirements assigned to your business appear in the vendor dashboard for follow-up.",
  },
];

const faqs = [
  {
    question: "How do I sign up as a vendor?",
    answer: "Use the New Vendor Signup tab above to create your vendor account and submit your business details in one step. QuickFurno will review your profile before enabling dashboard lead access.",
  },
  {
    question: "How do I log in later?",
    answer: "Return to this page and use the Vendor Login tab with the email and password you signed up with. After login you'll land on your Vendor Dashboard.",
  },
  {
    question: "Which categories are currently supported?",
    answer: "QuickFurno currently supports Interior Designers, Carpenters, Modular Factory, Premium Interiors, Sofa, Painter, and Civil Work vendors.",
  },
  {
    question: "When can matched enquiries appear?",
    answer: "Matched enquiries can appear once your account is approved and active, with a package and credits in place. Relevant client requirements are then assigned according to QuickFurno's matching rules.",
  },
];

/*
  QF-UI-V2-11R — copy truth correction. The description previously promised
  "verified home-service client leads": QuickFurno verifies VENDORS, not client
  enquiries, and "start receiving" read as an outcome guaranteed by signing up.
  The process steps and the matching FAQ now use the same eligibility wording
  locked in QF-UI-V2-10 — approved and active, with a package and credits in
  place. Nothing about auth, the wizard or submission changed.
*/
export const metadata: Metadata = {
  title: "Vendor Portal | QuickFurno",
  description:
    "Log in to your QuickFurno vendor dashboard or create a vendor account to submit your business profile for review and manage matched home-service enquiries when eligible.",
};

export default function VendorPortalPage({
  searchParams,
}: {
  searchParams?: { mode?: string };
}) {
  const initialMode = searchParams?.mode === "signup" ? "signup" : "login";

  return (
    <>
      {/*
        QF-UI-V2-12: the shared public Header/Footer used to wrap this page, so a
        vendor creating an account saw homeowner navigation, a
        "Get Free Team Matches" client-enquiry CTA and a hamburger opening the
        homeowner menu. Dedicated vendor chrome replaces them here; the shared
        public components are untouched and still serve every homeowner page.
      */}
      <VendorPortalHeader />
      <main className="qf-home-page qf-vendor-public-page">
        <div className="qf-home-app-shell">
          <VendorPortal initialMode={initialMode} />

          <section className="qf-home-section">
            <div className="qf-section-head">
              <h2>How QuickFurno works for vendors</h2>
              <p>A simple path from signup to dashboard-based lead management.</p>
            </div>
            <div className="qf-steps-flow">
              {steps.map((step, index) => (
                <article className="qf-step-node" key={step.title}>
                  <span>{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.copy}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="qf-home-section">
            <div className="qf-section-head">
              <h2>FAQ</h2>
              <p>Common questions for vendor partners joining QuickFurno.</p>
            </div>
            <FAQ items={faqs} />
          </section>
        </div>
      </main>
      <VendorPortalFooter />
    </>
  );
}
