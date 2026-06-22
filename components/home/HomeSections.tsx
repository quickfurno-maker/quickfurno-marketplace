import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { categorySlug, type QuickFurnoCategory } from "@/lib/quickfurno-data";

export function HomeIllustration() {
  return (
    <div className="qf-hero-illustration" aria-hidden="true">
      <span className="qf-float-shape qf-float-shape--one" />
      <span className="qf-float-shape qf-float-shape--two" />
      <span className="qf-float-shape qf-float-shape--three" />
      <svg viewBox="0 0 250 180" role="img" aria-label="">
        <path d="M45 143h160" stroke="#B9D4D7" strokeWidth="4" strokeLinecap="round" />
        <path d="M62 82 124 30l64 52" fill="#E7B45A" stroke="#075B67" strokeWidth="5" strokeLinejoin="round" />
        <path d="M75 78v67h99V78" fill="#FFFDF8" stroke="#075B67" strokeWidth="5" strokeLinejoin="round" />
        <path d="M105 145v-38h34v38" fill="#F8F4EA" stroke="#075B67" strokeWidth="4" />
        <path d="M86 92h24v22H86zM145 92h18v22h-18z" fill="#D9ECE8" stroke="#075B67" strokeWidth="3" />
        <path d="M171 48v26" stroke="#075B67" strokeWidth="5" strokeLinecap="round" />
        <path d="M165 48h17" stroke="#075B67" strokeWidth="5" strokeLinecap="round" />
        <circle cx="53" cy="56" r="5" fill="#D9902F" />
        <circle cx="201" cy="70" r="4" fill="#075B67" />
        <path d="M208 38c12 2 16 8 12 19-11-1-17-7-12-19Z" fill="#4D8C79" opacity="0.65" />
      </svg>
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
  { title: "Modular Kitchen", description: "Kitchen design, cabinets and installation.", icon: "kitchen", category: "Modular Factory" },
  { title: "Full Home Interior", description: "Complete design and execution support.", icon: "home", category: "Interior Designers" },
  { title: "Custom Wardrobe", description: "Storage made for your room and budget.", icon: "wardrobe", category: "Modular Factory" },
  { title: "Sofa Making", description: "Custom sofa, recliner and upholstery work.", icon: "sofa", category: "Sofa" },
  { title: "Painting", description: "Interior, exterior and texture painting.", icon: "paint", category: "Painter" },
  { title: "False Ceiling", description: "Ceiling design, lighting and repair.", icon: "ceiling", category: "Interior Designers" },
  { title: "Civil Renovation", description: "Tiles, mason work and renovation support.", icon: "civil", category: "Civil Work" },
  { title: "Flooring", description: "Tile, wooden and vinyl flooring services.", icon: "floor", category: "Civil Work" },
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
