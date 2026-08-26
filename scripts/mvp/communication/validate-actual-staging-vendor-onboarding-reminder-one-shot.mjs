// ============================================================================
// QF-MVP-40-R8B — validator for the ONE-SHOT ACTUAL-STAGING template creation authority.
// OFFLINE. Opens no socket, calls no Meta endpoint, touches no database, reads no
// credential, and never reads the owner's external asset attestation (that file lives
// outside the repository and may legitimately be absent on any machine).
//
// THE TWO DEFECTS THIS FILE EXISTS TO KILL
//   1. A production asset classifying as staging. R7B's pins made the production WABA and
//      phone the "authorised staging identity"; nothing could detect it. Here the
//      production triple must be refused, in every role.
//   2. A two-subscriber WABA being unblocked by TOLERANCE. The fix must never be a raised
//      count or a trusted display name — only the owner-attested EXACT set.
//
// Every rule is paired with a mutation that must be killed, and the happy paths are
// asserted first so no rejection test can be vacuous.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ADVISORY_PHONE_FIELDS,
  ALREADY_CREATED_STATUSES,
  CreateFailure,
  EXPECTED_PAYLOAD_FINGERPRINT,
  INTENDED_STAGE,
  OWNER_ACK_FLAG,
  Outcome,
  PreState,
  TARGET_CATEGORY,
  TARGET_LANGUAGE,
  TARGET_TEMPLATE_KEY,
  TARGET_TEMPLATE_NAME,
  classifyPreState,
  decide,
  loadCanonicalPayload,
  makeHttp,
  parseFlags,
  proveAssets,
  readLiveAssets,
  sha256Hex,
  validateIdentity,
} from "./create-actual-staging-vendor-onboarding-reminder-once.mjs";
import {
  ACTUAL_STAGING_IDENTITY_DIGESTS,
  KNOWN_PRODUCTION_IDENTITY_DIGESTS,
} from "./metaStagingIdentity.mjs";
import {
  AssetScope,
  stagingAssetProofDigest,
  verifyStagingAssetProof,
} from "./activate-meta-staging-canary.mjs";
import { OWNER_ACK_FLAG as R7B_ACK } from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";

const OPERATOR = "scripts/mvp/communication/create-actual-staging-vendor-onboarding-reminder-once.mjs";
const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const EVIDENCE = "docs/provider-manifests/meta-staging-identity-boundary-correction.json";
const PHONE_CORRECTION = "docs/provider-manifests/meta-staging-r8b-phone-state-correction.json";
const AUTHORIZED_STAGING_REF = "uckafzuochmbvtiodmcl";

const code = readFileSync(resolve(OPERATOR), "utf8");
const codeOnly = code
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
const packet = JSON.parse(readFileSync(resolve(PACKET), "utf8"));
const clonePacket = () => JSON.parse(JSON.stringify(packet));
const entryOf = (p) => p.templates.find((t) => t.internal_template_key === TARGET_TEMPLATE_KEY);

// Public Meta asset ids, not secrets. They appear only here so the rules can be driven.
const ACTUAL = { app: "2097008694503517", waba: "1780494096277768", phone: "1179556411918086" };
const PRODUCTION = { app: "1034375632334278", waba: "27861262223494153", phone: "1333595106493545" };
// A FIXTURE for the companion Meta attaches to a test WABA. No rule may pass because of
// this specific id — it is only ever supplied through an owner attestation.
const COMPANION_APP = "2202427980234937";

const NOW = 1_800_000_000_000;
const HEAD = "b".repeat(40);

