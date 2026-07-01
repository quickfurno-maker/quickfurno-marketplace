import type { Metadata } from "next";
import Link from "next/link";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { QFIcon } from "@/components/QuickFurnoIcons";

const categories = [
  { label: "Interior Designers", icon: "home" as const },
  { label: "Carpenters", icon: "hammer" as const },
  { label: "Modular Factory", icon: "grid" as const },
  { label: "Premium Interiors", icon: "star" as const },
  { label: "Sofa", icon: "sofa" as const },
  { label: "Painter", icon: "paint" as const },
  { label: "Civil Work", icon: "civil" as const },
];

const steps = [
  {
    title: "Apply as a vendor",
    copy: "Share your business details, service category, city, and contact information through the vendor registration form.",
  },
  {
    title: "QuickFurno verifies",
    copy: "Our team reviews your profile quality, service fit, and contact details before enabling marketplace access.",
  },
  {
    title: "Receive relevant leads",
    copy: "Once active, you can view client requirements assigned to your business from the vendor dashboard.",
  },
  {
    title: "Follow up and close",
    copy: "Use the dashboard to track lead status, mark progress, and report quality issues when needed.",
  },
];

const joinTypes = [
  "Independent home-service professionals",
  "Interior and premium fit-out studios",
  "Workshop-led teams and local service businesses",
  "Civil-work, sofa, painting, and finishing contractors",
];

const promises = [
  {
    title: "Requirement-first leads",
    copy: "Clients submit project needs before vendors are connected, so each lead starts with real context.",
  },
  {
    title: "Local service matching",
    copy: "QuickFurno focuses on connecting clients with suitable vendors near their city and service area.",
  },
  {
    title: "Quality controls",
    copy: "Dashboard reporting keeps poor-fit or invalid leads visible to the QuickFurno team.",
  },
];

const faqs = [
  {
    question: "Is vendor registration open?",
    answer: "Yes. You can submit your application through the vendor registration page. QuickFurno will review the details before enabling dashboard access.",
  },
  {
    question: "Which categories are currently supported?",
    answer: "QuickFurno currently supports Interior Designers, Carpenters, Modular Factory, Premium Interiors, Sofa, Painter, and Civil Work vendors.",
  },
  {
    question: "Where do approved vendors see leads?",
    answer: "Approved vendors can sign in and use the Vendor Dashboard to view lead stats, assigned leads, profile details, and support actions.",
  },
  {
    question: "Are package purchases live?",
    answer: "Package and recharge options are coming soon. For now, QuickFurno is keeping this flow controlled while the vendor marketplace is being stabilized.",
  },
];

export const metadata: Metadata = {
  title: "Vendor Partner Program | QuickFurno",
  description:
    "Join QuickFurno as a verified home-service vendor and connect with clients looking for interiors, carpentry, sofa, painting, and civil-work services.",
};

export default function VendorLandingPage() {
  return (
    <>
      <Header />
      <main className="qf-home-page qf-vendor-public-page">
        <div className="qf-home-app-shell">
          <section className="qf-hero-section qf-hero-section--split">
            <div className="qf-hero-copy">
              <h1>Get verified client leads for your home-service business</h1>
              <p>
                Join QuickFurno and connect with clients looking for interiors, carpentry,
                sofa, painting, and civil-work vendors near them.
              </p>
              <div className="qf-hero-actions">
                <Link href="/vendors/register" className="qf-hero-cta-primary">
                  Register as Vendor <QFIcon name="arrow" />
                </Link>
                <Link href="/vendor/dashboard" className="qf-hero-cta-secondary">
                  Vendor Dashboard
                </Link>
              </div>
            </div>

            <div className="dashboard-preview reveal-card" aria-label="Vendor dashboard preview">
              <div className="dashboard-topbar">
                <span />
                <strong>Vendor Dashboard</strong>
                <em>Lead ready</em>
              </div>
              <div className="dashboard-stat-grid">
                {[
                  ["New leads", "08"],
                  ["In progress", "14"],
                  ["Won", "06"],
                  ["Credits", "24"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <div className="dashboard-leads">
                {["Premium interior requirement", "Sofa repair enquiry", "Civil work site visit"].map((lead) => (
                  <div key={lead}>
                    <span>{lead}</span>
                    <small>Verified request</small>
                    <button type="button">View</button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="qf-home-section">
            <div className="qf-section-head">
              <h2>How QuickFurno works for vendors</h2>
              <p>A simple path from application to dashboard-based lead management.</p>
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
            <div className="qf-section-head qf-section-head--row">
              <div>
                <h2>Who can join</h2>
                <p>QuickFurno is built for serious local teams that can respond professionally to real client requirements.</p>
              </div>
              <Link href="/vendors/register" className="qf-section-link">
                Apply now <QFIcon name="arrow" />
              </Link>
            </div>
            <div className="qf-usp-grid">
              {joinTypes.map((item) => (
                <article className="qf-usp-card" key={item}>
                  <span><QFIcon name="briefcase" /></span>
                  <h3>{item}</h3>
                  <p>Suitable for vendors with active service capacity and reliable client follow-up.</p>
                </article>
              ))}
            </div>
          </section>

          <section className="qf-home-section">
            <div className="qf-section-head">
              <h2>Categories supported</h2>
              <p>Approved public categories for the current QuickFurno vendor program.</p>
            </div>
            <div className="qf-popular-grid">
              {categories.map((category) => (
                <article className="qf-popular-card" key={category.label}>
                  <span className="qf-popular-icon"><QFIcon name={category.icon} /></span>
                  <strong>{category.label}</strong>
                  <p>Eligible for vendor applications and future lead routing.</p>
                </article>
              ))}
            </div>
          </section>

          <section className="qf-home-section">
            <div className="qf-section-head">
              <h2>Lead quality promise</h2>
              <p>QuickFurno keeps the vendor experience focused on useful, trackable client opportunities.</p>
            </div>
            <div className="benefit-grid">
              {promises.map((promise) => (
                <article className="benefit-card" key={promise.title}>
                  <div className="category-icon"><QFIcon name="shield" /></div>
                  <h3>{promise.title}</h3>
                  <p>{promise.copy}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="qf-home-section">
            <div className="final-cta-card">
              <h2>Package/recharge coming soon</h2>
              <p>
                Vendor packages and recharge controls are being prepared carefully. For now,
                register your business and use the dashboard once your vendor profile is enabled.
              </p>
              <div className="qf-hero-actions">
                <Link href="/vendors/register" className="qf-hero-cta-primary">
                  Register as Vendor <QFIcon name="arrow" />
                </Link>
                <Link href="/vendor/dashboard" className="qf-hero-cta-secondary">
                  Open Dashboard
                </Link>
              </div>
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
      <Footer />
    </>
  );
}
