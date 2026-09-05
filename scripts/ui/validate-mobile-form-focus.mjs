// ============================================================================
// QuickFurno — scripts/ui/validate-mobile-form-focus.mjs
//
// QF-UI-HOTFIX-01 — two public-UI contracts that CI must keep true.
//
// (1) MOBILE FORM FOCUS STABILITY
//     The enquiry modal's scroll-lock / initial-focus / return-focus effect used
//     to depend on [open, showConfirm, success, form]. `form` changes on every
//     keystroke, so React tore the effect down and rebuilt it after each
//     character: cleanup called opener.focus(), which blurred the field being
//     typed into and closed the mobile keyboard; the re-run then refocused the
//     dialog and the keyboard reopened. Typing on a phone was impossible.
//
//     The rule: any effect that captures document.activeElement, restores focus,
//     or locks page scroll must be keyed to the modal's OPEN/CLOSE lifecycle
//     only — never to form/step/touched/submitting/success values. Escape
//     handling lives in its own effect whose cleanup only removes the listener.
//
// (2) HOMEPAGE ENTRY-MODULE LAYOUT
//     The homepage used to pin the service launcher beside the hero at >=1024px
//     with a 65fr/35fr split. The required architecture is a single stacked
//     column at every width: hero -> categories -> trust strip, each full width.
//
// The checks are deliberately whitespace-insensitive and run on CODE ONLY —
// comments are stripped first, so a comment that merely NAMES the old pattern
// (as several here do, to explain why it is forbidden) can never fail the build.
//
// Run: npm run test:ui:mobile-form-focus
// ============================================================================
import { readFileSync } from "node:fs";

const MODAL = "components/ClientEnquiryModal.tsx";
const PAGE = "app/page.tsx";
const CSS = "app/qf-public-v2.css";

/** Strip block and line comments, then collapse whitespace runs. */
function code(path) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}
/** Whitespace-insensitive form, so reformatting never breaks a rule. */
const flat = (s) => s.replace(/\s+/g, " ");
/** Verbatim source, including comments — for rules about literal copy. */
const readRaw = (path) => readFileSync(path, "utf8");

const MODAL_SRC = code(MODAL);
const MODAL_FLAT = flat(MODAL_SRC);
const PAGE_SRC = code(PAGE);
const PAGE_FLAT = flat(PAGE_SRC);
const CSS_SRC = code(CSS);
const CSS_FLAT = flat(CSS_SRC);

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
function assert(cond, msg) { if (!cond) throw new Error(msg); }

/**
 * A rule that cannot fail proves nothing. `mutant` re-evaluates a rule against a
 * deliberately broken copy of the source and fails if the rule still passes, so
 * every guard below is demonstrably able to catch the regression it describes.
 */
function mutant(name, source, mutate, stillPasses) {
  check(name, () => {
    assert(stillPasses(source), "precondition: the rule must PASS on real source");
    const broken = mutate(source);
    assert(broken !== source, "mutation was a no-op — the rule proves nothing");
    assert(!stillPasses(broken), "the rule ACCEPTED a broken source");
  });
}

/**
 * Every `useEffect(... , [deps])` in a file, as { body, deps }.
 * Bodies are matched by scanning to the effect's closing `}, [` marker, which is
 * enough for the shape this codebase uses and needs no parser dependency.
 */
function effects(src) {
  const out = [];
  const re = /useEffect\(\s*\(\s*\)\s*=>\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = m.index;
    const end = src.indexOf("}, [", start);
    if (end === -1) continue;
    const depsEnd = src.indexOf("]", end);
    out.push({
      body: src.slice(start, end),
      deps: src.slice(end + 3, depsEnd + 1).replace(/\s+/g, ""),
    });
  }
  return out;
}

/** Values that change while the client types. None may key a focus effect. */
const MUTABLE_FORM_DEPS = ["form", "touched", "submitting", "success", "step", "showConfirm"];

// ---------------------------------------------------------------------------
// 1. Mobile focus stability — the enquiry modal
// ---------------------------------------------------------------------------
check("01 the exact pre-hotfix dependency list is gone", () => {
  assert(!/\}\s*,\s*\[\s*open\s*,\s*showConfirm\s*,\s*success\s*,\s*form\s*\]/.test(MODAL_SRC),
    "the [open, showConfirm, success, form] focus effect is back — every keystroke will close the mobile keyboard");
});