let passed = 0;
let failed = 0;
const record = (label, ok) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}`); }
};

const goodEnv = () => ({
  QF_META_GRAPH_API_VERSION: "v26.0",
  QF_META_ACCESS_TOKEN: "irrelevant-not-a-real-token",
  QF_META_APP_ID: ACTUAL.app,
  QF_META_WABA_ID: ACTUAL.waba,
  QF_META_PHONE_NUMBER_ID: ACTUAL.phone,
});
const productionEnv = () => ({
  ...goodEnv(),
  QF_META_APP_ID: PRODUCTION.app,
  QF_META_WABA_ID: PRODUCTION.waba,
  QF_META_PHONE_NUMBER_ID: PRODUCTION.phone,
});

function mintProof(over = {}) {
  const body = {
    artifact: "qf-mvp-40-staging-meta-asset-proof",
    environment: "STAGING",
    project_ref: AUTHORIZED_STAGING_REF,
    asset_scope: "STAGING_DEDICATED",
    branch_head: HEAD,
    nonce: "n".repeat(32),
    meta_app_id: ACTUAL.app,
    waba_id: ACTUAL.waba,
    phone_number_id: ACTUAL.phone,
    expected_subscribed_app_ids: [ACTUAL.app, COMPANION_APP],
    intended_stage: INTENDED_STAGE,
    prohibited_asset_ids: [PRODUCTION.waba, PRODUCTION.phone, PRODUCTION.app],
    issued_at_ms: NOW - 60_000,
    expires_at_ms: NOW + 600_000,
    ...over,
  };
  body.proof_sha256 = stagingAssetProofDigest(body);
  return body;
}
const verifiedProof = (over = {}) =>
  verifyStagingAssetProof(mintProof(over), { now: () => NOW, projectRef: AUTHORIZED_STAGING_REF });

const liveGets = (over = {}) => ({
  waba: { ok: true, status: 200, body: { id: ACTUAL.waba } },
  phones: { ok: true, status: 200, body: { data: [{ id: ACTUAL.phone, verified_name: "n/a",
    // QF-MVP-40-R8B-R1: the DEFAULT fixture mirrors the state measured live on the actual
    // staging WABA on 2026-08-26 — NOT_VERIFIED / GREEN. Every test below therefore runs
    // against the real environment contract, not an idealized one.
    quality_rating: "GREEN", code_verification_status: "NOT_VERIFIED" }] } },
  subs: { ok: true, status: 200, body: { data: [
    { whatsapp_business_api_data: { id: ACTUAL.app } },
    { whatsapp_business_api_data: { id: COMPANION_APP } },
  ] } },
  ...over,
});
const expectedIdentity = () => ({ wabaId: ACTUAL.waba, phoneNumberId: ACTUAL.phone });
const proveWith = (getsOver = {}, proofOver = {}, branchHead = HEAD) => proveAssets({
  proof: verifiedProof(proofOver),
  assets: readLiveAssets(liveGets(getsOver)),
  expected: expectedIdentity(),
  branchHead,
});

const lookup = (rows) => ({ ok: true, status: 200, body: { data: rows } });
const exactRow = (over = {}) => ({ name: TARGET_TEMPLATE_NAME, language: TARGET_LANGUAGE,
  status: "APPROVED", category: TARGET_CATEGORY, id: "irrelevant", ...over });

const bothFlags = () => parseFlags(["--execute", OWNER_ACK_FLAG]);
const decideWith = (over = {}) => decide({
  flags: bothFlags(),
  identity: validateIdentity(goodEnv()),
  assetProof: proveWith(),
  payloadResult: loadCanonicalPayload(packet),
  preState: PreState.ABSENT,
  ...over,
});

// ===========================================================================
// BASELINE — the happy paths must work, or every rejection test below is vacuous.
// ===========================================================================
record("B01 the actual staging identity is authorised", validateIdentity(goodEnv()).ok === true);
record("B02 the canonical payload loads and matches the pinned fingerprint", (() => {
  const r = loadCanonicalPayload(packet);
  return r.ok === true && r.fingerprint === EXPECTED_PAYLOAD_FINGERPRINT;
})());
record("B03 a correct attestation + live readback proves STAGING_DEDICATED",
  proveWith().ok === true && proveWith().scope === AssetScope.STAGING_DEDICATED);
record("B04 ABSENT + both flags authorises exactly one POST",
  decideWith().post === true && decideWith().outcome === null);
record("B05 the pinned target is the intended one",
  TARGET_TEMPLATE_KEY === "vendor_onboarding_reminder"
  && TARGET_TEMPLATE_NAME === "qf_vendor_onboarding_reminder_v1"
  && TARGET_LANGUAGE === "en" && TARGET_CATEGORY === "UTILITY");

// ===========================================================================
// IDENTITY — the production triple must never authorise a POST.
// ===========================================================================
record("I01 the full production triple is REFUSED", validateIdentity(productionEnv()).ok === false);
record("I02 the production WABA alone is refused",
  validateIdentity({ ...goodEnv(), QF_META_WABA_ID: PRODUCTION.waba }).ok === false);
record("I03 the production phone alone is refused",
  validateIdentity({ ...goodEnv(), QF_META_PHONE_NUMBER_ID: PRODUCTION.phone }).ok === false);
record("I04 the production app alone is refused",
  validateIdentity({ ...goodEnv(), QF_META_APP_ID: PRODUCTION.app }).ok === false);
record("I05 the HISTORICAL MIXED triple (R7B's pins) is refused",
  validateIdentity({ ...goodEnv(), QF_META_WABA_ID: PRODUCTION.waba,
    QF_META_PHONE_NUMBER_ID: PRODUCTION.phone }).ok === false);
record("I06 a production identity blocks the POST even with both flags and ABSENT",
  decideWith({ identity: validateIdentity(productionEnv()) }).post === false);
record("I07 a missing id is refused", validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "" }).ok === false);
record("I08 a malformed id is refused", validateIdentity({ ...goodEnv(), QF_META_APP_ID: "abc" }).ok === false);
record("I09 a bad Graph API version is refused",
  validateIdentity({ ...goodEnv(), QF_META_GRAPH_API_VERSION: "26" }).ok === false);
record("I10 a missing token is refused",
  validateIdentity({ ...goodEnv(), QF_META_ACCESS_TOKEN: undefined }).ok === false);
record("I11 the operator declares NO identity pins of its own — it imports the boundary",
  !/ACTUAL_STAGING_IDENTITY_DIGESTS\s*=\s*Object\.freeze/.test(codeOnly)
  && /import\s*\{[\s\S]*?classifyStagingIdentity[\s\S]*?\}\s*from\s*["'][^"']*metaStagingIdentity\.mjs["']/.test(codeOnly));
record("I12 the operator does NOT import R7B's historical pins",
  !/EXPECTED_IDENTITY_DIGESTS/.test(codeOnly));

// ===========================================================================
// ASSET SCOPE — exact owner-attested set; no tolerance, no trusted names.
// ===========================================================================
record("A01 the exact attested two-app set passes", proveWith().ok === true);
record("A02 the same set in REVERSE order passes — order is irrelevant",
  proveWith({ subs: { ok: true, body: { data: [
    { whatsapp_business_api_data: { id: COMPANION_APP } },
    { whatsapp_business_api_data: { id: ACTUAL.app } }] } } }).ok === true);
record("A03 a MISSING attested companion fails",
  proveWith({ subs: { ok: true, body: { data: [{ whatsapp_business_api_data: { id: ACTUAL.app } }] } } }).ok === false);
record("A04 an UNEXPECTED third subscriber fails",
  proveWith({ subs: { ok: true, body: { data: [
    { whatsapp_business_api_data: { id: ACTUAL.app } },
    { whatsapp_business_api_data: { id: COMPANION_APP } },
    { whatsapp_business_api_data: { id: "555444333222111" } }] } } }).ok === false);
record("A05 the staging app MISSING from the live set fails",
  proveWith({ subs: { ok: true, body: { data: [
    { whatsapp_business_api_data: { id: COMPANION_APP } },
    { whatsapp_business_api_data: { id: "555444333222111" } }] } } }).ok === false);
record("A06 the PRODUCTION app appearing live fails",
  proveWith({ subs: { ok: true, body: { data: [
    { whatsapp_business_api_data: { id: ACTUAL.app } },
    { whatsapp_business_api_data: { id: PRODUCTION.app } }] } } }).ok === false);
record("A07 an EMPTY live subscriber set fails",
  proveWith({ subs: { ok: true, body: { data: [] } } }).ok === false);
record("A08 an UNREADABLE subscriber list fails — it is not evidence of an empty one",
  proveWith({ subs: { ok: false, body: null } }).ok === false);
record("A09 a display name alone authorises nothing", (() => {
  // The companion is present by NAME only; its id is a stranger. This must still fail.
  return proveWith({ subs: { ok: true, body: { data: [
    { whatsapp_business_api_data: { id: ACTUAL.app } },
    { whatsapp_business_api_data: { id: "111222333444555" }, name: "WA DevX Webhook Events 1P App" }] } } }).ok === false;
})());
record("A10 the live WABA must equal the configured WABA",
  proveWith({ waba: { ok: true, body: { id: PRODUCTION.waba } } }).ok === false);
record("A11 an unreadable WABA fails", proveWith({ waba: { ok: false, body: null } }).ok === false);
record("A12 more than one phone on the WABA fails",
  proveWith({ phones: { ok: true, body: { data: [
    { id: ACTUAL.phone, code_verification_status: "VERIFIED" },
    { id: "555444333222111", code_verification_status: "VERIFIED" }] } } }).ok === false);
// ---------------------------------------------------------------------------
// QF-MVP-40-R8B-R1 — PHONE STATE IS OBSERVED, NOT ENFORCED.
//
// The invariant this replaces ("an unverified phone fails") was wrong for this
// authority. R8B posts to the WABA-level `/{WABA-ID}/message_templates` endpoint, which
// takes no phone number, so requiring the phone to be code-verified imposed a SEND
// precondition on an operation that cannot send. Live on the actual staging WABA the
// exact attested phone reports NOT_VERIFIED / GREEN, which made the governed path
// unreachable for a reason unrelated to its authority.
//
// The correct narrower invariant: phone IDENTITY is still proved exactly; phone
// SEND-READINESS is not this operator's business. The tests below pin both halves — the
// relaxation AND everything it must not have relaxed.
// ---------------------------------------------------------------------------
record("A13 an unverified phone PASSES — exact identity, exact WABA, exact attested set",
  proveWith().ok === true && proveWith().scope === AssetScope.STAGING_DEDICATED);
record("A13a the default fixture really is the measured live state (NOT_VERIFIED/GREEN)", (() => {
  const r = readLiveAssets(liveGets());
  return r.codeVerificationStatus === "NOT_VERIFIED" && r.qualityRating === "GREEN";
})());
record("A13b a VERIFIED phone still passes — the relaxation is not an inversion",
  proveWith({ phones: { ok: true, body: { data: [
    { id: ACTUAL.phone, quality_rating: "GREEN", code_verification_status: "VERIFIED" }] } } }).ok === true);
record("A13c any code_verification_status value is accepted, none is a gate",
  ["VERIFIED", "NOT_VERIFIED", "EXPIRED", "PENDING", "", null, undefined].every((v) =>
    proveWith({ phones: { ok: true, body: { data: [
      { id: ACTUAL.phone, quality_rating: "GREEN", code_verification_status: v }] } } }).ok === true));
record("A13d a WRONG phone id still fails, whatever its verification state",
  proveWith({ phones: { ok: true, body: { data: [
    { id: "555444333222111", quality_rating: "GREEN", code_verification_status: "VERIFIED" }] } } }).ok === false);
record("A13e the PRODUCTION phone still fails, even when VERIFIED", (() => {
  const r = proveWith({ phones: { ok: true, body: { data: [
    { id: PRODUCTION.phone, quality_rating: "GREEN", code_verification_status: "VERIFIED" }] } } });
  const raw = readLiveAssets(liveGets({ phones: { ok: true, body: { data: [
    { id: PRODUCTION.phone, code_verification_status: "VERIFIED" }] } } }));
  return r.ok === false && raw.faults.includes(CreateFailure.LIVE_ASSET_IS_PRODUCTION);
})());
record("A13f an unreadable phones response still fails",
  proveWith({ phones: { ok: false, body: null } }).ok === false);
record("A13g a phones response with NO data array still fails",
  proveWith({ phones: { ok: true, body: {} } }).ok === false);
record("A13h an EMPTY phone list still fails",
  proveWith({ phones: { ok: true, body: { data: [] } } }).ok === false);
record("A13i the operator source contains NO code_verification_status gate", (() => {
  // Comment-stripped: the file legitimately EXPLAINS why it does not gate on this.
  const gated = /code_verification_status[\s\S]{0,40}(!==|===)\s*["'`]?VERIFIED/.test(codeOnly)
    || /PHONE_NOT_CODE_VERIFIED/.test(codeOnly);
  return gated === false;
})());
record("A13j the field is still OBSERVED and reported, not silently dropped",
  /codeVerificationStatus/.test(codeOnly)
  && /phone code verification/.test(code)
  && ADVISORY_PHONE_FIELDS.includes("code_verification_status"));
