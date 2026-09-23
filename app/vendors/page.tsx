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
  title: "Only 3 pros per enquiry | Join QuickFurno in Pune",
  description:
    "Every Pune homeowner enquiry goes to at most 3 verified pros nearby, in the right trade. Free to apply, verified by our Pune team, 24×7 support from your dashboard.",
  alternates: { canonical: "https://quickfurno.in/vendors" },
  openGraph: {
    title: "Only 3 pros per enquiry | Join QuickFurno in Pune",
    description:
      "Checked enquiries from homeowners near your base, shared with at most 3 verified pros. Free to apply.",
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
    title: "Homeowner shares the job",
    body: "Service, locality, budget and timeline, in about a minute.",
    icon: "home" as const,
  },
  {
    no: "STEP 2",
    title: "We check the details",
    body: "Missing or unclear details? We ask the homeowner before anyone is matched.",
    icon: "search" as const,
  },
  {
    no: "STEP 3",
    title: "3 nearby verified pros",
    body: "Right trade first, then the pros closest to the homeowner.",
    icon: "pin" as const,
    on: true,
  },
  {
    no: "STEP 4",
    title: "You call and quote",
    body: "The enquiry reaches your dashboard with the homeowner’s details. You take it from there.",
    icon: "phone" as const,
  },
];

const FIXES = [
  { fix: "We bring the homeowner to you", pain: "Pay a marketing agency every month" },
  { fix: "No ad account, no budget to watch", pain: "Run your own ads and hope they work" },
  { fix: "Enquiries wait in your dashboard, checked", pain: "Miss calls while you are on a site" },
  { fix: "Trade and distance first, then who has waited longest", pain: "Big names take every job" },
];

const NIGHT_ROWS = [
  { time: "11:47 PM", title: "Modular kitchen", meta: "Baner · 2 BHK · Within 1 month" },
  { time: "6:20 AM", title: "False ceiling", meta: "Wakad · Living room" },
  { time: "SUN 9:15 PM", title: "Full home painting", meta: "Kharadi · 3 BHK" },
];

const COMPARE = [
  ["Your enquiry goes to a long list of pros", "At most 3 pros at a time"],
  ["Vague details, fake numbers", "Checked for budget, timeline and locality"],
  ["Jobs from across the city", "Matched close to your base"],
  ["Calling people who never asked", "Homeowners who agreed to hear from you"],
  ["Anyone can post a review", "Reviews only from homeowners matched with you"],
  ["Unverified listings everywhere", "Verified pros only"],
];

const GETS = [
  {
    title: "Verified profile page",
    body: "A public page with your services, areas, work photos and the verified badge.",
    icon: "shield" as const,
  },
  {
    title: "Client Matching dashboard",
    body: "Every match with what the homeowner needs, where, and when they want to start.",
    icon: "list" as const,
  },
  {
    title: "Verified reviews",
    body: "Only homeowners matched with you can review you. No fake reviews from strangers.",
    icon: "star" as const,
  },
  {
    title: "24×7 support",
    body: "WhatsApp us or raise a ticket any time, right from your dashboard.",
    icon: "chat" as const,
  },
];

const SUPPORT_POINTS = [
  { title: "Any hour, every day", body: "Day or night, weekends and holidays included.", icon: "clock" as const },
  { title: "WhatsApp or a ticket", body: "Pick whatever is quickest for you at that moment.", icon: "chat" as const },
  {
    title: "Every reply saved",
    body: "Your support conversations stay in your dashboard, so nothing gets lost.",
    icon: "save" as const,
  },
  {
    title: "One tap from any screen",
    body: "Help sits at the top of every dashboard screen, and in the bottom menu.",
    icon: "shield" as const,
  },
];

const PROMISE_PRO = [
  ["At most 3 pros per enquiry", "Never a broadcast to everyone in town"],
  ["Only your trade, near your base", "No enquiries for work you don’t do"],
  ["Reviews from real clients only", "Only homeowners matched with you can review you"],
  ["Free to apply", "Verified by our team in Pune"],
];

const PROMISE_HOME = [
  ["Every pro is verified first", "Pending or rejected profiles never appear"],
  ["Up to 3 matches, not a crowd", "Only the most relevant pros near you"],
  ["Your details stay private", "Shared only with the pros matched to you"],
  ["Free to enquire", "No fee to enquire or compare"],
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
  { name: "Delhi NCR", image: "/assets/quickfurno/images/launch/cities/delhi-ncr.jpg" },
  { name: "Mumbai", image: "/assets/quickfurno/images/launch/cities/mumbai.jpg" },
  { name: "Hyderabad", image: "/assets/quickfurno/images/launch/cities/hyderabad.jpg" },
  { name: "Kolkata", image: "/assets/quickfurno/images/launch/cities/kolkata.jpg" },
  { name: "Bengaluru", image: "/assets/quickfurno/images/launch/cities/bengaluru.jpg" },
];

