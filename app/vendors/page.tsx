import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { whatsappLink } from "@/lib/config";
import { categories, categorySlug } from "@/lib/quickfurno-data";
import "./vendors-pro.css";

// ============================================================================
// QuickFurno — For professionals (/vendors)
//
// Port of the approved Desktop 1440 / Mobile 390 canvas boards. This page has
// two audiences: pros deciding whether to apply, and homeowners who land here
// by mistake. So it carries the matching rules in plain words and never talks
// about packages, credits or buying leads.
//
// HONESTY: every number and rule below is one the product actually enforces —
// at most 3 active pros per enquiry, geography-and-trade ordering with the
// longest-waiting pro first, homeowner consent before a match, reviews only
// from matched homeowners. No invented counts, ratings or testimonials.
// Styles: app/vendors/vendors-pro.css (qfv-*).
// ============================================================================

const SIGNUP_HREF = "/vendor?mode=signup";
const LOGIN_HREF = "/vendor?mode=login";

export const metadata: Metadata = {
  title: "Up to 3 pros per enquiry | Join QuickFurno in Pune",
  description:
    "Apply free to QuickFurno in Pune. Approved vendors can receive Client Matching assignments while their account remains eligible, including sufficient matching credits.",
  alternates: { canonical: "https://quickfurno.in/vendors" },
  openGraph: {
    title: "Up to 3 pros per enquiry | Join QuickFurno in Pune",
    description:
      "Free to apply. Eligible assignments are capped at 3 active pros at a time and follow QuickFurno's category, geography and fairness rules.",
    url: "https://quickfurno.in/vendors",
    siteName: "QuickFurno",
    type: "website",
  },
};

// ---------------------------------------------------------------- data ----

const TRADES = categories.map((category) => category.name);

const STEPS = [
  {
    no: "STEP 1",
    title: "Homeowner shares the requirement",
    body: "Service, locality and the project details they choose to provide.",
    icon: "home" as const,
  },
  {
    no: "STEP 2",
    title: "Quality and consent checks",
    body: "Incomplete or unclear requests can be held for clarification before assignment.",
    icon: "search" as const,
  },
  {
    no: "STEP 3",
    title: "Up to 3 eligible pros",
    body: "Category fit comes first; geography and the approved ranking rules help order eligible vendors.",
    icon: "pin" as const,
    on: true,
  },
  {
    no: "STEP 4",
    title: "Assigned in your dashboard",
    body: "If you receive an assignment, the permitted client details and requirement appear in Client Matching.",
    icon: "phone" as const,
  },
];

const FIXES = [
  { fix: "Marketplace matching instead of running your own ads", pain: "Manage a separate ad account for every enquiry" },
  { fix: "Assignments appear in your Client Matching dashboard", pain: "Depend on missed calls as the only intake channel" },
  { fix: "Category and geography are explicit ranking signals", pain: "Treat every enquiry as equally relevant" },
  { fix: "Assignment fairness is part of the approved order", pain: "Let one vendor dominate solely because of profile size" },
];

const NIGHT_ROWS = [
  { time: "11:47 PM", title: "Modular kitchen", meta: "Baner · 2 BHK · Within 1 month" },
  { time: "6:20 AM", title: "False ceiling", meta: "Wakad · Living room" },
  { time: "SUN 9:15 PM", title: "Full home painting", meta: "Kharadi · 3 BHK" },
];

const COMPARE = [
  ["Assignment cap", "At most 3 active pros at a time"],
  ["Quality handling", "Unclear requests can be held for clarification"],
  ["Geography", "A ranking signal when authoritative route/geography data is available"],
  ["Consent", "Client contact sharing requires the governed consent path"],
  ["Reviews", "Only matched homeowners can submit vendor reviews"],
  ["Eligibility", "Approval, active status and sufficient matching credits are required"],
];

const GETS = [
  {
    title: "Approved public profile",
    body: "After approval, your published services, areas and portfolio facts can appear on your public profile.",
    icon: "shield" as const,
  },
  {
    title: "Client Matching dashboard",
    body: "Eligible assignments show the requirement facts that QuickFurno is permitted to share with you.",
    icon: "list" as const,
  },
  {
    title: "Assignment-verified reviews",
    body: "Only homeowners with a real QuickFurno assignment can submit a review for that vendor.",
    icon: "star" as const,
  },
  {
    title: "Vendor support workspace",
    body: "Raise a tracked support ticket from your dashboard or use the WhatsApp contact channel.",
    icon: "chat" as const,
  },
];

const SUPPORT_POINTS = [
  { title: "Dashboard support", body: "Raise a tracked ticket from the vendor support workspace.", icon: "ticket" as const },
  { title: "WhatsApp contact", body: "Use the configured QuickFurno WhatsApp channel when that is more convenient.", icon: "chat" as const },
  {
    title: "Conversation history",
    body: "Support threads and replies remain available in the dashboard.",
    icon: "save" as const,
  },
  {
    title: "Clear support entry point",
    body: "The vendor dashboard includes a dedicated Support destination.",
    icon: "shield" as const,
  },
];

