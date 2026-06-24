import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { StatsCounter } from "@/components/home/StatsCounter";
import { TestimonialsCarousel } from "@/components/home/TestimonialsCarousel";
import { clientTestimonials } from "@/lib/quickfurno-data";

export function HomeIllustration() {
  return (
    <div className="qf-hero-banner" aria-hidden="true">
      <span className="qf-hero-glow" />
      <span className="qf-float-shape qf-float-shape--one" />
      <span className="qf-float-shape qf-float-shape--two" />
      <span className="qf-float-shape qf-float-shape--three" />

      <svg className="qf-hero-scene" viewBox="0 0 360 300" role="img" aria-label="">
        <defs>
          <linearGradient id="qfRoom" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FFF3E9" />
            <stop offset="1" stopColor="#FFE2CE" />
          </linearGradient>
          <linearGradient id="qfSofa" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#F58A5B" />
            <stop offset="1" stopColor="#E85A2A" />
          </linearGradient>
          <linearGradient id="qfWindow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#BFE3F7" />
            <stop offset="1" stopColor="#7FC0E8" />
          </linearGradient>
          <linearGradient id="qfRug" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#F2C14E" />
            <stop offset="1" stopColor="#E0992B" />
          </linearGradient>
        </defs>

        {/* Room */}
        <rect x="14" y="14" width="332" height="272" rx="26" fill="url(#qfRoom)" />
        <rect x="14" y="14" width="332" height="272" rx="26" fill="none" stroke="#FFFFFF" strokeOpacity="0.6" strokeWidth="2" />

        {/* Arched window with sunrise */}
        <path d="M48 70a44 44 0 0 1 88 0v66H48Z" fill="url(#qfWindow)" />
        <circle cx="92" cy="84" r="17" fill="#FFE7A6" opacity="0.95" />
        <path d="M48 104h88M92 38v98" stroke="#FFFFFF" strokeOpacity="0.7" strokeWidth="3" />
        <path d="M48 70a44 44 0 0 1 88 0v66H48Z" fill="none" stroke="#1B6BA8" strokeOpacity="0.25" strokeWidth="3" />

        {/* Wall art */}
        <rect x="210" y="58" width="46" height="58" rx="6" fill="#FFFFFF" stroke="#E0992B" strokeWidth="3" />
        <path d="M218 100l9-12 8 9 7-8 6 11Z" fill="#2E8FCC" opacity="0.7" />
        <rect x="270" y="64" width="40" height="46" rx="6" fill="#FFFFFF" stroke="#2E8FCC" strokeWidth="3" />
        <circle cx="290" cy="84" r="9" fill="#F58A5B" opacity="0.8" />

        {/* Floor rug */}
        <ellipse cx="200" cy="252" rx="150" ry="22" fill="url(#qfRug)" opacity="0.55" />

        {/* Sofa */}
        <rect x="150" y="176" width="170" height="54" rx="20" fill="url(#qfSofa)" />
        <rect x="158" y="158" width="154" height="40" rx="16" fill="#FF9A62" />
        <rect x="168" y="168" width="64" height="32" rx="11" fill="#FFFFFF" opacity="0.35" />
        <rect x="240" y="168" width="64" height="32" rx="11" fill="#FFFFFF" opacity="0.22" />
        <rect x="150" y="220" width="20" height="34" rx="8" fill="#C9491F" />
        <rect x="300" y="220" width="20" height="34" rx="8" fill="#C9491F" />

        {/* Cushions */}
        <rect x="176" y="170" width="30" height="30" rx="9" fill="#F2C14E" transform="rotate(8 191 185)" />
        <rect x="268" y="170" width="30" height="30" rx="9" fill="#2E8FCC" transform="rotate(-8 283 185)" />

        {/* Floor lamp */}
        <path d="M126 250V150" stroke="#1B6BA8" strokeWidth="4" strokeLinecap="round" />
        <path d="M112 150h28l-8-22h-12Z" fill="#F2C14E" stroke="#E0992B" strokeWidth="2" />
        <ellipse cx="126" cy="252" rx="16" ry="5" fill="#1B6BA8" opacity="0.3" />

        {/* Potted plant */}
        <path d="M300 250v-22" stroke="#2F8F5B" strokeWidth="4" strokeLinecap="round" />
        <path d="M300 232c-12-4-18-16-14-28 12 2 18 14 14 28ZM300 234c12-6 16-20 10-32-11 4-15 18-10 32Z" fill="#3DA76C" />
        <path d="M292 250h22l-4 18h-14Z" fill="#E85A2A" />
      </svg>

      <span className="qf-hero-chip qf-hero-chip--rating">
        <b>4.8★</b> Verified pros
      </span>
      <span className="qf-hero-chip qf-hero-chip--quote">
        <b>Free</b> quotes in minutes
      </span>
    </div>
  );
}

export const trustBadges = [
  { icon: "shield" as const, title: "Verified", label: "Vendors" },
  { icon: "bolt" as const, title: "Fast", label: "Response" },
  { icon: "map" as const, title: "Local", label: "Experts" },
  { icon: "noFee" as const, title: "No", label: "Brokerage" },
];

export const whyChooseItems = [
  ["shield", "Verified & Skilled", "Background-checked professionals you can trust."],
  ["tag", "Upfront & Transparent", "Clear pricing. No hidden charges."],
  ["clock", "On-Time Guarantee", "We value your time. On-time or on us."],
  ["compare", "Quality Assured", "Top-quality materials and work, every time."],
  ["bolt", "Hassle-Free Experience", "From booking to completion — we've got you covered."],
] as const;

