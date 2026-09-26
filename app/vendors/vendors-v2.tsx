// =============================================================================
// QuickFurno /vendors — sections ported from the approved canvas boards.
//
// One responsive tree per section. Mobile values are the CSS base (390 board);
// the `min-width: 900px` block in vendors-v2.css carries the 1280 board.
// Copy and figures come from vendors-content.ts verbatim — every number there
// is one the product actually enforces.
// =============================================================================

import Link from "next/link";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { EnquiryModalTrigger } from "@/components/ClientEnquiryModal";
import { Icon } from "@/components/qf-icon";
import { whatsappLink } from "@/lib/config";
import { categories, categorySlug } from "@/lib/quickfurno-data";
import {
  BADGE,
  CAT_ALL,
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
  GET_CTA,
  GET_TRUST,
  MATCH_BENEFITS,
  MATCH_PIN_NOTE,
  MATCH_PINS,
  STEPS,
  GET_EYE,
  GET_FEATS,
  GET_H2,
  GET_SCRIPT,
  GET_SUB,
  WHY_BAD_HEAD,
  WHY_BENEFITS,
  WHY_CTA,
  WHY_EYE,
  WHY_GOOD_HEAD,
  WHY_H2,
  WHY_ROWS,
  WHY_SUB,
  PRO_COLS,
  PRO_CTA,
  PRO_EYE,
  PRO_H2,
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

// The eight live categories, straight from the canonical registry — add one
// there and it appears here. Artwork is named after the slug, so a new
// category needs its two files and nothing else.
//
// Two cuts of the same illustration: the 1280 board fills the top of the card
// with a squared-off panel, the 390 board uses a circular crop. <picture>
// picks one, so a phone never downloads the desktop art and vice versa.
const CAT_CARDS = categories.map((category) => {
  const slug = categorySlug(category.name);
  const [l1, ...rest] = category.name.split(" ");
  return { slug, l1, l2: rest.join(" ") };
});

// ------------------------------------------------------------------ atoms ---

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
            src={`${IMG}/hero2-mobile-top.webp`}
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
        <div className="qv-hero-cards">
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
            <Link className="qv-cat" href={`/category/${c.slug}`} key={c.slug}>
              <picture>
                <source media="(min-width: 900px)" srcSet={`${IMG}/cat-icon-${c.slug}.webp`} />
                <img src={`${IMG}/ring-${c.slug}.webp`} alt="" loading="lazy" decoding="async" />
              </picture>
              <span className="qv-cat-label">
                <span className="qv-cat-l">{c.l1}</span>
                {c.l2 ? <span className="qv-cat-l">{c.l2}</span> : null}
              </span>
              {/* 1280 board only; the 390 card has no arrow — there is no room
                  for one and the whole card is already the tap target. */}
              <span className="qv-cat-go" aria-hidden="true">
                <Icon name="arrow" sw={2.3} />
              </span>
            </Link>
          ))}
        </div>

        <Link className="qv-cats-all" href="/#services">
          {CAT_ALL}
          <Icon name="arrow" sw={2.1} />
        </Link>
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
        <div className="qv-step-checks">
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

// The map artwork with the example vendors drawn over it. The names sit on
// top of the labels baked into the image, so each chip has to stay at least
// as wide as the label underneath it — that is what the min-width is for.
function MatchMap() {
  return (
    /* role="img" plus the label make the whole illustration announce itself as
       one thing, and as an example rather than live demand — the vendor names
       drawn over it are invented. The inner <img> takes an empty alt so it is
       not read out a second time. */
    <div
      className="qv-mmap"
      role="img"
      aria-label="Illustrative Client Matching product preview. Not live demand data."
    >
      <picture>
        <source media="(min-width: 900px)" srcSet={`${IMG}/match-visual-d.webp`} />
        <img src={`${IMG}/match-visual-m.webp`} alt="" loading="lazy" decoding="async" />
      </picture>
      {MATCH_PINS.map((p) => (
        <span
          className="qv-mpin"
          key={p.n}
          style={{ "--dx": p.dx, "--dy": p.dy, "--mx": p.mx, "--my": p.my } as CSSProperties}
        >
          <b>{p.n}</b>
          <i>{p.d}</i>
        </span>
      ))}
      <span className="qv-mmap-tag">{MATCH_PIN_NOTE}</span>
    </div>
  );
}