const PROMISE_PRO = [
  ["Up to 3 active pros per enquiry", "Replacement rules can apply, but the active assignment cap stays bounded"],
  ["Category and geography matter", "Matching uses governed eligibility and ranking signals, not a proximity promise"],
  ["Reviews require a real match", "Only homeowners matched to you can submit a vendor review"],
  ["Free to apply", "Client Matching still requires approval, account eligibility and sufficient matching credits"],
];

const PROMISE_HOME = [
  ["Public profiles pass listing controls", "Pending, rejected, suspended or hidden vendors are not active public listings"],
  ["Up to 3 active assignments", "QuickFurno keeps the active vendor set bounded"],
  ["Contact sharing is governed", "Client details are shared only through the assignment and consent authorities"],
  ["Free to enquire", "There is no homeowner fee to submit an enquiry"],
];

const ZONES = [
  {
    name: "East Pune",
    areas: [
      "Kharadi",
      "Viman Nagar",
      "Kalyani Nagar",
      "Koregaon Park",
      "Mundhwa",
      "Keshav Nagar",
      "Wagholi",
      "Hadapsar",
      "Magarpatta",
      "Manjri",
      "Lohegaon",
      "Dhanori",
    ],
  },
  {
    name: "West Pune",
    areas: [
      "Baner",
      "Balewadi",
      "Aundh",
      "Pashan",
      "Sus",
      "Bavdhan",
      "Kothrud",
      "Karve Nagar",
      "Erandwane",
      "Warje",
      "Wakad",
      "Hinjewadi",
    ],
  },
  {
    name: "Central Pune",
    areas: ["Shivajinagar", "Deccan", "Model Colony", "Camp", "Swargate", "Yerawada", "Vishrantwadi"],
  },
  {
    name: "South Pune",
    areas: [
      "Kondhwa",
      "NIBM",
      "Undri",
      "Wanowrie",
      "Bibwewadi",
      "Katraj",
      "Sinhagad Road",
      "Dhayari",
      "Ambegaon",
    ],
  },
  {
    name: "Pimpri-Chinchwad",
    areas: [
      "Pimpri-Chinchwad",
      "Pimple Saudagar",
      "Pimple Nilakh",
      "Pimple Gurav",
      "Ravet",
      "Tathawade",
      "Punawale",
      "Nigdi",
      "Akurdi",
      "Moshi",
    ],
  },
];

const CITIES = [
  { name: "Pune", image: "/assets/quickfurno/images/launch/cities/pune.jpg", live: true },
];

const FAQ = [
  {
    q: "Is it free to apply?",
    a: "Yes. Applying is free. Approval does not by itself activate Client Matching: the account must also remain eligible, including having sufficient matching credits when an assignment is made.",
  },
  {
    q: "How many pros get the same enquiry?",
    a: "QuickFurno caps active assignments at 3 pros at a time. Replacement and recovery rules can apply, so this is an active-assignment cap rather than a promise that only three vendors can ever be considered.",
  },
  {
    q: "How do you decide who gets an enquiry?",
    a: "Category compatibility comes first. Authoritative geography or route signals, area affinity, assignment fairness, rating and deterministic tie-breakers can then affect order under the approved matching rules.",
  },
  {
    q: "I'm new, with no reviews. Can I still be matched?",
    a: "There is no review-count minimum. You still need an approved and active vendor account, the right category eligibility, acceptance of Client Matching, no assignment suspension and sufficient matching credits.",
  },
  {
    q: "Do you guarantee every enquiry is genuine?",
    a: "No marketplace can guarantee that. QuickFurno records structured requirement details and applies quality and consent controls; unclear or incomplete requests can be held instead of assigned.",
  },
  {
    q: "Can I choose where I work?",
    a: "Your profile records your base and covered areas. Geography is used as a ranking signal when authoritative data is available, but a listed area is not a guarantee of assignments.",
  },
  {
    q: "Do you guarantee a number of enquiries?",
    a: "No. Matches depend on homeowner demand, your category, marketplace eligibility, current credits and the approved matching order.",
  },
  {
    q: "What do I need to apply?",
    a: "Your business details, the trades you do, the areas you cover and the profile information requested during signup. QuickFurno reviews the submission before an account can become an active public vendor.",
  },
];

// --------------------------------------------------------------- icons ----

type IconName =
  | "home"
  | "search"
  | "pin"
  | "phone"
  | "shield"
  | "list"
  | "star"
  | "chat"
  | "clock"
  | "save"
  | "check"
  | "user"
  | "headset"
  | "ticket";

