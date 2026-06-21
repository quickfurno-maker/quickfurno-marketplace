import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { PortfolioGallery } from "@/components/PortfolioGallery";
import { VendorCards } from "@/components/VendorCards";

export const metadata: Metadata = {
  title: "Raj Premium Interiors | QuickFurno Verified Vendor",
  description:
    "View Raj Premium Interiors profile, pricing, portfolio, reviews and contact actions on QuickFurno.",
  openGraph: {
    title: "Raj Premium Interiors on QuickFurno",
    description: "Verified interior design vendor profile with pricing, gallery and reviews.",
    url: "https://quickfurno.com/vendors/raj-premium-interiors",
    siteName: "QuickFurno",
    type: "profile",
  },
};

const profileStats = [
  ["125", "Projects Completed"],
  ["12 Years", "Experience"],
  ["4.8", "Average Rating"],
  ["< 1 hr", "Response"],
];

const services = [
  ["Interior Design", "Starting ₹1,450/sq.ft"],
  ["Modular Kitchen", "Starting ₹1,250/sq.ft"],
  ["Wardrobe", "Starting ₹1,100/sq.ft"],
  ["False Ceiling", "Starting ₹140/sq.ft"],
  ["Civil Renovation", "Project based"],
];

const reviews = [
  ["Aarav Joshi", "Elegant execution and transparent pricing. The team explained material choices clearly."],
  ["Meera Deshpande", "Our kitchen and wardrobe work was coordinated well, with quick updates and good finishing."],
  ["Sanjay Kulkarni", "Professional process from measurement to installation. Helpful for a first-time renovation."],
  ["Nikita Shah", "Good design suggestions and practical storage ideas for a compact apartment."],
];

export default function VendorProfilePage() {
  return (
    <>
      <Header />
      <main>
        <section className="profile-cover section-pad-top">
          <div className="container profile-cover-card">
            <div className="profile-cover-image warm-suite" role="img" aria-label="Raj Premium Interiors project cover preview" />
            <div className="profile-summary">
              <div className="profile-avatar" aria-hidden="true">RP</div>
              <div>
                <div className="badge-row">
                  <span className="status-badge status-badge--verified">Verified</span>
                  <span className="status-badge status-badge--featured">Featured</span>
                </div>
                <h1>Raj Premium Interiors</h1>
                <p>Interior Designers • Premium Interiors • Pune, Kharadi, Viman Nagar and nearby areas</p>
                <div className="profile-rating">4.8 ★ • 118 reviews</div>
                <div className="hero-cta-row">
                  <a className="btn btn-secondary" href="tel:+919999999999">Call</a>
                  <a className="btn btn-outline" href="https://wa.me/91XXXXXXXXXX">WhatsApp</a>
                  <Link className="btn btn-primary" href="/#lead-form">Request Quote</Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section-block">
          <div className="container profile-layout">
            <div className="profile-main">
              <div className="profile-stat-grid">
                {profileStats.map(([value, label]) => (
                  <article className="profile-stat-card reveal-card" key={label}>
                    <strong>{value}</strong>
                    <span>{label}</span>
                  </article>
                ))}
              </div>

              <section className="profile-panel reveal-card">
                <span className="eyebrow">About vendor</span>
                <h2>Premium interiors with managed execution.</h2>
                <p>
                  Raj Premium Interiors helps homeowners create elegant, functional and durable interiors
                  with transparent pricing, premium materials and managed execution.
                </p>
              </section>

              <section className="profile-panel reveal-card">
                <span className="eyebrow">Services & Pricing</span>
                <h2>Starting rates for common project scopes.</h2>
                <div className="service-price-grid">
                  {services.map(([service, price]) => (
                    <article key={service}>
                      <h3>{service}</h3>
                      <p>{price}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="profile-panel reveal-card">
                <span className="eyebrow">Portfolio masonry gallery</span>
                <h2>Recent project work.</h2>
                <PortfolioGallery limit={8} />
              </section>

              <section className="profile-panel reveal-card">
                <span className="eyebrow">Client reviews</span>
                <h2>What homeowners say.</h2>
                <div className="review-grid">
                  {reviews.map(([name, quote]) => (
                    <article className="review-card" key={name}>
                      <div className="stars" aria-label="5 star review">★★★★★</div>
                      <p>“{quote}”</p>
                      <strong>{name}</strong>
                    </article>
                  ))}
                </div>
              </section>

              <section className="profile-panel reveal-card">
                <span className="eyebrow">Similar vendors near you</span>
                <h2>Compare other active paid vendors.</h2>
                <VendorCards compact />
              </section>
            </div>

            <aside className="profile-contact-card" aria-label="Contact Raj Premium Interiors">
              <h2>Request a verified quote</h2>
              <p>QuickFurno can help you compare this vendor with 3 more verified options.</p>
              <Link className="btn btn-primary" href="/#lead-form">Request Quote</Link>
              <a className="btn btn-secondary" href="tel:+919999999999">Call Vendor</a>
              <a className="btn btn-outline" href="https://wa.me/91XXXXXXXXXX">WhatsApp</a>
            </aside>
          </div>
        </section>
      </main>
      <Footer />
      <div className="vendor-profile-mobile-cta" aria-label="Vendor profile contact actions">
        <a href="tel:+919999999999">Call</a>
        <a href="https://wa.me/91XXXXXXXXXX">WhatsApp</a>
        <Link href="/#lead-form">Request Quote</Link>
      </div>
    </>
  );
}
