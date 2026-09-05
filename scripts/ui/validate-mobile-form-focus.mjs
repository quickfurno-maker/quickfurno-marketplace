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

// ============================================================================
let passed = 0;
const failures = [];
for (const { name, fn } of checks) {
  try { fn(); passed += 1; console.log(`   ok    ${name}`); }
  catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
}
console.log(`\n${"=".repeat(78)}`);
console.log(`QF-UI-HOTFIX-01 mobile focus + homepage layout — passed ${passed}, failed ${failures.length}`);
if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
console.log("=".repeat(78));
process.exit(failures.length ? 1 : 0);