function Icon({ name, size = 22, color = "#F04A1A", width = 1.9 }: { name: IconName; size?: number; color?: string; width?: number }) {
  const paths: Record<IconName, JSX.Element> = {
    home: (
      <>
        <path d="M4 11.5 12 5l8 6.5" />
        <path d="M6.5 10.5V19h11v-8.5" />
        <path d="M10 19v-5h4v5" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="m16 16 4 4" />
      </>
    ),
    pin: (
      <>
        <path d="M12 21s6-5.3 6-10a6 6 0 0 0-12 0c0 4.7 6 10 6 10Z" />
        <circle cx="12" cy="11" r="2.2" />
      </>
    ),
    phone: (
      <path d="M5.5 3.5h3.2l1.8 4.6-2.3 1.4a11 11 0 0 0 6.3 6.3l1.4-2.3 4.6 1.8v3.2a2 2 0 0 1-2 2A16.5 16.5 0 0 1 3.5 5.5a2 2 0 0 1 2-2Z" />
    ),
    shield: (
      <>
        <path d="M12 3 19 6v5c0 4.4-2.8 7.7-7 10-4.2-2.3-7-5.6-7-10V6Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    list: (
      <>
        <path d="M9 6.5h11" />
        <path d="M9 12h11" />
        <path d="M9 17.5h11" />
        <circle cx="4.8" cy="6.5" r="1" />
        <circle cx="4.8" cy="12" r="1" />
        <circle cx="4.8" cy="17.5" r="1" />
      </>
    ),
    star: <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8Z" />,
    chat: (
      <>
        <path d="M20 11.5a8 8 0 0 1-11.7 7.1L4 19.8l1.2-4.1A8 8 0 1 1 20 11.5Z" />
        <path d="M8.5 10.5h7" />
        <path d="M8.5 13.5h4.5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
    save: (
      <>
        <path d="M5 4.5h11l3 3v12H5Z" />
        <path d="M8.5 4.5v4.5h6V4.5" />
        <path d="M8.5 19.5v-5h7v5" />
      </>
    ),
    check: <polyline points="5,12.5 10,17 19,7" />,
    user: (
      <>
        <circle cx="12" cy="8.5" r="3.8" />
        <path d="M4.5 20c.9-3.8 3.9-6 7.5-6s6.6 2.2 7.5 6" />
      </>
    ),
    headset: (
      <>
        <path d="M4.5 14.5V12a7.5 7.5 0 0 1 15 0v2.5" />
        <rect x="3.5" y="13.5" width="4" height="6" rx="1.6" />
        <rect x="16.5" y="13.5" width="4" height="6" rx="1.6" />
        <path d="M18.5 19.5c0 1.4-1.3 2-3 2h-2.5" />
      </>
    ),
    ticket: (
      <>
        <path d="M4 7.5h16v3a1.8 1.8 0 0 0 0 3.6v3.4H4v-3.4a1.8 1.8 0 0 0 0-3.6Z" />
        <path d="M14 7.5v10" strokeDasharray="1.6 2.2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Arrow({ color = "#FFFFFF" }: { color?: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function tradeHref(trade: string) {
  return `${SIGNUP_HREF}&trade=${categorySlug(trade)}`;
}

// ---------------------------------------------------------------- page ----

export default function VendorsPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <>
      <Header />
      <main className="qfv-page">
        {/* ============================ HERO ============================ */}
        <section className="qfv-hero qfv-section">
          <div className="qfv-hero-photo-wrap">
            <Image
              className="qfv-hero-photo"
              src="/assets/quickfurno/images/vendors/pros-hero.jpg"
              alt="A carpenter, an interior designer and a painter standing together in a finished Pune apartment"
              fill
              priority
              sizes="100vw"
            />
          </div>
          <div className="qfv-hero-veil" />
          <div className="qfv-shell qfv-hero-inner">
            <div className="qfv-hero-copy">
              <span className="qfv-hero-tag">
                <i className="qfv-dot" />
                Now onboarding pros across Pune
              </span>
              <h1>
                One enquiry.
                <br />
                Up to <span>3 pros.</span>
                <br />
                No crowd.
              </h1>
              <div className="qfv-slots">
                <span className="qfv-slots-label">ACTIVE ASSIGNMENT CAP</span>
                <div className="qfv-slots-row">
                  <span className="qfv-slot">
                    <Icon name="check" size={13} color="#5EBE8B" width={3} />
                    Assigned pro
                  </span>
                  <span className="qfv-slot">
                    <Icon name="check" size={13} color="#5EBE8B" width={3} />
                    Assigned pro
                  </span>
                  <span className="qfv-slot qfv-slot--open">+ Your spot</span>
                </div>
              </div>
              <p className="qfv-hero-body">
                Eligible enquiries can be assigned to up to 3 active pros at a time. Category fit comes first;
                geography and other approved ranking signals help order the eligible pool.
              </p>
              <div>
                <span className="qfv-trade-label">WHAT’S YOUR TRADE?</span>
                <div className="qfv-trades">
                  {TRADES.map((trade) => (
                    <Link key={trade} className="qfv-trade" href={tradeHref(trade)}>
                      {trade}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="qfv-hero-cta">
                <Link className="qfv-btn qfv-btn--primary" href={SIGNUP_HREF}>
                  Apply free <Arrow />
                </Link>
                <Link className="qfv-btn qfv-btn--ghost-light" href={LOGIN_HREF}>
                  Vendor login
                </Link>
                <span className="qfv-note qfv-note--light">
                  Free to apply, 6 short steps
                  <br />
                  Matching requires approval, eligibility and available credits
                </span>
              </div>
              <EnquiryModalTrigger
                className="qfv-hero-switch"
                modalTitle="Tell us what your home needs"
                source="Vendors page hero — homeowner switch"
              >
                <Icon name="home" size={16} color="#B9B1A3" width={2} />
                Looking to hire a pro instead? <strong>Get up to 3 matches</strong>
              </EnquiryModalTrigger>
            </div>
          </div>
        </section>

        {/* ==================== HOW MATCHING WORKS ==================== */}
        <section className="qfv-how qfv-section" id="how-matching-works">
          <div className="qfv-shell qfv-how-grid">
            <div>
              <div className="qfv-head">
                <span className="qfv-kicker">How matching works</span>
                <h2 className="qfv-h2">From a homeowner’s need to your phone</h2>
                <p className="qfv-lede">
                  Matching follows one governed order: eligibility and category fit first, then approved ranking signals such as geography and fairness.
                </p>
              </div>
              <ol className="qfv-steps">
                {STEPS.map((step) => (
                  <li key={step.no} className={`qfv-step${step.on ? " qfv-step--on" : ""}`}>
                    <span className="qfv-step-mark">
                      <Icon name={step.icon} size={23} color={step.on ? "#FFFFFF" : "#F04A1A"} />
                    </span>
                    <span>
                      <span className="qfv-step-no">{step.no}</span>
                      <h3>{step.title}</h3>
                      <p>{step.body}</p>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="qfv-note" style={{ marginTop: 22 }}>
                Matches depend on homeowner demand, account eligibility, available credits and the approved ranking order. No fixed volume is promised.
              </p>
            </div>

            {/* Illustrative geography example only; distance is a ranking signal, not an eligibility promise. */}
            <div className="qfv-map-wrap">
              <div className="qfv-map" role="img" aria-label="Illustrative map showing geography as one possible ranking signal for up to three eligible pros. Not live demand data.">
                <svg viewBox="0 0 500 470" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M-20 141 C 150 103, 300 188, 520 132" stroke="#E9DEC9" strokeWidth="14" fill="none" strokeLinecap="round" />
                  <path d="M110 -20 C 150 188, 90 329, 150 490" stroke="#E9DEC9" strokeWidth="10" fill="none" strokeLinecap="round" />
                  <path d="M360 -20 L 310 490" stroke="#EFE6D6" strokeWidth="9" fill="none" strokeLinecap="round" />
                  <path d="M-20 367 L 520 310" stroke="#EFE6D6" strokeWidth="8" fill="none" strokeLinecap="round" />
                  <circle cx="250" cy="235" r="160" fill="rgba(240,74,26,0.07)" stroke="#F04A1A" strokeWidth="1.6" strokeDasharray="6 6" />
                </svg>
                <span className="qfv-map-chip">
                  <i />
                  Illustrative geography example
                </span>
                <span className="qfv-map-home">
                  <Icon name="home" size={26} color="#FFFFFF" width={2.2} />
                </span>
                <span className="qfv-map-label qfv-map-label--dark" style={{ left: "33%", top: "57%", width: 170 }}>
                  <strong>Homeowner in Baner</strong>
                  <span>Needs a modular kitchen</span>
                </span>
                <span className="qfv-map-pin" style={{ left: "27%", top: "29%" }}>
                  <Icon name="check" size={17} color="#FFFFFF" width={3} />
                </span>
                <span className="qfv-map-label" style={{ left: "35%", top: "28%" }}>
                  <strong>Example pro</strong>
                  <span>2.1 km away</span>
                </span>
                <span className="qfv-map-pin" style={{ left: "69%", top: "37%" }}>
                  <Icon name="check" size={17} color="#FFFFFF" width={3} />
                </span>
                <span className="qfv-map-label" style={{ left: "77%", top: "36%" }}>
                  <strong>Example pro</strong>
                  <span>3.4 km away</span>
                </span>
                <span className="qfv-map-pin" style={{ left: "52%", top: "70%" }}>
                  <Icon name="check" size={17} color="#FFFFFF" width={3} />
                </span>
                <span className="qfv-map-label" style={{ left: "60%", top: "69%" }}>
                  <strong>Example pro</strong>
                  <span>4.0 km away</span>
                </span>
                <span className="qfv-tag-example qfv-map-example">EXAMPLE</span>
              </div>

              <div className="qfv-checked">
                <span className="qfv-checked-head">
                  EXAMPLE QUALITY CHECK
                  <span className="qfv-tag-example">EXAMPLE</span>
                </span>
                <ul>
                  {["Service captured", "Locality captured", "Project details reviewed", "Consent path checked before contact sharing"].map((line) => (
                    <li key={line}>
                      <span className="qfv-tick">
                        <Icon name="check" size={12} color="#1F9D5B" width={3} />
                      </span>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ===================== ALWAYS ON / NO AGENCY ===================== */}
        <section className="qfv-night-sec qfv-section">
          <div className="qfv-deco">
            <div className="qfv-glow" style={{ right: "-140px", top: "-140px", width: 560, height: 440, background: "radial-gradient(closest-side, rgba(255,177,61,0.13), rgba(255,177,61,0) 72%)" }} />
          </div>
          <div className="qfv-shell qfv-night-grid">
            <div>
              <div className="qfv-head">
                <span className="qfv-kicker qfv-kicker--amber">Always-available dashboard</span>
                <h2 className="qfv-h2">
                  Your dashboard is available
                  <br />
                  whenever you need it.
                </h2>
                <p className="qfv-lede">
                  Client Matching keeps assignments, requirement details and support access in one place. Automation
                  remains subject to QuickFurno&apos;s live launch controls and eligibility rules.
                </p>
              </div>
              <ul className="qfv-fixes">
                {FIXES.map((row) => (
                  <li key={row.fix} className="qfv-fix">
                    <span className="qfv-fix-mark">
                      <Icon name="check" size={17} color="#FFB13D" width={3} />
                    </span>
                    <span>
                      <b>{row.fix}</b>
                      <s>{row.pain}</s>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="qfv-nightcard">
              <div className="qfv-nightcard-head">
                <span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FFB13D" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />
                  </svg>
                  ILLUSTRATIVE DASHBOARD ACTIVITY
                </span>
                <span className="qfv-tag-example--dark">EXAMPLE</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {NIGHT_ROWS.map((row) => (
                  <div className="qfv-nightrow" key={row.title}>
                    <time>{row.time}</time>
                    <span style={{ flexGrow: 1, minWidth: 0 }}>
                      <b>{row.title}</b>
                      <span>{row.meta}</span>
                    </span>
                    <span className="qfv-pill-ok">CHECKED</span>
                  </div>
                ))}
              </div>
              <footer>Illustrative examples only. These rows are not live demand data.</footer>
            </div>
          </div>
        </section>

        {/* ======================== COMPARISON ======================== */}
        <section className="qfv-compare qfv-section" id="why-quickfurno">
          <div className="qfv-deco">
            <div className="qfv-glow" style={{ right: "-180px", top: "-200px", width: 660, height: 660, background: "radial-gradient(closest-side, rgba(240,74,26,0.14), rgba(240,74,26,0) 72%)" }} />
            <div className="qfv-glow" style={{ left: "-220px", bottom: "-240px", width: 620, height: 620, background: "radial-gradient(closest-side, rgba(255,177,61,0.2), rgba(255,177,61,0) 70%)" }} />
          </div>
          <div className="qfv-shell">
            <div className="qfv-compare-head">
              <div className="qfv-head">
                <span className="qfv-kicker">Why QuickFurno is different</span>
                <h2 className="qfv-h2">Everything that wastes a pro’s time, fixed.</h2>
              </div>
              <p className="qfv-lede" style={{ maxWidth: 400 }}>
                The page describes the same eligibility, assignment and review controls enforced by the marketplace.
              </p>
            </div>
            <div className="qfv-compare-card">
              <div className="qfv-compare-row qfv-compare-row--head">
                <span>QuickFurno rule</span>
                <span>What it means</span>
              </div>
              {COMPARE.map(([old, now]) => (
                <div className="qfv-compare-row" key={now}>
                  <span className="qfv-compare-old">
                    <span className="qfv-x">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#A39C90" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
                        <path d="M7 7l10 10M17 7 7 17" />
                      </svg>
                    </span>
                    <s>{old}</s>
                  </span>
                  <span className="qfv-compare-new">
                    <span className="qfv-tick">
                      <Icon name="check" size={12} color="#1F9D5B" width={3} />
                    </span>
                    {now}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ======================== WHAT YOU GET ======================== */}
        <section className="qfv-get qfv-section">
          <div className="qfv-shell qfv-get-grid">
            <div>
              <div className="qfv-head">
                <span className="qfv-kicker qfv-kicker--amber">What you get</span>
                <h2 className="qfv-h2">Everything you need to win the job.</h2>
              </div>
              <ul className="qfv-gets">
                {GETS.map((item) => (
                  <li className="qfv-get-item" key={item.title}>
                    <span className="qfv-get-mark">
                      <Icon name={item.icon} size={21} color="#FFB13D" />
                    </span>
                    <span>
                      <b>{item.title}</b>
                      <span>{item.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Illustrative product preview; deliberately not live demand data. */}
            <div className="qfv-browser" role="img" aria-label="Illustrative Client Matching product preview. Not live demand data.">
              <div className="qfv-browser-bar">
                <i />
                <i />
                <i />
                <span>quickfurno.in/vendor/dashboard</span>
              </div>
              <div className="qfv-dash">
                <div className="qfv-dash-side">
                  <span className="qfv-dash-logo">
                    Quick<i>Furno</i>
                  </span>
                  <span className="qfv-dash-nav">
                    <Icon name="list" size={16} color="#8A847A" width={1.9} />
                    Overview
                  </span>
                  <span className="qfv-dash-nav qfv-dash-nav--on">
                    <Icon name="list" size={16} color="#C93A0E" width={1.9} />
                    Client Matching
                  </span>
                  <span className="qfv-dash-nav">
                    <Icon name="user" size={16} color="#8A847A" width={1.9} />
                    My Profile
                  </span>
                  <span className="qfv-dash-nav">
                    <Icon name="star" size={16} color="#8A847A" width={1.9} />
                    Reviews
                  </span>
                  <span className="qfv-dash-nav">
                    <Icon name="headset" size={16} color="#8A847A" width={1.9} />
                    Support
                    <i />
                  </span>
                  <span className="qfv-dash-vendor">
                    <span className="qfv-avatar">KI</span>
                    <span>
                      <b>Kulkarni Interiors</b>
                      <span>
                        <Icon name="shield" size={12} color="#1F7A45" width={2.4} />
                        Approved vendor
                      </span>
                    </span>
                  </span>
                </div>
                <div className="qfv-dash-main">
                  <div className="qfv-dash-head">
                    <span>
                      <small>Kulkarni Interiors · Interior Designers, Carpenters · Baner</small>
                      <h3>Client Matching</h3>
                    </span>
                    <span className="qfv-tag-example">ILLUSTRATIVE EXAMPLE</span>
                  </div>
                  <div className="qfv-dash-stats">
                    <div className="qfv-dash-stat">
                      <small>New matches</small>
                      <b>2</b>
                    </div>
                    <div className="qfv-dash-stat">
                      <small>Base area</small>
                      <b style={{ fontSize: 16 }}>Baner</b>
                    </div>
                    <div className="qfv-dash-stat">
                      <small>Profile</small>
                      <em>
                        <Icon name="shield" size={15} color="#1F7A45" width={2.2} />
                        Approved
                      </em>
                    </div>
                  </div>
                  <div className="qfv-dash-leads">
                    {[
                      { t: "Modular kitchen", m: "Baner, Pune · 2.1 km · 2 BHK · Within 1 month", s: "NEW" },
                      { t: "Full home interior", m: "Kharadi, Pune · 3.8 km · 3 BHK · 1–2 months", s: "NEW" },
                      { t: "False ceiling", m: "Viman Nagar, Pune · 4.5 km · Living room", s: "CONTACTED" },
                    ].map((lead) => (
                      <div className="qfv-dash-lead" key={lead.t}>
                        <span className="qfv-dash-lead-mark">
                          <Icon name="home" size={18} color="#8A847A" width={1.8} />
                        </span>
                        <span style={{ flexGrow: 1, minWidth: 0 }}>
                          <b>{lead.t}</b>
                          <span>{lead.m}</span>
                        </span>
                        <span className={lead.s === "NEW" ? "qfv-pill-new" : "qfv-pill-done"}>{lead.s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ========================= VENDOR SUPPORT ========================= */}
        <section className="qfv-support qfv-section" id="support">
          <div className="qfv-deco">
            <div className="qfv-glow" style={{ right: "-160px", top: "-220px", width: 760, height: 760, background: "radial-gradient(closest-side, rgba(255,177,61,0.3), rgba(240,74,26,0) 74%)" }} />
            <div className="qfv-glow" style={{ right: "180px", bottom: "-280px", width: 720, height: 720, background: "radial-gradient(closest-side, rgba(240,74,26,0.2), rgba(240,74,26,0) 74%)" }} />
            <div className="qfv-support-veil" />
            <div className="qfv-skyline qfv-skyline--back" />
            <div className="qfv-skyline" />
          </div>
          <div className="qfv-shell qfv-support-grid">
            <div className="qfv-support-copy">
              <span className="qfv-kicker">Vendor support</span>
              <h2>
                Need help?
                <br />
                <span>Use your support workspace.</span>
              </h2>
              <p className="qfv-lede" style={{ color: "#5E5950" }}>
                Profile question or matching issue? Raise a tracked dashboard ticket or use the configured WhatsApp
                contact channel. No round-the-clock human response-time guarantee is claimed.
              </p>
              <ul className="qfv-support-points">
                {SUPPORT_POINTS.map((point) => (
                  <li className="qfv-support-point" key={point.title}>
                    <span className="qfv-support-mark">
                      <Icon name={point.icon} size={21} />
                    </span>
                    <span>
                      <b>{point.title}</b>
                      <span>{point.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="qfv-support-band">
                <strong>HELP</strong>
                <i />
                <span>Tracked support for vendors through the dashboard workspace.</span>
              </div>
            </div>

            <div className="qfv-support-visual">
              <div>
                <div className="qfv-phone">
                  <div className="qfv-phone-screen">
                    <div className="qfv-phone-bar">
                      <span>
                        Quick<i>Furno</i>
                      </span>
                      <span className="qfv-help-pill">
                        <Icon name="headset" size={14} color="#FFFFFF" width={2.1} />
                        Help
                      </span>
                    </div>
                    <div className="qfv-phone-body">
                      <span>
                        <small>Welcome back</small>
                        <h4>Kulkarni Interiors</h4>
                      </span>
                      <div className="qfv-phone-cards">
                        <div>
                          <small>New matches</small>
                          <b>2</b>
                        </div>
                        <div>
                          <small>Profile</small>
                          <em>Approved</em>
                        </div>
                      </div>
                      <div style={{ background: "#fff", border: "1px solid #EFE8DC", borderRadius: 12, padding: "11px 12px" }}>
                        <b style={{ fontSize: 13, fontWeight: 800 }}>Modular kitchen</b>
                        <div style={{ fontSize: 11, color: "#7A756C" }}>Baner · 2.1 km · 2 BHK</div>
                      </div>
                    </div>
                    <div className="qfv-phone-dim" />
                    <div className="qfv-sheet">
                      <span className="qfv-sheet-grip" />
                      <span>
                        <h5>How can we help?</h5>
                        <span className="qfv-sheet-live">
                          <i className="qfv-dot" style={{ width: 7, height: 7 }} />
                          Support workspace
                        </span>
                      </span>
                      <span className="qfv-sheet-opt">
                        <span className="qfv-sheet-opt-mark">
                          <Icon name="chat" size={17} width={2} />
                        </span>
                        <span style={{ flexGrow: 1 }}>
                          <b>WhatsApp us</b>
                          <span>Photos and voice notes</span>
                        </span>
                      </span>
                      <span className="qfv-sheet-opt">
                        <span className="qfv-sheet-opt-mark">
                          <Icon name="ticket" size={17} width={2} />
                        </span>
                        <span style={{ flexGrow: 1 }}>
                          <b>Raise a ticket</b>
                          <span>Tracked in your dashboard</span>
                        </span>
                      </span>
                    </div>
                    <div className="qfv-phone-nav">
                      <span>
                        <Icon name="home" size={19} color="#8A847A" />
                        Home
                      </span>
                      <span>
                        <Icon name="list" size={19} color="#8A847A" />
                        Matching
                      </span>
                      <span>
                        <Icon name="user" size={19} color="#8A847A" />
                        Profile
                      </span>
                      <span className="qfv-on">
                        <Icon name="headset" size={19} color="#F04A1A" />
                        Help
                      </span>
                    </div>
                  </div>
                </div>
                <p className="qfv-phone-caption">EXAMPLE SCREEN</p>
              </div>
              <div className="qfv-support-person">
                <Image
                  src="/assets/quickfurno/images/vendors/support-person.png"
                  alt=""
                  width={311}
                  height={1100}
                  sizes="(max-width: 979px) 120px, 180px"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ========================== MID CTA ========================== */}
        <section className="qfv-midcta qfv-section">
          <div className="qfv-shell qfv-midcta-inner">
            <div>
              <h2>Ready to apply?</h2>
              <p>
                Applying is free. QuickFurno reviews your business submission before an approved profile can become public.
              </p>
            </div>
            <div className="qfv-midcta-act">
              <Link className="qfv-btn qfv-btn--primary" href={SIGNUP_HREF}>
                Apply free <Arrow />
              </Link>
              <span className="qfv-note">Free · 6 short steps</span>
            </div>
          </div>
        </section>

        {/* ========================== PROMISE ========================== */}
        <section className="qfv-promise qfv-section" id="our-promise">
          <div className="qfv-deco">
            <div className="qfv-glow" style={{ left: "-180px", top: "-140px", width: 520, height: 520, background: "radial-gradient(closest-side, rgba(255,177,61,0.16), rgba(255,177,61,0) 72%)" }} />
            <div className="qfv-glow" style={{ right: "-160px", bottom: "-180px", width: 540, height: 540, background: "radial-gradient(closest-side, rgba(240,74,26,0.11), rgba(240,74,26,0) 72%)" }} />
          </div>
          <div className="qfv-shell">
            <div className="qfv-compare-head">
              <div className="qfv-head">
                <span className="qfv-kicker">Our promise</span>
                <h2 className="qfv-h2">Fair to pros. Fair to homeowners.</h2>
              </div>
              <p className="qfv-lede" style={{ maxWidth: 400 }}>
                The same rules protect both sides, which is why homeowners trust the pros they’re matched with.
              </p>
            </div>
            <div className="qfv-promise-cards">
              <div className="qfv-promise-card">
                <header>
                  <span className="qfv-promise-mark qfv-promise-mark--pro">
                    <Icon name="user" size={20} color="#FFFFFF" />
                  </span>
                  <div>
                    <b>To professionals</b>
                    <span>What you can count on</span>
                  </div>
                </header>
                <ul>
                  {PROMISE_PRO.map(([title, body]) => (
                    <li key={title}>
                      <span className="qfv-tick">
                        <Icon name="check" size={12} color="#1F9D5B" width={3} />
                      </span>
                      <span>
                        <b>{title}</b>
                        <span>{body}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="qfv-promise-card">
                <header>
                  <span className="qfv-promise-mark qfv-promise-mark--home">
                    <Icon name="home" size={20} color="#FFFFFF" />
                  </span>
                  <div>
                    <b>To homeowners</b>
                    <span>What every homeowner gets</span>
                  </div>
                </header>
                <ul>
                  {PROMISE_HOME.map(([title, body]) => (
                    <li key={title}>
                      <span className="qfv-tick">
                        <Icon name="check" size={12} color="#1F9D5B" width={3} />
                      </span>
                      <span>
                        <b>{title}</b>
                        <span>{body}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* =========================== AREAS =========================== */}
        <section className="qfv-areas qfv-section">
          <div className="qfv-deco">
            <div className="qfv-glow" style={{ right: "-200px", top: "-200px", width: 620, height: 620, background: "radial-gradient(closest-side, rgba(240,74,26,0.12), rgba(240,74,26,0) 72%)" }} />
            <div className="qfv-glow" style={{ left: "-220px", bottom: "-240px", width: 640, height: 640, background: "radial-gradient(closest-side, rgba(255,177,61,0.15), rgba(255,177,61,0) 72%)" }} />
          </div>
          <div className="qfv-shell">
            <div className="qfv-areas-head">
              <div className="qfv-head">
                <span className="qfv-kicker">Where we match</span>
                <h2 className="qfv-h2">Serving the Pune marketplace.</h2>
              </div>
              <p className="qfv-lede" style={{ maxWidth: 400 }}>
                Set your base and covered areas when you apply. Geography can influence ranking when authoritative
                data is available; it does not create a guaranteed radius or assignment.
              </p>
            </div>
            <div className="qfv-zones">
              {ZONES.map((zone) => (
                <div className="qfv-zone" key={zone.name}>
                  <header>
                    <h3>{zone.name}</h3>
                    <small>{zone.areas.length} localities</small>
                  </header>
                  <ul>
                    {zone.areas.map((area) => (
                      <li key={area}>{area}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="qfv-areas-note">
              <Icon name="pin" size={16} width={2} />
              Pune coverage is recorded on vendor profiles and used by the governed matching system.
            </p>
          </div>
        </section>

        {/* =========================== CITIES =========================== */}
        <section className="qfv-cities qfv-section">
          <div className="qfv-shell">
            <div className="qfv-cities-head">
              <span className="qfv-kicker" style={{ color: "#FF8A5C" }}>
                Our journey
              </span>
              <h2 className="qfv-h2">Made in Pune. Focused on Pune.</h2>
              <p>
                QuickFurno is launching as a Pune-only marketplace so supply, matching and support can stay focused.
              </p>
            </div>
            <div className="qfv-city-grid">
              {CITIES.map((city) => (
                <div className="qfv-city" key={city.name}>
                  <span className="qfv-city-photo">
                    <Image src={city.image} alt={city.name} width={104} height={104} sizes="104px" />
                  </span>
                  <b>{city.name}</b>
                  <span className="qfv-city-live">
                    <i className="qfv-dot" style={{ width: 7, height: 7 }} />
                    Live now
                  </span>
                </div>
              ))}
            </div>
          </div>
          <Image
            className="qfv-cities-art"
            src="/assets/quickfurno/images/launch/india-skyline.png"
            alt=""
            width={1100}
            height={208}
            sizes="(max-width: 1100px) 100vw, 1100px"
          />
        </section>

        {/* ============================ FAQ ============================ */}
        <section className="qfv-faq qfv-section" id="faq">
          <div className="qfv-deco">
            <div className="qfv-glow" style={{ left: "-160px", top: "-180px", width: 560, height: 560, background: "radial-gradient(closest-side, rgba(255,177,61,0.16), rgba(255,177,61,0) 72%)" }} />
          </div>
          <div className="qfv-shell qfv-faq-grid">
            <div className="qfv-faq-side">
              <span className="qfv-kicker">Questions</span>
              <h2 className="qfv-h2">What pros ask before they apply</h2>
              <p>Something else? Use the configured QuickFurno WhatsApp contact channel.</p>
              <a
                className="qfv-btn qfv-btn--ghost"
                href={whatsappLink(
                  "Hi QuickFurno, I run a home-services business in Pune and I have a question about applying to QuickFurno.",
                )}
                target="_blank"
                rel="noopener noreferrer"
                style={{ alignSelf: "flex-start" }}
              >
                Talk to our team
              </a>
            </div>
            <div className="qfv-faq-list">
              {FAQ.map((item, index) => (
                <details className="qfv-faq-item" key={item.q} open={index === 0}>
                  <summary>
                    {item.q}
                    <span className="qfv-faq-sign" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ========================= FINAL CTA ========================= */}
        <section className="qfv-final qfv-section">
          <div className="qfv-shell">
            <div className="qfv-final-card">
              <div className="qfv-final-copy">
                <h2>Apply to join QuickFurno.</h2>
                <p>
                  Applying is free. Active Client Matching starts only when your vendor account is approved and
                  remains eligible, including having sufficient matching credits.
                </p>
                <div className="qfv-final-trades">
                  {TRADES.map((trade) => (
                    <Link key={trade} href={tradeHref(trade)}>
                      {trade}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="qfv-final-act">
                <Link className="qfv-btn qfv-btn--primary" href={SIGNUP_HREF}>
                  Apply free <Arrow />
                </Link>
                <Link className="qfv-btn qfv-btn--ghost-light" href={LOGIN_HREF}>
                  Vendor login
                </Link>
                <span className="qfv-note">Free · 6 short steps</span>
              </div>
            </div>
          </div>
        </section>

        {/* ==================== HOMEOWNER SWITCH ==================== */}
        <section className="qfv-switch qfv-section">
          <div className="qfv-shell">
            <div className="qfv-switch-card">
              <span className="qfv-switch-mark">
                <Icon name="home" size={20} color="#FFFFFF" />
              </span>
              <div>
                <b>Here to hire, not to apply?</b>
                <span>Tell us what your home needs. QuickFurno can connect you with up to 3 relevant eligible pros. It is free to enquire.</span>
              </div>
              <EnquiryModalTrigger
                className="qfv-btn qfv-btn--primary"
                modalTitle="Tell us what your home needs"
                source="Vendors page — homeowner strip"
              >
                Get matched <Arrow />
              </EnquiryModalTrigger>
            </div>
          </div>
        </section>

        {/* ============ sticky apply bar, phones only ============ */}
        <div className="qfv-sticky">
          <Link className="qfv-btn qfv-btn--primary" href={SIGNUP_HREF}>
            Apply free <Arrow />
          </Link>
          <Link className="qfv-btn qfv-btn--ghost" href={LOGIN_HREF}>
            Log in
          </Link>
        </div>
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
    </>
  );
}