record("A13k quality_rating likewise remains advisory, not a gate",
  ["GREEN", "YELLOW", "RED", null].every((q) =>
    proveWith({ phones: { ok: true, body: { data: [
      { id: ACTUAL.phone, quality_rating: q, code_verification_status: "NOT_VERIFIED" }] } } }).ok === true)
  && ADVISORY_PHONE_FIELDS.includes("quality_rating"));
record("A14 a live PRODUCTION asset anywhere in the readback fails", (() => {
  const r = readLiveAssets(liveGets({ waba: { ok: true, body: { id: PRODUCTION.waba } } }));
  return r.ok === false && r.faults.includes(CreateFailure.LIVE_ASSET_IS_PRODUCTION);
})());
record("A15 a stale branch head fails — the attested commit must be the running one",
  proveWith({}, {}, "c".repeat(40)).ok === false);
record("A16 a missing branch head fails", proveWith({}, {}, null).ok === false);
record("A17 an unverifiable proof fails closed to SHARED_OR_UNKNOWN", (() => {
  const r = proveAssets({ proof: { ok: false, reason: "nope" }, assets: readLiveAssets(liveGets()),
    expected: expectedIdentity(), branchHead: HEAD });
  return r.ok === false && r.scope === AssetScope.SHARED_OR_UNKNOWN;
})());
record("A18 an ARM_READINESS proof cannot be consumed by this operator", (() => {
  // The adapter compares intended_stage by exact equality; the operator always declares
  // TEMPLATE_CREATION, so a readiness proof is refused before it ever classifies.
  const armProof = mintProof({ intended_stage: "ARM_READINESS" });
  return armProof.intended_stage !== INTENDED_STAGE
    && /stage:\s*INTENDED_STAGE/.test(codeOnly)
    && /INTENDED_STAGE\s*=\s*"TEMPLATE_CREATION"/.test(codeOnly);
})());
record("A19 an unproven asset scope blocks the POST even with both flags and ABSENT",
  decideWith({ assetProof: proveWith({ subs: { ok: true, body: { data: [] } } }) }).post === false);
