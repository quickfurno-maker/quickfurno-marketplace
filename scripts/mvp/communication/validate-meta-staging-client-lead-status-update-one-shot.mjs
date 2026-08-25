// ============================================================================
// QF-MVP-40-R7K — validator for the ONE-SHOT staging CLIENT lead-status recovery.
// OFFLINE. Calls no Meta endpoint, submits nothing, sends nothing, reads no credential.
//
// Every rule is paired with a MUTATION that must be killed: a rule that cannot fail
// proves nothing. The payload, pre-state, decision and exit-code layers are pure and are
// driven here with fixtures; the non-negotiable structural properties (no messaging
// endpoint, no DELETE/PUT/PATCH, no DB, no selector, exactly one createOnce) are proved
// by scanning the operator source, because those are properties of the FILE.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ClientPreState, EXPECTED_BODY_TEXT, EXPECTED_IDENTITY_DIGESTS, EXPECTED_PAYLOAD_FINGERPRINT,
  ExitCode, OWNER_ACK_FLAG, Outcome, PreState, REQUIRED_PACKET_STATE, REQUIRED_TEMPLATE_FIELDS,
  TARGET_CATEGORY, TARGET_LANGUAGE, TARGET_TEMPLATE_KEY, TARGET_TEMPLATE_NAME,
  classifyPreState, exitCodeForOutcome, loadCanonicalPayload,
} from "./create-meta-staging-client-lead-status-update-once.mjs";
import {
  classifyLiveAssets, decide, makeHttp, parseFlags, sha256Hex, validateIdentity,
} from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";

const OPERATOR = "scripts/mvp/communication/create-meta-staging-client-lead-status-update-once.mjs";
const VENDOR_OPERATOR = "scripts/mvp/communication/create-meta-staging-vendor-onboarding-reminder-once.mjs";
const CLIENT_MATCHING_OPERATOR = "scripts/mvp/communication/create-meta-staging-client-matching-update-once.mjs";
const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";

const code = readFileSync(resolve(OPERATOR), "utf8");
/** Executable code only — the header deliberately DISCUSSES what the operator must not do. */
const codeOnly = code
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
/** …and with string/template literals blanked, for control-flow-only rules. */
const codeNoStrings = codeOnly
  .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
  .replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""')
  .replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''");

const packet = JSON.parse(readFileSync(resolve(PACKET), "utf8"));
const vendorSrc = readFileSync(resolve(VENDOR_OPERATOR), "utf8");
const matchingSrc = readFileSync(resolve(CLIENT_MATCHING_OPERATOR), "utf8");

// Public, non-secret Meta asset ids, used ONLY as offline fixtures.
const REAL = { app: "2097008694503517", waba: "27861262223494153", phone: "1333595106493545" };
const goodEnv = () => ({
  QF_META_GRAPH_API_VERSION: "v26.0",
  QF_META_WABA_ID: REAL.waba,
  QF_META_PHONE_NUMBER_ID: REAL.phone,
  QF_META_APP_ID: REAL.app,
  QF_META_ACCESS_TOKEN: "irrelevant-not-a-real-token",
});
const okGet = (body) => ({ ok: true, status: 200, body });
const goodAssets = () => ({
  waba: okGet({ id: REAL.waba }),
  phones: okGet({ data: [{ id: REAL.phone, verified_name: "quickfurno.in", quality_rating: "GREEN", code_verification_status: "VERIFIED" }] }),
  subs: okGet({ data: [{ whatsapp_business_api_data: { id: REAL.app, name: "QuickFurno Staging" } }] }),
});
const clonePacket = () => JSON.parse(JSON.stringify(packet));
const entryOf = (p) => p.templates.find((t) => t.internal_template_key === TARGET_TEMPLATE_KEY);
const PAYLOAD = loadCanonicalPayload(packet).payload;
/** A remote row that fully matches the canonical payload. */
const goodRow = (over = {}) => ({
  id: "1234567890",
  name: TARGET_TEMPLATE_NAME,
  language: TARGET_LANGUAGE,
  status: "APPROVED",
  category: TARGET_CATEGORY,
  components: JSON.parse(JSON.stringify(PAYLOAD.components)),
  ...over,
});
const pre = (rowsOrLookup) =>
  classifyPreState(Array.isArray(rowsOrLookup) ? okGet({ data: rowsOrLookup }) : rowsOrLookup, PAYLOAD).state;

