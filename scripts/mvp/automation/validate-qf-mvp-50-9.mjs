// ============================================================================
// QuickFurno — scripts/mvp/automation/validate-qf-mvp-50-9.mjs
//
// QF-MVP-50.9 — exact clarification-request execution authority.
//
// WHAT IS BEING PROVED
//   `client.requirement_collection` and `client.missing_information_reminder`
//   need an `outstandingItem`. The dangerous way to supply one is "the latest
//   clarification request for this lead": a lead can be clarified more than
//   once, so a NEWER request would silently supply content for — and authorize
//   — an OLDER queued job. The client could then be asked about details they
//   were never asked for, or asked again after answering.
//
//   The authority is therefore SOURCE-BOUND: the producer sealed the exact
//   request id into the action's idempotency key, and the executor reads it
//   back out and re-proves it is STILL the lead's current request.
//
//   Two roles are kept apart and both are pinned here:
//     * the exact producer request is MESSAGE-CONTENT authority;
//     * the live lead row is BUSINESS-ELIGIBILITY authority.
//
// VERIFICATION LEVELS — never conflated:
//   [pure]   executes the REAL helper with no I/O.
//   [static] reads production source text for a required contract.
//   [mutant] mutates that text and asserts the static check REJECTS it.
//
// Run: npm run test:mvp:50-9
// ============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const outDir = resolve(".qf-50-9-build");
rmSync(outDir, { recursive: true, force: true });
const tsc = resolve("node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) throw new Error("TypeScript compiler not found. Run npm install first.");

const tsconfigPath = resolve(".qf-50-9-tsconfig.json");
writeFileSync(tsconfigPath, JSON.stringify({
  compilerOptions: {
    module: "commonjs", target: "ES2020", moduleResolution: "node", skipLibCheck: true,
    esModuleInterop: true, strict: true, outDir, rootDir: ".", baseUrl: ".", paths: { "@/*": ["./*"] },
  },
  files: [
    "lib/automation/clientClarificationExecution.ts",
    "lib/communication/businessTemplateVariables.ts",
    "lib/automation/clientDispatchVariables.ts",
  ],
}, null, 2));
try { execFileSync(process.execPath, [tsc, "-p", tsconfigPath], { stdio: "pipe" }); }
finally { rmSync(tsconfigPath, { force: true }); }

const require_ = createRequire(import.meta.url);
const Module = require_("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (typeof request === "string" && request.startsWith("@/")) {
    return originalResolve.call(this, resolve(outDir, request.slice(2)), ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const CLAR = require_(resolve(outDir, "lib/automation/clientClarificationExecution.js"));
const VARS = require_(resolve(outDir, "lib/communication/businessTemplateVariables.js"));
const {
  parseClarificationRequestIdentity,
  deriveOutstandingItem,
  CLARIFICATION_QUESTION_LABELS,
  CLARIFICATION_ACTION_TYPES,
  isClarificationActionType,
} = CLAR;
const { MAX_BUSINESS_VARIABLE_LENGTH } = VARS;
// The clarification builders are the CLIENT dispatch draft builders — they, not
// this phase, remain the final variable-contract authority.
const DISPATCH = require_(resolve(outDir, "lib/automation/clientDispatchVariables.js"));
const { buildClarificationRequestVariables, buildClarificationReminderVariables } = DISPATCH;

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const readRaw = (p) => readFileSync(p, "utf8");
const readCode = (p) => stripComments(readRaw(p));

const CONTRACT_SRC = readCode("lib/automation/clientClarificationExecution.ts");
const SERVICE_SRC = readCode("services/automationClientExecutionService.ts");
const SERVICE_RAW = readRaw("services/automationClientExecutionService.ts");

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function mutant(name, source, mutate, stillPasses) {
  check(name, () => {
    assert(stillPasses(source), "precondition: the rule must PASS on real source");
    const broken = mutate(source);
    assert(broken !== source, "mutation was a no-op — the rule proves nothing");
    assert(!stillPasses(broken), "the rule ACCEPTED a broken source");
  });
}

/**
 * Extract ONE function, signature and body, by BALANCED BRACE MATCHING.
 *
 * A `\n}` delimiter is not safe here: these signatures contain inline object
 * types (`args: { ... }`) whose closing brace sits at column 0, which would end
 * the extraction inside the signature and make every rule below vacuous.
 * The parameter list is skipped by paren-matching first, then the body is taken
 * by brace-matching, so nested blocks and object literals are handled exactly.
 */
function bodyOf(source, signature) {
  const start = source.indexOf(signature);
  assert(start !== -1, `could not find ${signature}`);

  const parenOpen = source.indexOf("(", start);
  assert(parenOpen !== -1, `no parameter list for ${signature}`);
  let depth = 0;
  let i = parenOpen;
  for (; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  assert(depth === 0, `unbalanced parameter list for ${signature}`);

  const braceOpen = source.indexOf("{", i);
  assert(braceOpen !== -1, `no body for ${signature}`);
  let d = 0;
  let j = braceOpen;
  for (; j < source.length; j += 1) {
    if (source[j] === "{") d += 1;
    else if (source[j] === "}") {
      d -= 1;
      if (d === 0) break;
    }
  }
  assert(d === 0, `unbalanced body for ${signature}`);
  return source.slice(start, j + 1);
}

const LEAD = "96477b53-32df-4956-9b9e-5af1583ce114";
const REQ = "bda1a17e-ad6f-41aa-a99c-d619a52a5c8b";
const REQ_HEX = REQ.replace(/-/g, "");
const REQUIREMENT = "client.requirement_collection";
const REMINDER = "client.missing_information_reminder";
const reqKey = (hex = REQ_HEX, lead = LEAD) => `qf_action_v1:${REQUIREMENT}:lead:${lead}:clar${hex}`;
const remKey = (hex = REQ_HEX, lead = LEAD) => `qf_action_v1:${REMINDER}:lead:${lead}:clarrem${hex}`;
const q = (...keys) => keys.map((k) => ({ key: k, text: `RAW GENERATOR TEXT for ${k}` }));

// ---------------------------------------------------------------------------
// 0. Harness self-checks — a rule that cannot fail proves nothing
// ---------------------------------------------------------------------------
check("00 [self] the body extractor isolates ONE COMPLETE function", () => {
  for (const sig of ["async function resolveClarificationExecutionFacts",
                     "function resolveVariableInput",
                     "async function buildClientCommunicationIntent"]) {
    const body = bodyOf(SERVICE_SRC, sig);
    assert(body.length > 300, `${sig}: extracted body is implausibly small — the signature truncated it`);
    assert(!/\nasync function |\nfunction /.test(body),
      `${sig}: the extractor swallowed a sibling function — every per-function rule would be vacuous`);
    const opens = (body.match(/\{/g) || []).length;
    const closes = (body.match(/\}/g) || []).length;
    assert(opens === closes, `${sig}: extraction is not brace-balanced (${opens} vs ${closes})`);
  }
  // The intent builder must contain its own real body markers, not just a signature.
  const build = bodyOf(SERVICE_SRC, "async function buildClientCommunicationIntent");
  assert(/readLeadFacts\(/.test(build) && /args\.builder as/.test(build),
    "the intent-builder extraction stopped inside its signature");
});

check("00b [self] the evidence fixtures are the real shapes", () => {
  assert(REQ_HEX.length === 32, "fixture request hex is not 32 chars");
  assert(reqKey() === `qf_action_v1:client.requirement_collection:lead:${LEAD}:clarbda1a17ead6f41aaa99cd619a52a5c8b`,
    "requirement fixture key drifted from the documented producer form");
  assert(remKey() === `qf_action_v1:client.missing_information_reminder:lead:${LEAD}:clarrembda1a17ead6f41aaa99cd619a52a5c8b`,
    "reminder fixture key drifted from the documented producer form");
});

// ---------------------------------------------------------------------------
// A. [pure] the parser — accepted forms
// ---------------------------------------------------------------------------
check("01 [pure] the requirement form yields the exact request id", () => {
  const r = parseClarificationRequestIdentity({ actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: reqKey() });
  assert(r.ok === true, "requirement key rejected");
  assert(r.requestId === REQ, `expected ${REQ}, got ${r.requestId}`);
});

check("02 [pure] the reminder form yields the exact request id", () => {
  const r = parseClarificationRequestIdentity({ actionType: REMINDER, leadId: LEAD, idempotencyKey: remKey() });
  assert(r.ok === true, "reminder key rejected");
  assert(r.requestId === REQ, `expected ${REQ}, got ${r.requestId}`);
});

check("03 [pure] UUID reconstruction is exact 8-4-4-4-12 for arbitrary hex", () => {
  const hex = "0123456789abcdef0123456789abcdef";
  const r = parseClarificationRequestIdentity({ actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: reqKey(hex) });
  assert(r.ok === true, "valid hex rejected");
  assert(r.requestId === "01234567-89ab-cdef-0123-456789abcdef", `bad reconstruction: ${r.requestId}`);
});

check("04 [pure] CASE: lowercase hex only — uppercase fails closed", () => {
  const upper = REQ_HEX.toUpperCase();
  const r = parseClarificationRequestIdentity({ actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: reqKey(upper) });
  assert(r.ok === false, "uppercase hex was accepted — two spellings would resolve to one request");
  const mixedLead = parseClarificationRequestIdentity({
    actionType: REQUIREMENT, leadId: LEAD.toUpperCase(), idempotencyKey: reqKey(),
  });
  assert(mixedLead.ok === false, "an uppercase lead id was accepted");
});

// ---------------------------------------------------------------------------
// B. [pure] the parser — every refusal
// ---------------------------------------------------------------------------
check("05 [pure] a wrong action is refused", () => {
  assert(parseClarificationRequestIdentity({
    actionType: REMINDER, leadId: LEAD, idempotencyKey: reqKey(),
  }).ok === false, "reminder accepted a requirement key");
  assert(parseClarificationRequestIdentity({
    actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: remKey(),
  }).ok === false, "requirement accepted a reminder key");
});

check("06 [pure] a key naming ANOTHER lead is refused", () => {
  const other = "11111111-2222-3333-4444-555555555555";
  assert(parseClarificationRequestIdentity({
    actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: reqKey(REQ_HEX, other),
  }).ok === false, "an embedded lead mismatch was ignored");
});

check("07 [pure] a wrong entity token is refused", () => {
  const key = `qf_action_v1:${REQUIREMENT}:vendor:${LEAD}:clar${REQ_HEX}`;
  assert(parseClarificationRequestIdentity({ actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: key }).ok === false,
    "a non-lead entity token was accepted");
});

check("08 [pure] a wrong namespace is refused", () => {
  const key = `qf_action_v2:${REQUIREMENT}:lead:${LEAD}:clar${REQ_HEX}`;
  assert(parseClarificationRequestIdentity({ actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: key }).ok === false,
    "a foreign namespace was accepted");
});

check("09 [pure] a wrong / missing evidence prefix is refused", () => {
  for (const ev of [`${REQ_HEX}`, `clr${REQ_HEX}`, `CLAR${REQ_HEX}`, `clarx${REQ_HEX}`]) {
    const key = `qf_action_v1:${REQUIREMENT}:lead:${LEAD}:${ev}`;
    assert(parseClarificationRequestIdentity({ actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: key }).ok === false,
      `evidence "${ev.slice(0, 8)}…" was accepted`);
  }
});

check("10 [pure] empty evidence is refused", () => {
  const key = `qf_action_v1:${REQUIREMENT}:lead:${LEAD}:`;
  assert(parseClarificationRequestIdentity({ actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: key }).ok === false,
    "an empty evidence token was accepted");
});

check("11 [pure] 31 and 33 hex characters are refused", () => {
  assert(parseClarificationRequestIdentity({
    actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: reqKey(REQ_HEX.slice(0, 31)),
  }).ok === false, "31 hex accepted");
  assert(parseClarificationRequestIdentity({
    actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: reqKey(REQ_HEX + "a"),
  }).ok === false, "33 hex accepted");
});

check("12 [pure] non-hex characters are refused", () => {
  assert(parseClarificationRequestIdentity({
    actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: reqKey("g".repeat(32)),
  }).ok === false, "non-hex accepted");
  assert(parseClarificationRequestIdentity({
    actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: reqKey(REQ_HEX.slice(0, 31) + "-"),
  }).ok === false, "a hyphen inside the hex was accepted");
});

check("13 [pure] trailing material and an extra colon are refused", () => {
  assert(parseClarificationRequestIdentity({
    actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: reqKey() + "x",
  }).ok === false, "trailing material accepted");
  assert(parseClarificationRequestIdentity({
    actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: reqKey() + ":extra",
  }).ok === false, "an extra colon segment was accepted");
  assert(parseClarificationRequestIdentity({
    actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: " " + reqKey(),
  }).ok === false, "leading whitespace accepted");
});

check("14 [pure] unknown / non-clarification actions are refused", () => {
  for (const a of ["client.lead_confirmation", "client.matching_update", "vendor.response_reminder", "", null, undefined, 7]) {
    assert(parseClarificationRequestIdentity({ actionType: a, leadId: LEAD, idempotencyKey: reqKey() }).ok === false,
      `action ${String(a)} was accepted`);
  }
});

check("15 [pure] non-string / empty inputs are refused", () => {
  for (const k of [null, undefined, "", 123, {}, []]) {
    assert(parseClarificationRequestIdentity({ actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: k }).ok === false,
      `idempotencyKey ${JSON.stringify(k)} accepted`);
  }
  for (const l of [null, undefined, "", "not-a-uuid", 5]) {
    assert(parseClarificationRequestIdentity({ actionType: REQUIREMENT, leadId: l, idempotencyKey: reqKey() }).ok === false,
      `leadId ${JSON.stringify(l)} accepted`);
  }
});

check("16 [pure] the closed action set is exactly the two clarification actions", () => {
  assert(JSON.stringify([...CLARIFICATION_ACTION_TYPES].sort()) ===
    JSON.stringify([REMINDER, REQUIREMENT].sort()), "the clarification action set changed");
  assert(Object.isFrozen(CLARIFICATION_ACTION_TYPES), "the action set is not frozen");
  assert(isClarificationActionType(REQUIREMENT) && isClarificationActionType(REMINDER), "predicate rejects a real action");
  assert(!isClarificationActionType("client.lead_confirmation"), "predicate accepts a non-clarification action");
});

// ---------------------------------------------------------------------------
// C. [pure] the closed safe-label registry
// ---------------------------------------------------------------------------
const EXPECTED_LABELS = {
  interior_leaf_category: "the interior service you need",
  sofa_work_type: "the sofa work you need",
  painting_work_type: "the painting work you need",
  civil_work_type: "the civil work you need",
  property_type: "your property type",
  property_size: "your property size",
  site_type: "your site type",
  sofa_size: "your sofa size",
  photo_available: "whether you have a photo or video",
  budget: "your budget range",
  timeline: "your preferred timeline",
  area_location: "your area or locality",
};

check("17 [pure] the label map is EXACTLY the twelve governed keys and phrases", () => {
  assert(JSON.stringify(CLARIFICATION_QUESTION_LABELS) === JSON.stringify(EXPECTED_LABELS),
    "the client-safe label registry changed");
  assert(Object.isFrozen(CLARIFICATION_QUESTION_LABELS), "the label registry is not frozen");
});

check("18 [pure] every supported key resolves on its own", () => {
  for (const [key, label] of Object.entries(EXPECTED_LABELS)) {
    const r = deriveOutstandingItem(q(key));
    assert(r.ok === true, `key ${key} failed`);
    assert(r.outstandingItem === label, `key ${key}: expected "${label}", got "${r.outstandingItem}"`);
    assert(r.keyCount === 1, `key ${key}: keyCount wrong`);
  }
});

check("19 [pure] the EXACT staging fixture renders the documented phrase", () => {
  const r = deriveOutstandingItem(q("interior_leaf_category", "property_type"));
  assert(r.ok === true, "the live staging question set failed to derive");
  assert(r.outstandingItem === "the interior service you need and your property type",
    `got "${r.outstandingItem}"`);
  assert(r.keyCount === 2, "keyCount wrong");
});

check("20 [pure] join shape: 1 / 2 / 3 / 5 items", () => {
  assert(deriveOutstandingItem(q("budget")).outstandingItem === "your budget range", "1-item join wrong");
  assert(deriveOutstandingItem(q("budget", "timeline")).outstandingItem ===
    "your budget range and your preferred timeline", "2-item join wrong");
  assert(deriveOutstandingItem(q("budget", "timeline", "site_type")).outstandingItem ===
    "your budget range, your preferred timeline, and your site type", "3-item join wrong");
  assert(deriveOutstandingItem(q("budget", "timeline", "site_type", "sofa_size", "property_type")).outstandingItem ===
    "your budget range, your preferred timeline, your site type, your sofa size, and your property type",
    "5-item join wrong");
});

check("21 [pure] PERSISTED order is preserved, never sorted", () => {
  const forward = deriveOutstandingItem(q("timeline", "budget")).outstandingItem;
  const reverse = deriveOutstandingItem(q("budget", "timeline")).outstandingItem;
  assert(forward === "your preferred timeline and your budget range", `forward order lost: ${forward}`);
  assert(reverse === "your budget range and your preferred timeline", `reverse order lost: ${reverse}`);
  assert(forward !== reverse, "order is being normalised — persisted order is not preserved");
});

check("22 [pure] an unknown question key fails closed", () => {
  assert(deriveOutstandingItem(q("nonexistent_key")).ok === false, "an unknown key was accepted");
  assert(deriveOutstandingItem(q("budget", "nonexistent_key")).ok === false,
    "an unknown key was accepted alongside a known one");
  assert(deriveOutstandingItem(q("__proto__")).ok === false, "a prototype key was accepted");
  assert(deriveOutstandingItem(q("constructor")).ok === false, "an inherited property was accepted");
});

check("23 [pure] empty / malformed questions_json fails closed", () => {
  for (const bad of [null, undefined, [], {}, "", "budget", 5,
                     [{ text: "no key" }], [{ key: 5 }], [{ key: "" }], [null], [["budget"]],
                     [{ key: "budget" }, null]]) {
    assert(deriveOutstandingItem(bad).ok === false, `malformed questions_json accepted: ${JSON.stringify(bad)}`);
  }
});

check("24 [pure] duplicate keys fail closed", () => {
  assert(deriveOutstandingItem(q("budget", "budget")).ok === false, "a duplicated key was accepted");
  assert(deriveOutstandingItem(q("budget", "timeline", "budget")).ok === false,
    "a duplicated key was accepted in a longer set");
});

check("25 [pure] an over-long aggregate fails closed and is NEVER truncated", () => {
  const all = Object.keys(EXPECTED_LABELS);
  const joined = all.map((k) => EXPECTED_LABELS[k]).join(", ");
  assert(joined.length > MAX_BUSINESS_VARIABLE_LENGTH,
    "fixture no longer exceeds the limit — the over-length case is not being exercised");
  const r = deriveOutstandingItem(q(...all));
  assert(r.ok === false, "an over-length outstandingItem was accepted");
  assert(r.outstandingItem === undefined, "a truncated value was returned instead of a refusal");
});

check("26 [pure] no accepted value ever exceeds the limit or carries CR/LF/tab", () => {
  const all = Object.keys(EXPECTED_LABELS);
  for (let n = 1; n <= all.length; n += 1) {
    const r = deriveOutstandingItem(q(...all.slice(0, n)));
    if (r.ok) {
      assert(r.outstandingItem.length <= MAX_BUSINESS_VARIABLE_LENGTH, `n=${n} exceeded the limit`);
      assert(!/[\r\n\t]/.test(r.outstandingItem), `n=${n} carried a control character`);
    }
  }
  for (const label of Object.values(EXPECTED_LABELS)) {
    assert(!/[\r\n\t]/.test(label), `label "${label}" carries a control character`);
  }
});

check("27 [pure] raw generator text is NEVER used as the value", () => {
  const r = deriveOutstandingItem(q("budget", "timeline"));
  assert(r.ok === true, "fixture failed");
  assert(!/RAW GENERATOR TEXT/.test(r.outstandingItem),
    "questions_json[*].text leaked into the client-visible value");
});

// ---------------------------------------------------------------------------
// D. [pure] the existing builders remain the final contract authority
// ---------------------------------------------------------------------------
check("28 [pure] both existing builders accept the derived value and still validate", () => {
  const derived = deriveOutstandingItem(q("interior_leaf_category", "property_type"));
  assert(derived.ok === true, "fixture failed");
  for (const [label, build] of [["request", buildClarificationRequestVariables],
                                ["reminder", buildClarificationReminderVariables]]) {
    const built = build({ clientName: "Asha", outstandingItem: derived.outstandingItem });
    assert(built.ok === true, `${label} builder rejected the derived value`);
    const blank = build({ clientName: "Asha", outstandingItem: "" });
    assert(blank.ok === false, `${label} builder accepted a blank outstandingItem`);
    const tooLong = build({ clientName: "Asha", outstandingItem: "x".repeat(MAX_BUSINESS_VARIABLE_LENGTH + 1) });
    assert(tooLong.ok === false, `${label} builder accepted an over-long outstandingItem`);
    const newline = build({ clientName: "Asha", outstandingItem: "a\nb" });
    assert(newline.ok === false, `${label} builder accepted a newline`);
  }
});

// ---------------------------------------------------------------------------
// E. [static] the executor contract
// ---------------------------------------------------------------------------
const clarBody = () => bodyOf(SERVICE_SRC, "async function resolveClarificationExecutionFacts");
const varBody = () => bodyOf(SERVICE_SRC, "function resolveVariableInput");

check("29 [static] ONLY the two clarification actions enter the parser path", () => {
  const body = clarBody();
  assert(/isClarificationActionType\(definition\.actionType\)/.test(body),
    "the clarification path is not gated on the closed action predicate");
  assert(/return \{ ok: true, outstandingItem: null \};/.test(body),
    "a non-clarification action does not short-circuit with no clarification facts");
  assert((SERVICE_SRC.match(/parseClarificationRequestIdentity\(/g) || []).length === 1,
    "the parser is called from more than one place in the executor");
});

check("30 [static] the exact request is read BY ID, with a narrow projection", () => {
  const body = clarBody();
  assert(/\.from\("lead_clarification_requests"\)/.test(body), "the request table is not read");
  assert(/\.eq\("id", identity\.requestId\)/.test(body), "the request is not read by the parsed id");
  assert(/\.select\("id, lead_id, status, questions_json, missing_fields"\)/.test(body),
    "the request projection changed");
  assert(!/select\("\*"\)/.test(body), "a SELECT * was introduced");
});

check("31 [static] there is NO latest-by-lead clarification query anywhere", () => {
  assert(!/lead_clarification_requests[\s\S]{0,400}?\.eq\("lead_id"/.test(SERVICE_SRC),
    "a clarification request is being selected by lead_id — a newer request could authorize an older job");
  assert(!/lead_clarification_requests[\s\S]{0,400}?\.order\(/.test(SERVICE_SRC),
    "a clarification request query is ordered — that is a latest-by-lead shortcut");
  assert(!/lead_clarification_requests[\s\S]{0,400}?\.limit\(/.test(SERVICE_SRC),
    "a clarification request query is limited — that is a latest-by-lead shortcut");
});

check("32 [static] request.lead_id is proven against the envelope lead", () => {
  assert(/if \(request\.lead_id !== leadId\)/.test(clarBody()),
    "a request belonging to another lead would be accepted");
});

check("33 [static] the full execution-time business reproof is present", () => {
  const body = clarBody();
  assert(/if \(request\.status !== "preview_prepared"\)/.test(body), "request.status is not re-proven");
  assert(/if \(leadRow\.clarification_required !== true\)/.test(body), "clarification_required is not re-proven");
  assert(/if \(leadRow\.clarification_status !== "preview_prepared"\)/.test(body),
    "clarification_status is not re-proven");
  assert(/if \(leadRow\.clarification_last_request_id !== identity\.requestId\)/.test(body),
    "clarification_last_request_id is not proven to be THIS request");
  assert((body.match(/QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE/g) || []).length === 4,
    "the four business-state refusals are not all present");
});

check("34 [static] the reproof runs BEFORE any variable, intent or send work", () => {
  const build = bodyOf(SERVICE_SRC, "async function buildClientCommunicationIntent");
  const clarAt = build.indexOf("resolveClarificationExecutionFacts(");
  const varAt = build.indexOf("resolveVariableInput(");
  const builtAt = build.indexOf("args.builder as");
  const intentAt = build.indexOf("return {\n    ok: true,");
  assert(clarAt !== -1, "the clarification binding is not called from the intent builder");
  assert(varAt !== -1 && builtAt !== -1, "the variable path moved");
  assert(clarAt < varAt, "clarification binding runs AFTER variable resolution");
  assert(clarAt < builtAt, "clarification binding runs AFTER the builder");
  assert(intentAt === -1 || clarAt < intentAt, "clarification binding runs AFTER the intent is returned");
});

check("35 [static] content is derived from question KEYS, not text or missing_fields", () => {
  const body = clarBody();
  assert(/deriveOutstandingItem\(request\.questions_json\)/.test(body),
    "outstandingItem is not derived from the exact request's questions_json");
  assert(!/missing_fields\s*\)/.test(body.replace(/\.select\([^)]*\)/g, "")),
    "missing_fields is being used as content authority");
  assert(!/questions_json[\s\S]{0,80}?\.text/.test(body), "raw question text is being read in the executor");
  assert(!/\.text\b/.test(CONTRACT_SRC.replace(/readQuestionKeys[\s\S]*?\n}/, "")),
    "the pure contract reads free-text question content");
});

check("36 [static] safeContext and n8n can never choose message content", () => {
  const body = clarBody();
  assert(!/safeContext/i.test(body), "safeContext reached the clarification authority");
  assert(!/safeContext/i.test(varBody()), "safeContext reached variable resolution");
  assert(!/safeContext/i.test(CONTRACT_SRC), "safeContext reached the pure contract");
  assert(!/n8n/i.test(CONTRACT_SRC), "n8n reached the pure contract");
  // outstandingItem is a PARAMETER of resolveVariableInput — it cannot be
  // sourced there from anything the caller did not prove.
  assert(/function resolveVariableInput\(\s*definition: ClientAutomationDispatchDefinition,\s*lead: LeadFacts,\s*outstandingItem: string \| null,\s*\)/.test(SERVICE_SRC),
    "resolveVariableInput no longer receives the proven outstandingItem as a parameter");
});

check("37 [static] both clarification actions use the existing builders and the proven value", () => {
  const body = varBody();
  assert(/case "client\.requirement_collection":\s*case "client\.missing_information_reminder":/.test(body),
    "the two clarification cases are no longer handled together");
  assert(/if \(outstandingItem === null\) return unresolved;/.test(body),
    "a null outstandingItem no longer fails closed");
  assert(/return \{ ok: true, input: \{ clientName: lead\.name, outstandingItem \} \};/.test(body),
    "the clarification variable input changed");
  assert(/getClientActionVariableBuilder/.test(SERVICE_SRC), "the registry builder lookup was removed");
  assert(/args\.builder as/.test(SERVICE_SRC), "the existing builder is no longer the final authority");
});

check("38 [static] every OTHER client action's variable input is unchanged", () => {
  const body = varBody();
  assert(/case "client\.lead_confirmation":\s*return \{ ok: true, input: \{ clientName: lead\.name \} \};/.test(body),
    "lead_confirmation input changed");
  assert(/case "client\.matching_update":[\s\S]{0,160}?matchedVendorCount: lead\.matchedVendorCount/.test(body),
    "matching_update input changed");
  assert(/case "client\.lead_status_update":[\s\S]{0,160}?leadStatusLabel: lead\.status/.test(body),
    "lead_status_update input changed");
  assert(/case "client\.transactional_followup":[\s\S]{0,160}?leadReference: lead\.reference/.test(body),
    "transactional_followup input changed");
  assert(/default:\s*return unresolved;/.test(body), "the fail-closed default was removed");
});

check("39 [static] the infrastructure/business distinction is preserved", () => {
  const body = clarBody();
  assert((body.match(/QF_EXEC_LEAD_LOOKUP_FAILED/g) || []).length === 2,
    "both lookups must map a query error to the infrastructure code");
  assert(/if \(requestRead\.error\) return \{ ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" \};/.test(body),
    "the request lookup error is not infrastructure");
  assert(/if \(leadRead\.error\) return \{ ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" \};/.test(body),
    "the lead lookup error is not infrastructure");
  assert(/if \(!request\) return \{ ok: false, code: "QF_EXEC_VARIABLES_UNRESOLVED" \};/.test(body),
    "a missing request row is not a fail-closed unresolved");
});

check("40 [static] QF-MVP-50.9 adds no send, provider, write or migration", () => {
  const body = clarBody();
  assert(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(body),
    "the clarification authority performs a database write");
  assert(!/graph\.facebook\.com|fetch\(|sendTemplateMessage|sendResolvedTemplate|CommunicationService/i.test(body),
    "a provider or send call was added");
  assert(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|fetch\(/.test(CONTRACT_SRC),
    "the pure contract performs I/O");
  assert(!/adminClient|process\.env|Date\.now|Math\.random/.test(CONTRACT_SRC),
    "the pure contract is no longer pure");
  const migrations = execFileSync("git",
    ["diff", "--name-only", "a6047ae216f5abf87da7196de13616e7b09c3f46", "--", "supabase/migrations"],
    { encoding: "utf8" });
  assert(migrations.trim() === "", `QF-MVP-50.9 must add no migration, but touched: ${migrations.trim()}`);
});

check("41 [static] no PII is logged by the clarification path", () => {
  const body = clarBody();
  const logs = body.match(/console\.(info|log|warn|error)\([\s\S]*?\);/g) || [];
  for (const block of logs) {
    assert(!/questions_json|outstandingItem|clientName|preview_message|lead\.name|phone/i.test(block),
      `a clarification log block may carry PII: ${block.slice(0, 90)}`);
  }
  assert(!/console\./.test(CONTRACT_SRC), "the pure contract logs");
});

check("42 [static] job ids are never hardcoded as runtime authority", () => {
  for (const [label, src] of [["contract", CONTRACT_SRC], ["service", SERVICE_SRC]]) {
    assert(!/4d9d5917|009a2154|bda1a17e|96477b53/.test(src),
      `${label} hardcodes a staging evidence id as runtime logic`);
  }
});

// ---------------------------------------------------------------------------
// E2. [pure+static] QF-MVP-50.9-C1 — the two idempotency identities
//
// Independent review found the first revision passed the ATTEMPT-scoped
// communication key (qf_auto_v1:<job>:<attempt>) into the clarification parser,
// which accepts only qf_action_v1 — so both clarification actions still failed
// closed. The parser was right; the WIRING was wrong. These rules pin the
// separation structurally so the swap cannot be reintroduced silently.
// ---------------------------------------------------------------------------
const execBody = () => bodyOf(SERVICE_SRC, "export async function executeClientAutomationForN8nTransport");

check("43 [pure] a qf_auto_v1 COMMUNICATION key can never resolve a clarification request", () => {
  const job = "7f2c1a44-9c6e-4a2b-8d11-77aa0b3c5e91";
  const attempt = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
  const communicationKey = `qf_auto_v1:${job}:${attempt}`;
  for (const action of [REQUIREMENT, REMINDER]) {
    const r = parseClarificationRequestIdentity({ actionType: action, leadId: LEAD, idempotencyKey: communicationKey });
    assert(r.ok === false, `${action}: the communication key was accepted as producer evidence`);
  }
  // …and the matching ACTION key for the same lead still resolves exactly.
  assert(parseClarificationRequestIdentity({
    actionType: REQUIREMENT, leadId: LEAD, idempotencyKey: reqKey(),
  }).requestId === REQ, "the action key stopped resolving");
  assert(parseClarificationRequestIdentity({
    actionType: REMINDER, leadId: LEAD, idempotencyKey: remKey(),
  }).requestId === REQ, "the reminder action key stopped resolving");
});

check("44 [static] the executor derives BOTH identities from their own sources", () => {
  const body = execBody();
  assert(/const communicationIdempotencyKey = buildAutomationCommunicationIdempotencyKey\(/.test(body),
    "the attempt-scoped communication key is not built under its explicit name");
  assert(/actionIdempotencyKey: envelope\.idempotencyKey,/.test(body),
    "the ACTION key is not taken from envelope.idempotencyKey");
  assert(/\n\s*communicationIdempotencyKey,\n/.test(body),
    "the communication key is not passed separately to the intent builder");
  // The action key must never be REBUILT from parts — the envelope already
  // carries Core's own source identity.
  assert(!/qf_action_v1/.test(body), "the executor hand-builds a qf_action_v1 key instead of using the envelope");
});

check("45 [static] the intent-builder boundary carries NO generic idempotency name", () => {
  const sig = SERVICE_SRC.slice(
    SERVICE_SRC.indexOf("async function buildClientCommunicationIntent"),
    SERVICE_SRC.indexOf("}): Promise<PreparedIntent>"),
  );
  assert(/actionIdempotencyKey: string;/.test(sig), "actionIdempotencyKey is not an explicit argument");
  assert(/communicationIdempotencyKey: string;/.test(sig), "communicationIdempotencyKey is not an explicit argument");
  assert(!/(^|[^a-zA-Z])idempotencyKey: string;/.test(sig),
    "a generic `idempotencyKey` survives at the boundary — the two identities are confusable again");
});

check("46 [static] the parser receives the ACTION key and only the ACTION key", () => {
  const build = bodyOf(SERVICE_SRC, "async function buildClientCommunicationIntent");
  assert(/resolveClarificationExecutionFacts\(\s*args\.definition,\s*args\.leadId,\s*args\.actionIdempotencyKey,\s*\)/.test(build),
    "the clarification binding does not receive args.actionIdempotencyKey");
  assert(!/resolveClarificationExecutionFacts\([\s\S]{0,120}?communicationIdempotencyKey/.test(build),
    "the clarification binding receives the communication key");
  const clar = clarBody();
  assert(/actionIdempotencyKey: string,/.test(clar), "the resolver no longer demands the action key by name");
  assert(/idempotencyKey: actionIdempotencyKey,/.test(clar),
    "the parser is not handed the action key");
  assert(!/communicationIdempotencyKey/.test(clar), "the communication key reached the clarification resolver");
});

check("47 [static] the communication row keeps its own ATTEMPT-scoped identity", () => {
  const build = bodyOf(SERVICE_SRC, "async function buildClientCommunicationIntent");
  assert(/idempotency_key: args\.communicationIdempotencyKey,/.test(build),
    "the communication intent no longer uses the attempt-scoped key");
  assert(!/idempotency_key: args\.actionIdempotencyKey/.test(build),
    "the ACTION key became the communication row's send identity");
});

check("48 [static] durable evidence is read with the COMMUNICATION key only", () => {
  const body = execBody();
  const calls = body.match(/readCommunicationEvidence\([^)]*\)/g) || [];
  assert(calls.length === 2, `expected exactly 2 evidence reads, found ${calls.length}`);
  for (const c of calls) {
    assert(/readCommunicationEvidence\(communicationIdempotencyKey\)/.test(c),
      `an evidence read does not use the communication key: ${c}`);
  }
  assert(!/readCommunicationEvidence\(envelope\.idempotencyKey\)|readCommunicationEvidence\(actionIdempotencyKey\)/.test(SERVICE_SRC),
    "durable evidence is being read with the ACTION key");
});

check("49 [static] envelope.idempotencyKey is used for clarification evidence and nothing else", () => {
  const uses = (SERVICE_SRC.match(/envelope\.idempotencyKey/g) || []).length;
  assert(uses === 1, `envelope.idempotencyKey is used ${uses} times — it must feed only the action-key argument`);
  assert(/actionIdempotencyKey: envelope\.idempotencyKey,/.test(SERVICE_SRC),
    "envelope.idempotencyKey is not wired to actionIdempotencyKey");
});

// ---------------------------------------------------------------------------
// F. [mutant] every rule must REJECT a broken source
// ---------------------------------------------------------------------------
mutant("M01 [mutant] reject: latest-request-by-lead instead of the sealed request",
  SERVICE_RAW,
  (s) => s.replace('.eq("id", identity.requestId)', '.eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1)'),
  (s) => {
    const c = stripComments(s);
    return /\.eq\("id", identity\.requestId\)/.test(c) &&
      !/lead_clarification_requests[\s\S]{0,400}?\.eq\("lead_id"/.test(c);
  });

mutant("M02 [mutant] reject: lead.clarification_missing_fields as content authority",
  SERVICE_RAW,
  (s) => s.replace("const derived = deriveOutstandingItem(request.questions_json);",
                   "const derived = deriveOutstandingItem(leadRow.clarification_missing_fields);"),
  (s) => /deriveOutstandingItem\(request\.questions_json\)/.test(stripComments(s)));

mutant("M03 [mutant] reject: safeContext supplies outstandingItem",
  SERVICE_RAW,
  (s) => s.replace("  if (outstandingItem === null) return unresolved;",
                   "  const fromContext = (definition as unknown as { safeContext?: { outstandingItem?: string } }).safeContext?.outstandingItem;\n      if (outstandingItem === null && !fromContext) return unresolved;"),
  (s) => !/safeContext/i.test(bodyOf(stripComments(s), "function resolveVariableInput")));

mutant("M04 [mutant] reject: an n8n-supplied outstandingItem",
  SERVICE_RAW,
  (s) => s.replace("  if (outstandingItem === null) return unresolved;",
                   "  const n8nOutstandingItem = null as string | null;\n      if (outstandingItem === null && n8nOutstandingItem === null) return unresolved;"),
  (s) => !/n8n[A-Za-z]*outstandingItem/i.test(bodyOf(stripComments(s), "function resolveVariableInput")));

mutant("M05 [mutant] reject: the embedded lead mismatch is ignored",
  SERVICE_RAW,
  (s) => s.replace("  if (request.lead_id !== leadId) return { ok: false, code: \"QF_EXEC_VARIABLES_UNRESOLVED\" };", ""),
  (s) => /if \(request\.lead_id !== leadId\)/.test(stripComments(s)));

mutant("M06 [mutant] reject: request.status is no longer re-proven",
  SERVICE_RAW,
  (s) => s.replace('  if (request.status !== "preview_prepared") {', "  if (false) {"),
  (s) => /if \(request\.status !== "preview_prepared"\)/.test(stripComments(s)));

mutant("M07 [mutant] reject: clarification_last_request_id is ignored",
  SERVICE_RAW,
  (s) => s.replace("  if (leadRow.clarification_last_request_id !== identity.requestId) {", "  if (false) {"),
  (s) => /if \(leadRow\.clarification_last_request_id !== identity\.requestId\)/.test(stripComments(s)));

mutant("M08 [mutant] reject: clarification_required is ignored",
  SERVICE_RAW,
  (s) => s.replace("  if (leadRow.clarification_required !== true) {", "  if (false) {"),
  (s) => /if \(leadRow\.clarification_required !== true\)/.test(stripComments(s)));

mutant("M09 [mutant] reject: clarification_status is ignored",
  SERVICE_RAW,
  (s) => s.replace('  if (leadRow.clarification_status !== "preview_prepared") {', "  if (false) {"),
  (s) => /if \(leadRow\.clarification_status !== "preview_prepared"\)/.test(stripComments(s)));

mutant("M10 [mutant] reject: the whole clarification reproof is removed",
  SERVICE_RAW,
  (s) => s.replace("  const clarification = await resolveClarificationExecutionFacts(", "  const clarification = { ok: true, outstandingItem: null } as const; void resolveClarificationExecutionFacts0("),
  (s) => {
    const build = bodyOf(stripComments(s), "async function buildClientCommunicationIntent");
    return /await resolveClarificationExecutionFacts\(/.test(build);
  });

mutant("M11 [mutant] reject: the binding runs AFTER variables are resolved",
  SERVICE_RAW,
  (s) => {
    const c = s;
    const block = "  const clarification = await resolveClarificationExecutionFacts(\n    args.definition,\n    args.leadId,\n    args.actionIdempotencyKey,\n  );\n  if (!clarification.ok) return { ok: false, code: clarification.code };\n\n";
    if (!c.includes(block)) throw new Error("mutation anchor missing");
    return c.replace(block, "").replace("  const built = (args.builder", block + "  const built = (args.builder");
  },
  (s) => {
    const build = bodyOf(stripComments(s), "async function buildClientCommunicationIntent");
    return build.indexOf("resolveClarificationExecutionFacts(") < build.indexOf("resolveVariableInput(");
  });

mutant("M12 [mutant] reject: raw questions_json[*].text becomes the value",
  SERVICE_RAW,
  (s) => s.replace("const derived = deriveOutstandingItem(request.questions_json);",
                   "const derived = { ok: true, outstandingItem: (request.questions_json as { text: string }[])[0].text };"),
  (s) => /deriveOutstandingItem\(request\.questions_json\)/.test(stripComments(s)));

mutant("M13 [mutant] reject: a DB write is added to the clarification path",
  SERVICE_RAW,
  (s) => s.replace('    .from("lead_clarification_requests")',
                   '    .from("lead_clarification_requests")\n    .update({ status: "sent" })'),
  (s) => !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(bodyOf(stripComments(s), "async function resolveClarificationExecutionFacts")));

mutant("M14 [mutant] reject: a provider send call is added",
  SERVICE_RAW,
  (s) => s.replace("  const derived = deriveOutstandingItem(request.questions_json);",
                   "  await fetch(\"https://graph.facebook.com/v20.0/messages\");\n  const derived = deriveOutstandingItem(request.questions_json);"),
  (s) => !/graph\.facebook\.com|fetch\(/i.test(bodyOf(stripComments(s), "async function resolveClarificationExecutionFacts")));

mutant("M15 [mutant] reject: a SELECT * replaces the narrow projection",
  SERVICE_RAW,
  (s) => s.replace('.select("id, lead_id, status, questions_json, missing_fields")', '.select("*")'),
  (s) => /\.select\("id, lead_id, status, questions_json, missing_fields"\)/.test(stripComments(s)));

mutant("M16 [mutant] reject: non-clarification actions enter the parser path",
  SERVICE_RAW,
  (s) => s.replace("  if (!isClarificationActionType(definition.actionType)) {", "  if (false) {"),
  (s) => /isClarificationActionType\(definition\.actionType\)/.test(bodyOf(stripComments(s), "async function resolveClarificationExecutionFacts")));

mutant("M17 [mutant] reject: a null outstandingItem stops failing closed",
  SERVICE_RAW,
  (s) => s.replace("      if (outstandingItem === null) return unresolved;",
                   '      if (outstandingItem === null) return { ok: true, input: { clientName: lead.name, outstandingItem: "more details" } };'),
  (s) => /if \(outstandingItem === null\) return unresolved;/.test(stripComments(s)));

mutant("M18 [mutant] reject: an unrelated client action's variables are changed",
  SERVICE_RAW,
  (s) => s.replace('    case "client.lead_confirmation":\n      return { ok: true, input: { clientName: lead.name } };',
                   '    case "client.lead_confirmation":\n      return { ok: true, input: { clientName: lead.name, extra: 1 } };'),
  (s) => /case "client\.lead_confirmation":\s*return \{ ok: true, input: \{ clientName: lead\.name \} \};/.test(
    bodyOf(stripComments(s), "function resolveVariableInput")));

mutant("M19 [mutant] reject: a lookup error is downgraded from infrastructure",
  SERVICE_RAW,
  (s) => s.replace('  if (requestRead.error) return { ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" };',
                   '  if (requestRead.error) return { ok: false, code: "QF_EXEC_VARIABLES_UNRESOLVED" };'),
  (s) => (bodyOf(stripComments(s), "async function resolveClarificationExecutionFacts")
    .match(/QF_EXEC_LEAD_LOOKUP_FAILED/g) || []).length === 2);

// --- mutants against the PURE contract -------------------------------------
mutant("M20 [mutant] reject: an unknown question key gets a default phrase",
  CONTRACT_SRC,
  (s) => s.replace("      return { ok: false };\n    }\n    labels.push(CLARIFICATION_QUESTION_LABELS[key]);",
                   '      labels.push("more details");\n      continue;\n    }\n    labels.push(CLARIFICATION_QUESTION_LABELS[key]);'),
  (s) => {
    const body = bodyOf(s, "export function deriveOutstandingItem");
    return /hasOwnProperty\.call\(CLARIFICATION_QUESTION_LABELS, key\)\) \{\s*return \{ ok: false \};/.test(body);
  });

mutant("M21 [mutant] reject: an over-long value is silently truncated",
  CONTRACT_SRC,
  (s) => s.replace("  if (outstandingItem.length > MAX_BUSINESS_VARIABLE_LENGTH) return { ok: false };",
                   "  outstandingItem = outstandingItem.slice(0, MAX_BUSINESS_VARIABLE_LENGTH);"),
  (s) => /if \(outstandingItem\.length > MAX_BUSINESS_VARIABLE_LENGTH\) return \{ ok: false \};/.test(s));

mutant("M22 [mutant] reject: only the first question is used",
  CONTRACT_SRC,
  (s) => s.replace("  if (labels.length === 1) {\n    outstandingItem = labels[0];\n  } else if",
                   "  if (labels.length >= 1) {\n    outstandingItem = labels[0];\n  } else if"),
  (s) => /if \(labels\.length === 1\) \{\s*outstandingItem = labels\[0\];/.test(s));

mutant("M23 [mutant] reject: keys are alphabetically sorted, losing persisted order",
  CONTRACT_SRC,
  (s) => s.replace("  const labels: string[] = [];", "  const labels: string[] = [];\n  keys = [...keys].sort() as readonly string[];"),
  (s) => !/keys\s*=\s*\[\.\.\.keys\]\.sort\(\)|\.sort\(\)/.test(bodyOf(s, "export function deriveOutstandingItem")));

mutant("M24 [mutant] reject: duplicate keys are silently de-duplicated",
  CONTRACT_SRC,
  (s) => s.replace("  if (new Set(keys).size !== keys.length) return { ok: false };", ""),
  (s) => /if \(new Set\(keys\)\.size !== keys\.length\) return \{ ok: false \};/.test(s));

mutant("M25 [mutant] reject: the parser accepts a malformed key by prefix matching",
  CONTRACT_SRC,
  (s) => s.replace("  if (segments.length !== 5) return { ok: false };", "  if (segments.length < 5) return { ok: false };"),
  (s) => /if \(segments\.length !== 5\) return \{ ok: false \};/.test(s));

mutant("M26 [mutant] reject: the hex length check is loosened",
  CONTRACT_SRC,
  (s) => s.replace("const LOWER_HEX_32 = /^[0-9a-f]{32}$/;", "const LOWER_HEX_32 = /^[0-9a-f]{31,33}$/;"),
  (s) => /const LOWER_HEX_32 = \/\^\[0-9a-f\]\{32\}\$\/;/.test(s));

mutant("M27 [mutant] reject: the embedded lead id is no longer compared",
  CONTRACT_SRC,
  (s) => s.replace("  if (embeddedLeadId !== leadId) return { ok: false };", ""),
  (s) => /if \(embeddedLeadId !== leadId\) return \{ ok: false \};/.test(s));

mutant("M28 [mutant] reject: the action prefix is no longer compared",
  CONTRACT_SRC,
  (s) => s.replace("  if (action !== actionType) return { ok: false };", ""),
  (s) => /if \(action !== actionType\) return \{ ok: false \};/.test(s));

// --- C1 mutants: the exact wiring swap independent review caught ------------
mutant("C1-M01 [mutant] reject: the call site feeds the COMMUNICATION key as the action key",
  SERVICE_RAW,
  (s) => s.replace("    actionIdempotencyKey: envelope.idempotencyKey,", "    actionIdempotencyKey: communicationIdempotencyKey,"),
  (s) => /actionIdempotencyKey: envelope\.idempotencyKey,/.test(stripComments(s)));

mutant("C1-M02 [mutant] reject: the parser is handed the communication key",
  SERVICE_RAW,
  (s) => s.replace("    args.actionIdempotencyKey,\n  );", "    args.communicationIdempotencyKey,\n  );"),
  (s) => /resolveClarificationExecutionFacts\(\s*args\.definition,\s*args\.leadId,\s*args\.actionIdempotencyKey,\s*\)/.test(
    bodyOf(stripComments(s), "async function buildClientCommunicationIntent")));

mutant("C1-M03 [mutant] reject: the ACTION key becomes the communication row identity",
  SERVICE_RAW,
  (s) => s.replace("      idempotency_key: args.communicationIdempotencyKey,", "      idempotency_key: args.actionIdempotencyKey,"),
  (s) => /idempotency_key: args\.communicationIdempotencyKey,/.test(stripComments(s)) &&
         !/idempotency_key: args\.actionIdempotencyKey/.test(stripComments(s)));

mutant("C1-M04 [mutant] reject: durable evidence is read with the ACTION key",
  SERVICE_RAW,
  (s) => s.replace("  const existingEvidence = await readCommunicationEvidence(communicationIdempotencyKey);",
                   "  const existingEvidence = await readCommunicationEvidence(envelope.idempotencyKey);"),
  (s) => {
    const body = bodyOf(stripComments(s), "export async function executeClientAutomationForN8nTransport");
    const calls = body.match(/readCommunicationEvidence\([^)]*\)/g) || [];
    return calls.length === 2 && calls.every((c) => /readCommunicationEvidence\(communicationIdempotencyKey\)/.test(c));
  });

mutant("C1-M05 [mutant] reject: the two arguments collapse back into one generic name",
  SERVICE_RAW,
  (s) => s.replace("  /** qf_action_v1 — ACTION-scoped producer identity. Clarification evidence only. */\n  actionIdempotencyKey: string;\n  /** qf_auto_v1 — ATTEMPT-scoped. The communication row's own identity. */\n  communicationIdempotencyKey: string;",
                   "  idempotencyKey: string;"),
  (s) => {
    const c = stripComments(s);
    const sig = c.slice(c.indexOf("async function buildClientCommunicationIntent"), c.indexOf("}): Promise<PreparedIntent>"));
    return /actionIdempotencyKey: string;/.test(sig) && /communicationIdempotencyKey: string;/.test(sig) &&
      !/(^|[^a-zA-Z])idempotencyKey: string;/.test(sig);
  });

mutant("C1-M06 [mutant] reject: the action key is hand-rebuilt instead of taken from the envelope",
  SERVICE_RAW,
  (s) => s.replace("    actionIdempotencyKey: envelope.idempotencyKey,",
                   "    actionIdempotencyKey: `qf_action_v1:${envelope.actionType}:lead:${envelope.entityId}:clar`,"),
  (s) => {
    const body = bodyOf(stripComments(s), "export async function executeClientAutomationForN8nTransport");
    return /actionIdempotencyKey: envelope\.idempotencyKey,/.test(body) && !/qf_action_v1/.test(body);
  });

// ============================================================================
(async () => {
  let passed = 0; const failures = [];
  for (const { name, fn } of checks) {
    try { await fn(); passed += 1; console.log(`   ok    ${name}`); }
    catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
  }
  rmSync(outDir, { recursive: true, force: true });
  console.log(`\n${"=".repeat(78)}`);
  console.log(`QF-MVP-50.9 exact clarification-request execution authority — passed ${passed}, failed ${failures.length}`);
  if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
  console.log("=".repeat(78));
  process.exit(failures.length ? 1 : 0);
})();
