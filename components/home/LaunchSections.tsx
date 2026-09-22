import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { getVendorTrust, type Vendor } from "@/lib/quickfurno-data";
import {
  HOME_FAQ,
  PUNE_AREAS,
  TESTIMONIALS,
  VERIFY_STEPS,
} from "@/lib/homepage-content";

// ============================================================================
// QuickFurno — homepage launch sections (server components, qfh- design system)
//
//   FeaturedVendors  — real approved vendors from Supabase; renders nothing
//                      when the list is empty or could not be read (honest UI,
//                      same principle as QF-UI-V2-06 — no demo fallback here).
//   HowWeVerify      — factual description of the vendor approval process.
//   AreasWeServe     — Pune/PCMC locality chips.
//   HomeFAQ          — <details> accordion + FAQPage JSON-LD (no client JS).
//   Testimonials     — real homeowner quotes from lib/homepage-content.ts.
//   VendorJoinCTA    — vendor-side call to action for the two-sided marketplace.
// ============================================================================

export function FeaturedVendors({ vendors }: { vendors: Vendor[] }) {
  if (!vendors.length) return null;
  return (
    <section className="qfh-section qfh-featured" aria-labelledby="qfh-featured-title">
      <div className="qfh-shell">
        <div className="qfh-section-head qfh-section-head--center">
          <p className="qfh-section-label">Verified vendors</p>
          <h2 id="qfh-featured-title">Meet Professionals Already on QuickFurno</h2>
          <p>Real, verified Pune businesses — browse their profiles or get matched in one enquiry.</p>
        </div>
        <div className="qfh-vendor-strip">
          {vendors.map((vendor) => {
            const trust = getVendorTrust(vendor);
            const rate = trust.startingPrice.replace("Starting at", "").trim();
            return (
              <Link key={vendor.slug} href={`/vendors/${vendor.slug}`} className="qfh-vendor-tile">
                <span className="qfh-vendor-avatar" aria-hidden="true">
                  {vendor.businessName
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((word) => word.charAt(0).toUpperCase())
                    .join("")}
                </span>
                <span className="qfh-vendor-copy">
                  <strong>{vendor.businessName}</strong>
                  <small>{vendor.category} · Pune</small>
                  {vendor.verified ? (
                    <em className="qfh-vendor-badge">
                      <QFIcon name="shield" /> Verified
                    </em>
                  ) : null}
                  {rate ? <span className="qfh-vendor-rate">From {rate}</span> : null}
                </span>
                <span className="qfh-vendor-arrow" aria-hidden="true">
                  <QFIcon name="arrow" />
                </span>
              </Link>
            );
          })}
        </div>
        <div className="qfh-featured-foot">
          <Link href="/category/interior-designers" className="qfh-view-all">
            Browse all vendors <QFIcon name="arrow" />
          </Link>
        </div>
      </div>
    </section>
  );
}

export function HowWeVerify() {
  return (
    <section className="qfh-section qfh-verify" id="how-we-verify">
      <div className="qfh-shell">
        <div className="qfh-section-head qfh-section-head--center">
          <p className="qfh-section-label">Trust &amp; safety</p>
          <h2>How QuickFurno Verifies Every Vendor</h2>
          <p>No anonymous listings. Every profile you see has been reviewed and approved.</p>
        </div>
        <div className="qfh-verify-grid">
          {VERIFY_STEPS.map((step) => (
            <article className="qfh-verify-card" key={step.title}>
              <span className="qfh-verify-icon">
                <QFIcon name={step.icon} />
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AreasWeServe() {
  return (
    <section className="qfh-section qfh-areas" aria-labelledby="qfh-areas-title">
      <div className="qfh-shell">
        <div className="qfh-section-head qfh-section-head--center">
          <p className="qfh-section-label">Across Pune &amp; PCMC</p>
          <h2 id="qfh-areas-title">Areas We Serve</h2>
        </div>
        <ul className="qfh-area-chips">
          {PUNE_AREAS.map((area) => (
            <li key={area}>
              <QFIcon name="pin" />
              {area}
            </li>
          ))}
        </ul>
        <p className="qfh-areas-note">Your locality not listed? Send an enquiry anyway — we cover most of Pune.</p>
      </div>
    </section>
  );
}

export function Testimonials() {
  if (!TESTIMONIALS.length) return null;
  return (
    <div className="qfh-testimonial-list">
      {TESTIMONIALS.map((item) => (
        <article className="qfh-testimonial" key={item.name}>
          <div className="qfh-avatar" aria-hidden="true">
            {item.name
              .split(/\s+/)
              .slice(0, 2)
              .map((word) => word.charAt(0).toUpperCase())
              .join("")}
          </div>
          <div className="qfh-testimonial-copy">
            <p>&ldquo;{item.quote}&rdquo;</p>
            <strong>{item.name}</strong>
            <small>{item.detail}</small>
          </div>
          <div className="qfh-stars" aria-label="Five star testimonial">
            ★★★★★
          </div>
        </article>
      ))}
    </div>
  );
}

export function HomeFAQ() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: HOME_FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
  return (
    <section className="qfh-section qfh-faq" id="faq">
      <div className="qfh-shell qfh-faq-shell">
        <div className="qfh-section-head qfh-section-head--center">
          <p className="qfh-section-label">Good to know</p>
          <h2>Frequently Asked Questions</h2>
        </div>
        <div className="qfh-faq-list">
          {HOME_FAQ.map((item) => (
            <details className="qfh-faq-item" key={item.q}>
              <summary>
                <span>{item.q}</span>
                <i aria-hidden="true" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger -- static JSON-LD built from local constants above.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </section>
  );
}

export function VendorJoinCTA() {
  return (
    <section className="qfh-section qfh-vendor-cta" aria-labelledby="qfh-vendor-cta-title">
      <div className="qfh-shell qfh-vendor-cta-inner">
        <div className="qfh-vendor-cta-copy">
          <p className="qfh-section-label">For professionals</p>
          <h2 id="qfh-vendor-cta-title">Are You a Home-Service Professional in Pune?</h2>
          <p>
            Join QuickFurno to get a verified public profile and receive relevant homeowner
            enquiries in your trade and area.
          </p>
        </div>
        <div className="qfh-vendor-cta-actions">
          <Link href="/vendors" className="qfh-primary-btn qfh-vendor-cta-btn">
            Join as a Vendor <QFIcon name="arrow" />
          </Link>
          <span>Free to apply · Verified profiles only</span>
        </div>
      </div>
    </section>
  );
}

/** Reusable enquiry trigger for sections that need one (kept for parity). */
export function SectionEnquiryButton({ source, children }: { source: string; children: React.ReactNode }) {
  return (
    <EnquiryModalTrigger className="qfh-primary-btn" source={source}>
      {children}
    </EnquiryModalTrigger>
  );
}
