// ============================================================================
// QF-MVP-40-R7I — validator for the ONE-SHOT staging CLIENT template creation authority.
// OFFLINE. Calls no Meta endpoint, submits nothing, sends nothing, reads no credential.
//
// Every rule is paired with a MUTATION that must be killed: a rule that cannot fail
// proves nothing. The payload, pre-state and decision layers are pure and are driven
// here with fixtures; the non-negotiable structural properties (no messaging endpoint,
// no DELETE/PUT/PATCH, no DB, no generic selector, exactly one createOnce call) are
// proved by scanning the operator source, because those are properties of the FILE.
//
// It also asserts the R7I refusal-code fix in activate-meta-staging-canary.mjs, which
// existed as three UNDEFINED ActivationFailure keys referenced by runPreflight.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EXPECTED_IDENTITY_DIGESTS, EXPECTED_PAYLOAD_FINGERPRINT, ExitCode, OWNER_ACK_FLAG, Outcome, PreState,
  REQUIRED_PACKET_STATE, REQUIRED_TEMPLATE_FIELDS, TARGET_CATEGORY, TARGET_LANGUAGE, TARGET_TEMPLATE_KEY,
  TARGET_TEMPLATE_NAME, classifyPreState, exitCodeForOutcome, loadCanonicalPayload,
} from "./create-meta-staging-client-matching-update-once.mjs";
import { templatesAreIdentical } from "./submit-meta-templates.mjs";
import {
  classifyLiveAssets, decide, makeHttp, parseFlags, sha256Hex, validateIdentity,
} from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";

const OPERATOR = "scripts/mvp/communication/create-meta-staging-client-matching-update-once.mjs";
const VENDOR_OPERATOR = "scripts/mvp/communication/create-meta-staging-vendor-onboarding-reminder-once.mjs";
const ACTIVATOR = "scripts/mvp/communication/activate-meta-staging-canary.mjs";
const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";

const code = readFileSync(resolve(OPERATOR), "utf8");
/**
 * Executable code only. The header deliberately DISCUSSES the things this operator must
 * not do ("no messaging/send endpoint", "no database access"), so a raw-text scan would
 * be satisfied by prose and defeated by it in equal measure.
 */
const codeOnly = code
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");

/**
 * Comment-stripped source with STRING AND TEMPLATE LITERALS blanked too. Needed for the
 * "no retry construct" and "no loop" rules: the operator legitimately PRINTS the words
 * "no retry" in its result lines, and a rule that failed on a log message would be
 * testing prose rather than control flow.
 */
const codeNoStrings = codeOnly
  .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
  .replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""')
  .replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''");

const packet = JSON.parse(readFileSync(resolve(PACKET), "utf8"));
const activatorSrc = readFileSync(resolve(ACTIVATOR), "utf8");
const vendorSrc = readFileSync(resolve(VENDOR_OPERATOR), "utf8");

// Public, non-secret Meta asset ids, used ONLY as offline fixtures so the pinned digest
// rules can be driven. The real values are supplied by the owner at runtime.
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
const row = (over = {}) => ({
  name: TARGET_TEMPLATE_NAME, language: TARGET_LANGUAGE, status: "APPROVED", category: TARGET_CATEGORY, ...over,
});

