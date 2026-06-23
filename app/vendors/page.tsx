import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { QFIcon } from "@/components/QuickFurnoIcons";
import styles from "./vendors.module.css";

const registerHref = "/vendors/register";

export const metadata: Metadata = {
  title: "For Vendors | QuickFurno",
  description:
    "Join QuickFurno to receive verified home-service leads, manage enquiries, build trust and grow faster in Pune and Mumbai.",
  openGraph: {
    title: "Grow your business with verified client leads from QuickFurno",
    description:
      "QuickFurno helps vendors receive genuine home-service enquiries in Pune and Mumbai.",
    url: "https://quickfurno.in/vendors",
    siteName: "QuickFurno",
    type: "website",
  },
};

const benefits = [
  {
    title: "Verified Leads",
    body: "High-intent enquiries from real homeowners.",
    icon: "/assets/quickfurno/icons/trust/verified-vendors.svg",
  },
  {
    title: "Faster Growth",
    body: "Win more projects and scale your business.",
    icon: "/assets/quickfurno/icons/process/start-project.svg",
  },
  {
    title: "Transparent Lead Allocation",
    body: "Fair distribution with no hidden preference.",
    icon: "/assets/quickfurno/icons/process/matched-vendors.svg",
  },
  {
    title: "Dedicated Support",
    body: "We help you succeed at every step.",
    icon: "/assets/quickfurno/icons/trust/fast-response.svg",
  },
];

const vendorSteps = [
  ["Create profile", "Complete your profile and get verified by our team."],
  ["Choose plan", "Select the plan that fits your business goals."],
  ["Get matched to leads", "Receive verified enquiries from your service areas."],
  ["Win more projects", "Connect with clients, share quotes and grow your business."],
];

const sampleLeads = [
  {
    title: "Premium Interior Design",
    location: "Baner, Pune",
    budget: "Rs 8-12 Lakh",
    status: "New",
    requested: "2m ago",
    image: "/assets/quickfurno/images/vendors/premium-living-room.svg",
  },
  {
    title: "Modular Kitchen",
    location: "Wakad, Pune",
    budget: "Rs 3-5 Lakh",
    status: "New",
    requested: "15m ago",
    image: "/assets/quickfurno/images/vendors/modular-kitchen.svg",
  },
  {
    title: "Civil Work",
    location: "Kothrud, Pune",
    budget: "Rs 5-8 Lakh",
    status: "Contacted",
    requested: "1h ago",
    image: "/assets/quickfurno/images/vendors/civil-work-site.svg",
  },
];

const plans = [
  {
    name: "Starter",
    price: "Rs 1,499",
    period: "/month",
    description: "Perfect for getting started",
    cta: "Choose Starter",
    features: [
      "15 lead credits/month",
      "Profile visibility in search",
      "WhatsApp leads",
      "Basic support",
    ],
  },
  {
    name: "Growth",
    price: "Rs 2,999",
    period: "/month",
    description: "Best for growing businesses",
    cta: "Choose Growth",
    badge: "Recommended",
    featured: true,
    features: [
      "40 lead credits/month",
      "Priority listing in search",
      "WhatsApp leads",
      "Performance insights",
      "Priority support",
    ],
  },
  {
    name: "Premium",
    price: "Rs 4,999",
    period: "/month",
    description: "For established professionals",
    cta: "Choose Premium",
    features: [
      "80 lead credits/month",
      "Top listing in search",
      "WhatsApp leads",
      "Performance insights",
      "Dedicated account manager",
    ],
  },
];

const uspCards = [
  ["Better lead quality", "High-intent clients ready to hire."],
  ["City-based matching", "Get leads from your service areas."],
  ["Priority listing for active subscribers", "Active plans get priority access."],
  ["Simple dashboard", "Manage leads and clients in one place."],
  ["Build trust with verified badges", "Verified badge boosts your credibility."],
  ["No hidden charges", "Transparent pricing you can trust."],
];

const testimonials = [
  {
    name: "Rohit Deshmukh",
    company: "UrbanCraft Interiors, Pune",
    quote: "QuickFurno brings us quality leads every day. Our project bookings have increased by 3x.",
  },
  {
    name: "Sanket Patil",
    company: "Patil Modular Solutions, Pune",
    quote: "The platform is easy to use and the leads are genuine. Highly recommended.",
  },
  {
    name: "Arjun Mehta",
    company: "Mehta Construction, Mumbai",
    quote: "Transparent process and great support. We have grown our business significantly.",
  },
];

