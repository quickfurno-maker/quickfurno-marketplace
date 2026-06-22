import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { QFIcon } from "@/components/QuickFurnoIcons";
import {
  categorySlug,
  clientTestimonials,
  type QuickFurnoCategory,
} from "@/lib/quickfurno-data";

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
  ["shield", "Verified local vendors", "Connect with trusted home-service experts near you."],
  ["compare", "Compare rates and services", "Check services, pricing and expertise before choosing."],
  ["bolt", "Fast response", "Get connected with suitable vendors quickly."],
  ["noFee", "No brokerage", "QuickFurno helps you connect without unnecessary middlemen."],
  ["request", "One request, multiple options", "Submit your requirement once and explore matching experts."],
  ["home", "Home-service focused", "Built specially for interiors, furniture, renovation and repairs."],
] as const;

export function WhyChooseSection() {
  return (
    <section className="qf-home-section" id="why-quickfurno">
      <div className="qf-section-head">
        <h2>Why clients choose QuickFurno</h2>
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
    ["1", "Tell requirement", "Share what you need, city and timeline."],
    ["2", "We match vendors", "QuickFurno shortlists suitable verified options."],
    ["3", "Compare, talk, choose", "Speak directly and move ahead with confidence."],
  ];

  return (
    <section className="qf-home-section" id="how-it-works">
      <div className="qf-section-head">
        <h2>How QuickFurno Works</h2>
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
    <section className="qf-client-cta">
      <h2>Need help finding the right vendor?</h2>
      <p>Share your requirement and QuickFurno will connect you with suitable verified vendors near you.</p>
      <EnquiryModalTrigger className="qf-gold-btn">Get Free Assistance</EnquiryModalTrigger>
    </section>
  );
}

const popularServices: Array<{
  title: string;
  description: string;
  icon: Parameters<typeof QFIcon>[0]["name"];
  category: QuickFurnoCategory;
}> = [
  { title: "Premium Interior", description: "High-end finishes and managed execution.", icon: "home", category: "Premium Interiors" },
  { title: "Interior Designer", description: "Complete design and turnkey support.", icon: "home", category: "Interior Designers" },
  { title: "Modular Factory", description: "Factory-finish kitchens and wardrobes.", icon: "kitchen", category: "Modular Factory" },
  { title: "Custom Sofa", description: "Sofa, recliner and upholstery work.", icon: "sofa", category: "Sofa" },
  { title: "Painting", description: "Interior, texture and waterproofing.", icon: "paint", category: "Painter" },
  { title: "Civil Work", description: "Renovation, tiling and mason work.", icon: "civil", category: "Civil Work" },
];

export function PopularServicesSection() {
  return (
    <section className="qf-home-section" id="popular-services">
      <div className="qf-section-head qf-section-head--split">
        <div>
          <h2>Popular Services</h2>
          <p>Explore the most requested home-service categories.</p>
        </div>
      </div>
      <div className="qf-popular-grid" data-reveal-group>
        {popularServices.map((service) => (
          <Link key={service.title} className="qf-popular-card" href={`/category/${categorySlug(service.category)}`}>
            <span className="qf-popular-icon">
              <QFIcon name={service.icon} />
            </span>
            <strong>{service.title}</strong>
            <p>{service.description}</p>
            <span className="qf-card-link">Explore Vendors</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function VendorCTASection() {
  return (
    <section className="qf-vendor-cta">
      <div>
        <h2>Are you a carpenter, interior designer or home-service vendor?</h2>
        <p>List your business on QuickFurno and receive relevant client enquiries.</p>
      </div>
      <Link href="/vendors" className="qf-teal-btn">
        List Your Business
      </Link>
    </section>
  );
}

// --- Phase 2A skeleton sections ---------------------------------------------

const trustStripItems = [
  { icon: "verified-vendors", title: "Verified vendors", label: "Background-checked pros" },
  { icon: "fast-response", title: "Fast response", label: "Matches in minutes" },
  { icon: "best-price", title: "Transparent rates", label: "Compare before you commit" },
  { icon: "location-matching", title: "Local experts", label: "Matched to your area" },
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
          <h2>Trusted home-service vendors across Pune &amp; Mumbai</h2>
          <p>
            QuickFurno matches you with verified local experts wherever you are in
            Pune and Mumbai — with more cities on the way.
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
      <div className="qf-home-testimonials" data-reveal-group>
        {clientTestimonials.map((testimonial) => (
          <article className="qf-home-testimonial-card" key={testimonial.name}>
            <div className="qf-stars" aria-label="5 out of 5 rating">
              ★★★★★
            </div>
            <p>&quot;{testimonial.quote}&quot;</p>
            <div className="qf-home-testimonial-author">
              <span aria-hidden="true">{testimonial.name.slice(0, 1)}</span>
              <div>
                <strong>{testimonial.name}</strong>
                <small>{testimonial.detail}</small>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
