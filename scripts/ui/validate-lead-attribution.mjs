// ============================================================================
// QuickFurno — scripts/ui/validate-lead-attribution.mjs
//
// QF-UI-TRACKING-01 — lead attribution must survive internal navigation.
//
// WHY THIS EXISTS
//   A production certification lead recorded utm_source / utm_medium /
//   utm_campaign = null with source_url = https://quickfurno.in/. Both live lead
//   surfaces each parsed window.location.search at SUBMIT time only, so a tagged
//   arrival followed by any internal navigation filed an untracked lead. Every
//   rupee of paid acquisition was landing as "Direct / none".
//
// HOW IT CHECKS
//   The behavioural rules EXECUTE the real lib/analytics/leadTracking.ts against
//   simulated browser environments — a fake location plus a fake (or hostile)
//   sessionStorage — so this proves behaviour, not wording. The structural rules
//   read component source to prove the duplicate readers are gone and the shared
//   authority is actually wired in; those are claims no execution can make.
//
//   Source checks run on CODE ONLY: comments are stripped first, so the comments
//   that deliberately NAME the removed pattern (to explain why it is forbidden)
//   can never fail the build.
//
// Run: npm run test:ui:lead-attribution
// ============================================================================
import { readFileSync } from "node:fs";

const TRACKING = "lib/analytics/leadTracking.ts";
const MODAL = "components/ClientEnquiryModal.tsx";
const FUNNEL = "components/LeadFunnel.tsx";
const LAYOUT = "app/layout.tsx";

/** Strip block and line comments so a comment can never satisfy or fail a rule. */
function code(path) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}
const raw = (path) => readFileSync(path, "utf8");

const TRACKING_CODE = code(TRACKING);
const MODAL_CODE = code(MODAL);
const FUNNEL_CODE = code(FUNNEL);
const LAYOUT_CODE = code(LAYOUT);

// ---------------------------------------------------------------------------
// Browser simulation
// ---------------------------------------------------------------------------

function makeStorage({ hostile = false, initial = null } = {}) {
  if (hostile) {
    return {
      getItem() { throw new Error("SecurityError: storage disabled"); },
      setItem() { throw new Error("QuotaExceededError"); },
    };
  }
  const map = new Map();
  if (initial !== null) map.set("qf_lead_utm_v1", initial);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    _map: map,
  };
}

/** Point the module's globals at a simulated page, then run `fn`. */
function withBrowser({ url, storage }, fn) {
  const priorLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const parsed = new URL(url);
  try {
    Object.defineProperty(globalThis, "location", {
      value: { href: parsed.href, search: parsed.search },
      configurable: true, writable: true,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: storage, configurable: true, writable: true,
    });
    return fn();
  } finally {
    if (priorLocation) Object.defineProperty(globalThis, "location", priorLocation);
    else delete globalThis.location;
    if (priorStorage) Object.defineProperty(globalThis, "sessionStorage", priorStorage);
    else delete globalThis.sessionStorage;
  }
}

const T = await import("../../lib/analytics/leadTracking.ts");