let passed = 0;
let failed = 0;
const record = (label, ok) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}`); }
};

// ---------------------------------------------------------------------------
// Baseline — if the happy path does not work, every "rejected" test is vacuous.
// ---------------------------------------------------------------------------
record("B01 authorised staging identity passes", validateIdentity(goodEnv()).ok === true);
record("B02 canonical payload loads and fingerprints exactly", (() => {
  const r = loadCanonicalPayload(packet);
  return r.ok === true && r.fingerprint === EXPECTED_PAYLOAD_FINGERPRINT;
})());
record("B03 live asset proof passes on the exact staging triple", classifyLiveAssets(goodAssets()).ok === true);
record("B04 a fully matching remote row classifies ALREADY_CREATED", pre([goodRow()]) === ClientPreState.ALREADY_CREATED);
record("B05 ABSENT + both flags is a POST decision", (() => {
  const d = decide({
    flags: parseFlags(["--execute", OWNER_ACK_FLAG]), identity: validateIdentity(goodEnv()),
    payloadResult: loadCanonicalPayload(packet), preState: ClientPreState.ABSENT,
  });
  return d.post === true;
})());
record("B06 comment-stripping leaves executable substance and removes prose",
  codeOnly.length > 2000
  && /export function loadCanonicalPayload\(/.test(codeOnly)
  && /await http\.createOnce\(/.test(codeOnly)
  && /message_templates/.test(codeOnly)
  && /DELETE \/ PUT \/ PATCH/.test(code)
  && !/DELETE \/ PUT \/ PATCH/.test(codeOnly));
record("B07 the structural scanners are live, not vacuous", (() => {
  const injected = `${codeOnly}\nconst c = createClient(); await c.rpc("arm");\nawait fetch(u, { method: "DELETE" });`;
  return /supabase|createClient|\.rpc\(/i.test(injected)
    && /method:\s*["'](DELETE|PUT|PATCH)["']/i.test(injected)
    && !/supabase|createClient|\.rpc\(/i.test(codeOnly);
})());

// ---------------------------------------------------------------------------
// IDENTITY / SCOPE
// ---------------------------------------------------------------------------
record("I01 a wrong WABA id is rejected",
  validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "27861262223494154" }).ok === false);
record("I02 a wrong app id is rejected",
  validateIdentity({ ...goodEnv(), QF_META_APP_ID: "2097008694503518" }).ok === false);
record("I03 a wrong phone id is rejected",
  validateIdentity({ ...goodEnv(), QF_META_PHONE_NUMBER_ID: "1333595106493546" }).ok === false);
record("I04 an arbitrary/production-shaped identity is rejected (allow-list of one)", (() => {
  const r = validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "999888777666555", QF_META_APP_ID: "111222333444555", QF_META_PHONE_NUMBER_ID: "555444333222111" });
  return r.ok === false && r.faults.filter((f) => f.startsWith("unauthorized_identity:")).length === 3;
})());
record("I05 the operator declares NO second identity pin set — it imports R7B's",
  !/EXPECTED_IDENTITY_DIGESTS\s*=\s*Object\.freeze/.test(codeOnly)
  && /import\s*\{[\s\S]*?EXPECTED_IDENTITY_DIGESTS[\s\S]*?\}\s*from\s*["'][^"']*create-meta-staging-vendor-onboarding-reminder-once\.mjs["']/.test(codeOnly));
record("I06 no raw staging id literal appears in the operator",
  !new RegExp(REAL.waba).test(code) && !new RegExp(REAL.app).test(code) && !new RegExp(REAL.phone).test(code));
record("I07 the pinned digests match the public staging asset ids",
  sha256Hex(REAL.app) === EXPECTED_IDENTITY_DIGESTS.appId
  && sha256Hex(REAL.waba) === EXPECTED_IDENTITY_DIGESTS.wabaId
  && sha256Hex(REAL.phone) === EXPECTED_IDENTITY_DIGESTS.phoneNumberId);
record("I08 the target constants are hard-pinned literals", (() => {
  const pinned = (n, v) => new RegExp(`export const ${n}\\s*=\\s*\\n?\\s*["']${v}["']`).test(codeOnly);
  return pinned("TARGET_TEMPLATE_KEY", TARGET_TEMPLATE_KEY)
    && pinned("TARGET_TEMPLATE_NAME", TARGET_TEMPLATE_NAME)
    && pinned("TARGET_LANGUAGE", TARGET_LANGUAGE)
    && pinned("TARGET_CATEGORY", TARGET_CATEGORY)
    && pinned("EXPECTED_PAYLOAD_FINGERPRINT", EXPECTED_PAYLOAD_FINGERPRINT);
})());
record("I09 no generic selector, and no argv/env path into the target", (() => {
  if (/--template\b/.test(codeOnly)) return false;
  const argvUses = codeOnly.match(/process\.argv[^\s;)]*/g) ?? [];
  const allowed = new Set(["process.argv[1]", "process.argv.slice(2"]);
  if (!argvUses.every((u) => allowed.has(u))) return false;
  const decls = [...codeOnly.matchAll(/TARGET_TEMPLATE_(?:KEY|NAME)\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  return decls.length === 2 && decls.every((d) => /^"[^"]*"$/.test(d))
    && !/env\.[A-Z_]*TEMPLATE/i.test(codeOnly)
    && !/env\.[A-Z_]*CATEGORY/i.test(codeOnly);
})());
record("I10 R7B and R7I are untouched by this phase",
  /TARGET_TEMPLATE_KEY = "vendor_onboarding_reminder"/.test(vendorSrc)
  && /"c6e95a38dde899f717999520082feddf4c91f2a33c84650c72538ef2c111199a"/.test(vendorSrc)
  && /TARGET_TEMPLATE_KEY = "client_matching_update"/.test(matchingSrc)
  && /"c0930db5a9beee61de0076caf234b36f950554bc21c60b697845028a8d057e1c"/.test(matchingSrc));
record("I11 this operator targets a DIFFERENT template than R7B and R7I",
  TARGET_TEMPLATE_KEY === "client_lead_status_update"
  && EXPECTED_PAYLOAD_FINGERPRINT !== "c6e95a38dde899f717999520082feddf4c91f2a33c84650c72538ef2c111199a"
  && EXPECTED_PAYLOAD_FINGERPRINT !== "c0930db5a9beee61de0076caf234b36f950554bc21c60b697845028a8d057e1c");
record("I12 the quarantined MARKETING sibling is never referenced as a target",
  !/qf_client_matching_update_v1/.test(codeOnly));

// ---------------------------------------------------------------------------
// PACKET / PAYLOAD
// ---------------------------------------------------------------------------
record("P01 a wrong provider template name is rejected", (() => {
  const p = clonePacket(); entryOf(p).provider_template_name = "qf_something_else_v1";
  return loadCanonicalPayload(p).ok === false;
})());
record("P02 a renamed payload name is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.name = "qf_something_else_v1";
  return loadCanonicalPayload(p).reason === "name_mismatch";
})());
record("P03 a changed body is rejected on exact text before fingerprint", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].text += " Extra.";
  return loadCanonicalPayload(p).reason === "body_text_mismatch";
})());
record("P04 a changed category is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.category = "MARKETING";
  return loadCanonicalPayload(p).reason === "category_mismatch";
})());
record("P05 a changed language is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.language = "en_US";
  return loadCanonicalPayload(p).reason === "language_mismatch";
})());
record("P06 a changed example VALUE is rejected by the fingerprint", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].example.body_text[0][0] = "Rahul";
  return loadCanonicalPayload(p).reason === "fingerprint_drift";
})());
record("P07 example arity change (3 values) is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].example.body_text[0].push("x");
  return loadCanonicalPayload(p).reason === "example_arity_unexpected";
})());
record("P08 example arity change (1 value) is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].example.body_text[0].pop();
  return loadCanonicalPayload(p).reason === "example_arity_unexpected";
})());
record("P09 a second example row is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].example.body_text.push(["a", "b"]);
  return loadCanonicalPayload(p).reason === "example_shape_unexpected";
})());
record("P10 an added parameter_format is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.parameter_format = "POSITIONAL";
  return loadCanonicalPayload(p).reason === "payload_shape_unexpected";
})());
record("P11 an added header component is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components.push({ type: "header", format: "TEXT", text: "Hi" });
  return loadCanonicalPayload(p).reason === "component_count_unexpected";
})());
record("P12 an added footer component is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components.push({ type: "footer", text: "x" });
  return loadCanonicalPayload(p).reason === "component_count_unexpected";
})());
record("P13 a buttons block is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].buttons = [{ type: "QUICK_REPLY", text: "Hi" }];
  return loadCanonicalPayload(p).reason === "buttons_present";
})());
record("P14 a duplicate target entry is rejected", (() => {
  const p = clonePacket(); p.templates.push(JSON.parse(JSON.stringify(entryOf(p))));
  return loadCanonicalPayload(p).reason === "target_entry_not_unique";
})());
record("P15 a missing target entry is rejected", (() => {
  const p = clonePacket(); p.templates = p.templates.filter((t) => t.internal_template_key !== TARGET_TEMPLATE_KEY);
  return loadCanonicalPayload(p).reason === "target_entry_not_unique";
})());
record("P16 an unreadable packet is rejected", loadCanonicalPayload(null).reason === "packet_unreadable");
record("P17 one placeholder is rejected (this target needs exactly two)", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].text = "Hi {{1}}, your enquiry moved on.";
  return loadCanonicalPayload(p).reason === "body_text_mismatch";
})());
record("P18 the committed body carries exactly {{1}} then {{2}} and no {{3}}", (() => {
  const t = entryOf(packet).creation_payload.components[0].text;
  const ph = (t.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((x) => x.replace(/\s/g, ""));
  return ph.length === 2 && ph[0] === "{{1}}" && ph[1] === "{{2}}" && !/\{\{\s*[3-9]\s*\}\}/.test(t);
})());
record("P19 the pinned body text equals the committed packet body",
  EXPECTED_BODY_TEXT === entryOf(packet).creation_payload.components[0].text);
record("P20 the committed examples are exactly Asha / Vendors matched", (() => {
  const ex = entryOf(packet).creation_payload.components[0].example.body_text;
  return ex.length === 1 && ex[0].length === 2 && ex[0][0] === "Asha" && ex[0][1] === "Vendors matched";
})());

// ---- the packet hold must remain exactly as committed ----
record("H01 submit_now flipped to true is rejected", (() => {
  const p = clonePacket(); entryOf(p).submit_now = true;
  return loadCanonicalPayload(p).reason === "submit_now_not_held";
})());
record("H02 a non-approved approval_status is rejected", (() => {
  const p = clonePacket(); entryOf(p).local_state.approval_status = "pending";
  return loadCanonicalPayload(p).reason === "approval_status_unexpected";
})());
record("H03 a drifted submission_state is rejected", (() => {
  const p = clonePacket(); entryOf(p).local_state.submission_state = "APPROVED_MAPPED";
  return loadCanonicalPayload(p).reason === "submission_state_unexpected";
})());
record("H04 a missing local_state is rejected", (() => {
  const p = clonePacket(); delete entryOf(p).local_state;
  return loadCanonicalPayload(p).reason === "local_state_missing";
})());
record("H05 the committed packet still holds the required state",
  entryOf(packet).submit_now === REQUIRED_PACKET_STATE.submitNow
  && entryOf(packet).local_state.approval_status === REQUIRED_PACKET_STATE.approvalStatus
  && entryOf(packet).local_state.submission_state === REQUIRED_PACKET_STATE.submissionState);
record("H06 the operator never WRITES submit_now",
  !/submit_now\s*=/.test(codeOnly) && !/entry\.submit_now\s*=/.test(codeOnly));

// ---------------------------------------------------------------------------
// PRE-STATE — a row existing is NOT proof the right row exists.
// ---------------------------------------------------------------------------
record("S01 ABSENT when no exact row exists", pre([]) === ClientPreState.ABSENT);
record("S02 a different template name does not count as present",
  pre([goodRow({ name: "qf_client_matching_update_v1" })]) === ClientPreState.ABSENT);
record("S03 a different language does not count as present",
  pre([goodRow({ language: "hi" })]) === ClientPreState.ABSENT);
record("S04 duplicate exact rows are AMBIGUOUS", pre([goodRow(), goodRow()]) === ClientPreState.AMBIGUOUS);
record("S05 an unreadable lookup is UNREADABLE",
  pre({ ok: false, status: 500, body: null }) === ClientPreState.UNREADABLE);
record("S06 a PENDING exact match is ALREADY_CREATED",
  pre([goodRow({ status: "PENDING" })]) === ClientPreState.ALREADY_CREATED);
record("S07 an unsafe status (REJECTED) refuses", pre([goodRow({ status: "REJECTED" })]) === ClientPreState.PRESENT_OTHER_STATUS);
record("S08 a MARKETING category refuses — the live client_matching_update trap",
  pre([goodRow({ category: "MARKETING" })]) === ClientPreState.PRESENT_CATEGORY_MISMATCH);
record("S09 missing remote components refuse", (() => {
  const r = goodRow(); delete r.components;
  return pre([r]) === ClientPreState.PRESENT_COMPONENTS_UNUSABLE;
})());
record("S10 null remote components refuse",
  pre([goodRow({ components: null })]) === ClientPreState.PRESENT_COMPONENTS_UNUSABLE);
record("S11 different remote body content refuses", (() => {
  const r = goodRow(); r.components[0].text = "Totally different body.";
  return pre([r]) === ClientPreState.PRESENT_CONTENT_MISMATCH;
})());
record("S12 the local payload can NEVER substitute for missing remote components", (() => {
  const r = goodRow(); delete r.components;
  // Even with the canonical payload supplied as the expectation, absence cannot confirm.
  return classifyPreState(okGet({ data: [r] }), PAYLOAD).state !== ClientPreState.ALREADY_CREATED;
})());
record("S13 only ABSENT and ALREADY_CREATED are non-refusing", (() => {
  const nonRefusing = [ClientPreState.ABSENT, ClientPreState.ALREADY_CREATED];
  const all = Object.values(ClientPreState);
  return all.every((s) => nonRefusing.includes(s)
    || decide({ flags: parseFlags(["--execute", OWNER_ACK_FLAG]), identity: validateIdentity(goodEnv()),
        payloadResult: loadCanonicalPayload(packet), preState: s }).post === false);
})());

// ---------------------------------------------------------------------------
// R7K-R1 BLOCKER 1 — a malformed HTTP-200 must NEVER be read as ABSENT.
// ABSENT is the only state that can reach a POST, so absence must be PROVEN by a real
// empty array, never inferred from a shape the operator could not parse.
// ---------------------------------------------------------------------------
const malformed200 = [
  ["body null", { ok: true, status: 200, body: null }],
  ["body {}", { ok: true, status: 200, body: {} }],
  ["body is an array", { ok: true, status: 200, body: [] }],
  ["body is a string", { ok: true, status: 200, body: "ok" }],
  ["data null", okGet({ data: null })],
  ["data {}", okGet({ data: {} })],
  ["data is a string", okGet({ data: "none" })],
  ["data contains null row", okGet({ data: [null] })],
  ["data contains a non-object row", okGet({ data: ["qf_client_lead_status_update_v1"] })],
  ["data contains an array row", okGet({ data: [[]] })],
  ["row without a name", okGet({ data: [{ language: "en", status: "APPROVED" }] })],
  ["row with a non-string name", okGet({ data: [{ name: 123, language: "en" }] })],
  ["row with an empty name", okGet({ data: [{ name: "", language: "en" }] })],
  ["target-named row with missing language", okGet({ data: [{ name: TARGET_TEMPLATE_NAME, status: "APPROVED" }] })],
  ["target-named row with non-string language", okGet({ data: [{ name: TARGET_TEMPLATE_NAME, language: 7 }] })],
  ["target-named row with empty language", okGet({ data: [{ name: TARGET_TEMPLATE_NAME, language: "" }] })],
];
for (const [label, lookup] of malformed200) {
  record(`U01 malformed HTTP-200 (${label}) => UNREADABLE, never ABSENT`,
    classifyPreState(lookup, PAYLOAD).state === ClientPreState.UNREADABLE);
}
record("U02 EVERY malformed HTTP-200 case is refused at the decision layer — zero POST",
  malformed200.every(([, lookup]) => decide({
    flags: parseFlags(["--execute", OWNER_ACK_FLAG]),
    identity: validateIdentity(goodEnv()),
    payloadResult: loadCanonicalPayload(packet),
    preState: classifyPreState(lookup, PAYLOAD).state,
  }).post === false));
record("U03 a PROVEN empty array is still ABSENT (the fix is not over-broad)",
  classifyPreState(okGet({ data: [] }), PAYLOAD).state === ClientPreState.ABSENT);
record("U04 a well-formed different-name row still yields ABSENT and needs no language",
  classifyPreState(okGet({ data: [{ name: "qf_vendor_onboarding_reminder_v1", status: "APPROVED" }] }), PAYLOAD).state
    === ClientPreState.ABSENT);
record("U05 a well-formed different-LANGUAGE target row yields ABSENT, not UNREADABLE",
  classifyPreState(okGet({ data: [goodRow({ language: "hi" })] }), PAYLOAD).state === ClientPreState.ABSENT);
record("U06 a valid exact row still classifies ALREADY_CREATED after the hardening",
  classifyPreState(okGet({ data: [goodRow()] }), PAYLOAD).state === ClientPreState.ALREADY_CREATED);
record("U07 duplicate exact rows still classify AMBIGUOUS",
  classifyPreState(okGet({ data: [goodRow(), goodRow()] }), PAYLOAD).state === ClientPreState.AMBIGUOUS);
record("U08 the fail-open `? ... : []` fallback is GONE from the source",
  !/Array\.isArray\(lookup\.body\?\.data\)\s*\?/.test(codeOnly)
  && !/\?\s*lookup\.body\.data\s*:\s*\[\]/.test(codeOnly)
  && /if \(!Array\.isArray\(body\.data\)\) return unreadable;/.test(codeOnly));
record("U09 body type and row interpretability are both proven before filtering",
  /if \(!body \|\| typeof body !== "object" \|\| Array\.isArray\(body\)\) return unreadable;/.test(codeOnly)
  && /typeof r\.name !== "string"/.test(codeOnly)
  && /r\.name === TARGET_TEMPLATE_NAME && \(typeof r\.language !== "string"/.test(codeOnly));

// ---------------------------------------------------------------------------
// R7K-R1 BLOCKER 2 — an unexpected exception AFTER the single POST is a mutation with an
// unproven outcome, not a plain refusal.
// ---------------------------------------------------------------------------
/** The operator's terminal-catch rule, mirrored exactly for a behavioural proof. */
const terminalOutcome = (postCount) => (postCount > 0 ? Outcome.CREATE_AMBIGUOUS : Outcome.REFUSED);
record("A01 zero-post unexpected failure => REFUSED / exit 1",
  terminalOutcome(0) === Outcome.REFUSED && exitCodeForOutcome(terminalOutcome(0)) === 1);
record("A02 post-consumed unexpected failure => CREATE_AMBIGUOUS / exit 2",
  terminalOutcome(1) === Outcome.CREATE_AMBIGUOUS && exitCodeForOutcome(terminalOutcome(1)) === 2);
record("A03 the two terminal branches never share an exit code",
  exitCodeForOutcome(terminalOutcome(0)) !== exitCodeForOutcome(terminalOutcome(1)));
record("A04 the terminal catch consults http.postCount()",
  /\.catch\(\(\) => \{[\s\S]{0,600}?http\.postCount\(\) > 0/.test(codeOnly));
record("A05 the terminal catch selects CREATE_AMBIGUOUS when a POST was consumed",
  /const outcome = posted \? Outcome\.CREATE_AMBIGUOUS : Outcome\.REFUSED;/.test(codeOnly));
record("A06 the terminal catch exits through exitCodeForOutcome, not a hardcoded code",
  /process\.exit\(exitCodeForOutcome\(outcome\)\);/.test(codeOnly)
  && !/catch\(\(\) => \{[\s\S]{0,600}?process\.exit\(ExitCode\.REFUSED\)/.test(codeOnly));
record("A07 the terminal catch never prints the raw exception", (() => {
  const seg = codeOnly.match(/\.catch\(\(\) => \{[\s\S]*?\n\s*\}\);/);
  return seg !== null
    && !/\(\s*(e|err|error)\s*\)/.test(seg[0])
    && !/console\.log\([^)]*\b(e|err|error)\b/.test(seg[0]);
})());
record("A08 the transport still increments the counter BEFORE issuing the request", (() => {
  // Proven against R7B's audited makeHttp, which this operator imports unchanged.
  return /postCount \+= 1;[\s\S]{0,120}try \{/.test(vendorSrc);
})());
record("A09 a throwing transport is observably counted as a consumed POST", await (async () => {
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl: async () => { throw new Error("boom"); } });
  await http.createOnce({});
  return http.postCount() === 1 && terminalOutcome(http.postCount()) === Outcome.CREATE_AMBIGUOUS;
})());

// ---------------------------------------------------------------------------
// MODE / AUTHORITY
// ---------------------------------------------------------------------------
const decideWith = (argv, preState, over = {}) => decide({
  flags: parseFlags(argv),
  identity: over.identity ?? validateIdentity(goodEnv()),
  payloadResult: over.payloadResult ?? loadCanonicalPayload(packet),
  preState,
});
record("D01 ABSENT + both flags is the ONLY POST decision",
  decideWith(["--execute", OWNER_ACK_FLAG], ClientPreState.ABSENT).post === true);
record("D02 default (no flags) never posts", decideWith([], ClientPreState.ABSENT).post === false);
record("D03 --execute alone never posts", (() => {
  const d = decideWith(["--execute"], ClientPreState.ABSENT);
  return d.post === false && d.outcome === Outcome.DRY_RUN_WOULD_POST;
})());
record("D04 owner acknowledgement alone never posts", (() => {
  const d = decideWith([OWNER_ACK_FLAG], ClientPreState.ABSENT);
  return d.post === false && d.outcome === Outcome.DRY_RUN_WOULD_POST;
})());
record("D05 both flags are necessary and sufficient", (() => {
  const f = parseFlags(["--execute", OWNER_ACK_FLAG]);
  return f.mayPost === true && parseFlags(["--execute"]).mayPost === false
    && parseFlags([OWNER_ACK_FLAG]).mayPost === false && OWNER_ACK_FLAG === "--owner-authorized-once";
})());
record("D06 an exact semantic existing row never posts", (() => {
  const d = decideWith(["--execute", OWNER_ACK_FLAG], ClientPreState.ALREADY_CREATED);
  return d.post === false && d.outcome === Outcome.ALREADY_CREATED;
})());
record("D07 category mismatch never posts",
  decideWith(["--execute", OWNER_ACK_FLAG], ClientPreState.PRESENT_CATEGORY_MISMATCH).post === false);
record("D08 content mismatch never posts",
  decideWith(["--execute", OWNER_ACK_FLAG], ClientPreState.PRESENT_CONTENT_MISMATCH).post === false);
record("D09 unusable components never post",
  decideWith(["--execute", OWNER_ACK_FLAG], ClientPreState.PRESENT_COMPONENTS_UNUSABLE).post === false);
record("D10 duplicate rows never post",
  decideWith(["--execute", OWNER_ACK_FLAG], ClientPreState.AMBIGUOUS).post === false);
record("D11 unreadable template lookup never posts",
  decideWith(["--execute", OWNER_ACK_FLAG], ClientPreState.UNREADABLE).post === false);
record("D12 an unsafe status never posts",
  decideWith(["--execute", OWNER_ACK_FLAG], ClientPreState.PRESENT_OTHER_STATUS).post === false);
record("D13 an unauthorised identity never posts", (() => {
  const d = decideWith(["--execute", OWNER_ACK_FLAG], ClientPreState.ABSENT, {
    identity: validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "1" }),
  });
  return d.post === false && d.outcome === Outcome.REFUSED;
})());
record("D14 a drifted payload never posts", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].text += "!";
  const d = decideWith(["--execute", OWNER_ACK_FLAG], ClientPreState.ABSENT, { payloadResult: loadCanonicalPayload(p) });
  return d.post === false && d.outcome === Outcome.REFUSED;
})());
record("D15 unreadable live assets never post — the operator returns before the lookup",
  /if \(!assets\.ok\) \{[\s\S]{0,160}return exitCodeForOutcome\(Outcome\.REFUSED\);/.test(codeOnly)
  && classifyLiveAssets({ waba: { ok: false }, phones: { ok: false }, subs: { ok: false } }).ok === false);

// ---------------------------------------------------------------------------
// TRANSPORT — one POST max, inherited from R7B's audited makeHttp.
// ---------------------------------------------------------------------------
record("T01 the inherited one-POST boundary rejects a second POST", await (async () => {
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ id: "1" }) }) });
  await http.createOnce({});
  let threw = false;
  try { await http.createOnce({}); } catch { threw = true; }
  return threw === true && http.postCount() === 1;
})());
record("T02 a throwing transport still consumes the single POST budget", await (async () => {
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl: async () => { throw new Error("net"); } });
  const r = await http.createOnce({});
  let threw = false;
  try { await http.createOnce({}); } catch { threw = true; }
  return r.threw === true && threw === true && http.postCount() === 1;
})());
record("T03 GET never consumes the POST budget", await (async () => {
  const http = makeHttp({ version: "v26.0", wabaId: REAL.waba, token: "t", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }) });
  await http.get("/message_templates");
  await http.get("/subscribed_apps");
  return http.postCount() === 0;
})());
record("T04 exactly one `await http.createOnce(` call exists",
  (codeOnly.match(/await http\.createOnce\(/g) ?? []).length === 1);
record("T05 there is no second POST after an ambiguous response or a failed readback",
  (codeOnly.match(/createOnce/g) ?? []).length === 1);
record("T06 the PRE-STATE GET explicitly requests the required fields", (() => {
  const m = codeOnly.match(/const lookup = await http\.get\(\s*[\s\S]{0,240}?\);/);
  return m !== null && /fields=\$\{REQUIRED_TEMPLATE_FIELDS\}/.test(m[0]);
})());
record("T07 the POST-CREATE readback GET explicitly requests the required fields", (() => {
  const m = codeOnly.match(/const back = await http\.get\(\s*[\s\S]{0,240}?\);/);
  return m !== null && /fields=\$\{REQUIRED_TEMPLATE_FIELDS\}/.test(m[0]);
})());
record("T08 every message_templates GET carries the field set", (() => {
  const gets = codeOnly.match(/http\.get\(\s*`[^`]*message_templates[^`]*`/g) ?? [];
  return gets.length === 2 && gets.every((g) => /fields=\$\{REQUIRED_TEMPLATE_FIELDS\}/.test(g));
})());
record("T09 the required field set is exactly the reviewed one",
  REQUIRED_TEMPLATE_FIELDS === "id,name,language,status,category,components");
record("T10 confirmation is derived from the readback pre-state, not from a local fallback",
  /const confirmed = after\.state === ClientPreState\.ALREADY_CREATED;/.test(codeOnly)
  && !/after\.row\.components\s*\?\?/.test(codeOnly)
  && !/\?\?\s*payloadResult\.payload\.components/.test(codeOnly));
record("T11 the semantic comparison receives REMOTE components only",
  /components:\s*row\.components,/.test(codeOnly)
  && /Array\.isArray\(row\.components\)/.test(codeOnly));

// ---------------------------------------------------------------------------
// EXIT CODES
// ---------------------------------------------------------------------------
record("E01 CREATED exits 0", exitCodeForOutcome(Outcome.CREATED) === 0);
record("E02 ALREADY_CREATED exits 0", exitCodeForOutcome(Outcome.ALREADY_CREATED) === 0);
record("E03 DRY_RUN_WOULD_POST exits 0", exitCodeForOutcome(Outcome.DRY_RUN_WOULD_POST) === 0);
record("E04 CREATE_AMBIGUOUS exits with a DISTINCT non-zero code",
  exitCodeForOutcome(Outcome.CREATE_AMBIGUOUS) === 2
  && exitCodeForOutcome(Outcome.CREATE_AMBIGUOUS) !== exitCodeForOutcome(Outcome.CREATED)
  && exitCodeForOutcome(Outcome.CREATE_AMBIGUOUS) !== exitCodeForOutcome(Outcome.REFUSED));
record("E05 REFUSED exits 1", exitCodeForOutcome(Outcome.REFUSED) === 1);
record("E06 an unknown outcome fails closed to non-zero",
  exitCodeForOutcome("SOMETHING_NEW") === ExitCode.REFUSED && exitCodeForOutcome(undefined) === ExitCode.REFUSED);
record("E07 every terminal path routes through exitCodeForOutcome/ExitCode",
  !/\breturn 0;|\breturn 1;|\breturn 2;/.test(codeOnly)
  && !/process\.exit\(0\)|process\.exit\(1\)|process\.exit\(2\)/.test(codeOnly)
  && /return exitCodeForOutcome\(outcome\);/.test(codeOnly));
record("E08 the deterministic-rejection path is non-zero", (() => {
  const seg = codeOnly.match(/DETERMINISTIC_4XX_REJECTION[\s\S]{0,460}?\n\s*\}/);
  return seg !== null && /return exitCodeForOutcome\(Outcome\.REFUSED\);/.test(seg[0]);
})());
record("E09 the unexpected-failure catch is non-zero on BOTH branches", (() => {
  // Since R7K-R1 the catch no longer hardcodes a code: it picks REFUSED (1) or
  // CREATE_AMBIGUOUS (2) from the POST counter and exits via exitCodeForOutcome. Both
  // are non-zero, so an unexpected failure can never look like success either way.
  const routed = /process\.exit\(exitCodeForOutcome\(outcome\)\);/.test(codeOnly);
  const bothNonZero = exitCodeForOutcome(Outcome.REFUSED) !== 0
    && exitCodeForOutcome(Outcome.CREATE_AMBIGUOUS) !== 0;
  return routed && bothNonZero;
})());

// ---------------------------------------------------------------------------
// SAFE ERROR HANDLING
// ---------------------------------------------------------------------------
record("X01 the operator reads e.subcode", /e\.subcode/.test(codeOnly));
record("X02 the operator never reads the non-existent e.error_subcode",
  !/\.error_subcode/.test(codeOnly));
record("X03 only sanitized structured error fields are printed",
  /safeMetaError\(/.test(codeOnly)
  && !/JSON\.stringify\(res\.body/.test(codeOnly)
  && !/console\.log\([^)]*res\.body/.test(codeOnly));
record("X04 no secret or raw asset id is interpolated into output",
  !/\$\{[^}]*ACCESS_TOKEN/.test(codeOnly)
  && !/\$\{[^}]*QF_META_WABA_ID/.test(codeOnly)
  && !/\$\{[^}]*PHONE_NUMBER_ID/.test(codeOnly)
  && !/\$\{[^}]*APP_SECRET/.test(codeOnly)
  && !/console\.log\(\s*JSON\.stringify\(\s*(process\.)?env/.test(codeOnly)
  && !/Authorization/.test(codeOnly));

// ---------------------------------------------------------------------------
// STRUCTURAL FORBIDDEN SURFACES
// ---------------------------------------------------------------------------
record("F01 no messaging endpoint",
  !/\/messages\b/.test(codeOnly) && !/sendResolvedTemplate|CommunicationService/.test(codeOnly));
record("F02 no DELETE / PUT / PATCH", !/method:\s*["'](DELETE|PUT|PATCH)["']/i.test(codeOnly));
record("F03 the operator declares no HTTP method of its own — it imports makeHttp",
  (codeOnly.match(/method:\s*["'][A-Z]+["']/gi) ?? []).length === 0
  && !/fetch\(/.test(codeOnly)
  && !/https?:\/\/graph\.facebook\.com/.test(codeOnly)
  && /import\s*\{[\s\S]*?makeHttp[\s\S]*?\}\s*from\s*["'][^"']*create-meta-staging-vendor-onboarding-reminder-once\.mjs["']/.test(codeOnly));
record("F04 no database, Supabase client or RPC surface",
  !/supabase|createClient|\.rpc\(|service_role|adminClient/i.test(codeOnly));
record("F05 no provider / readiness / canary / mapping / webhook mutation",
  !/arm[-_]?readiness|arm[-_]?canary|qf_arm_|qf_disable_|activation_status|outbound_enabled|webhook_processing_enabled|provider_template_mappings/i.test(codeOnly));
record("F06 no retry construct can reach a second POST — control flow, not log prose", (() => {
  // The operator PRINTS "no retry"; that is documentation, not behaviour, so judge the
  // source with string literals blanked.
  //
  // R7K-R1 introduced ONE loop: the row-interpretability check inside classifyPreState.
  // A blanket "no loops" rule would now be wrong, so prove the stronger property instead —
  // no loop can possibly issue a POST:
  //   1. no while/do loops anywhere;
  //   2. every `for` lives inside classifyPreState, which is PURE — it never receives or
  //      references the transport, so it cannot call createOnce;
  //   3. exactly one createOnce call exists in the whole file;
  //   4. no scheduler and no `retry` identifier in control flow.
  const noWhile = !/\bwhile\s*\(|\bdo\s*\{/.test(codeNoStrings);
  const noScheduler = !/setTimeout|setInterval|setImmediate|process\.nextTick/.test(codeNoStrings);
  const noRetryIdentifier = !/\bretry\b/i.test(codeNoStrings);

  const fnMatch = codeNoStrings.match(/export function classifyPreState\([\s\S]*?\n\}/);
  if (!fnMatch) return false;
  const pureFn = fnMatch[0];

  const totalFor = (codeNoStrings.match(/\bfor\s*\(/g) ?? []).length;
  const forInPureFn = (pureFn.match(/\bfor\s*\(/g) ?? []).length;
  const everyLoopIsInThePureFn = totalFor > 0 && totalFor === forInPureFn;

  const pureFnCannotPost = !/http\.|createOnce|fetch\(/.test(pureFn);
  const oneCreateOnce = (codeNoStrings.match(/createOnce/g) ?? []).length === 1;

  return noWhile && noScheduler && noRetryIdentifier
    && everyLoopIsInThePureFn && pureFnCannotPost && oneCreateOnce
    && /no retry/i.test(codeOnly);
})());
record("F07 the only mutating verb reachable is the single inherited createOnce",
  (codeOnly.match(/http\.(get|createOnce)\(/g) ?? []).filter((c) => c.includes("createOnce")).length === 1);

// ---------------------------------------------------------------------------
// PROVENANCE
// ---------------------------------------------------------------------------
record("G01 the pinned fingerprint equals the packet's committed fingerprint",
  entryOf(packet).payload_fingerprint === EXPECTED_PAYLOAD_FINGERPRINT
  && createHash("sha256").update(JSON.stringify(entryOf(packet).creation_payload)).digest("hex") === EXPECTED_PAYLOAD_FINGERPRINT);
record("G02 ClientPreState extends R7B's PreState without redefining its members",
  Object.entries(PreState).every(([k, v]) => ClientPreState[k] === v)
  && Object.isFrozen(ClientPreState));
record("G03 only ONE client template is in scope — the sibling stays untouched",
  !/client_matching_update/.test(codeOnly));

console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
