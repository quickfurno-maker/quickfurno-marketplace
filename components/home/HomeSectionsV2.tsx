import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { QFIcon } from "@/components/QuickFurnoIcons";

/**
 * QF-UI-V2-05 homepage sections.
 *
 * COPY TRUTH. Every claim below is one the product can actually stand behind:
 * verified vendor profiles, up to 3 matches per lead, free for homeowners, Pune
 * and Mumbai. The previous copy asserted things the repo has no support for —
 * "Background-checked professionals", "On-Time Guarantee / on-time or on us",
 * "Quality Assured … every time", "Matches in minutes", "Fast Response",
 * "Clear rates, no surprises", "work gets done … on time, every time" — and all
 * of those are gone rather than restyled.
 *
 * The wording also stops implying QuickFurno performs the work: it is a
 * marketplace that introduces homeowners to vendors.
 */

/** Trust strip — qualitative facts, stated once, with no fake counters. */
const TRUST_POINTS = [
  { icon: "shield" as const, label: "Verified vendor profiles" },
  { icon: "compare" as const, label: "Up to 3 matches" },
  { icon: "noFee" as const, label: "Free for homeowners" },
  { icon: "pin" as const, label: "Pune & Mumbai" },
  { icon: "lock" as const, label: "Your details stay private" },
];

export function TrustStripV2() {
  return (
    <div className="qf-trust-strip" aria-label="What QuickFurno offers">
      {TRUST_POINTS.map((point) => (
        <span key={point.label} className="qf-trust-item">
          <QFIcon name={point.icon} />
          {point.label}
        </span>
      ))}
    </div>
  );
}

const STEPS = [
  ["Tell us what you need", "Share your requirement, area and budget range in a few steps."],
  ["Get matched", "We introduce you to up to 3 relevant verified vendors for your project."],
  ["Compare and connect", "Look at their profiles and work, then contact them directly."],
  ["Choose your vendor", "Pick the team that suits your project and agree terms with them."],
];

export function HowItWorksV2() {
  return (
    <section className="qf-pub-section qf-pub-section--surface" id="how-it-works">
      <div className="qf-pub-container">
        <div className="qf-pub-sectionhead">
          <span className="qf-pub-eyebrow">How it works</span>
          <h2>From requirement to the right team, in four steps</h2>
          <p>
            QuickFurno is a marketplace: we match you with verified local vendors and you deal
            with them directly.
          </p>
        </div>

        <ol className="qf-steps">
          {STEPS.map(([title, body], index) => (
            <li className="qf-step" key={title}>
              <span className="qf-step-num" aria-hidden="true">{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const WHY = [
  ["shield", "Verified vendor profiles", "Every vendor is reviewed and approved by QuickFurno before their profile goes live."],
  ["compare", "A shortlist, not a spam list", "You get up to 3 relevant vendors for your requirement — not calls from everyone."],
  ["map", "Matched to your area", "Matching uses the city and areas each vendor actually covers."],
  ["noFee", "Free for homeowners", "Sending a requirement and comparing vendors costs you nothing."],
  ["user", "You deal directly", "Compare profiles and contact the vendor yourself — no middle layer on your project."],
  ["chat", "Support when you need it", "Message the QuickFurno team if something about a match looks wrong."],
] as const;

export function WhyQuickFurnoV2() {
  return (
    <section className="qf-pub-section" id="why-quickfurno">
      <div className="qf-pub-container">
        <div className="qf-pub-sectionhead">
          <span className="qf-pub-eyebrow">Why QuickFurno</span>
          <h2>A calmer way to find home-service vendors</h2>
          <p>Fewer, better-matched introductions — and the details you need to choose well.</p>
        </div>

        <div className="qf-usp">
          {WHY.map(([icon, title, body]) => (
            <article className="qf-usp-item" key={title}>
              <span className="qf-pub-icontile" aria-hidden="true">
                <QFIcon name={icon} />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CoverageV2() {
  return (
    <section className="qf-pub-section qf-pub-section--surface" id="coverage">
      <div className="qf-pub-container">
        <div className="qf-coverage">
          <div>
            <span className="qf-pub-eyebrow">Coverage</span>
            <h2 style={{ margin: 0, fontSize: "clamp(1.4rem, 3vw, 1.9rem)", fontWeight: 700, letterSpacing: "-0.025em", color: "var(--qf-brand-ink)" }}>
              Live in Pune &amp; Mumbai
            </h2>
            <p style={{ margin: "0.55rem 0 0", maxWidth: "48ch", lineHeight: 1.6, color: "var(--qf-brand-muted)" }}>
              QuickFurno currently matches homeowners with verified vendors across these two
              cities.
            </p>
          </div>

          <div>
            <div className="qf-coverage-cities">
              <span className="qf-coverage-city"><QFIcon name="pin" />Pune</span>
              <span className="qf-coverage-city"><QFIcon name="pin" />Mumbai</span>
            </div>
            <p className="qf-coverage-note">More cities as we verify vendors there.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FinalCTAV2() {
  return (
    <section className="qf-pub-section" id="contact">
      <div className="qf-pub-container">
        <div className="qf-final-cta">
          <h2>Ready to find the right team for your project?</h2>
          <p>
            Tell us what you need and we will introduce you to verified local vendors who do that
            kind of work.
          </p>
          <EnquiryModalTrigger className="qf-pub-btn qf-pub-btn--primary" source="Homepage final CTA">
            Get Free Team Matches
            <QFIcon name="arrow" />
          </EnquiryModalTrigger>
          <div className="qf-final-cta-points">
            <span><QFIcon name="noFee" />Free for homeowners</span>
            <span><QFIcon name="compare" />Up to 3 verified matches</span>
            <span><QFIcon name="pin" />Pune &amp; Mumbai</span>
          </div>
        </div>
      </div>
    </section>
  );
}