export function WhyChooseSection() {
  return (
    <section className="qf-home-section" id="why-quickfurno">
      <div className="qf-section-head">
        <h2>Why Homeowners Choose QuickFurno</h2>
        <p>A premium, verified way to connect with the right home-service vendor.</p>
      </div>
      <div className="qf-usp-grid" data-reveal-group>
        {whyChooseItems.map(([icon, title, body]) => (
          <article className="qf-usp-card" key={title}>
            <span>
              <QFIcon name={icon} />
            </span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function HomeHowItWorksSection() {
  const steps = [
    ["1", "Tell Us What You Need", "Share your requirement in a few simple steps."],
    ["2", "Get Matched", "We connect you with the best verified professionals."],
    ["3", "Schedule & Confirm", "Choose a time that works for you. Easy and fast."],
    ["4", "Sit Back & Relax", "Work gets done with quality, on time, every time."],
  ];

  return (
    <section className="qf-home-section" id="how-it-works">
      <div className="qf-section-head">
        <h2>How QuickFurno Works</h2>
        <p>From requirement to finished work in four easy steps.</p>
      </div>
      <div className="qf-steps-flow" data-reveal-group>
        {steps.map(([number, title, body]) => (
          <article className="qf-step-node" key={number}>
            <span>{number}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ClientCTASection() {
  return (
    <section className="qf-client-cta qf-client-cta--banner">
      <div className="qf-client-cta-body">
        <h2>Ready to transform your home?</h2>
        <p>
          Tell us your requirement and get connected with verified home-service
          vendors near you.
        </p>
        <ul className="qf-cta-points" aria-label="QuickFurno promises">
          <li>Up to 3 verified matches</li>
          <li>Free for homeowners</li>
          <li>Dedicated support</li>
        </ul>
      </div>
      <EnquiryModalTrigger className="qf-gold-btn" source="Homepage final CTA">
        Get Free Vendor Matches
      </EnquiryModalTrigger>
    </section>
  );
}

// Most-requested home services (no public pricing — clients are matched to
// verified vendors who share quotes after the enquiry).
const featuredFlows = [
  { icon: "kitchen", title: "Modular Kitchen", desc: "Design. Build. Install." },
  { icon: "paint", title: "Full Home Painting", desc: "Beautiful walls. On time." },
  { icon: "sofa", title: "Sofa Maker", desc: "Custom. Comfort. Built." },
  { icon: "wardrobe", title: "Verified Carpenters", desc: "Skilled. Verified. Nearby." },
] as const;

export function FeaturedFlows() {
  return (
    <section className="qf-home-section" id="featured">
      <div className="qf-section-head">
        <h2>Popular Services</h2>
        <p>Most-requested home services across Pune &amp; Mumbai.</p>
      </div>
      <div className="qf-featured-grid" data-reveal-group>
        {featuredFlows.map((flow) => (
          <article className="qf-featured-card" key={flow.title}>
            <span className="qf-featured-icon">
              <QFIcon name={flow.icon} />
            </span>
            <div className="qf-featured-meta">
              <strong>{flow.title}</strong>
              <small>{flow.desc}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// Headline marketplace stats (navy strip) — animated counters live in the
// client component so the rest of this module stays a server component.
export function StatsStrip() {
  return <StatsCounter />;
}

// --- Homepage sections ------------------------------------------------------

const trustStripItems = [
  { icon: "verified-vendors", title: "Verified Vendors", label: "Background-checked pros" },
  { icon: "fast-response", title: "Fast Response", label: "Matches in minutes" },
  { icon: "transparent-process", title: "Transparent Process", label: "Clear rates, no surprises" },
  { icon: "location-matching", title: "Location-Based Matching", label: "Matched to your area" },
] as const;

export function TrustStrip() {
  return (
    <section className="qf-home-section qf-home-section--tight" id="trust">
      <div className="qf-trust-strip" data-reveal-group>
        {trustStripItems.map((item) => (
          <div className="qf-trust-strip-item" key={item.title}>
            <img
              src={`/assets/quickfurno/icons/trust/${item.icon}.svg`}
              alt=""
              width={30}
              height={30}
              loading="lazy"
            />
            <span>
              <b>{item.title}</b>
              <small>{item.label}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CoverageSection() {
  return (
    <section className="qf-home-section" id="coverage">
      <div className="qf-coverage" data-reveal>
        <div>
          <span className="qf-u-eyebrow">Now serving</span>
          <h2>We&apos;re live in Pune &amp; Mumbai</h2>
          <p>
            QuickFurno connects you with verified local experts across Pune and
            Mumbai — with more cities on the way.
          </p>
          <div className="qf-coverage-cities">
            <span>Pune</span>
            <span>Mumbai</span>
            <span>More cities soon</span>
          </div>
        </div>
        <div className="qf-coverage-media">
          <img
            src="/assets/quickfurno/images/city/pune-mumbai-line-art.svg"
            alt="Pune and Mumbai coverage illustration"
            loading="lazy"
          />
        </div>
      </div>
    </section>
  );
}

export function HomeTestimonials() {
  return (
    <section className="qf-home-section" id="testimonials">
      <div className="qf-section-head">
        <h2>What clients say about QuickFurno</h2>
        <p>Real homeowners who found the right vendor through us.</p>
      </div>
      <TestimonialsCarousel testimonials={clientTestimonials} />
    </section>
  );
}
