import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import { categories, categorySlug, type QuickFurnoCategory } from "@/lib/quickfurno-data";
import styles from "./vendors.module.css";

const SIGNUP_HREF = "/vendor?mode=signup";
const LOGIN_HREF = "/vendor?mode=login";

export const metadata: Metadata = {
  title: "Grow Your Business with Client Matching | QuickFurno Vendors",
  description:
    "Join QuickFurno as a Pune home-service vendor, build your verified business profile, activate matching credits and manage relevant client matches.",
  openGraph: {
    title: "Grow Your Business with Client Matching | QuickFurno Vendors",
    description:
      "A Pune-focused marketplace for verified home-service professionals and relevant client matching.",
    url: "https://quickfurno.in/vendors",
    siteName: "QuickFurno",
    type: "website",
  },
};

const CATEGORY_META: Record<QuickFurnoCategory, { subtitle: string; image: string }> = {
  "Interior Designers": { subtitle: "Residential interior design", image: "/assets/quickfurno/images/categories/interior-designers.svg" },
  Carpenters: { subtitle: "Custom furniture & woodwork", image: "/assets/quickfurno/images/categories/carpenters.svg" },
  "Modular Factory": { subtitle: "Factory-finish modular work", image: "/assets/quickfurno/images/categories/modular-factory.svg" },
  "Premium Interiors": { subtitle: "Premium design & execution", image: "/assets/quickfurno/images/categories/premium-interiors.svg" },
  Sofa: { subtitle: "Custom sofas & upholstery", image: "/assets/quickfurno/images/categories/sofa.svg" },
  Painter: { subtitle: "Interior & exterior painting", image: "/assets/quickfurno/images/categories/painter.svg" },
  "Civil Work": { subtitle: "Renovation & civil work", image: "/assets/quickfurno/images/categories/civil-work.svg" },
};

const SERVICE_CARDS = categories.map(({ name }) => ({ name, ...CATEGORY_META[name] }));

const STEPS = [
  ["user", "Create Profile", "Tell us about your business, services, areas and portfolio."],
  ["shield", "Get Reviewed", "QuickFurno reviews your business details before marketplace activation."],
  ["noFee", "Activate Matching Credits", "Your package and matching credits are activated after the required verification."],
  ["compare", "Receive Client Matches", "Relevant client enquiries can then appear in your Client Matching workspace."],
] as const;

const BENEFITS = [
  ["compare", "Relevant Client Matching", "See enquiries that fit your approved category and marketplace eligibility."],
  ["noFee", "Transparent Matching Credits", "Your dashboard shows the package and matching-credit balance attached to your account."],
  ["pin", "Pune-Only Launch", "The marketplace is currently focused on Pune, so the product stays locally relevant."],
  ["bolt", "Direct Client Connection", "When contact is available, connect with the client directly from your match workspace."],
  ["user", "Public Business Profile", "Present approved services, areas, photos and business information to homeowners."],
  ["chat", "QuickFurno Support", "Use the vendor support workspace for account, package and matching questions."],
] as const;

const EXAMPLE_MATCHES = [
  { service: "Full Home Interior", area: "Kharadi, Pune", budget: "Budget shared", category: "Interior Designers" },
  { service: "Modular Kitchen", area: "Baner, Pune", budget: "Budget shared", category: "Modular Factory" },
  { service: "Sofa Upholstery", area: "Aundh, Pune", budget: "Budget shared", category: "Sofa" },
  { service: "Home Painting", area: "Hadapsar, Pune", budget: "Budget shared", category: "Painter" },
] as const;

