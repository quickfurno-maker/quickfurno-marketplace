// =============================================================================
// QuickFurno /vendors — sections ported from the approved canvas boards.
//
// One responsive tree per section. Mobile values are the CSS base (390 board);
// the `min-width: 900px` block in vendors-v2.css carries the 1280 board.
// Copy and figures come from vendors-content.ts verbatim — every number there
// is one the product actually enforces.
// =============================================================================

import { Fragment, type CSSProperties, type ReactNode } from "react";
import { GLYPHS } from "./vendors-glyphs";
import {
  BADGE,
  CAT_ALL,
  CAT_CARDS,
  CAT_EYE,
  CAT_SUB,
  DASH_EYE,
  DASH_FEATS,
  DASH_H2,
  DASH_LINK,
  DASH_NOTE,
  DASH_PINS,
  DASH_SUB,
  MATCH_EYE,
  MATCH_H2,
  MATCH_NOTE,
  MATCH_SUB,
  PILL_POS,
  PINS,
  QUAL_POS,
  QUAL_ROWS,
  QUAL_TITLE,
  STEPS,
  GET_EYE,
  GET_FEATS,
  GET_H2,
  GET_PANEL,
  GET_SCRIPT,
  GET_SUB,
  WHY_BAD_HEAD,
  WHY_CARDS,
  WHY_EYE,
  WHY_GOOD_HEAD,
  WHY_H2,
  WHY_ROWS,
  WHY_SCRIPT,
  WHY_SUB,
  PRO_COLS,
  PRO_CTA,
  PRO_EYE,
  PRO_H2,
  PRO_NOTE_L,
  PRO_NOTE_R,
  PRO_SUB,
  SUP_CTA,
  SUP_EYE,
  SUP_FEATS,
  SUP_H2,
  SUP_SCRIPT_D,
  SUP_SCRIPT_M,
  SUP_SUB,
  APPLY_EYE,
  APPLY_H2,
  APPLY_NOTE,
  APPLY_SCRIPT,
  APPLY_SUB,
  AREAS_BADGE,
  AREAS_CHECK,
  AREAS_EYE,
  AREAS_H2,
  AREAS_PILLS,
  AREAS_SCRIPT,
  AREAS_SUB,
  AREAS_TRUST,
  AREAS_ZONES,
  FAQ_BTN,
  FAQ_EYE,
  FAQ_H2,
  FAQ_ITEMS,
  FAQ_PILLS,
  FAQ_SCRIPT,
  FAQ_SUB,
  FOOT_BLURB,
  FOOT_COLS,
  FOOT_CTAS,
  FOOT_LEGAL,
  FOOT_SCRIPT,
  FOOT_TRUST,
  SWITCH_B,
  SWITCH_BTN,
  SWITCH_T,
  CARDS,
  FEATS,
  FINE,
  H1,
  LEDE,
  LOGIN,
  PROOF_K,
  PROOF_P,
  SIGNUP,
  SLOTS,
} from "./vendors-content";

const IMG = "/assets/quickfurno/images/vendors/v2";

// ------------------------------------------------------------------ atoms ---

export function Icon({
  name,
  className = "qv-ico",
  sw = 1.9,
  fill = "none",
}: {
  name: string;
  className?: string;
  sw?: number;
  fill?: string;
}) {
  const d = GLYPHS[name];
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={fill}
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="qv-eyebrow">
      <i />
      {children}
    </span>
  );
}

function Swoosh() {
  return (
    <svg
      viewBox="0 0 120 26"
      className="qv-swoosh"
      fill="none"
      stroke="#E0611E"
      strokeWidth={4}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 20C26 6 78 2 116 8" />
    </svg>
  );
}

function ProofCard() {
  return (
    <div className="qv-proof">
      <div className="qv-proof-body">
        <span className="qv-proof-k">{PROOF_K}</span>
        <div className="qv-proof-slots">
          <span className="qv-slot">
            <Icon name="check" sw={3} />
            {SLOTS[0]}
          </span>
          <span className="qv-slot">
            <Icon name="check" sw={3} />
            {SLOTS[1]}
          </span>
          <span className="qv-slot qv-slot-open">{SLOTS[2]}</span>
        </div>
        <p className="qv-proof-p" dangerouslySetInnerHTML={{ __html: PROOF_P }} />
      </div>
      <Icon name="trend" sw={2} />
    </div>
  );
}