export function MatchingV2() {
  return (
    <section className="qv-sec qv-dk qv-match" id="how-matching-works">
      <div className="qv-shell qv-msplit">
        <div className="qv-msplit-copy">
          <Eyebrow>{MATCH_EYE}</Eyebrow>
          <h2 className="qv-sec-h2">
            {MATCH_H2[0]}
            <br />
            {MATCH_H2[1]}
            <span className="qv-hl">{MATCH_H2[2]}</span>
          </h2>
          <p className="qv-sec-sub">{MATCH_SUB}</p>
        </div>

        {/* Tap-to-open on a phone, where four expanded steps would add roughly
            a screen and a half; always open from 900px up, where there is room
            for them side by side with the map. */}
        <div className="qv-msplit-steps">
          {STEPS.map(([icon, no, title, body, checks], i) => (
            <details className="qv-mstep" key={no}>
              <summary>
                <span className="qv-mstep-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="qv-mstep-ico">
                  <Icon name={icon} sw={2} />
                </span>
                <span className="qv-mstep-head">
                  <span className="qv-mstep-eye">{no}</span>
                  <h3>{title}</h3>
                </span>
                <span className="qv-mstep-chev" aria-hidden="true">
                  <Icon name="chev" sw={2.2} />
                </span>
              </summary>
              <div className="qv-mstep-panel">
                <p>{body}</p>
                <div className="qv-mstep-checks">
                  {checks.map((c) => (
                    <div key={c}>
                      <Icon name="check" sw={2.6} />
                      <span>{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          ))}
        </div>

        <div className="qv-msplit-vis">
          <MatchMap />
        </div>

        {/* 390 board only — the 1280 board has the phone inside the map art. */}
        <div className="qv-msplit-phone">
          <img
            src={`${IMG}/match-phone-m.webp`}
            alt="The request as it appears on a vendor phone"
            loading="lazy"
            decoding="async"
          />
        </div>

        <div className="qv-msplit-note">
          <div className="qv-mnote">
            <span className="qv-mnote-ico">
              <Icon name="bolt_" sw={2} fill="currentColor" />
            </span>
            <p>{MATCH_NOTE}</p>
          </div>
        </div>

        <div className="qv-msplit-ben">
          {MATCH_BENEFITS.map(([icon, title, body]) => (
            <div className="qv-mben" key={title}>
              <span className="qv-mben-ico">
                <Icon name={icon} sw={2} />
              </span>
              <div>
                <span className="qv-mben-t">{title}</span>
                <span className="qv-mben-d">{body}</span>
              </div>
            </div>
          ))}
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
            <Link className="qv-note-link" href="#how-matching-works">
              {DASH_LINK}
              <Icon name="arrow" sw={2.1} />
            </Link>
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

// The problems / answers pair. Tap-to-open on a phone, where the two panels
// run to twelve rows between them; both open from 900px up, side by side.
function WhyPanel({
  tone,
  head,
  rows,
}: {
  tone: "bad" | "good";
  head: readonly [string, string];
  rows: readonly (readonly [string, string, string])[];
}) {
  return (
    <details className={`qv-wpan qv-wpan--${tone}`}>
      <summary>
        <span className="qv-wpan-ico">
          <Icon name={tone === "bad" ? "x_" : "check"} sw={2.6} />
        </span>
        <span className="qv-wpan-head">
          <b>{head[0]}</b>
          <i>{head[1]}</i>
        </span>
        <span className="qv-wpan-chev" aria-hidden="true">
          <Icon name="chev" sw={2.2} />
        </span>
      </summary>
      <div className="qv-wpan-rows">
        {rows.map(([icon, t, b]) => (
          <div className="qv-wpan-row" key={t}>
            <span className="qv-wpan-ric">
              <Icon name={icon} sw={2} />
            </span>
            <span className="qv-wpan-rtx">
              <b>{t}</b>
              <i>{b}</i>
            </span>
            <span className="qv-wpan-rch" aria-hidden="true">
              <Icon name="chev" sw={2.2} />
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

// The gradient call to action both the "why" and "what you get" bands close on.
function DarkCta({
  className,
  icon,
  title,
  body,
  label,
  note,
}: {
  className: string;
  icon: string;
  title: ReactNode;
  body?: string;
  label: string;
  note?: string;
}) {
  return (
    <div className={`qv-dcta ${className}`}>
      <span className="qv-dcta-ico">
        <Icon name={icon} sw={2} />
      </span>
      <span className="qv-dcta-t">{title}</span>
      {body ? <p className="qv-dcta-b">{body}</p> : null}
      <span className="qv-dcta-act">
        <a className="qv-dcta-btn" href={SIGNUP}>
          {label}
          <Icon name="arrow" sw={2.2} />
        </a>
        {note ? <span className="qv-dcta-note">{note}</span> : null}
      </span>
    </div>
  );
}

export function WhyV2() {
  return (
    <section className="qv-sec qv-dk qv-why" id="why-quickfurno">
      <div className="qv-shell qv-wsplit">
        <div className="qv-wsplit-copy">
          <Eyebrow>{WHY_EYE}</Eyebrow>
          <h2 className="qv-sec-h2">
            {WHY_H2[0]}
            <br />
            <span className="qv-hl">{WHY_H2[1]}</span>
            <br />
            {WHY_H2[2].trim()}
          </h2>
          <p className="qv-sec-sub">{WHY_SUB}</p>
          <div className="qv-wben">
            {WHY_BENEFITS.map(([icon, t, b]) => (
              <div className="qv-wben-i" key={t}>
                <span className="qv-wben-ico">
                  <Icon name={icon} sw={2} />
                </span>
                <span className="qv-wben-tx">
                  <b>{t}</b>
                  <i>{b}</i>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="qv-wsplit-fig">
          <picture>
            <source media="(min-width: 900px)" srcSet={`${IMG}/why-visual-d.webp`} />
            <img
              src={`${IMG}/why-visual-m.webp`}
              alt="A professional on site"
              loading="lazy"
              decoding="async"
            />
          </picture>
        </div>

        <div className="qv-wsplit-panels">
          <WhyPanel tone="bad" head={WHY_BAD_HEAD} rows={WHY_ROWS.map((r) => [r[0], r[1], r[2]] as const)} />
          <WhyPanel tone="good" head={WHY_GOOD_HEAD} rows={WHY_ROWS.map((r) => [r[0], r[3], r[4]] as const)} />
        </div>

        <div className="qv-wsplit-cta">
          <DarkCta className="qv-dcta--why" icon="shield" title={WHY_CTA[0]} body={WHY_CTA[1]} label={WHY_CTA[2]} />
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------- 6. what you get ---

export function WhatYouGetV2() {
  return (
    <section className="qv-sec qv-dk qv-get">
      <div className="qv-shell qv-gsplit">
        <div className="qv-gsplit-copy">
          <Eyebrow>{GET_EYE}</Eyebrow>
          <h2 className="qv-sec-h2">
            {GET_H2[0]}
            <br />
            {GET_H2[1]}
            <span className="qv-hl">{GET_H2[2]}</span>
          </h2>
          <p className="qv-sec-sub">{GET_SUB}</p>
          {/* 1280 board only — the 390 board has no room for the script line */}
          <div className="qv-gscript">
            <span className="qv-script">{GET_SCRIPT}</span>
            <i />
          </div>
        </div>

        <div className="qv-gsplit-fig">
          <picture>
            <source media="(min-width: 900px)" srcSet={`${IMG}/get-visual-d.webp`} />
            <img
              src={`${IMG}/get-visual-m.webp`}
              alt="The client matching dashboard on a vendor phone"
              loading="lazy"
              decoding="async"
            />
          </picture>
        </div>

        <div className="qv-gsplit-rows">
          {GET_FEATS.map(([icon, t, b]) => (
            <div className="qv-grow" key={t}>
              <span className="qv-grow-ico">
                <Icon name={icon} sw={2} />
              </span>
              <span className="qv-grow-tx">
                <b>{t}</b>
                <i>{b}</i>
              </span>
              <span className="qv-grow-chev" aria-hidden="true">
                <Icon name="chev" sw={2.2} />
              </span>
            </div>
          ))}
        </div>

        <div className="qv-gsplit-trust">
          <div className="qv-gtrust">
            {GET_TRUST.map(([icon, t, b]) => (
              <div className="qv-gtrust-i" key={t}>
                <span className="qv-gtrust-ico">
                  <Icon name={icon} sw={2} />
                </span>
                <span className="qv-gtrust-tx">
                  <b>{t}</b>
                  <i>{b}</i>
                </span>
              </div>
            ))}
            <a className="qv-dcta-btn" href={SIGNUP}>
              {GET_CTA}
              <Icon name="arrow" sw={2.2} />
            </a>
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
    <section className="qv-sec qv-dk qv-pro" id="our-promise">
      <div className="qv-shell qv-psplit">
        <div className="qv-psplit-copy">
          <Eyebrow>{PRO_EYE}</Eyebrow>
          <h2 className="qv-sec-h2">
            {PRO_H2[0]}
            <br />
            <span className="qv-hl">{PRO_H2[1]}</span>
          </h2>
          <p className="qv-sec-sub">{PRO_SUB}</p>
        </div>

        <div className="qv-psplit-fig">
          <picture>
            <source media="(min-width: 900px)" srcSet={`${IMG}/pro-hero-d.webp`} />
            <img
              src={`${IMG}/pro-hero-m.webp`}
              alt="A professional and a homeowner"
              loading="lazy"
              decoding="async"
            />
          </picture>
        </div>

        {/* Two governed promises. The blue column reads as the homeowner side;
            on the dark ground its accent is lightened to #A9D4F2, because the
            board's navy is invisible against near-black. */}
        <div className="qv-psplit-cols">
          {PRO_COLS.map(([icon, title, sub, accent, , , rows]) => (
            <div className={`qv-pcol ${accent === "#E0611E" ? "qv-pcol--pro" : "qv-pcol--home"}`} key={title}>
              <div className="qv-pcol-h">
                <span className="qv-pcol-ico">
                  <Icon name={icon} sw={2} />
                </span>
                <span className="qv-pcol-tx">
                  <b>{title}</b>
                  <i>{sub}</i>
                </span>
              </div>
              {rows.map(([rIcon, t, b]) => (
                <div className="qv-pcol-row" key={t}>
                  <span className="qv-pcol-ric">
                    <Icon name={rIcon} sw={2} />
                  </span>
                  <span className="qv-pcol-rtx">
                    <b>{t}</b>
                    <i>{b}</i>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="qv-psplit-cta">
          <DarkCta
            className="qv-dcta--pro"
            icon="shield"
            title={
              <>
                {PRO_CTA[0].replace(" for everyone.", "")}
                <span className="qv-hl"> for everyone.</span>
              </>
            }
            body={PRO_CTA[1]}
            label={PRO_CTA[2]}
            note={PRO_CTA[3]}
          />
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

        {/* Five zones. On a phone each one collapses to a ~60px row, which
            takes the band from about 2,600px to 1,550px without dropping a
            single locality; the first stays open so names are visible without
            a tap. All five are open from 900px up, side by side. */}
        <div className="qv-areas-zones">
          {AREAS_ZONES.map(([name, blurb, count, list], i) => (
            <details className="qv-zone" key={name} open={i === 0}>
              <summary>
                <span className="qv-zone-ico">
                  <Icon name="home_" sw={2} />
                </span>
                <span className="qv-zone-t">
                  <b>{name}</b>
                  <i className="qv-zone-blurb">{blurb}</i>
                  <i className="qv-zone-sub">
                    <b>{count}</b> · {blurb}
                  </i>
                </span>
                <span className="qv-zone-count">
                  <Icon name="pin_" sw={2.2} />
                  {count}
                </span>
                <span className="qv-zone-tog" aria-hidden="true" />
              </summary>
              <div className="qv-zone-panel">
                <div className="qv-zone-list">
                  {list.map((a) => (
                    <div className="qv-zone-row" key={a}>
                      <span>{a}</span>
                      <Icon name="chev" sw={2.2} />
                    </div>
                  ))}
                </div>
                <Link className="qv-zone-all" href="/#areas">
                  View all {count}
                  <Icon name="arrow" sw={2.2} />
                </Link>
              </div>
            </details>
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
            <Link className="qv-btn qv-btn-primary" href="/#areas">
              {AREAS_CHECK[2]}
              <Icon name="arrow" sw={2.1} />
            </Link>
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
          <a
            className="qv-faq-wa"
            href={whatsappLink("Hi QuickFurno, I have a question about joining as a service professional.")}
            target="_blank"
            rel="noreferrer"
          >
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
          <EnquiryModalTrigger
            className="qv-btn qv-btn-primary"
            source="Vendor page homeowner switch"
            modalTitle="Tell us what your home needs"
          >
            <Icon name="people" sw={2} />
            {SWITCH_BTN}
            <Icon name="arrow" sw={2.1} />
          </EnquiryModalTrigger>
        </div>
      </div>
    </section>
  );
}