const miniLeads = [
  { title: "Premium Interior Design", place: "Baner, Pune", budget: "₹8–12L", status: "New" },
  { title: "Modular Kitchen", place: "Wakad, Pune", budget: "₹3–5L", status: "New" },
  { title: "Civil Work", place: "Kothrud, Pune", budget: "₹5–8L", status: "Contacted" },
];

// Floating benefit badges around the hero visual.
const heroFloatBadges = [
  { icon: "shield" as const, title: "Verified Leads", sub: "Pre-qualified enquiries" },
  { icon: "bolt" as const, title: "Fast Lead Alerts", sub: "Real-time notifications" },
  { icon: "map" as const, title: "Pune & Mumbai", sub: "High-demand leads" },
  { icon: "compare" as const, title: "Higher Conversions", sub: "Convert more leads" },
  { icon: "star" as const, title: "Premium Visibility", sub: "Stand out & grow" },
];

// Compact stats strip shown below the hero visual.
const heroStats = [
  { value: "10,000+", label: "Verified Pros" },
  { value: "4.7", label: "Average Rating" },
  { value: "100%", label: "Secure & Trusted" },
];

function VendorLeadCard() {
  return (
    <div className={styles.leadCardMock} aria-label="QuickFurno vendor lead dashboard preview">
      <div className={styles.leadCardTop}>
        <span className={styles.leadCardAvatar}>UI</span>
        <div className={styles.leadCardWho}>
          <strong>QuickFurno Vendor</strong>
          <small>UrbanCraft Interiors · Premium plan</small>
        </div>
        <span className={styles.leadCardLive}>Live</span>
      </div>

      <div className={styles.leadCardKpis}>
        <div>
          <strong>12</strong>
          <small>Active Leads</small>
        </div>
        <div>
          <strong>5</strong>
          <small>New Today</small>
        </div>
        <div>
          <strong>92%</strong>
          <small>Response</small>
        </div>
      </div>

      <div className={styles.leadCardListHead}>
        <strong>Recent Leads</strong>
        <span>This week</span>
      </div>
      <div className={styles.leadCardList}>
        {miniLeads.map((lead) => (
          <div className={styles.leadCardRow} key={lead.title}>
            <span className={styles.leadCardRowAvatar}>{lead.title.slice(0, 1)}</span>
            <div className={styles.leadCardRowMeta}>
              <strong>{lead.title}</strong>
              <small>{lead.place}</small>
            </div>
            <b className={styles.leadCardRowBudget}>{lead.budget}</b>
            <em className={styles.leadCardRowStatus} data-status={lead.status}>
              {lead.status}
            </em>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VendorsPage() {
  return (
    <>
      <Header />
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.shell}>
            <div className={styles.heroCopy} data-reveal>
              <span className={styles.eyebrow}>For Service Professionals</span>
              <h1>
                Grow your business with verified client leads.
                <span className={styles.heroHighlight}>From QuickFurno.</span>
              </h1>
              <p>
                Receive genuine home-service enquiries, manage leads with ease, and grow
                faster across Pune &amp; Mumbai.
              </p>
              <div className={styles.heroActions}>
                <Link className={styles.primaryCta} href={registerHref}>
                  Become a Vendor
                </Link>
                <Link className={styles.secondaryCta} href="#lead-demo">
                  View Lead Demo
                </Link>
              </div>
              <div className={styles.trustLine}>
                <span>Trusted by 500+ service professionals in Pune &amp; Mumbai</span>
                <strong>4.8/5 from 500+ professionals</strong>
              </div>
            </div>

            <div className={styles.heroVisual}>
              <div className={styles.heroVisualStage}>
                <VendorLeadCard />
                <div className={styles.floatBadges} aria-hidden="true">
                  {heroFloatBadges.map((badge) => (
                    <span className={styles.floatBadge} key={badge.title}>
                      <span className={styles.floatBadgeIcon}>
                        <QFIcon name={badge.icon} />
                      </span>
                      <span className={styles.floatBadgeText}>
                        <strong>{badge.title}</strong>
                        <small>{badge.sub}</small>
                      </span>
                    </span>
                  ))}
                </div>
              </div>
              <div className={styles.heroStats}>
                {heroStats.map((stat) => (
                  <div className={styles.heroStat} key={stat.label}>
                    <strong>{stat.value}</strong>
                    <small>{stat.label}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={styles.benefitStrip} aria-label="Vendor benefits">
          <div className={styles.stripShell}>
            {benefits.map((benefit) => (
              <article className={styles.benefitCard} key={benefit.title}>
                <Image src={benefit.icon} width={40} height={40} alt="" aria-hidden="true" />
                <div>
                  <h2>{benefit.title}</h2>
                  <p>{benefit.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2>How it works for vendors</h2>
          </div>
          <div className={styles.stepGrid}>
            {vendorSteps.map(([title, body], index) => (
              <article className={styles.stepCard} key={title}>
                <span>{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.leadSection} id="lead-demo">
          <div className={styles.sectionHeading}>
            <h2>Leads waiting for you</h2>
          </div>
          <div className={styles.leadLayout}>
            <div className={styles.leadGrid}>
              {sampleLeads.map((lead) => (
                <article className={styles.leadCard} key={lead.title}>
                  <Image src={lead.image} width={160} height={120} alt={`${lead.title} preview`} />
                  <div className={styles.leadInfo}>
                    <h3>{lead.title}</h3>
                    <span>{lead.location}</span>
                    <dl>
                      <div>
                        <dt>Budget</dt>
                        <dd>{lead.budget}</dd>
                      </div>
                      <div>
                        <dt>Client Status</dt>
                        <dd>{lead.status}</dd>
                      </div>
                      <div>
                        <dt>Requested</dt>
                        <dd>{lead.requested}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className={styles.leadActions}>
                    <Link href={registerHref}>Accept Lead</Link>
                    <Link href={registerHref}>View Details</Link>
                    <Link href={registerHref}>WhatsApp</Link>
                  </div>
                </article>
              ))}
            </div>

            <aside className={styles.leadBenefits}>
              {[
                ["Real-time lead notifications", "Never miss a new opportunity."],
                ["Direct client communication", "Chat or call directly through the platform."],
                ["Secure & transparent process", "No hidden charges, no compromises."],
                ["Performance insights", "Track response rate and conversions."],
              ].map(([title, body]) => (
                <div key={title}>
                  <strong>{title}</strong>
                  <span>{body}</span>
                </div>
              ))}
            </aside>
          </div>
        </section>

        <section className={styles.splitSection}>
          <div>
            <div className={styles.sectionHeading}>
              <h2>Choose the plan that grows with your business</h2>
            </div>
            <div className={styles.pricingGrid}>
              {plans.map((plan) => (
                <article className={`${styles.planCard} ${plan.featured ? styles.planFeatured : ""}`} key={plan.name}>
                  {plan.badge ? <span className={styles.planBadge}>{plan.badge}</span> : null}
                  <h3>{plan.name}</h3>
                  <p>{plan.description}</p>
                  <strong>
                    {plan.price}
                    <small>{plan.period}</small>
                  </strong>
                  <ul>
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                  <Link href={registerHref}>{plan.cta}</Link>
                </article>
              ))}
            </div>
          </div>

          <div>
            <div className={styles.sectionHeading}>
              <h2>Why vendors love QuickFurno</h2>
            </div>
            <div className={styles.uspGrid}>
              {uspCards.map(([title, body]) => (
                <article className={styles.uspCard} key={title}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.testimonials}>
          <div className={styles.sectionHeading}>
            <h2>What our vendors say</h2>
          </div>
          <div className={styles.testimonialGrid}>
            {testimonials.map((item) => (
              <article className={styles.testimonialCard} key={item.name}>
                <div>
                  <span>{item.name.slice(0, 1)}</span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.company}</small>
                  </div>
                </div>
                <p>&quot;{item.quote}&quot;</p>
                <em>*****</em>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.finalCta}>
          <div>
            <h2>Ready to receive more client enquiries?</h2>
            <p>Join 500+ service professionals who are growing faster with QuickFurno.</p>
          </div>
          <Link href={registerHref}>Join QuickFurno Today</Link>
          <ul>
            <li>No hidden charges</li>
            <li>Cancel anytime</li>
            <li>24/7 support</li>
          </ul>
        </section>
      </main>
      <Footer />
    </>
  );
}