// ------------------------------------------------------------------- hero ---

export function HeroV2() {
  return (
    <section className="qv-hero">
      <div className="qv-hero-bg">
        <picture>
          <source media="(min-width: 900px)" srcSet={`${IMG}/hero2-desktop.webp`} />
          <img
            src={`${IMG}/hero2-mobile.webp`}
            alt="A carpenter, an interior designer and a painter in front of the Pune skyline"
            fetchPriority="high"
            decoding="async"
          />
        </picture>
      </div>
      <div className="qv-hero-veil" />

      <div className="qv-hero-shell">
        {/* the 1280 board floats these three above the headline; the 390 board
            drops them, so they are hidden rather than duplicated */}
        <div className="qv-hero-cards" aria-hidden="true">
          {CARDS.map(([key, label]) => (
            <div className="qv-hero-card" key={label}>
              <span className="qv-hero-card-ico">
                <Icon name={key} sw={2} />
              </span>
              <span className="qv-hero-card-label">{label}</span>
              <Icon name="chev" sw={2.2} />
            </div>
          ))}
        </div>

        <div className="qv-hero-copy">
          <span className="qv-badge">
            <Icon name="people" sw={1.8} />
            {BADGE}
          </span>

          <h1>
            {H1[0]}
            <br />
            <span style={{ color: "#FCB253" }}>{H1[1]}</span>
            <br />
            <span className="qv-hero-h1last">
              {H1[2]}
              <span>
                <Swoosh />
              </span>
            </span>
          </h1>

          <p className="qv-hero-lede">{LEDE}</p>

          <div className="qv-feats">
            {FEATS.map(([key, a, b], i) => (
              <Fragment key={key}>
                {i > 0 && <i className="qv-rule" />}
                <div className="qv-feat">
                  <span className="qv-feat-ring">
                    <Icon name={key} sw={2} />
                  </span>
                  <span className="qv-feat-label">
                    {a}
                    <br />
                    {b || " "}
                  </span>
                </div>
              </Fragment>
            ))}
          </div>

          <div className="qv-cta-row">
            <a className="qv-btn qv-btn-primary" href={SIGNUP}>
              Apply Free
              <Icon name="arrow" sw={2.1} />
            </a>
            <a className="qv-btn qv-btn-ghost" href={LOGIN}>
              Vendor Login
            </a>
          </div>

          <p className="qv-hero-fine">{FINE}</p>
        </div>

        <div className="qv-hero-spacer" />

        <div className="qv-hero-proof">
          <ProofCard />
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------- categories ---

export function CategoriesV2() {
  return (
    <section className="qv-sec qv-cats">
      <div className="qv-shell qv-cats-shell">
        <div className="qv-cats-copy">
          <Eyebrow>{CAT_EYE}</Eyebrow>
          <h2>
            Choose your
            <br className="qv-br-m" /> service category
          </h2>
          <p className="qv-cats-sub">{CAT_SUB}</p>
        </div>

        <div className="qv-cats-grid">
          {CAT_CARDS.map((c) => (
            <a className="qv-cat" href={`https://quickfurno.in/category/${c.slug}`} key={c.slug}>
              <img src={`${IMG}/${c.file}.webp`} alt="" loading="lazy" decoding="async" />
              <span className="qv-cat-label">
                <span className="qv-cat-l">{c.l1}</span>
                {c.l2 ? (
                  <>
                    {" "}
                    <span className="qv-cat-l">{c.l2}</span>
                  </>
                ) : null}
              </span>
            </a>
          ))}
        </div>

        <a className="qv-cats-all" href="https://quickfurno.in/services">
          {CAT_ALL}
          <Icon name="arrow" sw={2.1} />
        </a>
      </div>
    </section>
  );
}

// ------------------------------------------- shared: stepped list + note ----

function Step({
  icon,
  no,
  title,
  body,
  checks,
  last,
}: {
  icon: string;
  no: string;
  title: string;
  body: string;
  checks?: readonly string[];
  last: boolean;
}) {
  return (
    <div className="qv-step">
      {!last && <i className="qv-step-line" />}
      <span className="qv-step-n">{no.slice(-2).trim().padStart(2, "0")}</span>
      <span className="qv-tile">
        <Icon name={icon} />
      </span>
      <div className="qv-step-body">
        <span className="qv-step-eye">{no}</span>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      {checks ? (
        <div className="qv-step-checks" aria-hidden="true">
          {checks.map((c) => (
            <div className="qv-check" key={c}>
              <Icon name="check" sw={3} />
              <span>{c}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function parsePos(pos: string) {
  const out: Record<string, string> = {};
  for (const part of pos.split(";")) {
    const [k, v] = part.split(":").map((x) => x.trim());
    if (!k) continue;
    out[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out as CSSProperties;
}

// -------------------------------------------------- 3. how matching works ---

export function MatchingV2() {
  return (
    <section className="qv-sec qv-match" id="how-matching-works">
      <div className="qv-shell qv-split">
        <div className="qv-split-copy">
          <Eyebrow>{MATCH_EYE}</Eyebrow>
          <h2 className="qv-sec-h2">
            {MATCH_H2[0]}
            <br />
            {MATCH_H2[1]}
            <span className="qv-hl">{MATCH_H2[2]}</span>
          </h2>
          <p className="qv-sec-sub">{MATCH_SUB}</p>
        </div>

        <div className="qv-split-steps">
          {STEPS.map(([icon, no, title, body, checks], i) => (
            <Step
              key={no}
              icon={icon}
              no={no}
              title={title}
              body={body}
              checks={checks}
              last={i === STEPS.length - 1}
            />
          ))}
        </div>

        <div className="qv-split-vis">
          <div className="qv-visual">
            <img
              src={`${IMG}/match-composite.webp`}
              alt="A QuickFurno project request on a phone beside a map of the matching area"
              loading="lazy"
              decoding="async"
            />
            <div className="qv-ov qv-ov-pill" style={parsePos(PILL_POS)}>
              <Icon name="pin_" sw={2} />
              <div className="qv-ov-body">
                <span className="qv-ov-t">Example matching area</span>
                <span className="qv-ov-d">Baner, Pune</span>
              </div>
            </div>
            {PINS.map((p) => (
              <div className="qv-ov" style={parsePos(p.pos)} key={p.pos}>
                <span className="qv-ov-av">
                  <Icon name="people" sw={2} />
                </span>
                <div className="qv-ov-body">
                  <span className="qv-ov-t">Eligible pro</span>
                  <span className="qv-ov-d">{p.d}</span>
                  <span className="qv-ov-tag">EXAMPLE</span>
                </div>
              </div>
            ))}
            <div className="qv-ov-qual" style={parsePos(QUAL_POS)}>
              <div className="qv-ov-qual-h">
                <Icon name="doc" sw={2} />
                <span>{QUAL_TITLE}</span>
              </div>
              {QUAL_ROWS.map((r) => (
                <div className="qv-ov-qual-r" key={r}>
                  <Icon name="check" sw={3} />
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="qv-split-note">
          <div className="qv-note">
            <span className="qv-note-ico">
              <Icon name="bolt_" sw={2} fill="currentColor" />
            </span>
            <p>{MATCH_NOTE}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------- 4. the dashboard ---

export function DashboardV2() {
  return (
    <section className="qv-sec qv-dash">
      <div className="qv-shell qv-split">
        <div className="qv-split-copy">
          <Eyebrow>{DASH_EYE}</Eyebrow>
          <h2 className="qv-sec-h2">
            {DASH_H2[0]}
            <br />
            <span className="qv-hl">{DASH_H2[1]}</span>
          </h2>
          <p className="qv-sec-sub">{DASH_SUB}</p>
        </div>

        <div className="qv-split-steps">
          {DASH_FEATS.map(([icon, title, body], i) => (
            <div className="qv-step" key={title}>
              {i < DASH_FEATS.length - 1 && <i className="qv-step-line qv-step-line-flat" />}
              <span className="qv-tile">
                <Icon name={icon} />
              </span>
              <div className="qv-step-body">
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="qv-split-note">
          <div className="qv-note">
            <span className="qv-note-ico">
              <Icon name="bolt_" sw={2} fill="currentColor" />
            </span>
            <p>{DASH_NOTE}</p>
            <a className="qv-note-link" href="https://quickfurno.in/vendors">
              {DASH_LINK}
              <Icon name="arrow" sw={2.1} />
            </a>
          </div>
        </div>

        <div className="qv-split-vis">
          <div className="qv-visual">
            <img
              src={`${IMG}/dash-visual-v2.webp`}
              alt="The QuickFurno vendor dashboard on a phone beside enquiry and category panels"
              loading="lazy"
              decoding="async"
            />
            {DASH_PINS.map((p) => (
              <div className="qv-ov" style={parsePos(p.pos)} key={p.t}>
                <span className="qv-ov-av">
                  <Icon name="people" sw={2} />
                </span>
                <div className="qv-ov-body">
                  <span className="qv-ov-t">{p.t}</span>
                  <span className="qv-ov-d">{p.d}</span>
                  <span className="qv-ov-tag">EXAMPLE</span>
                </div>
              </div>
            ))}
            <span className="qv-chip">ILLUSTRATIVE EXAMPLE</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------- 5. why QuickFurno is different ---

function Panel({
  head,
  sub,
  rows,
  tone,
}: {
  head: string;
  sub: string;
  rows: readonly (readonly [string, string, string])[];
  tone: "bad" | "good";
}) {
  return (
    <div className={`qv-panel qv-panel-${tone}`}>
      <div className="qv-panel-h">
        <span className="qv-panel-mark">
          <Icon name={tone === "good" ? "check" : "x_"} sw={3} />
        </span>
        <div>
          <b>{head}</b>
          <i>{sub}</i>
        </div>
      </div>
      {rows.map(([icon, t, b]) => (
        <div className="qv-panel-row" key={t}>
          <span className="qv-panel-row-ico">
            <Icon name={icon} sw={2} />
          </span>
          <div className="qv-panel-row-body">
            <b>{t}</b>
            <i>{b}</i>
          </div>
          <Icon name="chev" sw={2.2} />
        </div>
      ))}
    </div>
  );
}

export function WhyV2() {
  return (
    <section className="qv-sec qv-why" id="why-quickfurno">
      <div className="qv-shell">
        <div className="qv-why-top">
          <div>
            <Eyebrow>{WHY_EYE}</Eyebrow>
            <h2 className="qv-sec-h2">
              {WHY_H2[0]}
              <br />
              <span className="qv-hl">{WHY_H2[1]}</span>
              {WHY_H2[2]}
            </h2>
            <p className="qv-sec-sub">{WHY_SUB}</p>
          </div>

          <div className="qv-why-cluster">
            <div className="qv-why-fig">
              <span className="qv-script">{WHY_SCRIPT}</span>
              <img
                src={`${IMG}/why-person.webp`}
                alt="A professional in a hard hat, arms folded"
                loading="lazy"
                decoding="async"
              />
            </div>
            {WHY_CARDS.map(([icon, t, b], i) => (
              <div className={`qv-why-card qv-why-c${i + 1}`} key={t}>
                <span className="qv-why-card-ico">
                  <Icon name={icon} sw={2} />
                </span>
                <div>
                  <b>{t}</b>
                  <i>{b}</i>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="qv-why-panels">
          <Panel
            head={WHY_BAD_HEAD[0]}
            sub={WHY_BAD_HEAD[1]}
            rows={WHY_ROWS.map((r) => [r[0], r[1], r[2]] as const)}
            tone="bad"
          />
          <Panel
            head={WHY_GOOD_HEAD[0]}
            sub={WHY_GOOD_HEAD[1]}
            rows={WHY_ROWS.map((r) => [r[0], r[3], r[4]] as const)}
            tone="good"
          />
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------- 6. what you get ---

export function WhatYouGetV2() {
  return (
    <section className="qv-sec qv-get">
      <div className="qv-shell qv-split">
        <div className="qv-split-copy">
          <Eyebrow>{GET_EYE}</Eyebrow>
          <h2 className="qv-sec-h2">
            {GET_H2[0]}
            <br />
            {GET_H2[1]}
            <span className="qv-hl">{GET_H2[2]}</span>
          </h2>
          <p className="qv-sec-sub">{GET_SUB}</p>
        </div>

        <div className="qv-split-vis">
          <div className="qv-get-fig">
            <span>{GET_SCRIPT}</span>
            <picture>
              <source media="(min-width: 900px)" srcSet={`${IMG}/get-dashboard.webp`} />
              <img
                src={`${IMG}/get-phone.webp`}
                alt="The Client Matching dashboard"
                loading="lazy"
                decoding="async"
              />
            </picture>
          </div>
        </div>

        <div className="qv-split-steps qv-get-rows">
          {GET_FEATS.map(([icon, t, b]) => (
            <div className="qv-get-row" key={t}>
              <span className="qv-get-row-ico">
                <Icon name={icon} />
              </span>
              <div className="qv-get-row-body">
                <h3>{t}</h3>
                <p>{b}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="qv-split-note">
          <div className="qv-get-panel">
            <b>{GET_PANEL[0]}</b>
            <p>{GET_PANEL[1]}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------ 7. vendor support ---

export function SupportV2() {
  return (
    <section className="qv-sec qv-sup" id="support">
      <div className="qv-shell qv-split">
        <div className="qv-split-copy">
          <Eyebrow>{SUP_EYE}</Eyebrow>
          <h2 className="qv-sec-h2">
            {SUP_H2[0]}
            <br />
            {SUP_H2[1]}
            <span className="qv-hl">{SUP_H2[2]}</span>
          </h2>
          <p className="qv-sec-sub">{SUP_SUB}</p>
        </div>

        <div className="qv-split-vis">
          {/* 390 board: phone and agent composed in a tinted panel */}
          <div className="qv-sup-panel">
            <div className="qv-sup-pair">
              <div className="qv-sup-phone">
                <img
                  src={`${IMG}/sup-phone.webp`}
                  alt="The vendor support workspace on a phone"
                  loading="lazy"
                  decoding="async"
                />
                <span className="qv-sup-chip">ILLUSTRATIVE EXAMPLE</span>
              </div>
              <div className="qv-sup-side">
                <span className="qv-script">{SUP_SCRIPT_M}</span>
                <img
                  src={`${IMG}/sup-model.webp`}
                  alt="A QuickFurno support agent"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          </div>

          {/* 1280 board: one composed photograph */}
          <div className="qv-sup-wide">
            <span className="qv-script">{SUP_SCRIPT_D}</span>
            <img
              src={`${IMG}/sup-desktop.webp`}
              alt="The vendor support workspace on a phone, beside a QuickFurno support agent"
              loading="lazy"
              decoding="async"
            />
            <span className="qv-sup-chip">ILLUSTRATIVE EXAMPLE</span>
          </div>
        </div>

        <div className="qv-split-steps qv-sup-rows">
          {SUP_FEATS.map(([icon, title, body, tint, accent]) => (
            <div className="qv-sup-row" key={title}>
              <span className="qv-sup-row-ico" style={{ backgroundColor: tint, color: accent }}>
                <Icon name={icon} />
              </span>
              <div className="qv-sup-row-body">
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="qv-split-note">
          <div className="qv-sup-cta">
            <span className="qv-sup-cta-ico">
              <Icon name="doc" sw={1.9} />
            </span>
            <div className="qv-sup-cta-body">
              <b>
                {SUP_CTA[0]}
                <span className="qv-hl">{SUP_CTA[1]}</span>
              </b>
              <p>{SUP_CTA[2]}</p>
            </div>
            <div className="qv-cta-stack">
              <a className="qv-btn qv-btn-primary" href={SIGNUP}>
                {SUP_CTA[3]}
                <Icon name="arrow" sw={2.1} />
              </a>
              <small>{SUP_CTA[4]}</small>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------- 8. our promise ---

export function PromiseV2() {
  return (
    <section className="qv-sec qv-pro" id="our-promise">
      <div className="qv-shell qv-split">
        <div className="qv-split-copy">
          <Eyebrow>{PRO_EYE}</Eyebrow>
          <h2 className="qv-sec-h2">
            {PRO_H2[0]}
            <br />
            <span className="qv-hl">{PRO_H2[1]}</span>
          </h2>
          <p className="qv-sec-sub">{PRO_SUB}</p>
        </div>

        <div className="qv-split-vis">
          <div className="qv-pro-fig">
            <span className="qv-script qv-pro-note qv-pro-note-l">{PRO_NOTE_L}</span>
            <img
              src={`${IMG}/pro-pair.webp`}
              alt="A professional and a homeowner standing back to back"
              loading="lazy"
              decoding="async"
            />
            <span className="qv-script qv-pro-note qv-pro-note-r">{PRO_NOTE_R}</span>
          </div>
        </div>

        <div className="qv-split-steps qv-pro-cols">
          {PRO_COLS.map(([icon, title, sub, accent, tint, card, rows]) => (
            <div className="qv-pro-col" key={title} style={{ backgroundColor: card }}>
              <div className="qv-pro-col-h">
                <span className="qv-pro-col-mark" style={{ backgroundColor: accent }}>
                  <Icon name={icon} sw={2} />
                </span>
                <div>
                  <b>{title}</b>
                  <i>{sub}</i>
                </div>
              </div>
              {rows.map(([rIcon, t, b]) => (
                <div className="qv-pro-row" key={t}>
                  <span className="qv-pro-row-ico" style={{ backgroundColor: tint, color: accent }}>
                    <Icon name={rIcon} sw={2} />
                  </span>
                  <div className="qv-pro-row-body">
                    <b>{t}</b>
                    <i>{b}</i>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="qv-split-note">
          <div className="qv-pro-cta">
            <span className="qv-pro-cta-ico">
              <Icon name="shield" sw={2} />
            </span>
            <span className="qv-pro-cta-t">{PRO_CTA[0]}</span>
            <p>{PRO_CTA[1]}</p>
            <div className="qv-cta-stack">
              <a className="qv-btn qv-btn-primary" href={SIGNUP}>
                {PRO_CTA[2]}
                <Icon name="arrow" sw={2.1} />
              </a>
              <small>{PRO_CTA[3]}</small>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------- pills ---

function Pills({ items, className }: { items: readonly (readonly [string, string, string])[]; className: string }) {
  return (
    <div className={className}>
      {items.map(([icon, a, b]) => (
        <div className="qv-pill" key={a + b}>
          <span className="qv-pill-ico">
            <Icon name={icon} sw={2} />
          </span>
          <span>
            {a}
            <br />
            {b}
          </span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------- 9. where we match ---

export function AreasV2() {
  return (
    <section className="qv-sec qv-areas">
      <div className="qv-shell qv-areas-grid">
        <div className="qv-areas-copy">
          <Eyebrow>{AREAS_EYE}</Eyebrow>
          <h2 className="qv-sec-h2">
            {AREAS_H2[0]}
            <span className="qv-hl">{AREAS_H2[1]}</span>
            {AREAS_H2[2]}
          </h2>
          <p className="qv-sec-sub">{AREAS_SUB}</p>
        </div>

        <div className="qv-areas-art">
          <span className="qv-script">
            {AREAS_SCRIPT[0]}
            <br />
            <span>{AREAS_SCRIPT[1]}</span>
          </span>
          <img src={`${IMG}/areas-landmark.webp`} alt="Shaniwar Wada in Pune" loading="lazy" decoding="async" />
          <span className="qv-areas-badge">
            <Icon name="pin_" sw={2} />
            {AREAS_BADGE}
          </span>
        </div>

        <Pills items={AREAS_PILLS} className="qv-areas-pills" />

        <div className="qv-areas-zones">
          {AREAS_ZONES.map(([name, blurb, count, list]) => (
            <div className="qv-zone" key={name}>
              <div className="qv-zone-h">
                <span className="qv-zone-ico">
                  <Icon name="home_" sw={2} />
                </span>
                <div>
                  <b>{name}</b>
                  <i>{blurb}</i>
                </div>
              </div>
              <span className="qv-zone-count">
                <Icon name="pin_" sw={2.2} />
                {count}
              </span>
              <div className="qv-zone-list">
                {list.map((a) => (
                  <div className="qv-zone-row" key={a}>
                    <span>{a}</span>
                    <Icon name="chev" sw={2.2} />
                  </div>
                ))}
              </div>
              <a className="qv-zone-all" href="https://quickfurno.in/vendors">
                View all {count}
                <Icon name="arrow" sw={2.2} />
              </a>
            </div>
          ))}
        </div>

        <div className="qv-areas-note">
          <div className="qv-areas-check">
            <span className="qv-areas-check-ico">
              <Icon name="pin_" sw={2} />
            </span>
            <div className="qv-areas-check-body">
              <b>{AREAS_CHECK[0]}</b>
              <p>{AREAS_CHECK[1]}</p>
            </div>
            <a className="qv-btn qv-btn-primary" href="https://quickfurno.in/vendors">
              {AREAS_CHECK[2]}
              <Icon name="arrow" sw={2.1} />
            </a>
          </div>
          <div className="qv-areas-trust">
            {AREAS_TRUST.map(([icon, t, b]) => (
              <div className="qv-trust-col" key={t}>
                <Icon name={icon} sw={2} />
                <b>{t}</b>
                <i>{b}</i>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ 10. FAQ ---

export function FaqV2() {
  return (
    <section className="qv-sec qv-faq" id="faq">
      <div className="qv-shell qv-faq-grid">
        <div>
          <Eyebrow>{FAQ_EYE}</Eyebrow>
          <h2 className="qv-sec-h2">
            {FAQ_H2[0]}
            <br />
            <span className="qv-hl">{FAQ_H2[1]}</span>
          </h2>
          <p className="qv-sec-sub">{FAQ_SUB}</p>
          <a className="qv-faq-wa" href="https://quickfurno.in/vendors">
            <span className="qv-faq-wa-ico">
              <Icon name="chat" sw={2.1} />
            </span>
            {FAQ_BTN}
          </a>
          <Pills items={FAQ_PILLS} className="qv-faq-pills" />
        </div>

        <div className="qv-faq-art">
          <span className="qv-script">{FAQ_SCRIPT}</span>
          <img src={`${IMG}/faq-woman.webp`} alt="A QuickFurno team member" loading="lazy" decoding="async" />
        </div>

        <div className="qv-faq-panel">
          {FAQ_ITEMS.map(([icon, q, a], i) => (
            <details className="qv-faq-item" key={q} open={i === 0}>
              <summary>
                <span className="qv-faq-ico">
                  <Icon name={icon} sw={2} />
                </span>
                <span className="qv-faq-q">{q}</span>
                <span className="qv-faq-sign" aria-hidden="true" />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------- 11. apply + hire switch ---

export function ApplyV2() {
  return (
    <section className="qv-sec qv-apply">
      <div className="qv-shell">
        <div className="qv-apply-block">
          <div className="qv-apply-inner">
            <div className="qv-apply-copy">
              <span className="qv-apply-eye">{APPLY_EYE}</span>
              <h2>
                {APPLY_H2[0]}
                <br />
                {APPLY_H2[1]}
              </h2>
              <p className="qv-apply-sub">{APPLY_SUB}</p>
              <div className="qv-apply-chips">
                {CAT_CARDS.map((c) => (
                  <span className="qv-chip-out" key={c.slug}>
                    <Icon name="wrench" sw={2.1} />
                    {c.l1}
                    {c.l2 ? ` ${c.l2}` : ""}
                  </span>
                ))}
              </div>
            </div>

            <div className="qv-apply-man">
              <span className="qv-script">{APPLY_SCRIPT}</span>
              <img src={`${IMG}/cta-man.webp`} alt="A QuickFurno professional" loading="lazy" decoding="async" />
            </div>

            <div className="qv-apply-btns">
              <a className="qv-btn-white" href={SIGNUP}>
                Apply free
                <Icon name="arrow" sw={2.1} />
              </a>
              <a className="qv-btn-line" href={LOGIN}>
                Vendor login
              </a>
              <small>{APPLY_NOTE}</small>
            </div>
          </div>
        </div>

        <div className="qv-switch">
          <span className="qv-switch-ico">
            <Icon name="home_" sw={2} />
          </span>
          <div className="qv-switch-body">
            <b>{SWITCH_T}</b>
            <p>{SWITCH_B}</p>
          </div>
          <a className="qv-btn qv-btn-primary" href="https://quickfurno.in/">
            <Icon name="people" sw={2} />
            {SWITCH_BTN}
            <Icon name="arrow" sw={2.1} />
          </a>
        </div>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- 12. footer ---

const SOCIALS: readonly (readonly [string, string])[] = [
  ["Instagram", "people"],
  ["Facebook", "chat"],
  ["YouTube", "arrow"],
  ["LinkedIn", "doc"],
  ["WhatsApp", "chat"],
];

function FootGroup({ title, links }: { title: string; links: readonly (readonly [string, string])[] }) {
  const slug = title.toLowerCase().replace(/[^a-z]/g, "");
  return (
    <div className={`qv-foot-group qv-foot-g-${slug}`}>
      <span className="qv-foot-group-t">{title.toUpperCase()}</span>
      <div className={title === "Categories" ? "qv-foot-cols2" : undefined}>
        {links.map(([t, h]) => (
          <a href={`https://quickfurno.in${h}`} key={t}>
            {t}
            <Icon name="chev" className="qv-ico qv-foot-chev" sw={2.2} />
          </a>
        ))}
      </div>
    </div>
  );
}

export function FooterV2() {
  const groups = Object.fromEntries(FOOT_COLS.map(([t, l]) => [t, l]));
  return (
    <footer className="qv qv-sec qv-foot">
      <div className="qv-shell">
        <div className="qv-foot-ctas">
          {FOOT_CTAS.map(([icon, eye, h1, h2, h3, body, btn, href, prim]) => (
            <div className="qv-foot-cta" key={eye}>
              <span
                className="qv-foot-cta-ico"
                style={{ backgroundColor: prim ? "#E0611E" : "rgba(224, 97, 30, 0.85)" }}
              >
                <Icon name={icon} sw={2} />
              </span>
              <div className="qv-foot-cta-body">
                <span className="qv-foot-cta-eye">{eye}</span>
                <h3>
                  {h1}
                  <span className="qv-hl">{h2}</span>
                  {h3}
                </h3>
                <p>{body}</p>
                <a
                  className="qv-foot-cta-btn"
                  href={href}
                  style={{
                    backgroundColor: prim ? "#E0611E" : "#FFFFFF",
                    color: prim ? "#FFFFFF" : "#14110D",
                  }}
                >
                  {btn}
                  <Icon name="arrow" sw={2.1} />
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="qv-foot-main">
          <div className="qv-foot-brand">
            <span className="qv-foot-brand-name">
              Quick<span className="qv-hl">Furno</span>
            </span>
            <p className="qv-foot-blurb">{FOOT_BLURB}</p>
            <div className="qv-foot-social">
              {SOCIALS.map(([name, icon]) => (
                <a href="https://quickfurno.in/" aria-label={name} key={name}>
                  <Icon name={icon} />
                </a>
              ))}
            </div>
            <div className="qv-foot-trust">
              {FOOT_TRUST.map(([icon, a, b]) => (
                <div className="qv-foot-trust-col" key={a}>
                  <Icon name={icon} sw={2} />
                  <span>
                    {a}
                    <br />
                    {b}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="qv-foot-links">
            <FootGroup title="Categories" links={groups["Categories"]} />
            <div className="qv-foot-rest">
              <FootGroup title="Company" links={groups["Company"]} />
              <FootGroup title="For Vendors" links={groups["For Vendors"]} />
              <FootGroup title="Support" links={groups["Support"]} />
              <FootGroup title="Cities" links={groups["Cities"]} />
            </div>
          </div>
        </div>

        <div className="qv-foot-sky">
          <span className="qv-script">{FOOT_SCRIPT}</span>
          <img src={`${IMG}/foot-skyline.webp`} alt="The Pune skyline" loading="lazy" decoding="async" />
        </div>

        <div className="qv-foot-legal">
          <span>{FOOT_LEGAL[0]}</span>
          <span>{FOOT_LEGAL[1]}</span>
        </div>
      </div>
    </footer>
  );
}