let passed = 0;
let failed = 0;
const record = (label, ok) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}`); }
};

// ---------------------------------------------------------------------------
// Baseline: the happy path must actually work, or every "rejected" test is vacuous.
// ---------------------------------------------------------------------------
record("B01 authorised staging identity passes", validateIdentity(goodEnv()).ok === true);
record("B02 canonical payload loads and fingerprints exactly", (() => {
  const r = loadCanonicalPayload(packet);
  return r.ok === true && r.fingerprint === EXPECTED_PAYLOAD_FINGERPRINT;
})());
record("B03 live asset proof passes on the exact staging triple", classifyLiveAssets(goodAssets()).ok === true);
record("B04 ABSENT + both flags is a POST decision", (() => {
  const d = decide({
    flags: parseFlags(["--execute", OWNER_ACK_FLAG]), identity: validateIdentity(goodEnv()),
    payloadResult: loadCanonicalPayload(packet), preState: PreState.ABSENT,
  });
  return d.post === true;
})());
record("B05 comment-stripping leaves executable substance and removes prose",
  codeOnly.length > 2000
  && /export function loadCanonicalPayload\(/.test(codeOnly)
  && /await http\.createOnce\(/.test(codeOnly)
  && /message_templates/.test(codeOnly)
  && /DELETE \/ PUT \/ PATCH/.test(code)        // the prose DOES discuss it …
  && !/DELETE \/ PUT \/ PATCH/.test(codeOnly)); // … and stripping removed exactly that
record("B06 the structural scanners are live, not vacuous", (() => {
  const injected = `${codeOnly}\nconst c = createClient(); await c.rpc("arm");\nawait fetch(u, { method: "DELETE" });`;
  return /supabase|createClient|\.rpc\(/i.test(injected)
    && /method:\s*["'](DELETE|PUT|PATCH)["']/i.test(injected)
    && !/supabase|createClient|\.rpc\(/i.test(codeOnly);
})());

// ---------------------------------------------------------------------------
// Identity — the pinned triple is shared with R7B, never duplicated.
// ---------------------------------------------------------------------------
record("M01 a wrong WABA id is rejected",
  validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "27861262223494154" }).ok === false);
record("M02 a wrong app id is rejected",
  validateIdentity({ ...goodEnv(), QF_META_APP_ID: "2097008694503518" }).ok === false);
record("M03 a wrong phone id is rejected",
  validateIdentity({ ...goodEnv(), QF_META_PHONE_NUMBER_ID: "1333595106493546" }).ok === false);
record("M03b an arbitrary/production-shaped identity is rejected (allow-list of one)", (() => {
  const r = validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "999888777666555", QF_META_APP_ID: "111222333444555", QF_META_PHONE_NUMBER_ID: "555444333222111" });
  return r.ok === false && r.faults.filter((f) => f.startsWith("unauthorized_identity:")).length === 3;
})());
record("M03c the operator declares NO second identity pin set — it imports R7B's",
  !/EXPECTED_IDENTITY_DIGESTS\s*=\s*Object\.freeze/.test(codeOnly)
  && /import\s*\{[\s\S]*?EXPECTED_IDENTITY_DIGESTS[\s\S]*?\}\s*from\s*["'][^"']*create-meta-staging-vendor-onboarding-reminder-once\.mjs["']/.test(codeOnly)
  && /EXPECTED_IDENTITY_DIGESTS\s*=\s*Object\.freeze/.test(vendorSrc));

// ---------------------------------------------------------------------------
// Payload — the pinned fingerprint is the backstop behind every field rule.
// ---------------------------------------------------------------------------
record("M04 a wrong provider template name is rejected", (() => {
  const p = clonePacket(); entryOf(p).provider_template_name = "qf_something_else_v1";
  return loadCanonicalPayload(p).ok === false;
})());
record("M04b a renamed payload name is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.name = "qf_something_else_v1";
  return loadCanonicalPayload(p).reason === "name_mismatch";
})());
record("M05 a changed body is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].text += " Extra.";
  return loadCanonicalPayload(p).reason === "fingerprint_drift";
})());
record("M06 a changed category is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.category = "MARKETING";
  return loadCanonicalPayload(p).reason === "category_mismatch";
})());
record("M07 a changed language is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.language = "en_US";
  return loadCanonicalPayload(p).reason === "language_mismatch";
})());
record("M08 a changed example is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].example.body_text[0][0] = "Rahul";
  return loadCanonicalPayload(p).reason === "fingerprint_drift";
})());
record("M09 an added parameter_format is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.parameter_format = "POSITIONAL";
  return loadCanonicalPayload(p).reason === "payload_shape_unexpected";
})());
record("M10 a second component is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components.push({ type: "footer", text: "x" });
  return loadCanonicalPayload(p).reason === "component_count_unexpected";
})());
record("M11 a buttons block is rejected", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].buttons = [{ type: "QUICK_REPLY", text: "Hi" }];
  return loadCanonicalPayload(p).reason === "buttons_present";
})());
record("M12 a duplicate target entry is rejected", (() => {
  const p = clonePacket(); p.templates.push(JSON.parse(JSON.stringify(entryOf(p))));
  return loadCanonicalPayload(p).reason === "target_entry_not_unique";
})());
record("M12b a missing target entry is rejected", (() => {
  const p = clonePacket(); p.templates = p.templates.filter((t) => t.internal_template_key !== TARGET_TEMPLATE_KEY);
  return loadCanonicalPayload(p).reason === "target_entry_not_unique";
})());
record("M12c an unreadable packet is rejected", loadCanonicalPayload(null).reason === "packet_unreadable");

// ---- the two-placeholder contract, which differs from R7B's single placeholder ----
record("M13 one placeholder is rejected (this target needs exactly two)", (() => {
  const p = clonePacket(); const b = entryOf(p).creation_payload.components[0];
  b.text = "Hi {{1}}, QuickFurno has matched your enquiry.";
  return loadCanonicalPayload(p).reason === "variable_shape_unexpected";
})());
record("M13b three placeholders are rejected", (() => {
  const p = clonePacket(); const b = entryOf(p).creation_payload.components[0];
  b.text = `${b.text} Ref {{3}}.`;
  return loadCanonicalPayload(p).reason === "variable_shape_unexpected";
})());
record("M13c out-of-order placeholders are rejected", (() => {
  const p = clonePacket(); const b = entryOf(p).creation_payload.components[0];
  b.text = "Hi {{2}}, QuickFurno has matched your enquiry with {{1}} verified vendors. They may contact you shortly.";
  return loadCanonicalPayload(p).reason === "variable_shape_unexpected";
})());
record("M13d a named placeholder is rejected", (() => {
  const p = clonePacket(); const b = entryOf(p).creation_payload.components[0];
  b.text = "Hi {{name}}, QuickFurno has matched your enquiry with {{2}} verified vendors. They may contact you shortly.";
  return loadCanonicalPayload(p).reason === "variable_shape_unexpected";
})());
record("M13e the committed payload really carries exactly {{1}} then {{2}}", (() => {
  const t = entryOf(packet).creation_payload.components[0].text;
  const ph = (t.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((x) => x.replace(/\s/g, ""));
  return ph.length === 2 && ph[0] === "{{1}}" && ph[1] === "{{2}}";
})());

// ---- the packet hold must remain exactly as committed ----
record("M14 submit_now flipped to true is rejected", (() => {
  const p = clonePacket(); entryOf(p).submit_now = true;
  return loadCanonicalPayload(p).reason === "submit_now_not_held";
})());
record("M14b a non-approved approval_status is rejected", (() => {
  const p = clonePacket(); entryOf(p).local_state.approval_status = "pending";
  return loadCanonicalPayload(p).reason === "approval_status_unexpected";
})());
record("M14c a drifted submission_state is rejected", (() => {
  const p = clonePacket(); entryOf(p).local_state.submission_state = "APPROVED_MAPPED";
  return loadCanonicalPayload(p).reason === "submission_state_unexpected";
})());
record("M14d a missing local_state is rejected", (() => {
  const p = clonePacket(); delete entryOf(p).local_state;
  return loadCanonicalPayload(p).reason === "local_state_missing";
})());
record("M14e the committed packet still holds the required state",
  entryOf(packet).submit_now === REQUIRED_PACKET_STATE.submitNow
  && entryOf(packet).local_state.approval_status === REQUIRED_PACKET_STATE.approvalStatus
  && entryOf(packet).local_state.submission_state === REQUIRED_PACKET_STATE.submissionState);

// ---------------------------------------------------------------------------
// Pre-state — only ABSENT may ever post.
// ---------------------------------------------------------------------------
record("M15 ABSENT is classified when no exact row exists",
  classifyPreState(okGet({ data: [] })).state === PreState.ABSENT);
record("M15b a different template name does not count as present",
  classifyPreState(okGet({ data: [row({ name: "qf_vendor_onboarding_reminder_v1" })] })).state === PreState.ABSENT);
record("M15c a different language does not count as present",
  classifyPreState(okGet({ data: [row({ language: "hi" })] })).state === PreState.ABSENT);
record("M16 APPROVED existing target is ALREADY_CREATED",
  classifyPreState(okGet({ data: [row({ status: "APPROVED" })] })).state === PreState.ALREADY_CREATED);
record("M17 PENDING existing target is ALREADY_CREATED",
  classifyPreState(okGet({ data: [row({ status: "PENDING" })] })).state === PreState.ALREADY_CREATED);
record("M18 duplicate remote rows are AMBIGUOUS",
  classifyPreState(okGet({ data: [row(), row()] })).state === PreState.AMBIGUOUS);
record("M18b another status is PRESENT_OTHER_STATUS",
  classifyPreState(okGet({ data: [row({ status: "REJECTED" })] })).state === PreState.PRESENT_OTHER_STATUS);
record("M18c an unreadable lookup is UNREADABLE",
  classifyPreState({ ok: false, status: 500, body: null }).state === PreState.UNREADABLE);

// ---------------------------------------------------------------------------
// Decision — the only POST path, and every refusal around it.
// ---------------------------------------------------------------------------
const decideWith = (argv, preState, over = {}) => decide({
  flags: parseFlags(argv),
  identity: over.identity ?? validateIdentity(goodEnv()),
  payloadResult: over.payloadResult ?? loadCanonicalPayload(packet),
  preState,
});
record("D01 ABSENT + both flags is the ONLY POST decision",
  decideWith(["--execute", OWNER_ACK_FLAG], PreState.ABSENT).post === true);
record("D02 --execute alone never posts", (() => {
  const d = decideWith(["--execute"], PreState.ABSENT);
  return d.post === false && d.outcome === Outcome.DRY_RUN_WOULD_POST;
})());
record("D03 owner acknowledgement alone never posts", (() => {
  const d = decideWith([OWNER_ACK_FLAG], PreState.ABSENT);
  return d.post === false && d.outcome === Outcome.DRY_RUN_WOULD_POST;
})());
record("D04 no flags never posts", decideWith([], PreState.ABSENT).post === false);
record("D05 APPROVED existing target never posts", (() => {
  const d = decideWith(["--execute", OWNER_ACK_FLAG], PreState.ALREADY_CREATED);
  return d.post === false && d.outcome === Outcome.ALREADY_CREATED;
})());
record("D06 PENDING existing target never posts (same ALREADY_CREATED state)",
  decideWith(["--execute", OWNER_ACK_FLAG], PreState.ALREADY_CREATED).post === false);
record("D07 AMBIGUOUS duplicate rows never post", (() => {
  const d = decideWith(["--execute", OWNER_ACK_FLAG], PreState.AMBIGUOUS);
  return d.post === false && d.outcome === Outcome.REFUSED;
})());
record("D08 UNREADABLE pre-state never posts",
  decideWith(["--execute", OWNER_ACK_FLAG], PreState.UNREADABLE).post === false);
record("D09 PRESENT_OTHER_STATUS never posts",
  decideWith(["--execute", OWNER_ACK_FLAG], PreState.PRESENT_OTHER_STATUS).post === false);
record("D10 an unauthorised identity never posts", (() => {
  const d = decideWith(["--execute", OWNER_ACK_FLAG], PreState.ABSENT, {
    identity: validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "1" }),
  });
  return d.post === false && d.outcome === Outcome.REFUSED;
})());
record("D11 a drifted payload never posts", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].text += "!";
  const d = decideWith(["--execute", OWNER_ACK_FLAG], PreState.ABSENT, { payloadResult: loadCanonicalPayload(p) });
  return d.post === false && d.outcome === Outcome.REFUSED;
})());
record("D12 a truthy env var is NOT an acknowledgement", (() => {
  const f = parseFlags(["--execute"]);
  return f.mayPost === false && OWNER_ACK_FLAG === "--owner-authorized-once";
})());

// ---------------------------------------------------------------------------
// Transport — ONE POST per process, inherited from R7B's audited makeHttp.
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
  return http.postCount() === 0;
})());

// ---------------------------------------------------------------------------
// Structure — properties of the FILE, not of any one execution.
// ---------------------------------------------------------------------------
record("S01 exactly one `await http.createOnce(` call exists",
  (codeOnly.match(/await http\.createOnce\(/g) ?? []).length === 1);
record("S02 the operator implements no transport of its own — it imports makeHttp",
  !/fetch\(/.test(codeOnly)
  && !/https?:\/\/graph\.facebook\.com/.test(codeOnly)
  && /import\s*\{[\s\S]*?makeHttp[\s\S]*?\}\s*from\s*["'][^"']*create-meta-staging-vendor-onboarding-reminder-once\.mjs["']/.test(codeOnly));
record("S03 no database, Supabase client or RPC surface",
  !/supabase|createClient|\.rpc\(|service_role/i.test(codeOnly));
record("S04 no messaging endpoint",
  !/\/messages\b/.test(codeOnly) && !/sendResolvedTemplate|CommunicationService/.test(codeOnly));
record("S05 no DELETE / PUT / PATCH",
  !/method:\s*["'](DELETE|PUT|PATCH)["']/i.test(codeOnly));
record("S06 the only declared HTTP method is the inherited POST call site",
  (codeOnly.match(/method:\s*["'][A-Z]+["']/gi) ?? []).length === 0);
record("S07 no generic --template selector, and no argv/env path into the target name", (() => {
  // The flag name would live in a string literal, so scan the comment-stripped source.
  if (/--template\b/.test(codeOnly)) return false;
  // argv is read in EXACTLY two audited places: entry detection and flag parsing. Any
  // third read is a potential selector, so enumerate rather than pattern-match loosely.
  const argvUses = codeOnly.match(/process\.argv[^\s;)]*/g) ?? [];
  const allowed = new Set(["process.argv[1]", "process.argv.slice(2"]);
  if (!argvUses.every((u) => allowed.has(u))) return false;
  // The target name must never be derived from argv or the environment: extract each
  // declaration's right-hand side and require it to be a plain quoted literal.
  const decls = [...codeOnly.matchAll(/TARGET_TEMPLATE_(?:KEY|NAME)\s*=\s*([^;]+);/g)]
    .map((m) => m[1].trim());
  const allLiteral = decls.length === 2 && decls.every((d) => /^"[^"]*"$/.test(d));
  return allLiteral && !/env\.[A-Z_]*TEMPLATE/i.test(codeOnly);
})());
record("S08 no provider / readiness / canary / mapping authority",
  !/arm[-_]?readiness|arm[-_]?canary|qf_arm_|qf_disable_|activation_status|outbound_enabled/i.test(codeOnly));
record("S09 no retry construct — asserted on control flow, not on log prose", (() => {
  // The operator PRINTS "no retry"; that is documentation of behaviour, not behaviour.
  // Scan the source with string literals blanked so only real control flow is judged.
  const noLoop = !/\bfor\s*\(|\bwhile\s*\(|\bdo\s*\{/.test(codeNoStrings);
  const noScheduler = !/setTimeout|setInterval|setImmediate|process\.nextTick/.test(codeNoStrings);
  const noRetryIdentifier = !/\bretry\b/i.test(codeNoStrings);
  // …and prove the scanner is live: the word really is present in the raw source.
  const proseExists = /no retry/i.test(codeOnly);
  return noLoop && noScheduler && noRetryIdentifier && proseExists;
})());
record("S10 the target constants are hard-pinned literals", (() => {
  const pinned = (name, value) =>
    new RegExp(`export const ${name}\\s*=\\s*\\n?\\s*["']${value}["']`).test(codeOnly);
  return pinned("TARGET_TEMPLATE_KEY", TARGET_TEMPLATE_KEY)
    && pinned("TARGET_TEMPLATE_NAME", TARGET_TEMPLATE_NAME)
    && pinned("TARGET_LANGUAGE", TARGET_LANGUAGE)
    && pinned("TARGET_CATEGORY", TARGET_CATEGORY)
    && pinned("EXPECTED_PAYLOAD_FINGERPRINT", EXPECTED_PAYLOAD_FINGERPRINT);
})());
record("S11 the readback requests exactly the required fields (via the shared constant)",
  /fields=\$\{REQUIRED_TEMPLATE_FIELDS\}/.test(codeOnly)
  && REQUIRED_TEMPLATE_FIELDS === "id,name,language,status,category,components");
