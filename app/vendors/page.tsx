import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { StickyMobileCTA } from "@/components/StickyMobileCTA";
import styles from "./vendors.module.css";

/*
  QF-UI-V2-10 — public vendor acquisition page.

  Rebuilt on the V2 public design system, and stripped of content that presented
  invented data or unprovable promises as fact. Removed outright:

    • the hero "dashboard" mock: a fake business ("UrbanCraft Interiors ·
      Premium plan"), a "Live" badge and the metrics 12 Active Client Matches /
      5 New Today / 92% Response, plus three invented lead rows with budgets;
    • sampleLeads + miniLeads — "Client requests waiting for you" with
      ₹8–12L / "2m ago" / Accept Match / WhatsApp actions;
    • three named testimonials (Rohit Deshmukh, Sanket Patil, Arjun Mehta) with
      growth quotes — no evidence in the repository that they are real or
      approved for public use;
    • the five floating hero badges (Pre-qualified enquiries, Real-time
      notifications, High-demand enquiries, Higher Conversions, Premium
      Visibility) and the VendorHeroStats strip.

  What replaces them is grounded in the certified vendor dashboard and in the
  journey already published on /vendor: create an account, QuickFurno reviews
  the profile, and once the account is approved, active and credited, matched
  enquiries appear in the dashboard.
*/

const SIGNUP_HREF = "/vendor?mode=signup";
const LOGIN_HREF = "/vendor?mode=login";

export const metadata: Metadata = {
  title: "For Vendors | QuickFurno",
  description:
    "Create a QuickFurno vendor account, build your public business profile, and manage matched home-service enquiries in Pune and Mumbai.",
  openGraph: {
    title: "For Vendors | QuickFurno",
    description:
      "Create a QuickFurno vendor account, build your public business profile, and manage matched home-service enquiries in Pune and Mumbai.",
    url: "https://quickfurno.in/vendors",
    siteName: "QuickFurno",
    type: "website",
  },
};

/** Capabilities that exist in the certified vendor dashboard today. */
const CAPABILITIES: [string, string][] = [
  ["Assigned enquiries", "See the client requirements matched to your business in one inbox."],
  ["Status & follow-up", "Move each enquiry through your own follow-up stages."],
  ["Public business profile", "Publish services, service areas, photos and hours once approved."],
  ["Lead credits & package", "See your remaining credits and current package state."],
  ["Notifications", "Account and enquiry updates in the dashboard."],
  ["Support thread", "Raise a question with the QuickFurno team and track the reply."],
];

/**
 * Mirrors the journey already published on /vendor, including the approval and
 * "active and credited" eligibility steps — so the page never implies enquiries
 * begin arriving the moment someone signs up.
 */
const STEPS: [string, string][] = [
  ["Create your vendor account", "Sign up and submit your business details. This creates your login and sends your profile for review."],
  ["QuickFurno reviews your profile", "Our team checks your business details and service fit before enabling marketplace access."],
  ["Account becomes eligible", "Lead access depends on your account being approved and active, with a package and credits in place."],
  ["Manage matched enquiries", "Once eligible, matched client requirements appear in your dashboard for follow-up."],
];

/** The categories QuickFurno actually supports today (same list as /vendor FAQ). */
const CATEGORIES = [
  "Interior Designers",
  "Carpenters",
  "Modular Factory",
  "Premium Interiors",
  "Sofa",
  "Painter",
  "Civil Work",
];

/**
 * Illustrative only. Every value is generic, no business is named, nothing is
 * time-stamped or counted, and the block is labelled "Example view" in the UI
 * and in its accessible name so it can never read as live production data.
 */