check("02 the scroll-lock / focus lifecycle effect is keyed to [open] alone", () => {
  const lifecycle = effects(MODAL_SRC).filter(
    (e) => /style\.overflow/.test(e.body) || /document\.activeElement/.test(e.body),
  );
  assert(lifecycle.length > 0, "no scroll-lock/focus effect found — has the modal been restructured?");
  for (const e of lifecycle) {
    assert(e.deps === "[open]", `a focus/scroll effect is keyed to ${e.deps}; it must be exactly [open]`);
  }
});

check("03 no effect that touches focus depends on a mutable form value", () => {
  for (const e of effects(MODAL_SRC)) {
    const touchesFocus =
      /document\.activeElement/.test(e.body) ||
      /\.focus\(\)/.test(e.body) ||
      /style\.overflow/.test(e.body);
    if (!touchesFocus) continue;
    // The contact-step focus effect is allowed `step` — it must fire once per
    // step change, and `step` does not change while a field is being typed in.
    const allowed = e.deps === "[step,open]" || e.deps === "[open,step]";
    if (allowed) continue;
    for (const dep of MUTABLE_FORM_DEPS) {
      assert(!new RegExp(`(^|[\\[,])${dep}([,\\]]|$)`).test(e.deps),
        `a focus/scroll effect depends on "${dep}" (deps ${e.deps}) — typing will tear it down`);
    }
  }
});

check("04 the Escape effect's cleanup ONLY removes the listener", () => {
  const escape = effects(MODAL_SRC).find((e) => /event\.key\s*!==\s*"Escape"/.test(e.body));
  assert(escape, "the Escape handler effect was not found");
  const cleanup = escape.body.slice(escape.body.indexOf("return () =>"));
  assert(/removeEventListener/.test(cleanup), "the Escape effect does not remove its listener");
  assert(!/\.focus\(\)/.test(cleanup), "the Escape effect's cleanup restores focus — that reintroduces the keyboard bug");
  assert(!/style\.overflow/.test(cleanup), "the Escape effect's cleanup touches the scroll lock");
  assert(!/paddingRight/.test(cleanup), "the Escape effect's cleanup touches scrollbar compensation");
});

check("05 Escape uses a stable ref so `form` never becomes a dependency", () => {
  assert(/requestCloseRef/.test(MODAL_SRC), "requestCloseRef is gone — Escape will need `form` in its deps again");
  assert(/requestCloseRef\.current\s*=\s*requestClose/.test(MODAL_FLAT), "requestCloseRef is never kept up to date");
});

check("06 opener focus is restored only in the open-lifecycle cleanup", () => {
  const lifecycle = effects(MODAL_SRC).find((e) => /document\.activeElement/.test(e.body));
  assert(lifecycle, "the opener-capturing effect was not found");
  assert(lifecycle.deps === "[open]", `opener capture is keyed to ${lifecycle.deps}, not [open]`);
  assert(/opener\.focus\(\)/.test(lifecycle.body), "the opener is captured but focus is never handed back on close");
});

check("07 the contact-step focus effect keeps its [step, open] boundary", () => {
  const stepEffect = effects(MODAL_SRC).find((e) => /nameInputRef\.current\?\.focus/.test(e.body));
  assert(stepEffect, "the contact-step focus effect was not found");
  assert(stepEffect.deps === "[step,open]", `contact-step focus is keyed to ${stepEffect.deps}, expected [step,open]`);
});