record("S12 the semantic readback uses templatesAreIdentical()",
  /templatesAreIdentical\(/.test(codeOnly));
record("S13 an unconfirmed create is classified AMBIGUOUS, never CREATED",
  /confirmed[\s\S]{0,200}Outcome\.CREATED[\s\S]{0,80}Outcome\.CREATE_AMBIGUOUS/.test(codeOnly));
record("S14 no raw secret or asset id is printed",
  !/QF_META_ACCESS_TOKEN\s*\}|\$\{[^}]*ACCESS_TOKEN/.test(codeOnly)
  && !/\$\{[^}]*QF_META_WABA_ID/.test(codeOnly)
  && !/\$\{[^}]*APP_SECRET/.test(codeOnly)
  && !/console\.log\([^)]*res\.body/.test(codeOnly));
record("S15 Meta errors are surfaced through safeMetaError only",
  /safeMetaError\(/.test(codeOnly) && !/JSON\.stringify\(res\.body/.test(codeOnly));
record("S16 the vendor R7B operator is unchanged by this phase",
  /TARGET_TEMPLATE_KEY = "vendor_onboarding_reminder"/.test(vendorSrc)
  && /EXPECTED_PAYLOAD_FINGERPRINT =\s*\n?\s*"c6e95a38dde899f717999520082feddf4c91f2a33c84650c72538ef2c111199a"/.test(vendorSrc));

// ---------------------------------------------------------------------------
// The R7I refusal-code fix — three ActivationFailure keys runPreflight already used.
// ---------------------------------------------------------------------------
record("R01 META_TEMPLATE_AMBIGUOUS is declared in ActivationFailure",
  /META_TEMPLATE_AMBIGUOUS:\s*"META_TEMPLATE_AMBIGUOUS"/.test(activatorSrc));
record("R02 META_STATUS_NOT_APPROVED is declared in ActivationFailure",
  /META_STATUS_NOT_APPROVED:\s*"META_STATUS_NOT_APPROVED"/.test(activatorSrc));
record("R03 META_CATEGORY_MISMATCH is declared in ActivationFailure",
  /META_CATEGORY_MISMATCH:\s*"META_CATEGORY_MISMATCH"/.test(activatorSrc));
record("R04 every ActivationFailure key referenced anywhere is now declared", (() => {
  const runtimeSrc = readFileSync(resolve("scripts/mvp/communication/canaryActivationRuntime.mjs"), "utf8");
  const block = activatorSrc.match(/export const ActivationFailure = Object\.freeze\(\{[\s\S]*?\n\}\);/)[0];
  const declared = new Set([...block.matchAll(/^\s{2}([A-Z0-9_]+):/gm)].map((m) => m[1]));
  const used = new Set(
    [...`${activatorSrc}\n${runtimeSrc}`.matchAll(/ActivationFailure\.([A-Z0-9_]+)/g)].map((m) => m[1]));
  return [...used].every((u) => declared.has(u));
})());
record("R05 the three keys are genuinely reachable from runPreflight's template proof", (() => {
  const runtimeSrc = readFileSync(resolve("scripts/mvp/communication/canaryActivationRuntime.mjs"), "utf8");
  return /ActivationFailure\.META_TEMPLATE_AMBIGUOUS/.test(runtimeSrc)
    && /ActivationFailure\.META_STATUS_NOT_APPROVED/.test(runtimeSrc)
    && /ActivationFailure\.META_CATEGORY_MISMATCH/.test(runtimeSrc);
})());

// ---------------------------------------------------------------------------
// Fingerprint provenance.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// R7I REVIEW CORRECTION 1 — both GETs must request the fields the proofs depend on,
// so an API default-field narrowing can never make an existing row look ABSENT.
// ---------------------------------------------------------------------------
record("C01 the required field set is exactly the reviewed one",
  REQUIRED_TEMPLATE_FIELDS === "id,name,language,status,category,components");
record("C02 the PRE-STATE GET explicitly requests the required fields", (() => {
  const pre = codeOnly.match(/const lookup = await http\.get\(\s*[\s\S]{0,240}?\);/);
  return pre !== null
    && /fields=\$\{REQUIRED_TEMPLATE_FIELDS\}/.test(pre[0])
    && /name=\$\{encodeURIComponent\(TARGET_TEMPLATE_NAME\)\}/.test(pre[0]);
})());
record("C03 the READBACK GET explicitly requests the required fields", (() => {
  const back = codeOnly.match(/const back = await http\.get\(\s*[\s\S]{0,240}?\);/);
  return back !== null && /fields=\$\{REQUIRED_TEMPLATE_FIELDS\}/.test(back[0]);
})());
record("C04 no message_templates GET omits the field set", (() => {
  const gets = codeOnly.match(/http\.get\(\s*`[^`]*message_templates[^`]*`/g) ?? [];
  return gets.length === 2 && gets.every((g) => /fields=\$\{REQUIRED_TEMPLATE_FIELDS\}/.test(g));
})());
record("C05 classifyPreState really depends on name+language+status (so the fields matter)",
  classifyPreState(okGet({ data: [row({ status: undefined })] })).state === PreState.PRESENT_OTHER_STATUS
  && classifyPreState(okGet({ data: [row({ language: undefined })] })).state === PreState.ABSENT
  && classifyPreState(okGet({ data: [row({ name: undefined })] })).state === PreState.ABSENT);

// ---------------------------------------------------------------------------
// R7I REVIEW CORRECTION 2 — the semantic check must use ONLY the remote row.
// A row that omits `components` must never be confirmable.
// ---------------------------------------------------------------------------
record("C06 the operator contains NO local-components fallback",
  !/after\.row\.components\s*\?\?/.test(codeOnly)
  && !/components:\s*after\.row\.components\s*\?\?/.test(codeOnly)
  && !/\?\?\s*payloadResult\.payload\.components/.test(codeOnly));
record("C07 the semantic comparison passes the remote components verbatim, gated on isArray",
  /const remoteComponents = after\.row\.components;/.test(codeOnly)
  && /const componentsUsable = Array\.isArray\(remoteComponents\);/.test(codeOnly)
  && /semantic = componentsUsable && templatesAreIdentical\(/.test(codeOnly)
  && /components:\s*remoteComponents,/.test(codeOnly));
record("C08 semantic starts false, never null, so an absent row cannot confirm",
  /let semantic = false;/.test(codeOnly));
record("C09 a readback row missing `components` can never match semantically", (() => {
  // The exact scenario: right name, language, status APPROVED, right category, no components.
  const missing = classifyPreState(okGet({ data: [row({ category: TARGET_CATEGORY })] }));
  if (missing.state !== PreState.ALREADY_CREATED) return false;
  const remoteComponents = missing.row.components;           // undefined
  const semantic = Array.isArray(remoteComponents) && templatesAreIdentical(
    { name: missing.row.name, language: missing.row.language, category: missing.row.category, components: remoteComponents },
    loadCanonicalPayload(packet).payload);
  const confirmed = missing.state === PreState.ALREADY_CREATED && semantic === true;
  // Unconfirmed -> the operator's outcome expression yields CREATE_AMBIGUOUS, exit 2.
  return semantic === false && confirmed === false && exitCodeForOutcome(Outcome.CREATE_AMBIGUOUS) === ExitCode.AMBIGUOUS;
})());
record("C10 an explicit null components readback also cannot confirm", (() => {
  const r = classifyPreState(okGet({ data: [row({ category: TARGET_CATEGORY, components: null })] }));
  return Array.isArray(r.row.components) === false;
})());
record("C11 the local payload IS otherwise a full match — so C09 is not vacuous", (() => {
  const payload = loadCanonicalPayload(packet).payload;
  return templatesAreIdentical(
    { name: payload.name, language: payload.language, category: payload.category, components: payload.components },
    payload) === true;
})());

// ---------------------------------------------------------------------------
// R7I REVIEW CORRECTION 3 — an ambiguous MUTATION must not look like success.
// ---------------------------------------------------------------------------
record("C12 CREATED exits 0", exitCodeForOutcome(Outcome.CREATED) === 0);
record("C13 CREATE_AMBIGUOUS exits with a DISTINCT non-zero code",
  exitCodeForOutcome(Outcome.CREATE_AMBIGUOUS) === 2
  && exitCodeForOutcome(Outcome.CREATE_AMBIGUOUS) !== exitCodeForOutcome(Outcome.CREATED)
  && exitCodeForOutcome(Outcome.CREATE_AMBIGUOUS) !== exitCodeForOutcome(Outcome.REFUSED));
record("C14 REFUSED exits non-zero", exitCodeForOutcome(Outcome.REFUSED) === 1);
record("C15 DRY_RUN_WOULD_POST exits 0", exitCodeForOutcome(Outcome.DRY_RUN_WOULD_POST) === 0);
record("C16 ALREADY_CREATED exits 0", exitCodeForOutcome(Outcome.ALREADY_CREATED) === 0);
record("C17 an unknown outcome fails closed to non-zero",
  exitCodeForOutcome("SOMETHING_NEW") === ExitCode.REFUSED && exitCodeForOutcome(undefined) === ExitCode.REFUSED);
record("C18 the operator routes every terminal path through exitCodeForOutcome/ExitCode",
  !/\breturn 0;|\breturn 1;|\breturn 2;/.test(codeOnly)
  && !/process\.exit\(0\)|process\.exit\(1\)|process\.exit\(2\)/.test(codeOnly)
  && /return exitCodeForOutcome\(outcome\);/.test(codeOnly));
record("C19 the deterministic-rejection path is non-zero", (() => {
  const seg = codeOnly.match(/DETERMINISTIC_4XX_REJECTION[\s\S]{0,420}?\n\s*\}/);
  return seg !== null && /return exitCodeForOutcome\(Outcome\.REFUSED\);/.test(seg[0]);
})());
record("C20 the unexpected-failure catch is non-zero",
  /catch\(\(\) => \{[\s\S]{0,200}process\.exit\(ExitCode\.REFUSED\)/.test(codeOnly));

// ---------------------------------------------------------------------------
// R7I REVIEW CORRECTION 4 — safeMetaError returns `subcode`, not `error_subcode`.
// ---------------------------------------------------------------------------
record("C21 the operator reads e.subcode", /e\.subcode/.test(codeOnly));
record("C22 the operator never reads the non-existent e.error_subcode",
  !/e\.error_subcode/.test(codeOnly) && !/\.error_subcode/.test(codeOnly));
record("C23 safeMetaError genuinely exposes `subcode` and not `error_subcode`", (() => {
  const src = readFileSync(resolve("scripts/mvp/communication/submit-meta-templates.mjs"), "utf8");
  const fn = src.match(/export function safeMetaError\(body\)[\s\S]*?\n\}/)[0];
  return /subcode:\s*int\(e\.error_subcode\)/.test(fn)     // it MAPS error_subcode -> subcode
    && /\{ code: null, subcode: null, type: null, is_transient: null \}/.test(fn);
})());

record("G01 the pinned fingerprint equals the packet's committed fingerprint",
  entryOf(packet).payload_fingerprint === EXPECTED_PAYLOAD_FINGERPRINT
  && createHash("sha256").update(JSON.stringify(entryOf(packet).creation_payload)).digest("hex") === EXPECTED_PAYLOAD_FINGERPRINT);
record("G02 the pinned digests match the public staging asset ids",
  sha256Hex(REAL.app) === EXPECTED_IDENTITY_DIGESTS.appId
  && sha256Hex(REAL.waba) === EXPECTED_IDENTITY_DIGESTS.wabaId
  && sha256Hex(REAL.phone) === EXPECTED_IDENTITY_DIGESTS.phoneNumberId);
record("G03 this operator targets a DIFFERENT template than R7B",
  TARGET_TEMPLATE_KEY === "client_matching_update"
  && TARGET_TEMPLATE_NAME === "qf_client_matching_update_v1"
  && EXPECTED_PAYLOAD_FINGERPRINT !== "c6e95a38dde899f717999520082feddf4c91f2a33c84650c72538ef2c111199a");
record("G04 only ONE client template is in scope — the sibling stays untouched",
  !/client_lead_status_update/.test(codeOnly));

console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