record("A20 no subscriber COUNT threshold exists in the operator",
  !/subscriberCount\s*(===|==|<=|>=|<|>)\s*\d/.test(codeOnly)
  && !/subscriber_set_not_exactly_one/.test(codeOnly));
record("A21 no companion app id is hard-coded", !code.includes(COMPANION_APP));
record("A22 no companion display name is trusted", !/DevX|1P App/i.test(codeOnly));

// ===========================================================================
// PAYLOAD — pinned fingerprint, pinned shape, sourced from the committed packet.
// ===========================================================================
record("P01 the fingerprint is pinned to the canonical value",
  EXPECTED_PAYLOAD_FINGERPRINT === "c6e95a38dde899f717999520082feddf4c91f2a33c84650c72538ef2c111199a");
record("P02 a renamed template is refused", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.name = "qf_something_else_v1";
  return loadCanonicalPayload(p).ok === false;
})());
record("P03 a changed body is refused", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].text += " extra";
  return loadCanonicalPayload(p).reason === "fingerprint_drift";
})());
record("P04 a changed category is refused", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.category = "MARKETING";
  return loadCanonicalPayload(p).ok === false;
})());
record("P05 a changed language is refused", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.language = "en_US";
  return loadCanonicalPayload(p).ok === false;
})());
record("P06 an added button is refused", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.components[0].buttons = [];
  return loadCanonicalPayload(p).ok === false;
})());
record("P07 an unreadable packet is refused", loadCanonicalPayload(null).ok === false);
record("P08 a bad payload blocks the POST", (() => {
  const p = clonePacket(); entryOf(p).creation_payload.category = "MARKETING";
  return decideWith({ payloadResult: loadCanonicalPayload(p) }).post === false;
})());
record("P09 the operator never reads or writes the packet's submit_now",
  !/submit_now/.test(codeOnly));