function ClientMatchingPreview() {
  return (
    <figure className={styles.productPreview} aria-label="Illustrative Client Matching product preview. Not live demand data.">
      <figcaption className={styles.previewBadge}>Product preview ? illustrative</figcaption>
      <div className={styles.previewShell} aria-hidden="true">
        <div className={styles.previewSidebar}>
          <Image src="/assets/quickfurno/logos/quickfurno-logo.svg" alt="" width={150} height={42} />
          <span className={styles.previewNavActive}><QFIcon name="compare" /> Client Matching</span>
          <span><QFIcon name="home" /> Overview</span>
          <span><QFIcon name="user" /> Profile</span>
          <span><QFIcon name="noFee" /> Credits</span>
        </div>
        <div className={styles.previewMain}>
          <div className={styles.previewTopline}>
            <div><small>Vendor workspace</small><strong>Client Matching</strong></div>
            <span>VK</span>
          </div>
          <div className={styles.previewTabs}><b>New matches</b><span>Contacted</span><span>Reviewed</span></div>
          <div className={styles.previewMatchList}>
            {EXAMPLE_MATCHES.slice(0, 3).map((match) => (
              <div className={styles.previewMatch} key={match.service}>
                <span className={styles.previewThumb}><QFIcon name="home" /></span>
                <span><strong>{match.service}</strong><small>{match.area}</small></span>
                <em>View match</em>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

export default function VendorsPage() {
  return (
    <>
      <Header />
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroBackdrop} aria-hidden="true">
            <Image src="/assets/quickfurno/images/hero/hero-interior-diorama.svg" alt="" fill priority sizes="100vw" />
          </div>
          <div className={styles.shell + " " + styles.heroGrid}>
            <div className={styles.heroCopy}>
              <p className={styles.kicker}>Pune&apos;s home-services marketplace</p>
              <h1>Grow Your Business <span>with Client Matching</span></h1>
              <p className={styles.heroLead}>
                Build your QuickFurno profile, complete marketplace review and manage relevant client enquiries through one vendor workspace.
              </p>
              <div className={styles.heroActions}>
                <Link className={styles.primaryCta} href={SIGNUP_HREF}>Become a Vendor <QFIcon name="arrow" /></Link>
                <Link className={styles.secondaryCta} href={LOGIN_HREF}>Vendor Login</Link>
              </div>
              <div className={styles.trustRow} aria-label="Vendor marketplace facts">
                <span><QFIcon name="pin" />Pune-only launch</span>
                <span><QFIcon name="shield" />Vendor review</span>
                <span><QFIcon name="compare" />Client Matching</span>
                <span><QFIcon name="noFee" />Matching credits</span>
              </div>
            </div>
            <div className={styles.heroVisual}><ClientMatchingPreview /></div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="vendor-categories">
          <div className={styles.shell}>
            <div className={styles.sectionHead}>
              <div><p className={styles.eyebrow}>Built for Pune professionals</p><h2 id="vendor-categories">Your real QuickFurno categories</h2></div>
              <p>Only the categories currently available in the marketplace are shown here.</p>
            </div>
            <div className={styles.categoryGrid}>
              {SERVICE_CARDS.map((service) => (
                <Link className={styles.categoryCard} href={`/category/${categorySlug(service.name)}`} key={service.name}>
                  <span className={styles.categoryMedia}><Image src={service.image} alt="" fill sizes="(max-width: 720px) 46vw, 14vw" /></span>
                  <span className={styles.categoryCopy}><strong>{service.name}</strong><small>{service.subtitle}</small></span>
                  <QFIcon name="arrow" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.sectionAlt} id="how-vendor-matching-works" aria-labelledby="vendor-steps">
          <div className={styles.shell}>
            <div className={styles.sectionHead}>
              <div><p className={styles.eyebrow}>How QuickFurno works for vendors</p><h2 id="vendor-steps">A clear path from profile to Client Matching</h2></div>
              <p>Marketplace access is eligibility-based; signup alone does not activate client matching.</p>
            </div>
            <ol className={styles.steps}>
              {STEPS.map(([icon, title, body], index) => (
                <li className={styles.step} key={title}>
                  <span className={styles.stepNumber}>{index + 1}</span>
                  <span className={styles.stepIcon}><QFIcon name={icon} /></span>
                  <div><h3>{title}</h3><p>{body}</p></div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="vendor-benefits">
          <div className={styles.shell + " " + styles.benefitLayout}>
            <div>
              <div className={styles.sectionHeadCompact}><p className={styles.eyebrow}>Why vendors choose QuickFurno</p><h2 id="vendor-benefits">A simpler local marketplace workflow</h2></div>
              <div className={styles.benefitGrid}>
                {BENEFITS.map(([icon, title, body]) => (
                  <article className={styles.benefit} key={title}><span><QFIcon name={icon} /></span><div><h3>{title}</h3><p>{body}</p></div></article>
                ))}
              </div>
            </div>
            <aside className={styles.truthPanel}>
              <span className={styles.truthIcon}><QFIcon name="shield" /></span>
              <p className={styles.eyebrow}>Built around real product rules</p>
              <h3>No fake demand counters. No promises of business results.</h3>
              <p>QuickFurno presents your approved profile and gives eligible vendors a structured Client Matching workspace. Actual matching depends on client demand and marketplace eligibility.</p>
            </aside>
          </div>
        </section>

        <section className={styles.sectionAlt} aria-labelledby="match-preview-title">
          <div className={styles.shell}>
            <div className={styles.sectionHead}>
              <div><p className={styles.eyebrow}>Client Matching preview</p><h2 id="match-preview-title">See how matched enquiries are organised</h2></div>
              <p>Illustrative examples only ? these cards are not live demand or current client records.</p>
            </div>
            <div className={styles.matchGrid}>
              {EXAMPLE_MATCHES.map((match) => (
                <article className={styles.matchCard} key={match.service}>
                  <span className={styles.examplePill}>Example</span>
                  <h3>{match.service}</h3>
                  <p><QFIcon name="pin" />{match.area}</p>
                  <p><QFIcon name="tag" />{match.budget}</p>
                  <div><span>Client match</span><span>{match.category}</span></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.finalCta}>
          <div className={styles.shell + " " + styles.finalCtaInner}>
            <div><p className={styles.eyebrow}>Ready to build your QuickFurno profile?</p><h2>Join Pune&apos;s Client Matching marketplace.</h2><p>Create your vendor account and submit your business details for review.</p></div>
            <div className={styles.finalActions}><Link className={styles.primaryCta} href={SIGNUP_HREF}>Become a Vendor <QFIcon name="arrow" /></Link><Link className={styles.finalLogin} href={LOGIN_HREF}>Vendor Login</Link></div>
          </div>
        </section>
      </main>
      <Footer />
      <StickyMobileCTA />
    </>
  );
}