// Same-class scan across the other live focus/scroll surfaces.
const SCANNED = [
  "components/FreeVendorInterestButton.tsx",
  "components/admin/useAdminModalFocus.ts",
  "components/home/HomeServiceLauncher.tsx",
  "components/public-listing/VendorCompareV2.tsx",
  "components/vendor-dashboard-v2/VendorMobileNav.tsx",
];
check("08 no other live modal keys a focus/scroll effect to typed values", () => {
  for (const file of SCANNED) {
    for (const e of effects(code(file))) {
      const touchesFocus =
        /document\.activeElement/.test(e.body) || /\.focus\(\)/.test(e.body) || /style\.overflow/.test(e.body);
      if (!touchesFocus) continue;
      for (const dep of ["form", "touched", "value", "query", "submitting"]) {
        assert(!new RegExp(`(^|[\\[,])${dep}([,\\]]|$)`).test(e.deps),
          `${file}: focus/scroll effect depends on "${dep}" (deps ${e.deps})`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Homepage entry-module layout
// ---------------------------------------------------------------------------
check("09 the desktop 65/35 hero-beside-categories split is gone", () => {
  const grid = CSS_FLAT.match(/\.qf-hero-v2-grid\s*\{[^}]*\}/g) ?? [];
  assert(grid.length > 0, ".qf-hero-v2-grid has no rules at all");
  for (const block of grid) {
    assert(!/grid-template-columns/.test(block),
      `.qf-hero-v2-grid declares grid-template-columns again (${block.trim()}) — the entry module must stay one column`);
  }
  assert(!/65fr/.test(CSS_FLAT) && !/35fr/.test(CSS_FLAT),
    "a 65fr/35fr split is back in the public stylesheet");
});

check("10 DOM order is hero -> categories -> trust", () => {
  const hero = PAGE_FLAT.indexOf("<HomeHeroSlider");
  const launcher = PAGE_FLAT.indexOf("<HomeServiceLauncher");
  const trust = PAGE_FLAT.indexOf("<TrustStripV2");
  assert(hero !== -1 && launcher !== -1 && trust !== -1, "one of hero/launcher/trust is missing from the homepage");
  assert(hero < launcher, "HomeServiceLauncher renders before HomeHeroSlider");
  assert(launcher < trust, "TrustStripV2 renders before HomeServiceLauncher");
});

check("11 neither the hero nor the launcher is duplicated", () => {
  const count = (needle) => PAGE_FLAT.split(needle).length - 1;
  assert(count("<HomeHeroSlider") === 1, "the hero slider is rendered more than once");
  assert(count("<HomeServiceLauncher") === 1, "the service launcher is rendered more than once");
});

check("12 the launcher has an explicit multi-column desktop grid", () => {
  const blocks = CSS_FLAT.match(/\.qf-launcher-grid\s*\{[^}]*\}/g) ?? [];
  const columns = blocks.map((b) => b.match(/grid-template-columns:\s*repeat\((\d+)/)).filter(Boolean).map((m) => Number(m[1]));
  assert(columns.includes(2), "the launcher lost its 2-column mobile grid");
  assert(columns.some((n) => n >= 3), "the launcher has no widened (3+ column) grid for its full-width placement");
  assert(columns.some((n) => n >= 4), "the launcher has no 4-column desktop grid");
});

check("13 the wide tile spans, rather than orphaning, on the desktop grid", () => {
  assert(/\.qf-launcher-item--wide\s*\{\s*grid-column:\s*span 2;\s*\}/.test(CSS_FLAT),
    "the wide launcher tile has no `grid-column: span 2` desktop rule — Civil Work will orphan onto its own row");
});

// ---------------------------------------------------------------------------
// 3. Public phone contract — one rule across every live lead-entry surface
// ---------------------------------------------------------------------------
check("14 /enquiry enforces the same Indian mobile contract as the modal", () => {
  const funnel = code("components/LeadFunnel.tsx");
  assert(/\/\^\[6-9\]\\d\{9\}\$\//.test(funnel.replace(/\s+/g, "")),
    "LeadFunnel does not enforce ^[6-9]\\d{9}$");
  assert(/maxLength=\{10\}/.test(flat(funnel)), "the /enquiry phone field has no 10-character cap");
  assert(/sanitizePhone\(/.test(funnel), "the /enquiry phone field does not sanitize to digits");
  assert(!/length\s*<\s*10/.test(funnel), "the old 'at least 10 digits' check is back — it accepts 11+ digits");
});

// ---------------------------------------------------------------------------
// 4. QF-MOBILE-FORM — the enquiry modal is ONE continuous form
// ---------------------------------------------------------------------------
check("15 [semantic] the modal renders a single form, not a step", () => {
  assert(/function renderSingleForm\s*\(/.test(MODAL_SRC), "renderSingleForm() is gone");
  assert(/\{renderSingleForm\(\)\}/.test(MODAL_FLAT), "the modal body does not render the single form");
  assert(!/function renderStep\s*\(/.test(MODAL_SRC), "the step renderer is back");
  assert(!/\{renderStep\(\)\}/.test(MODAL_FLAT), "the modal body still renders a single step");
});

check("16 [semantic] no wizard step chrome is rendered on any width", () => {
  for (const marker of ["qf-rf-steps", "qf-rf-progress", "qf-rf-phase", "qf-rf-qcount"]) {
    assert(!new RegExp(`className=("|\{\`)[^"\`]*${marker}`).test(MODAL_SRC),
      `the modal still renders wizard chrome: ${marker}`);
  }
  assert(!/role="progressbar"/.test(MODAL_SRC), "a step progress bar is back in the enquiry modal");
  assert(!/Question \$\{questionNumber\}/.test(MODAL_SRC), "the question counter is back");
});

check("17 [semantic] Back / Next step navigation is gone", () => {
  assert(!/function goNext\s*\(/.test(MODAL_SRC), "goNext() is back");
  assert(!/function goBack\s*\(/.test(MODAL_SRC), "goBack() is back");
  assert(!/>\s*Next\s*</.test(MODAL_SRC), "a Next button is back in the enquiry modal");
});

check("18 [semantic] every required control is present in the one form", () => {
  const body = MODAL_SRC.slice(MODAL_SRC.indexOf("function renderSingleForm"));
  for (const id of ["qf-sf-service", "qf-sf-city", "qf-sf-name", "qf-sf-phone",
                    "qf-sf-budget", "qf-sf-property", "qf-sf-timeline", "qf-sf-message"]) {
    assert(body.includes(`id="${id}"`), `the single form is missing ${id}`);
  }
  assert(/GooglePlaceAutocomplete/.test(body), "the Area field lost its Google autocomplete");
  assert(/onManualChange=\{onAreaManualChange\}/.test(body), "the Area manual fallback is gone");
  assert(/type="checkbox"[\s\S]{0,200}form\.shareConsent/.test(body), "the consent checkbox is gone");
  assert(/form\.whatsappSame/.test(body), "the WhatsApp same-as-phone control is gone");
});

check("19 [semantic] service and city are real selects bound to the shared sources", () => {
  const body = MODAL_SRC.slice(MODAL_SRC.indexOf("function renderSingleForm"));
  assert(/mainCategories\.map/.test(body), "the service select does not read mainCategories");
  assert(/activeCities\.map/.test(body), "the city select does not read the admin-managed active cities");
  assert(!/const CITIES\s*=\s*\[/.test(MODAL_SRC), "a hardcoded city list was introduced");
});

check("20 [semantic] the budget band writes the canonical min/max/notSure", () => {
  assert(/const BUDGET_BANDS/.test(MODAL_SRC), "BUDGET_BANDS is gone");
  assert(/function selectBudgetBand/.test(MODAL_SRC), "selectBudgetBand() is gone");
  const fn = MODAL_SRC.slice(MODAL_SRC.indexOf("function selectBudgetBand"));
  for (const field of ["budgetNotSure", "budgetMin", "budgetMax"]) {
    assert(fn.includes(field), `selectBudgetBand no longer writes ${field}`);
  }
  assert(/budget_range: budgetText/.test(MODAL_FLAT), "the canonical budget_range payload field changed");
});

check("21 [semantic] submit is blocked while submitting and validates the whole form", () => {
  assert(/disabled=\{submitting\}/.test(MODAL_SRC), "the submit button is not disabled while submitting");
  assert(/if \(submitting\) return;/.test(MODAL_SRC), "handleSubmit does not guard against a double submit");
  assert(/const invalid = formError\(\);/.test(MODAL_SRC), "handleSubmit does not validate the whole form");
  assert(/function formError/.test(MODAL_SRC), "formError() is gone");
  // formError must delegate to the pre-existing per-step rules, not re-implement them.
  const fe = MODAL_SRC.slice(MODAL_SRC.indexOf("function formError"), MODAL_SRC.indexOf("function markAllTouched"));
  assert(/stepError\(/.test(fe), "formError() re-implements validation instead of reusing stepError()");
});

check("22 [static] the client modal imports no server/business authority", () => {
  for (const banned of ["adminClient", "SUPABASE_SERVICE_ROLE_KEY", "qf_assign_lead_vendors",
                        "services/leadMatchingEngine", "canonicalAssignmentAuthority"]) {
    assert(!MODAL_SRC.includes(banned), `the client enquiry modal reaches for ${banned}`);
  }
});

check("23 [semantic] the consent legal text and share_consent semantics are intact", () => {
  const body = MODAL_SRC.slice(MODAL_SRC.indexOf("function renderSingleForm"));
  assert(/up to 3 verified vendors initially/.test(body), "the consent cap sentence changed");
  assert(/may manually connect me with additional verified vendors/.test(body),
    "the replacement-vendor consent sentence was dropped");
  assert(/href="\/privacy"/.test(body) && /href="\/terms"/.test(body), "a consent policy link was dropped");
  assert(!/shareConsent: true/.test(MODAL_SRC), "consent is pre-checked somewhere");
});

// Mutants for the new contract.
mutant("M15 [mutant] reject: the step renderer comes back",
  MODAL_SRC,
  (s) => s.replace("function renderSingleForm(", "function renderStep(").replace("{renderSingleForm()}", "{renderStep()}"),
  (s) => /function renderSingleForm\s*\(/.test(s) && !/function renderStep\s*\(/.test(s));

mutant("M21 [mutant] reject: the submit button stops being disabled while submitting",
  MODAL_SRC,
  (s) => s.replace("disabled={submitting}", "disabled={false}"),
  (s) => /disabled=\{submitting\}/.test(s));

// ---------------------------------------------------------------------------
// 5. QF-MVP-80.16A — the hero is informational, not a CTA surface
// ---------------------------------------------------------------------------
const HERO = code("components/home/HomeHeroSlider.tsx");
const HERO_RAW = readRaw("components/home/HomeHeroSlider.tsx");
const HERO_FLAT = flat(HERO);

check("24 [semantic] no CTA fields remain on a hero slide", () => {
  assert(!/^\s*primary\s*:/m.test(HERO), "HeroSlide.primary is back");
  assert(!/^\s*secondary\s*[?:]/m.test(HERO), "HeroSlide.secondary is back");
  assert(!/\.qf-hero-slide-actions/.test(CSS_SRC), "the hero action row CSS is back");
  assert(!/qf-hero-slide-actions/.test(HERO), "the hero renders an action row again");
});

check("25 [semantic] the hero renders no enquiry trigger and no CTA link", () => {
  assert(!/EnquiryModalTrigger/.test(HERO), "the hero renders an EnquiryModalTrigger again");
  assert(!/from "next\/link"/.test(HERO), "the hero imports next/link again");
  assert(!/<Link\b/.test(HERO), "the hero renders a Link CTA again");
  // The only buttons left must be carousel navigation.
  const buttons = HERO_FLAT.match(/<button/g) || [];
  assert(buttons.length > 0, "the carousel lost its navigation buttons");
  assert(!/qf-pub-btn/.test(HERO), "a public CTA button class is back inside the hero");
});

check("26 [semantic] the carousel itself is fully preserved", () => {
  const slides = HERO.match(/\bid:\s*"/g) || [];
  assert(slides.length === 3, `expected exactly 3 hero slides, found ${slides.length}`);
  assert(/qf-hero-dots/.test(HERO), "the hero dots are gone");
  assert(/qf-hero-arrows/.test(HERO) || /qf-hero-arrow/.test(HERO), "the hero arrows are gone");
  assert(/INTERVAL_MS/.test(HERO), "autoplay timing is gone");
  assert(/onTouchStart|onPointerDown/.test(HERO), "swipe handling is gone");
  assert(/ArrowLeft|ArrowRight/.test(HERO), "keyboard navigation is gone");
  assert(/prefers-reduced-motion/.test(HERO) || /reduced/i.test(HERO),
    "reduced-motion handling is gone");
});

check("27 [semantic] the homepage keeps its other conversion entry points", () => {
  assert(/<HomeServiceLauncher/.test(PAGE_FLAT), "the service launcher is gone");
  assert(/StickyMobileCTA/.test(PAGE_SRC), "StickyMobileCTA is no longer mounted");
  const hero = PAGE_FLAT.indexOf("<HomeHeroSlider");
  const launcher = PAGE_FLAT.indexOf("<HomeServiceLauncher");
  assert(hero !== -1 && launcher !== -1 && hero < launcher,
    "the service launcher no longer follows the hero");
});

// ---------------------------------------------------------------------------
// 6. QF-MVP-80.16A — dispatch refusal observability stays sanitized
// ---------------------------------------------------------------------------
const TRIGGER = code("lib/communication/leadAssignmentDispatchTrigger.ts");
const TRIGGER_FLAT = flat(TRIGGER);
const WRAPPER = readRaw("ops/production/qf-lead-assignment-dispatch.sh");

check("28 [semantic] refusal reasons are a CLOSED vocabulary", () => {
  assert(/export const DispatchRefusalCategory/.test(TRIGGER), "the refusal vocabulary is gone");
  assert(/SEND_REFUSED_OTHER/.test(TRIGGER), "the catch-all bucket is gone");
  assert(/export function categorizeDispatchRefusal/.test(TRIGGER), "the categoriser is gone");
  // The categoriser must never return the raw code.
  const fn = TRIGGER.slice(TRIGGER.indexOf("export function categorizeDispatchRefusal"));
  const body = fn.slice(0, fn.indexOf(String.fromCharCode(10, 125)));
  assert(!/return code\b/.test(body), "categorizeDispatchRefusal returns the raw internal code");
  assert(/return DispatchRefusalCategory\.SEND_REFUSED_OTHER;/.test(body),
    "an unrecognised code does not fall back to the opaque bucket");
});

check("29 [semantic] the response is still constructed field-by-field", () => {
  const fn = TRIGGER.slice(TRIGGER.indexOf("export function sanitizeDispatchSummary"));
  assert(!/\.\.\.summary/.test(fn), "the sanitizer spreads the summary");
  assert(!/outcomes:/.test(fn), "the sanitizer returns outcomes");
  assert(/refusalReasons: summarizeRefusalReasons\(summary\)/.test(fn),
    "refusalReasons is not produced by the aggregator");
  for (const banned of ["intentId", "assignmentId", "vendorId", "leadId", "destination",
                        "destinationHash", "providerMessageId", "boundaryIso", "message", "stack"]) {
    assert(!new RegExp(`\b${banned}\b\s*:`).test(fn), `the sanitizer returns ${banned}`);
  }
});

check("30 [semantic] the aggregator reads only ok/reason from each outcome", () => {
  const fn = TRIGGER.slice(TRIGGER.indexOf("function summarizeRefusalReasons"));
  const body = fn.slice(0, fn.indexOf(String.fromCharCode(10, 125)));
  assert(/record\.ok/.test(body) && /record\.reason/.test(body), "the aggregator changed shape");
  assert(!/JSON\.stringify/.test(body), "the aggregator serialises an outcome");
  assert(/categorizeDispatchRefusal\(record\.reason\)/.test(body),
    "a raw reason is counted without categorisation");
});

check("31 [static] the cron wrapper accepts and sanitizes the new field", () => {
  assert(/"refusalReasons"/.test(WRAPPER), "the wrapper contract still rejects refusalReasons");
  assert(/test\("\^\[A-Z_\]\+\$"\)/.test(WRAPPER),
    "the wrapper does not constrain reason keys to a safe shape");
  assert(/reason_/.test(WRAPPER), "the wrapper does not log the reason counts");
  // The wrapper must never log the raw body.
  const codeOnly = WRAPPER.split(String.fromCharCode(10)).filter((l) => !/^\s*#/.test(l)).join(String.fromCharCode(10));
  assert(!/log ".*http_body/.test(codeOnly), "the wrapper logs the raw response body");
});

mutant("M29 [mutant] reject: a raw reason field is added to the response",
  TRIGGER,
  (s) => s.replace(
    "    refusalReasons: summarizeRefusalReasons(summary),",
    "    refusalReasons: summarizeRefusalReasons(summary),\n    error: summary?.selectionRefusal,",
  ),
  (s) => {
    const fn = s.slice(s.indexOf("export function sanitizeDispatchSummary"));
    return !/\berror\s*:/.test(fn);
  });

mutant("M24 [mutant] reject: a hero CTA comes back",
  HERO,
  (s) => s.replace("type HeroSlide = {", "type HeroSlide = {\n  primary: string;"),
  (s) => !/^\s*primary\s*:/m.test(s));


// ============================================================================
// QF-UI-HOTFIX-02 — the enquiry modal's ROW CONTRACT.
//
// The wizard had four flow children, so the shell declared four grid tracks.
// The single-form redesign left only header / body / footer, and CSS grid
// auto-placement then handed the SCROLLING body an `auto` track (sized to its
// content) and the footer the flexible `minmax(0, 1fr)` track — which collapses
// to zero once the body has eaten the modal's max-height. On desktop the user
// could scroll to the consent row and still never see "Get Free Team Matches".
//
// The invariant: the flexible track belongs to whichever element owns the
// overflow, and the submit footer is a SIBLING of the scroller, never inside it.
// ============================================================================

const ENQUIRY_CSS = "app/client-enquiry-v2.css";
const ENQUIRY_CSS_SRC = code(ENQUIRY_CSS);
const ENQUIRY_CSS_FLAT = flat(ENQUIRY_CSS_SRC);

/** The `.qf-rf-modal` shell rule body, comments already stripped. */
function modalShellRule(src) {
  const flatSrc = flat(src);
  const i = flatSrc.indexOf(".qf-rf-modal.qf-rf-modal {");
  return i === -1 ? "" : flatSrc.slice(i, flatSrc.indexOf("}", i));
}
/** The `.qf-rf-body` rule body. */
function bodyRule(src) {
  const flatSrc = flat(src);
  const i = flatSrc.indexOf(".qf-rf-body.qf-rf-body {");
  return i === -1 ? "" : flatSrc.slice(i, flatSrc.indexOf("}", i));
}

check("U40 the modal declares exactly THREE tracks: auto minmax(0,1fr) auto", () => {
  const rule = modalShellRule(ENQUIRY_CSS_SRC);
  assert(rule !== "", ".qf-rf-modal shell rule not found");
  assert(/grid-template-rows: auto minmax\(0, ?1fr\) auto;/.test(rule),
    "the modal no longer declares `auto minmax(0, 1fr) auto`");
});

check("U41 the obsolete FOUR-track wizard rule is gone from the stylesheet", () => {
  assert(!/grid-template-rows: auto auto minmax\(0, ?1fr\) auto/.test(ENQUIRY_CSS_FLAT),
    "the four-track wizard grid is back — the submit CTA will be pushed out of the modal");
});

check("U42 the scrolling body can shrink: min-height:0 AND overflow-y:auto", () => {
  const rule = bodyRule(ENQUIRY_CSS_SRC);
  assert(rule !== "", ".qf-rf-body rule not found");
  assert(/min-height: 0;/.test(rule), "min-height:0 is missing — an auto min-height re-breaks the footer");
  assert(/overflow-y: auto;/.test(rule), "the body no longer owns the overflow");
});

check("U43 the submit footer is a SIBLING that follows the scrolling body", () => {
  const bodyAt = MODAL_SRC.indexOf('className="qf-rf-body"');
  const footerAt = MODAL_SRC.indexOf('className="qf-rf-footer qf-sf-footer"');
  assert(bodyAt !== -1, "qf-rf-body element is gone");
  assert(footerAt !== -1, "qf-sf-footer element is gone");
  assert(footerAt > bodyAt, "the submit footer no longer follows the body");
});

check("U44 the submit CTA is NOT inside the scrolling body", () => {
  const bodyAt = MODAL_SRC.indexOf('className="qf-rf-body"');
  const footerAt = MODAL_SRC.indexOf('className="qf-rf-footer qf-sf-footer"');
  const insideBody = MODAL_SRC.slice(bodyAt, footerAt);
  assert(!/qf-sf-cta/.test(insideBody), "the submit CTA was moved into the scroll body");
  assert(!/Get Free Team Matches/.test(insideBody), "the submit CTA label appears inside the scroll body");
});

check("U45 qf-sf-cta lives inside qf-sf-footer", () => {
  const footerAt = MODAL_SRC.indexOf('className="qf-rf-footer qf-sf-footer"');
  const footerEnd = MODAL_SRC.indexOf("</footer>", footerAt);
  const footer = MODAL_SRC.slice(footerAt, footerEnd);
  assert(/qf-sf-cta/.test(footer), "qf-sf-cta is no longer inside the submit footer");
  assert(/Get Free Team Matches/.test(footer), "the CTA label left the submit footer");
  assert(/qf-sf-trust/.test(footer), "the trust line left the submit footer");
});

check("U46 the CTA label appears exactly once in the modal", () => {
  const hits = (MODAL_SRC.match(/Get Free Team Matches/g) || []).length;
  assert(hits === 1, `expected exactly 1 CTA label, found ${hits}`);
});

check("U47 no page-fixed footer positioning was introduced", () => {
  for (const sel of [".qf-rf-footer.qf-rf-footer {", ".qf-sf-footer.qf-sf-footer {"]) {
    const i = ENQUIRY_CSS_FLAT.indexOf(sel);
    assert(i !== -1, `${sel} rule not found`);
    const rule = ENQUIRY_CSS_FLAT.slice(i, ENQUIRY_CSS_FLAT.indexOf("}", i));
    assert(!/position: fixed/.test(rule),
      `${sel} uses position:fixed — a viewport-fixed CTA can escape the modal`);
  }
});

mutant("M40 [mutant] reject: the old four-track wizard grid is restored",
  ENQUIRY_CSS_SRC,
  (s) => s.replace("grid-template-rows: auto minmax(0, 1fr) auto;",
                   "grid-template-rows: auto auto minmax(0, 1fr) auto;"),
  (s) => {
    const rule = modalShellRule(s);
    return /grid-template-rows: auto minmax\(0, ?1fr\) auto;/.test(rule)
      && !/grid-template-rows: auto auto minmax\(0, ?1fr\) auto/.test(flat(s));
  });

mutant("M41 [mutant] reject: the body loses min-height:0",
  ENQUIRY_CSS_SRC,
  (s) => s.replace("  min-height: 0;\n  overflow-y: auto;", "  overflow-y: auto;"),
  (s) => /min-height: 0;/.test(bodyRule(s)));

mutant("M42 [mutant] reject: the submit CTA is moved into the scroll body",
  MODAL_SRC,
  (s) => s.replace('<div className="qf-rf-body" ref={bodyRef}>',
                   '<div className="qf-rf-body" ref={bodyRef}><button className="qf-sf-cta">Get Free Team Matches</button>'),
  (s) => {
    const bodyAt = s.indexOf('className="qf-rf-body"');
    const footerAt = s.indexOf('className="qf-rf-footer qf-sf-footer"');
    return !/qf-sf-cta/.test(s.slice(bodyAt, footerAt));
  });

mutant("M43 [mutant] reject: the footer is pinned to the viewport",
  ENQUIRY_CSS_SRC,
  (s) => s.replace(".qf-sf-footer.qf-sf-footer {", ".qf-sf-footer.qf-sf-footer {\n  position: fixed;"),
  (s) => {
    const f = flat(s);
    const i = f.indexOf(".qf-sf-footer.qf-sf-footer {");
    return !/position: fixed/.test(f.slice(i, f.indexOf("}", i)));
  });

// ============================================================================
let passed = 0;
const failures = [];
for (const { name, fn } of checks) {
  try { fn(); passed += 1; console.log(`   ok    ${name}`); }
  catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
}
console.log(`\n${"=".repeat(78)}`);
console.log(`QF-UI focus + homepage + single form + hero CTA + dispatch observability — passed ${passed}, failed ${failures.length}`);
if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
console.log("=".repeat(78));
process.exit(failures.length ? 1 : 0);