// ---------------------------------------------------------------------------

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const eq = (a, b, msg) => assert(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const TAGGED_A = "https://quickfurno.in/?utm_source=facebook&utm_medium=paid_social&utm_campaign=pune_interiors";
const TAGGED_B = "https://quickfurno.in/kitchen?utm_source=google&utm_medium=cpc&utm_campaign=diwali_2026";
const UNTAGGED = "https://quickfurno.in/vendors/some-vendor";
const ALL_FIVE = "https://quickfurno.in/?utm_source=s1&utm_medium=m1&utm_campaign=c1&utm_term=kitchen&utm_content=hero";

// ---- 1. one shared authority, wired into both live surfaces ----------------

check("1 a single shared tracking authority module exists", () => {
  assert(/export function resolveLeadTracking/.test(TRACKING_CODE), "resolveLeadTracking missing");
  assert(/export function captureLeadAttribution/.test(TRACKING_CODE), "captureLeadAttribution missing");
  assert(/qf_lead_utm_v1/.test(TRACKING_CODE), "versioned storage key missing");
});

check("2 the enquiry modal uses the shared authority", () => {
  assert(/from "@\/lib\/analytics\/leadTracking"/.test(MODAL_CODE), "modal does not import the authority");
  assert(/\.\.\.resolveLeadTracking\(\)/.test(MODAL_CODE), "modal payload does not spread resolveLeadTracking()");
  assert(/captureLeadAttribution\(\)/.test(MODAL_CODE), "modal does not capture on mount");
});

check("3 /enquiry (LeadFunnel) uses the shared authority", () => {
  assert(/from "@\/lib\/analytics\/leadTracking"/.test(FUNNEL_CODE), "funnel does not import the authority");
  assert(/\.\.\.resolveLeadTracking\(\)/.test(FUNNEL_CODE), "funnel payload does not spread resolveLeadTracking()");
});

check("4 duplicate local UTM readers are gone from live lead paths", () => {
  for (const [label, src] of [["modal", MODAL_CODE], ["funnel", FUNNEL_CODE]]) {
    assert(!/new URLSearchParams\(\s*window\.location\.search\s*\)/.test(src),
      `${label} still parses window.location.search directly`);
    assert(!/function readTrackingContext|function readTracking\b/.test(src),
      `${label} still defines a local tracking reader`);
    assert(!/utm_source:\s*pick\(/.test(src), `${label} still builds utm_* locally`);
  }
});

check("5 the provider is mounted app-wide so capture runs early", () => {
  assert(/EnquiryModalProvider/.test(LAYOUT_CODE), "layout no longer mounts EnquiryModalProvider");
  // The capture effect must not be keyed to form/step/open state — that is the
  // QF-UI-HOTFIX-01 failure mode.
  const m = /useEffect\(\s*\(\)\s*=>\s*\{\s*captureLeadAttribution\(\);?\s*\}\s*,\s*\[([^\]]*)\]\s*\)/.exec(MODAL_CODE);
  assert(m, "capture effect not found in the expected once-per-mount shape");
  eq(m[1].trim(), "", "capture effect must have an EMPTY dependency array");
});

// ---- behavioural rules: executed against the real module -------------------

check("6 tagged current URL wins over stored attribution", () => {
  const storage = makeStorage({ initial: JSON.stringify({ utm_source: "old", utm_campaign: "old_camp" }) });
  const out = withBrowser({ url: TAGGED_B, storage }, () => T.resolveLeadTracking());
  eq(out.utm_source, "google", "current tagged utm_source must win");
  eq(out.utm_campaign, "diwali_2026", "current tagged utm_campaign must win");
});

check("7 untagged internal navigation retains stored attribution", () => {
  const storage = makeStorage();
  withBrowser({ url: TAGGED_A, storage }, () => T.captureLeadAttribution());
  const out = withBrowser({ url: UNTAGGED, storage }, () => T.resolveLeadTracking());
  eq(out.utm_source, "facebook", "utm_source lost on internal navigation");
  eq(out.utm_medium, "paid_social", "utm_medium lost on internal navigation");
  eq(out.utm_campaign, "pune_interiors", "utm_campaign lost on internal navigation");
});

check("8 a new tagged campaign replaces the previous one", () => {
  const storage = makeStorage();
  withBrowser({ url: TAGGED_A, storage }, () => T.captureLeadAttribution());
  withBrowser({ url: TAGGED_B, storage }, () => T.captureLeadAttribution());
  const out = withBrowser({ url: UNTAGGED, storage }, () => T.resolveLeadTracking());
  eq(out.utm_source, "google", "campaign B must replace campaign A");
  eq(out.utm_campaign, "diwali_2026", "campaign B must replace campaign A");
  assert(out.utm_medium === "cpc", "campaign B medium must replace A's");
});

check("9 campaigns are never merged field-by-field across visits", () => {
  // A carries utm_term; B does not. B must NOT inherit A's term.
  const storage = makeStorage();
  withBrowser({ url: ALL_FIVE, storage }, () => T.captureLeadAttribution());
  const out = withBrowser({ url: TAGGED_B, storage }, () => T.resolveLeadTracking());
  eq(out.utm_source, "google", "B source expected");
  assert(out.utm_term === undefined, "utm_term must not leak from the previous campaign");
  assert(out.utm_content === undefined, "utm_content must not leak from the previous campaign");
});

check("10 all five UTM fields survive capture and resolution", () => {
  const storage = makeStorage();
  withBrowser({ url: ALL_FIVE, storage }, () => T.captureLeadAttribution());
  const out = withBrowser({ url: UNTAGGED, storage }, () => T.resolveLeadTracking());
  eq(out.utm_source, "s1", "utm_source"); eq(out.utm_medium, "m1", "utm_medium");
  eq(out.utm_campaign, "c1", "utm_campaign"); eq(out.utm_term, "kitchen", "utm_term");
  eq(out.utm_content, "hero", "utm_content");
});

check("11 source_url stays the CURRENT submission URL", () => {
  const storage = makeStorage();
  withBrowser({ url: TAGGED_A, storage }, () => T.captureLeadAttribution());
  const out = withBrowser({ url: UNTAGGED, storage }, () => T.resolveLeadTracking());
  eq(out.source_url, UNTAGGED, "source_url must be the page the lead was submitted from");
});

check("12 an untagged visit stores nothing and erases nothing", () => {
  const storage = makeStorage();
  withBrowser({ url: UNTAGGED, storage }, () => T.captureLeadAttribution());
  eq(storage._map.size, 0, "an untagged page must not write a storage record");
  const out = withBrowser({ url: UNTAGGED, storage }, () => T.resolveLeadTracking());
  assert(out.utm_source === undefined, "untagged direct visit must carry no utm_source");
  eq(out.source_url, UNTAGGED, "untagged visit still records source_url");
});

check("13 empty utm values never overwrite a real campaign", () => {
  const storage = makeStorage();
  withBrowser({ url: TAGGED_A, storage }, () => T.captureLeadAttribution());
  const blank = "https://quickfurno.in/?utm_source=&utm_medium=%20";
  const out = withBrowser({ url: blank, storage }, () => T.resolveLeadTracking());
  eq(out.utm_source, "facebook", "blank utm_source must not erase the campaign");
});

check("14 hostile sessionStorage never throws and never blocks submission", () => {
  const storage = makeStorage({ hostile: true });
  let captured;
  assert((() => { try { captured = withBrowser({ url: TAGGED_A, storage }, () => T.captureLeadAttribution()); return true; } catch { return false; } })(),
    "captureLeadAttribution threw on hostile storage");
  const out = withBrowser({ url: TAGGED_A, storage }, () => T.resolveLeadTracking());
  eq(out.utm_source, "facebook", "current-URL attribution must still work without storage");
  eq(out.source_url, TAGGED_A, "source_url must still resolve without storage");
  assert(captured !== undefined, "capture must return a value even when storage fails");
});

check("15 a corrupt stored record degrades to empty, not to a crash", () => {
  const storage = makeStorage({ initial: "{not json" });
  const out = withBrowser({ url: UNTAGGED, storage }, () => T.resolveLeadTracking());
  assert(out.utm_source === undefined, "corrupt record must not surface");
  eq(out.source_url, UNTAGGED, "corrupt record must not break source_url");
});

check("16 server-side rendering (no location, no storage) is safe", () => {
  const priorL = Object.getOwnPropertyDescriptor(globalThis, "location");
  const priorS = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  try {
    delete globalThis.location; delete globalThis.sessionStorage;
    const out = T.resolveLeadTracking();
    assert(out && typeof out === "object", "must return an object during SSR");
    assert(out.utm_source === undefined, "no attribution during SSR");
  } finally {
    if (priorL) Object.defineProperty(globalThis, "location", priorL);
    if (priorS) Object.defineProperty(globalThis, "sessionStorage", priorS);
  }
});

// ---- containment -----------------------------------------------------------

check("17 the tracking authority imports no backend/business authority", () => {
  const imports = [...raw(TRACKING).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert(imports.length === 0, `tracking module must import nothing, found: ${imports.join(", ")}`);
  for (const banned of [
    "supabase", "createClient", "service_role", "fetch(", "XMLHttpRequest",
    "assignLead", "qf_assign", "credit", "vendor", "communication_", "submitLead",
    "auto_assignment", "whatsapp", "meta_whatsapp", "n8n", "leadService",
  ]) {
    assert(!TRACKING_CODE.toLowerCase().includes(banned.toLowerCase()),
      `tracking module must not reference ${banned}`);
  }
});

check("18 the tracking authority performs no network or DB write", () => {
  assert(!/fetch\s*\(|axios|XMLHttpRequest|navigator\.sendBeacon/.test(TRACKING_CODE), "network call present");
  assert(!/localStorage|document\.cookie|indexedDB/.test(TRACKING_CODE),
    "only the versioned sessionStorage key may be used");
  const writes = [...TRACKING_CODE.matchAll(/\.setItem\(/g)];
  assert(writes.length === 1, `expected exactly one setItem, found ${writes.length}`);
});

check("19 every storage touch is wrapped so it cannot throw", () => {
  // getItem / setItem / property access must each sit inside a try block.
  for (const needle of ["getItem", "setItem"]) {
    const idx = TRACKING_CODE.indexOf(needle);
    assert(idx > 0, `${needle} missing`);
    const before = TRACKING_CODE.slice(0, idx);
    assert(before.lastIndexOf("try {") > before.lastIndexOf("}\n"), `${needle} is not inside a try block`);
  }
  const tries = [...TRACKING_CODE.matchAll(/catch\s*\{/g)];
  assert(tries.length >= 5, `expected defensive catches, found ${tries.length}`);
});

// ---- mutants: prove the behavioural rules can actually fail ----------------

check("20 mutant: 'current always wins' would lose attribution on internal navigation", () => {
  // Real behaviour keeps the stored campaign...
  eq(T.chooseAttribution({}, { utm_source: "facebook" }).utm_source, "facebook", "real rule");
  // ...whereas the naive rule (return current unconditionally) would drop it.
  const naive = ((current) => current)({});
  assert(naive.utm_source === undefined, "the mutant must lose attribution");
  assert(T.chooseAttribution({}, { utm_source: "facebook" }).utm_source !== naive.utm_source,
    "real rule and mutant must differ — otherwise this check proves nothing");
});

check("21 mutant: 'stored always wins' would ignore a new campaign", () => {
  eq(T.chooseAttribution({ utm_source: "google" }, { utm_source: "facebook" }).utm_source, "google", "real rule");
  const naive = ((_c, stored) => stored)({ utm_source: "google" }, { utm_source: "facebook" });
  assert(naive.utm_source === "facebook", "the mutant must keep the stale campaign");
});

check("22 mutant: a field-merge would fabricate a campaign nobody ran", () => {
  const a = { utm_source: "facebook", utm_term: "kitchen" };
  const b = { utm_source: "google", utm_medium: "cpc", utm_campaign: "diwali_2026" };
  const merged = { ...a, ...b };
  assert(merged.utm_term === "kitchen", "the merge mutant carries A's term");
  assert(T.chooseAttribution(b, a).utm_term === undefined, "real rule must not merge");
});

// ============================================================================
let passed = 0;
const failures = [];
for (const { name, fn } of checks) {
  try { fn(); passed += 1; console.log(`   ok    ${name}`); }
  catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
}
console.log(`\n${"=".repeat(78)}`);
console.log(`QF-UI-TRACKING-01 lead attribution — passed ${passed}, failed ${failures.length}`);
if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
console.log("=".repeat(78));
process.exit(failures.length ? 1 : 0);