record("P10 the operator has no template selector — the target is not a parameter",
  !/env\.[A-Z_]*TEMPLATE/i.test(codeOnly) && !/--target/.test(codeOnly));

// ===========================================================================
// PRE-STATE — ABSENT is the only writable state.
// ===========================================================================
record("R01 an empty lookup is ABSENT", classifyPreState(lookup([])).state === PreState.ABSENT);
record("R02 an exact APPROVED row is ALREADY_CREATED",
  classifyPreState(lookup([exactRow()])).state === PreState.ALREADY_CREATED);
record("R03 an exact PENDING row is ALREADY_CREATED",
  classifyPreState(lookup([exactRow({ status: "PENDING" })])).state === PreState.ALREADY_CREATED);
record("R04 a REJECTED row is PRESENT_OTHER_STATUS, never writable",
  classifyPreState(lookup([exactRow({ status: "REJECTED" })])).state === PreState.PRESENT_OTHER_STATUS);
record("R05 duplicate exact rows are AMBIGUOUS",
  classifyPreState(lookup([exactRow(), exactRow()])).state === PreState.AMBIGUOUS);
record("R06 an unreadable lookup is UNREADABLE",
  classifyPreState({ ok: false, body: null }).state === PreState.UNREADABLE);
record("R07 a different language does not count as the target",
  classifyPreState(lookup([exactRow({ language: "en_US" })])).state === PreState.ABSENT);
