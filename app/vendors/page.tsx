import type { Metadata } from "next";
import Link from "next/link";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { VendorApplicationForm } from "@/components/VendorApplicationForm";
import { VendorDashboardPreview } from "@/components/VendorDashboardPreview";
import { vendorFaqs } from "@/lib/quickfurno-data";

export const metadata: Metadata = {
  title: "For Vendors | QuickFurno",
  description:
    "Register with QuickFurno to receive verified client leads for interiors, carpentry, modular factory work, painting, sofa and civil work.",
  openGraph: {
    title: "Grow with QuickFurno verified leads",
    description: "Join QuickFurno and receive genuine home-service enquiries in Pune and Mumbai.",
    url: "https://quickfurno.in/vendors",
    siteName: "QuickFurno",
    type: "website",
  },
};

const benefits = [
  "Get verified client leads",
  "Pay per lead package",
  "Showcase your projects",
  "Get visibility in your city",
  "Receive WhatsApp lead alerts",
  "Manage leads in vendor app",
  "Build ratings and trust",
];

const packages = [
  {
    name: "Starter Plan",
    badge: "MVP package",
    leads: "5 leads",
    price: "₹250 per lead",
    total: "Total ₹1,250",
    features: ["WhatsApp lead alerts", "Vendor listing visibility", "Basic profile page"],
    highlighted: true,
  },
  {
    name: "Growth Plan",
    badge: "For steady teams",
    leads: "20 leads",
    price: "Better ranking",
    total: "Priority visibility",
    features: ["Project gallery", "Profile improvements", "Higher marketplace placement"],
    highlighted: false,
  },
  {
    name: "Premium Plan",
    badge: "Scale package",
    leads: "50 leads",
    price: "Top placement",
    total: "Featured profile",
    features: ["Analytics support", "Featured marketplace badge", "Premium profile visibility"],
    highlighted: false,
  },
];

const vendorSteps = [
  "Register your business",
  "Admin verifies profile",
  "Buy lead package",
  "Receive client leads",
  "Contact client quickly",
  "Update status in vendor app",
];

export default function VendorsPage() {
  return (
    <>
      <Header />
      <main>
        <section className="vendor-hero section-pad-top">
          <div className="container vendor-hero-grid">
            <div>
              <span className="eyebrow">For verified professionals</span>
              <h1>Grow your home-service business with verified client leads.</h1>
              <p>
                Join QuickFurno and receive genuine client enquiries for interiors, carpentry,
                modular factory work, painting, sofa and civil work.
              </p>
              <div className="hero-cta-row">
                <Link href="#vendor-form" className="btn btn-primary">
                  Register as Vendor
                </Link>
                <Link href="#lead-packages" className="btn btn-secondary">
                  View Lead Packages
                </Link>
                <a className="btn btn-outline" href="https://wa.me/91XXXXXXXXXX">
                  WhatsApp Team
                </a>
              </div>
            </div>
            <VendorDashboardPreview />
          </div>
        </section>

        <section className="section-block">
          <div className="container section-heading">
            <span className="eyebrow">Vendor benefits</span>
            <h2>Built for professionals who want filtered enquiries, not random calls.</h2>
          </div>
          <div className="container benefit-grid">
            {benefits.map((benefit) => (
              <article className="benefit-card reveal-card" key={benefit}>
                <span aria-hidden="true">✓</span>
                <h3>{benefit}</h3>
              </article>
            ))}
          </div>
        </section>

        <section id="lead-packages" className="section-block section-warm">
          <div className="container section-heading">
            <span className="eyebrow">Lead packages</span>
            <h2>Start small, measure quality, then scale visibility.</h2>
          </div>
          <div className="container packages-grid">
            {packages.map((item) => (
              <article className={`package-card ${item.highlighted ? "package-card--highlighted" : ""}`} key={item.name}>
                <span>{item.badge}</span>
                <h3>{item.name}</h3>
                <strong>{item.leads}</strong>
                <p>{item.price}</p>
                <p>{item.total}</p>
                <ul>
                  {item.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <Link href="#vendor-form" className="btn btn-primary">
                  Register as Vendor
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section id="vendor-form" className="section-block">
          <div className="container">
            <VendorApplicationForm />
          </div>
        </section>

        <section className="section-block section-warm">
          <div className="container section-heading">
            <span className="eyebrow">Vendor system</span>
            <h2>How the QuickFurno vendor flow works.</h2>
          </div>
          <div className="container vendor-step-grid">
            {vendorSteps.map((step, index) => (
              <article className="step-card reveal-card" key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{step}</h3>
              </article>
            ))}
          </div>
        </section>

        <section className="section-block">
          <div className="container app-preview-grid">
            <VendorDashboardPreview />
            <div className="app-preview-card reveal-card">
              <span className="eyebrow">Android vendor app preview</span>
              <h2>Android vendor dashboard app coming.</h2>
              <ul>
                <li>View assigned leads</li>
                <li>Call or WhatsApp clients</li>
                <li>Update lead status</li>
                <li>Track remaining leads</li>
                <li>Renew package</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="section-block section-warm">
          <div className="container faq-layout">
            <div className="section-heading section-heading--left">
              <span className="eyebrow">Vendor FAQ</span>
              <h2>Questions vendors ask before joining QuickFurno.</h2>
            </div>
            <FAQ items={vendorFaqs} />
          </div>
        </section>

        <section className="final-cta">
          <div className="container final-cta-card">
            <span className="eyebrow">Start receiving enquiries</span>
            <h2>Start receiving verified client enquiries.</h2>
            <div className="hero-cta-row">
              <Link href="#vendor-form" className="btn btn-primary">
                Register Now
              </Link>
              <a className="btn btn-outline" href="https://wa.me/91XXXXXXXXXX">
                WhatsApp Team
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <StickyMobileCTA />
    </>
  );
}