function DashboardPreview() {
  return (
    <figure className={styles.preview} role="img" aria-label="Illustrative example of the QuickFurno vendor dashboard layout. Not live data.">
      <figcaption className={styles.previewLabel}>Example view</figcaption>

      <div className={styles.previewCard} aria-hidden="true">
        <div className={styles.previewTop}>
          <span className={styles.previewAvatar} />
          <span className={styles.previewLines}>
            <i style={{ width: "62%" }} />
            <i style={{ width: "38%" }} />
          </span>
        </div>

        <div className={styles.previewTiles}>
          <span><small>Assigned leads</small><i /></span>
          <span><small>Lead credits</small><i /></span>
          <span><small>Profile completion</small><i /></span>
        </div>

        <div className={styles.previewList}>
          <strong>Assigned enquiries</strong>
          {[0, 1, 2].map((row) => (
            <span className={styles.previewRow} key={row}>
              <i style={{ width: "44%" }} />
              <i style={{ width: "26%" }} />
              <em />
            </span>
          ))}
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
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className={styles.hero}>
          <div className={styles.shell}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>For service professionals</span>
              <h1 className={styles.heroTitle}>
                Get relevant home-service enquiries in your service areas
              </h1>
              <p className={styles.heroLede}>
                Create a QuickFurno vendor account, publish your business profile, and manage the
                client enquiries matched to your services across Pune &amp; Mumbai.
              </p>

              <div className={styles.heroActions}>
                <Link className={styles.primaryCta} href={SIGNUP_HREF}>
                  Create vendor account
                </Link>
                <Link className={styles.secondaryCta} href={LOGIN_HREF}>
                  Vendor login
                </Link>
              </div>

              <p className={styles.heroNote}>
                Profiles are reviewed by QuickFurno before they go live. Enquiry access depends on
                your account being approved, active and credited.
              </p>
            </div>

            <div className={styles.heroVisual}>
              <DashboardPreview />
            </div>
          </div>
        </section>

        {/* ── Capabilities ─────────────────────────────────────────────── */}
        <section className={styles.section} aria-labelledby="qf-vend-manage">
          <div className={styles.shell}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>The vendor dashboard</span>
              <h2 id="qf-vend-manage">What you can manage in QuickFurno</h2>
            </div>
            <ul className={styles.cardGrid}>
              {CAPABILITIES.map(([title, body]) => (
                <li className={styles.card} key={title}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Process ──────────────────────────────────────────────────── */}
        <section className={styles.sectionAlt} aria-labelledby="qf-vend-steps">
          <div className={styles.shell}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>How it works</span>
              <h2 id="qf-vend-steps">From signup to matched enquiries</h2>
            </div>
            <ol className={styles.steps}>
              {STEPS.map(([title, body], index) => (
                <li className={styles.step} key={title}>
                  <span className={styles.stepNum} aria-hidden="true">{index + 1}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Example enquiry ──────────────────────────────────────────── */}
        <section className={styles.section} aria-labelledby="qf-vend-example">
          <div className={styles.shell}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>Example</span>
              <h2 id="qf-vend-example">How an assigned enquiry appears</h2>
              <p className={styles.sectionLede}>
                A single illustrative card. QuickFurno shows the client&apos;s requirement, service
                and area; contact details are released through the dashboard according to your
                account&apos;s lead access.
              </p>
            </div>

            <div className={styles.example}>
              <span className={styles.exampleLabel}>Example enquiry</span>
              <dl className={styles.exampleRows}>
                <div><dt>Service</dt><dd>Modular kitchen</dd></div>
                <div><dt>Area</dt><dd>Baner, Pune</dd></div>
                <div><dt>Budget</dt><dd>Shown when the client provides one</dd></div>
                <div><dt>Status</dt><dd>New</dd></div>
              </dl>
            </div>
          </div>
        </section>

        {/* ── Categories ───────────────────────────────────────────────── */}
        <section className={styles.sectionAlt} aria-labelledby="qf-vend-cats">
          <div className={styles.shell}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>Who it is for</span>
              <h2 id="qf-vend-cats">Built for local service professionals</h2>
              <p className={styles.sectionLede}>
                QuickFurno currently supports these categories in Pune &amp; Mumbai.
              </p>
            </div>
            <ul className={styles.chips}>
              {CATEGORIES.map((category) => (
                <li key={category}>{category}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────────────── */}
        <section className={styles.finalCta}>
          <div className={styles.shell}>
            <h2>Join QuickFurno as a vendor</h2>
            <p>
              Create your account and submit your business details. Our team will review your
              profile and share package details with you directly.
            </p>
            <div className={styles.finalActions}>
              <Link className={styles.primaryCta} href={SIGNUP_HREF}>
                Create vendor account
              </Link>
              <Link className={styles.finalLogin} href={LOGIN_HREF}>
                Already a vendor? Log in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
      <StickyMobileCTA />
    </>
  );
}