const FAQ = [
  {
    q: "Is it free to apply?",
    a: "Yes. Applying and verification are free. Our team talks you through how the partnership works once your business is approved.",
  },
  {
    q: "How many pros get the same enquiry?",
    a: "At most 3 at a time. If one of them steps away, that spot can go to another pro, but an enquiry is never broadcast to a long list.",
  },
  {
    q: "How do you decide who gets an enquiry?",
    a: "Trade first, then how close you are to the homeowner, then who has waited longest since their last match. Ratings only break a tie.",
  },
  {
    q: "I’m new, with no reviews. Will I still be matched?",
    a: "Yes. Reviews don’t decide who gets matched. A verified profile in the right trade, near the homeowner, is what counts — and pros who haven’t been matched recently come first.",
  },
  {
    q: "Are the enquiries genuine?",
    a: "Every enquiry is checked for real details — service, locality, budget and timeline — and the homeowner agrees to be contacted before any pro sees it.",
  },
  {
    q: "Can I choose where I work?",
    a: "Yes. Set your base area when you apply and we match homeowners around it, or choose to cover all of Pune.",
  },
  {
    q: "Do you guarantee a number of enquiries?",
    a: "No. Matches depend on what homeowners near you ask for, so we never promise a fixed number.",
  },
  {
    q: "What do I need to apply?",
    a: "Your business details, the trades you do, the areas you cover and a few photos of your work. Our Pune team tells you if anything else is needed to finish verification.",
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
                Only <span>3 pros.</span>
                <br />
                No crowd.
              </h1>
              <div className="qfv-slots">
                <span className="qfv-slots-label">EACH ENQUIRY</span>
                <div className="qfv-slots-row">
                  <span className="qfv-slot">
                    <Icon name="check" size={13} color="#5EBE8B" width={3} />
                    Verified pro
                  </span>
                  <span className="qfv-slot">
                    <Icon name="check" size={13} color="#5EBE8B" width={3} />
                    Verified pro
                  </span>
                  <span className="qfv-slot qfv-slot--open">+ Your spot</span>
                </div>
              </div>
              <p className="qfv-hero-body">
                Each enquiry goes to at most 3 verified pros in the right trade, close to the homeowner. It’s checked
                for real details, and the homeowner has agreed to hear from you.
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
                  Free · 6 short steps
                  <br />
                  Verified by our Pune team
                </span>
              </div>
              <EnquiryModalTrigger
                className="qfv-hero-switch"
                modalTitle="Tell us what your home needs"
                source="Vendors page hero — homeowner switch"
              >
                <Icon name="home" size={16} color="#B9B1A3" width={2} />
                Looking to hire a pro instead? <strong>Get matched with 3 near you →</strong>
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
                  The same simple rules for every enquiry. No bidding, no auctions. Just the right trade, close by.
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
                Matches depend on what homeowners near you ask for. We don’t promise a fixed number.
              </p>
            </div>

            {/* map: an example of one enquiry finding the nearest verified pros */}
            <div className="qfv-map-wrap">
              <div className="qfv-map" role="img" aria-label="Example map: a homeowner in Baner and the three nearest verified pros, 2.1 km, 3.4 km and 4.0 km away">
                <svg viewBox="0 0 500 470" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M-20 141 C 150 103, 300 188, 520 132" stroke="#E9DEC9" strokeWidth="14" fill="none" strokeLinecap="round" />
                  <path d="M110 -20 C 150 188, 90 329, 150 490" stroke="#E9DEC9" strokeWidth="10" fill="none" strokeLinecap="round" />
                  <path d="M360 -20 L 310 490" stroke="#EFE6D6" strokeWidth="9" fill="none" strokeLinecap="round" />
                  <path d="M-20 367 L 520 310" stroke="#EFE6D6" strokeWidth="8" fill="none" strokeLinecap="round" />
                  <circle cx="250" cy="235" r="160" fill="rgba(240,74,26,0.07)" stroke="#F04A1A" strokeWidth="1.6" strokeDasharray="6 6" />
                </svg>
                <span className="qfv-map-chip">
                  <i />
                  Up to 3 verified pros nearby
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
                  <strong>Verified pro</strong>
                  <span>2.1 km away</span>
                </span>
                <span className="qfv-map-pin" style={{ left: "69%", top: "37%" }}>
                  <Icon name="check" size={17} color="#FFFFFF" width={3} />
                </span>
                <span className="qfv-map-label" style={{ left: "77%", top: "36%" }}>
                  <strong>Verified pro</strong>
                  <span>3.4 km away</span>
                </span>
                <span className="qfv-map-pin" style={{ left: "52%", top: "70%" }}>
                  <Icon name="check" size={17} color="#FFFFFF" width={3} />
                </span>
                <span className="qfv-map-label" style={{ left: "60%", top: "69%" }}>
                  <strong>Verified pro</strong>
                  <span>4.0 km away</span>
                </span>
                <span className="qfv-tag-example qfv-map-example">EXAMPLE</span>
              </div>

              <div className="qfv-checked">
                <span className="qfv-checked-head">
                  ENQUIRY CHECKED
                  <span className="qfv-tag-example">EXAMPLE</span>
                </span>
                <ul>
                  {["Budget looks realistic", "Timeline shared", "Locality confirmed", "Agreed to be contacted"].map((line) => (
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
                <span className="qfv-kicker qfv-kicker--amber">No agency. No ads.</span>
                <h2 className="qfv-h2">
                  We’re live 24×7,
                  <br />
                  so you don’t have to be.
                </h2>
                <p className="qfv-lede">
                  Homeowners look for pros late at night, on Sundays, from the office. QuickFurno takes the enquiry,
                  checks the details and lines up the match while you are on a site, with a client, or asleep.
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
                  WHILE YOU WERE OFF THE CLOCK
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
              <footer>Checked through the night and waiting in your dashboard when you opened it.</footer>
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
                Built around one idea: fewer, better-matched enquiries beat a long list of strangers.
              </p>
            </div>
            <div className="qfv-compare-card">
              <div className="qfv-compare-row qfv-compare-row--head">
                <span>Typical enquiry sites</span>
                <span>QuickFurno</span>
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

            {/* dashboard, with example data */}
            <div className="qfv-browser">
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
                    24×7 Support
                    <i />
                  </span>
                  <span className="qfv-dash-vendor">
                    <span className="qfv-avatar">KI</span>
                    <span>
                      <b>Kulkarni Interiors</b>
                      <span>
                        <Icon name="shield" size={12} color="#1F7A45" width={2.4} />
                        Verified vendor
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
                    <span className="qfv-tag-example">EXAMPLE DATA</span>
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
                        Verified
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

        {/* ========================= 24×7 SUPPORT ========================= */}
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
              <span className="qfv-kicker">24×7 support</span>
              <h2>
                Stuck at 11 pm?
                <br />
                <span>We’re still here.</span>
              </h2>
              <p className="qfv-lede" style={{ color: "#5E5950" }}>
                Profile stuck in review? A question about a match? Reach the QuickFurno team any hour, any day,
                straight from your dashboard.
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
                <strong>24×7</strong>
                <i />
                <span>Support for every verified pro, from the day you join.</span>
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
                        24×7 Help
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
                          <em>Verified</em>
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
                          Our team is available 24×7
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
                  alt="A QuickFurno support team member"
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
              <h2>Ready to be one of the 3?</h2>
              <p>
                Applying is free. Our Pune team verifies your business before any homeowner sees your profile.
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
                <h2 className="qfv-h2">Homeowners across Pune, matched near you.</h2>
              </div>
              <p className="qfv-lede" style={{ maxWidth: 400 }}>
                Set your base area when you apply. We match you with homeowners around it, or you can choose to cover
                all of Pune.
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
              Locality not listed? We match homeowners across all of Pune.
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
              <h2 className="qfv-h2">Made in Pune. Coming to your city next.</h2>
              <p>
                We are building QuickFurno where we live — then bringing verified home professionals to more of India.
              </p>
            </div>
            <div className="qfv-city-grid">
              {CITIES.map((city) => (
                <div className="qfv-city" key={city.name}>
                  <span className="qfv-city-photo">
                    <Image src={city.image} alt={city.name} width={104} height={104} sizes="104px" />
                  </span>
                  <b>{city.name}</b>
                  {city.live ? (
                    <span className="qfv-city-live">
                      <i className="qfv-dot" style={{ width: 7, height: 7 }} />
                      Live now
                    </span>
                  ) : (
                    <span className="qfv-city-soon">Coming soon</span>
                  )}
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
              <p>Something else? Our Pune team answers on WhatsApp and email.</p>
              <a
                className="qfv-btn qfv-btn--ghost"
                href={whatsappLink(
                  "Hi QuickFurno, I run a home-services business in Pune and I have a question about applying as a verified pro.",
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
                <h2>Be one of the 3.</h2>
                <p>
                  When a homeowner near you needs your trade, they hear from at most 3 verified pros. Make sure you’re
                  one of them.
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
                <span>Tell us what your home needs. We’ll match you with up to 3 verified pros near you. It’s free.</span>
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