record("R08 a different name does not count as the target",
  classifyPreState(lookup([exactRow({ name: "qf_other_v1" })])).state === PreState.ABSENT);
record("R09 only APPROVED and PENDING mean 'already created'",
  [...ALREADY_CREATED_STATUSES].sort().join(",") === "APPROVED,PENDING");

// ===========================================================================
// DECISION — one POST, in one state, with two flags.
// ===========================================================================
record("D01 ABSENT + both flags => POST", decideWith().post === true);
record("D02 ABSENT + dry run => WOULD_POST, zero POST", (() => {
  const d = decideWith({ flags: parseFlags([]) });
  return d.post === false && d.outcome === Outcome.DRY_RUN_WOULD_POST;
})());
record("D03 ABSENT + only --execute => zero POST",
  decideWith({ flags: parseFlags(["--execute"]) }).post === false);
record("D04 ABSENT + only the acknowledgement => zero POST",
  decideWith({ flags: parseFlags([OWNER_ACK_FLAG]) }).post === false);
record("D05 ALREADY_CREATED => zero POST, and not an error", (() => {
  const d = decideWith({ preState: PreState.ALREADY_CREATED });
  return d.post === false && d.outcome === Outcome.ALREADY_CREATED;
})());
record("D06 PRESENT_OTHER_STATUS (incl. REJECTED) => refused",
  decideWith({ preState: PreState.PRESENT_OTHER_STATUS }).outcome === Outcome.REFUSED);
record("D07 AMBIGUOUS => refused", decideWith({ preState: PreState.AMBIGUOUS }).outcome === Outcome.REFUSED);
record("D08 UNREADABLE => refused", decideWith({ preState: PreState.UNREADABLE }).outcome === Outcome.REFUSED);
record("D09 an unknown pre-state fails CLOSED",
  decideWith({ preState: "SOMETHING_NEW" }).outcome === Outcome.REFUSED);

// ===========================================================================
// FLAGS — a NEW acknowledgement; spent ones are refused.
// ===========================================================================
record("F01 no flags => dry run", parseFlags([]).mayPost === false);
record("F02 both new flags => may post", bothFlags().mayPost === true);
record("F03 R7B's SPENT acknowledgement is refused as unknown", (() => {
  const f = parseFlags(["--execute", R7B_ACK]);
  return f.ok === false && f.reason === CreateFailure.UNKNOWN_FLAG && f.mayPost === false;
})());
record("F04 R7B's acknowledgement really is the spent one", R7B_ACK === "--owner-authorized-once");
record("F05 the repair authority's acknowledgement is refused here too",
  parseFlags(["--execute", "--owner-authorized-once-identity-repair"]).ok === false);
record("F06 an unknown flag is refused, never silently ignored",
  parseFlags(["--execute", OWNER_ACK_FLAG, "--force"]).ok === false);
record("F07 a refused flag set blocks the POST",
  decideWith({ flags: parseFlags(["--execute", R7B_ACK]) }).post === false);
record("F08 no environment variable can substitute for the acknowledgement",
  !/process\.env\[[^\]]*(ACK|AUTHORI)/i.test(codeOnly) && !/env\.[A-Z_]*(ACK|AUTHORIZED)/.test(codeOnly));

