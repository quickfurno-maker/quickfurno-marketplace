// ============================================================================
// QuickFurno — "How it works" v3 (dark)
//
// Server component. Replaces the light .qfp-how section on the launch
// homepage. Styles live in app/home-how-v3.css.
//
// HONESTY RULES BAKED IN — do not "improve" these away:
//   * The three businesses are EXAMPLES, not live listings. The section
//     carries a visible disclaimer and the map has an illustrative
//     accessible name. Keep both.
//   * No star ratings, no review counts. QuickFurno has no rating system,
//     so a rating shown here would be a claim the product cannot back.
//     Chips show trade + distance instead.
//   * "Profile checked" matches the live "Verified Profiles" / "Reviewed
//     before listed" language. Do not upgrade it to "Verified pro" or
//     similar without a real check behind it.
//   * The homeowner pin says "Your location", not an invented person, and
//     no human faces are used.
//
// The example names and distances deliberately match the /vendors matching
// board (app/vendors/vendors-content.ts → MATCH_PINS) so the two pages agree.
// ============================================================================
import { optionalRealImage } from "@/lib/homepage-images";

type Team = {
  name: string;
  trade: string;
  area: string;
  km: string;
  slug: string;
};

const TEAMS: Team[] = [
  { name: "Abhijeet Interiors", trade: "Interior designer", area: "Baner", km: "1.2 km", slug: "interior-designers" },
  { name: "Woodcraft Pune", trade: "Carpenter", area: "Wakad", km: "2.4 km", slug: "carpenters" },
  { name: "Onestop Interiors", trade: "Modular interiors", area: "Aundh", km: "3.1 km", slug: "premium-interiors" },
];

const TILES: { slug: string; label: string }[] = [
  { slug: "interior-designers", label: "Interior Designers" },
  { slug: "carpenters", label: "Carpenters" },
  { slug: "painter", label: "Painting" },
  { slug: "false-ceiling", label: "False Ceiling" },
];

const cat = (slug: string) => optionalRealImage(`categories/${slug}-v2`);

/* ---------------------------------------------------------------- icons */
const IconChat = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 11.5a8.5 8.5 0 0 1-11.9 7.8L3 20.5l1.3-4.1A8.5 8.5 0 1 1 21 11.5z" />
    <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
  </svg>
);
const IconPeople = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="8.5" r="3" />
    <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
    <path d="M16.5 6.2a3 3 0 0 1 0 5.6" />
    <path d="M18 14.6a5.5 5.5 0 0 1 3 4.9" />
  </svg>
);
const IconCheckCircle = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.4 2.4 4.6-4.8" />
  </svg>
);
const IconTick = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);
const IconHome = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 10.5 12 4l8 6.5" />
    <path d="M6 10v9h12v-9" />
  </svg>
);
const IconSearch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#6F685F" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
);
const IconChevron = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 5 7 7-7 7" />
  </svg>
);
const Connector = () => (
  <span className="qfh-link" aria-hidden="true">
    <svg className="qfh-link-r" viewBox="0 0 24 24" fill="none" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h13" />
      <path d="m12.5 6 6 6-6 6" />
    </svg>
    <svg className="qfh-link-d" viewBox="0 0 24 24" fill="none" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v13" />
      <path d="m6 11.5 6 6 6-6" />
    </svg>
  </span>
);