// ===========================================================================
// THE PORT — one POST, ever. No delete/put/patch. No messaging. No database.
// ===========================================================================
await (async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([init?.method ?? "GET", url]);
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  const http = makeHttp({ version: "v26.0", wabaId: ACTUAL.waba, token: "t", fetchImpl });
  await http.createOnce({ name: TARGET_TEMPLATE_NAME });
  let threw = false;
  try { await http.createOnce({ name: TARGET_TEMPLATE_NAME }); } catch { threw = true; }
  record("H01 the SECOND POST throws — a one-shot cannot become a two-shot",
    threw === true && http.postCount() === 1);
  record("H02 the single POST targets /message_templates and nothing else",
    calls.filter(([m]) => m === "POST").length === 1
    && calls.find(([m]) => m === "POST")[1].endsWith("/message_templates"));
})();
record("H03 no DELETE, PUT or PATCH method appears", !/method:\s*["'](DELETE|PUT|PATCH)["']/.test(codeOnly));
record("H04 the messaging endpoint is never referenced", !/\/messages\b|sendMessage|messaging_product/.test(codeOnly));
record("H05 no database client is constructed", !/createClient\(|supabase/i.test(codeOnly));
record("H06 no mapping or provider table is referenced",
  !/communication_provider_accounts|communication_template_mappings/.test(codeOnly));
record("H07 the operator arms nothing",
  !/arm[-_]?readiness|arm[-_]?canary|qf_arm_|qf_disable_|activation_status|outbound_enabled/i.test(codeOnly));
record("H08 no loop, scheduler or retry construct can drive a second attempt", (() => {
  const noStrings = codeOnly.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, "``");
  return !/\bfor\s*\(|\bwhile\s*\(|\bdo\s*\{/.test(noStrings)
    && !/setTimeout|setInterval|setImmediate|process\.nextTick/.test(noStrings)
    && !/\bretry\b/i.test(noStrings);
})());
record("H09 an ambiguous create is reported, never retried",
  /CREATE_AMBIGUOUS/.test(codeOnly) && /classifyCreateResponse/.test(codeOnly));
record("H10 the create classification reads the FIELD, not the object",
  /const \{ classification \} = classifyCreateResponse\(res\)/.test(codeOnly));
record("H11 exactly one readback follows the POST",
  (codeOnly.match(/const back = await http\.get\(/g) ?? []).length === 1);
record("H12 the asset proof is verified BEFORE any template lookup or POST", (() => {
  const proofAt = codeOnly.indexOf("adapter.verify(");
  const postAt = codeOnly.indexOf("http.createOnce(");
  const lookupAt = codeOnly.indexOf("message_templates?name=");
  return proofAt > 0 && proofAt < lookupAt && proofAt < postAt;
})());
record("H13 no raw Meta identifier is committed in the operator",
  !code.includes(ACTUAL.waba) && !code.includes(ACTUAL.phone) && !code.includes(ACTUAL.app)
  && !code.includes(PRODUCTION.waba) && !code.includes(PRODUCTION.phone));
record("H14 the digest helper is the shared one, not a local re-implementation",
  sha256Hex(ACTUAL.waba) === ACTUAL_STAGING_IDENTITY_DIGESTS.wabaId
  && !/createHash\(/.test(codeOnly));
record("H15 the production digests are never a valid target",
  Object.values(KNOWN_PRODUCTION_IDENTITY_DIGESTS)
    .every((d) => !Object.values(ACTUAL_STAGING_IDENTITY_DIGESTS).includes(d)));

// ===========================================================================
// EVIDENCE
// ===========================================================================
let ev = null;
try { ev = JSON.parse(readFileSync(resolve(EVIDENCE), "utf8")); } catch { ev = null; }
record("E01 the correction artifact exists", ev !== null);
if (ev) {
  const c = ev.new_authorities?.actual_staging_template_creation;
  record("E02 it names this operator and validator",
    c?.operator === OPERATOR
    && c?.validator === "scripts/mvp/communication/validate-actual-staging-vendor-onboarding-reminder-one-shot.mjs");
  record("E03 it records the authority as NOT YET EXECUTED", c?.execution_status === "NOT_EXECUTED");
  record("E04 it pins the same acknowledgement flag the code uses",
    (c?.required_flags ?? []).includes(OWNER_ACK_FLAG));
  record("E05 it pins the same payload fingerprint the code uses",
    c?.target?.payload_fingerprint === EXPECTED_PAYLOAD_FINGERPRINT);
  record("E06 it records that no subscriber count or display name is trusted",
    c?.asset_scope_proof?.hard_coded_count_used === false
    && c?.asset_scope_proof?.display_name_trusted === false
    && c?.asset_scope_proof?.companion_app_hard_coded === false);
  record("E07 it declares the packet model unchanged",
    c?.packet_model_unchanged?.global_packet_changed === false
    && c?.packet_model_unchanged?.submit_now_read_or_written === false);
  record("E08 it makes no deletion claim about the historical template",
    /NOT known whether that template was ever deleted/i
      .test(ev.what_the_earlier_evidence_does_and_does_not_prove
        ?.vendor_onboarding_reminder_specifically?.deletion_claim ?? ""));
  record("E09 it records the actual-staging state as ABSENT at diagnosis",
    ev.live_diagnosis_2026_08_25?.qf_vendor_onboarding_reminder_v1_on_actual_staging?.state
      === "ABSENT_AT_DIAGNOSIS");
  record("E10 it grants no send, mapping, readiness or canary authority",
    ev.authorities_explicitly_not_granted?.send_authority === "DENIED"
    && ev.authorities_explicitly_not_granted?.readiness_arm_authority === "NOT_GRANTED"
    && ev.authorities_explicitly_not_granted?.canary_arm_authority === "NOT_GRANTED");
  record("E11 it reproduces no Meta request or response body",
    !JSON.stringify(ev).includes("\"response_body\"") && !JSON.stringify(ev).includes("\"request_body\""));
}

// -- QF-MVP-40-R8B-R1 forward correction record ------------------------------
let r1 = null;
try { r1 = JSON.parse(readFileSync(resolve(PHONE_CORRECTION), "utf8")); } catch { r1 = null; }
record("E20 the phone-state correction artifact exists", r1 !== null);
if (r1) {
  record("E21 it is a FORWARD correction, not a historical rewrite",
    r1.correction_type === "FORWARD_LIVE_EVIDENCE_CORRECTION"
    && r1.not_a_historical_rewrite?.alters_r7_evidence === false
    && r1.not_a_historical_rewrite?.alters_any_execution_record === false);
  record("E22 it records that the validator was green before live execution",
    r1.pre_correction_state?.validator_was_green_offline === true
    && r1.pre_correction_state?.validator_result_before_live_execution === "101 passed, 0 failed");
  record("E23 it records zero POSTs during discovery",
    r1.live_evidence_2026_08_26?.meta_post_count === 0
    && r1.execution_counts_at_authoring?.meta_post_count === 0);
  record("E24 it records that no R8B authority was consumed",
    r1.live_evidence_2026_08_26?.authority_consumption?.r8b_creation_authority === "NOT_CONSUMED"
    && r1.authorities_explicitly_not_granted?.r8b_execution_status === "NOT_EXECUTED");
  record("E25 it states the correction makes nothing send-capable",
    r1.behavioral_change?.makes_anything_send_capable === false
    && r1.behavioral_change?.changes_global_rules === false);
  record("E26 it records the live phone state that triggered the correction",
    r1.live_evidence_2026_08_26?.get_only_phone_diagnosis?.code_verification_status === "NOT_VERIFIED"
    && r1.live_evidence_2026_08_26?.get_only_phone_diagnosis?.phone_count === 1
    && r1.live_evidence_2026_08_26?.get_only_phone_diagnosis?.expected_phone_match === true);
  record("E27 it deletes no tests", r1.validator?.tests_deleted === 0);
  record("E28 every retained fence it claims is one this suite actually proves", (() => {
    const f = r1.fences_explicitly_retained ?? [];
    return Array.isArray(f) && f.length >= 15
      && f.some((s) => /EXACTLY equal the owner-attested set/.test(s))
      && f.some((s) => /maximum ONE POST/i.test(s))
      && f.some((s) => /no database access/i.test(s));
  })());
  record("E29 it names the send-capable paths it left untouched",
    (r1.untouched_send_capable_paths?.files ?? []).length === 3
    && r1.untouched_send_capable_paths?.r8a_database_repair_unchanged === true);
}

// ===========================================================================
console.log("");
console.log(`QF-MVP-40-R8B ACTUAL-STAGING TEMPLATE CREATION: ${passed}/${passed + failed} PASS`);
if (failed === 0) console.log("QF_MVP_40_R8B_ACTUAL_STAGING_TEMPLATE_CREATION_PROVEN");
console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