/* --------------------------------------------------------------- visuals */
function AppPreview() {
  return (
    <div className="qfh-phone" role="img" aria-label="Preview of the QuickFurno enquiry screen">
      <div className="qfh-scr">
        <div className="qfh-scr-bar">
          <span className="qfh-wm">
            Quick<i>Furno</i>
          </span>
          <span>9:41</span>
        </div>
        <p className="qfh-scr-h">Find the right home service</p>
        <div className="qfh-scr-search">
          <span>Search a service&hellip;</span>
          <IconSearch />
        </div>
        <div className="qfh-scr-grid">
          {TILES.map((t) => {
            const src = cat(t.slug);
            return (
              <figure className="qfh-tile" key={t.slug}>
                {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : null}
                <figcaption>{t.label}</figcaption>
              </figure>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MatchMap() {
  const letters = ["a", "b", "c"] as const;
  return (
    <div
      className="qfh-map"
      role="img"
      aria-label="Illustrative map showing three example Teams matched near a homeowner in Baner, Pune. Not live listings."
    >
      <span className="qfh-map-grid" aria-hidden="true" />
      <span className="qfh-map-river" aria-hidden="true" />
      <span className="qfh-rings" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {TEAMS.map((t, i) => {
        const src = cat(t.slug);
        return (
          <span className={`qfh-vchip qfh-vchip--${letters[i]}`} key={t.name}>
            {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : null}
            <span>
              <b>{t.name}</b>
              <i>
                {t.trade} &middot; {t.km}
              </i>
            </span>
          </span>
        );
      })}
      {letters.map((l) => (
        <span className={`qfh-dot qfh-dot--${l}`} key={l} aria-hidden="true" />
      ))}
      <span className="qfh-me">
        <b>
          <IconHome />
        </b>
        <u>
          Your location
          <i>Baner, Pune</i>
        </u>
      </span>
      <span className="qfh-map-tag">
        <IconTick />3 Teams matched
      </span>
    </div>
  );
}

function Shortlist() {
  return (
    <ul className="qfh-vlist">
      {TEAMS.map((t) => {
        const src = cat(t.slug);
        return (
          <li className="qfh-vrow" key={t.name}>
            {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : null}
            <div>
              <b>{t.name}</b>
              <i>
                {t.trade} &middot; {t.area}
              </i>
              <span className="qfh-chk">
                <IconTick />
                Profile checked
              </span>
            </div>
            <IconChevron />
          </li>
        );
      })}
    </ul>
  );
}

/* --------------------------------------------------------------- section */
const STEPS = [
  {
    n: "01",
    icon: <IconChat />,
    h: "Tell us what you need",
    p: "Choose the service, share your location and a few details. Your phone number is only requested at the contact step.",
    visual: <AppPreview />,
  },
  {
    n: "02",
    icon: <IconPeople />,
    h: "We find eligible Teams",
    p: "QuickFurno matches you with up to 3 active Teams based on your service, location and eligibility checks.",
    visual: <MatchMap />,
  },
  {
    n: "03",
    icon: <IconCheckCircle />,
    h: "Compare & choose",
    p: "Review profiles and quotes, then choose the professional you trust. No fees, no obligation.",
    visual: <Shortlist />,
  },
];

export default function HowItWorksV3() {
  return (
    <section className="qfh" id="how-it-works">
      <span className="qfh-arc qfh-arc--l" aria-hidden="true" />
      <span className="qfh-arc qfh-arc--r" aria-hidden="true" />
      <span className="qfh-glow" aria-hidden="true" />
      <div className="qfh-shell">
        <div className="qfh-head-c">
          <span className="qfh-kicker">How it works</span>
          <h2>
            Three steps.
            <br />{" "}
            <span>Zero running around.</span>
          </h2>
          <p className="qfh-lede">
            From your requirement to a trusted professional &mdash; all in one place.
          </p>
        </div>
        <ol className="qfh-steps">
          {STEPS.map((s) => (
            <li className="qfh-step" key={s.n}>
              <div className="qfh-visual">{s.visual}</div>
              <div className="qfh-text">
                <span className="qfh-badges">
                  <span className="qfh-num">{s.n}</span>
                  <span className="qfh-icon">{s.icon}</span>
                </span>
                <h3>{s.h}</h3>
                <p>{s.p}</p>
              </div>
              <Connector />
            </li>
          ))}
        </ol>
        <p className="qfh-note">
          Example Teams shown &mdash; illustrative preview, not live listings.
        </p>
      </div>
    </section>
  );
}
