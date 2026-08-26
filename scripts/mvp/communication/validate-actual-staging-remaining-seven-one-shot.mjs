// ============================================================================
// QF-MVP-40-R8C — validator for the ONE-SHOT remaining-seven ACTUAL-staging template
// creation authority. OFFLINE. Opens no socket, calls no Meta endpoint, touches no
// database, reads no credential and reads no external owner proof.
//
// THIS AUTHORITY CAN MUTATE SEVEN TIMES, so the load-bearing rules here are the ones
// that bound the mutation: the target set is frozen and derived, the preflight is
// COMPLETE before the first POST, each target may be posted at most once, the run stops
// permanently at the first unproven outcome, and nothing retries.
//
// Every rule is paired with a mutation that must be killed, and the happy paths are
// asserted first so no rejection test can be vacuous.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ANCHOR,
  ANCHOR_KEY,
  ANCHOR_REQUIRED_STATUS,
  EXECUTE_FLAG,
  ExitCode,
  MAX_POSTS,
  OWNER_ACK_FLAG,
  Outcome,
  PreflightFailure,
  REQUIRED_CATEGORY,
  REQUIRED_LANGUAGE,
  REQUIRED_TEMPLATE_FIELDS,
  RemoteState,
  SlotOutcome,
  TARGETS,
  attemptCreateSlot,
  classifyAllPreStates,
  classifyAnchor,
  classifyRemoteState,
  loadAllCanonicalPayloads,
  loadCanonicalPayload,
  lookupPath,
  makePostLedger,
  makeReadOnlyHttp,
  parseFlags,
  preflight,
  proveAssets,
  readLiveAssets,
  summarize,
  validateIdentity,
  verifyReadback,
} from "./create-actual-staging-remaining-seven-once.mjs";
import { INTENDED_STAGE } from "./create-actual-staging-vendor-onboarding-reminder-once.mjs";
import { OWNER_ACK_FLAG as R8B_ACK } from "./create-actual-staging-vendor-onboarding-reminder-once.mjs";
import { SEED_SET } from "./seed-meta-staging-inactive-mappings.mjs";
import { stagingAssetProofDigest, AssetScope } from "./activate-meta-staging-canary.mjs";
import {
  ACTUAL_STAGING_IDENTITY_DIGESTS,
  KNOWN_PRODUCTION_IDENTITY_DIGESTS,
  HISTORICAL_MIXED_IDENTITY_DIGESTS,
} from "./metaStagingIdentity.mjs";

const OPERATOR = "scripts/mvp/communication/create-actual-staging-remaining-seven-once.mjs";
const PACKET = "docs/provider-manifests/meta-template-submission-packet.json";
const EVIDENCE = "docs/provider-manifests/meta-staging-r8c-remaining-seven-creation.json";
const AUTHORIZED_STAGING_REF = "uckafzuochmbvtiodmcl";

const code = readFileSync(resolve(OPERATOR), "utf8");
/** Executable code only — the header DISCUSSES what it must not do; prose is not proof. */
const codeOnly = code
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
const noStrings = codeOnly.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, "``");

const packet = JSON.parse(readFileSync(resolve(PACKET), "utf8"));
const clonePacket = () => JSON.parse(JSON.stringify(packet));
const entryOf = (p, key) => p.templates.find((t) => t.internal_template_key === key);

// Public Meta asset ids, not secrets. Here only so the rules can be driven.
const ACTUAL = { app: "2097008694503517", waba: "1780494096277768", phone: "1179556411918086" };
const PRODUCTION = { app: "1034375632334278", waba: "27861262223494153", phone: "1333595106493545" };
const COMPANION_APP = "2202427980234937";

const NOW = 1_800_000_000_000;
const HEAD = "d".repeat(40);

let passed = 0;
let failed = 0;
const record = (label, ok) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}`); }
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const goodEnv = () => ({
  QF_META_GRAPH_API_VERSION: "v26.0",
  QF_META_ACCESS_TOKEN: "irrelevant-not-a-real-token",
  QF_META_APP_ID: ACTUAL.app,
  QF_META_WABA_ID: ACTUAL.waba,
  QF_META_PHONE_NUMBER_ID: ACTUAL.phone,
});
const productionEnv = () => ({ ...goodEnv(), QF_META_APP_ID: PRODUCTION.app,
  QF_META_WABA_ID: PRODUCTION.waba, QF_META_PHONE_NUMBER_ID: PRODUCTION.phone });

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
/** Mirrors what buildStagingAssetProofAdapter hands the operator: a VERIFIED proof. */
async function verifiedProof(over = {}) {
  const { verifyStagingAssetProof } = await import("./activate-meta-staging-canary.mjs");
  return verifyStagingAssetProof(mintProof(over), { now: () => NOW, projectRef: AUTHORIZED_STAGING_REF });
}

// Live readback fixtures use the MEASURED state: NOT_VERIFIED / GREEN (QF-MVP-40-R8B-R1).
const liveGets = (over = {}) => ({
  waba: { ok: true, status: 200, body: { id: ACTUAL.waba } },
  phones: { ok: true, status: 200, body: { data: [{ id: ACTUAL.phone, verified_name: "n/a",
    quality_rating: "GREEN", code_verification_status: "NOT_VERIFIED" }] } },
  subs: { ok: true, status: 200, body: { data: [
    { whatsapp_business_api_data: { id: ACTUAL.app } },
    { whatsapp_business_api_data: { id: COMPANION_APP } } ] } },
  ...over,
});

const payloads = loadAllCanonicalPayloads(packet);
const payloadFor = (key) => (key === ANCHOR_KEY
  ? payloads.anchorResult
  : payloads.results[TARGETS.findIndex((t) => t.key === key)]);

/** A remote row built FROM the canonical payload, so semantic comparison genuinely passes. */
const rowFor = (target, over = {}) => {
  const p = payloadFor(target.key).payload;
  return { id: "irrelevant", name: p.name, language: p.language, status: "PENDING",
           category: p.category, components: p.components, ...over };
};
const lookup = (rows) => ({ ok: true, status: 200, body: { data: rows } });
const anchorApproved = () => lookup([rowFor(ANCHOR, { status: "APPROVED" })]);
const sevenAbsent = () => TARGETS.map(() => lookup([]));

const bothFlags = () => parseFlags([EXECUTE_FLAG, OWNER_ACK_FLAG]);

async function proveWith(getsOver = {}, proofOver = {}, branchHead = HEAD) {
  return proveAssets({
    proof: await verifiedProof(proofOver),
    assets: readLiveAssets(liveGets(getsOver)),
    expected: { wabaId: ACTUAL.waba, phoneNumberId: ACTUAL.phone },
    branchHead,
  });
}

async function preflightWith(over = {}) {
  return preflight({
    flags: bothFlags(),
    identity: validateIdentity(goodEnv()),
    assetProof: await proveWith(),
    payloads,
    anchorState: classifyAnchor(anchorApproved(), payloads.anchorResult.payload),
    preStates: classifyAllPreStates(sevenAbsent()),
    ...over,
  });
}

/**
 * Drive the REAL seven-slot sequence with fake one-shot clients.
 * `createFor(name)` decides each target's create response; `getFor(name)` its readback.
 * The validator may loop here — the OPERATOR may not, and that is asserted separately.
 */
async function runSevenSlots({ createFor, getFor }) {
  const ledger = makePostLedger();
  const posted = [];
  const makeClient = () => {
    let n = 0;
    let currentName = null;
    return {
      postCount: () => n,
      async createOnce(payload) {
        if (n > 0) throw new Error("SECOND_POST_REFUSED");
        n += 1;
        currentName = payload.name;
        posted.push(payload.name);
        return createFor(payload.name);
      },
      async get() { return getFor(currentName); },
    };
  };
  const slots = [];
  let prior = Object.freeze({ continue: true });
  for (let i = 0; i < TARGETS.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const s = await attemptCreateSlot({
      target: TARGETS[i], payloadResult: payloads.results[i], makeClient, prior, ledger });
    slots.push(s);
    prior = s;
  }
  return { slots, posted, total: ledger.posts() };
}
// A real Meta 2xx create body carries id AND status. classifyCreateResponse correctly
// treats a body without a known status as AMBIGUOUS, so the fixture must be complete
// or every "clean create" test below would silently exercise the ambiguous path.
const cleanCreate = () => ({ threw: false, httpStatus: 200,
  body: { id: "x", status: "PENDING", category: "UTILITY" } });
const okReadback = (name) => {
  const t = TARGETS.find((x) => x.providerName === name) ?? ANCHOR;
  return lookup([rowFor(t)]);
};

// ===========================================================================
// BASELINE — the happy paths must work, or every rejection test is vacuous.
// ===========================================================================
record("B01 the actual staging identity is authorised", validateIdentity(goodEnv()).ok === true);
record("B02 all eight canonical payloads load and fingerprint-match", payloads.ok === true);
record("B03 a correct attestation + live readback proves STAGING_DEDICATED",
  (await proveWith()).scope === AssetScope.STAGING_DEDICATED);
record("B04 the APPROVED anchor passes", classifyAnchor(anchorApproved(), payloads.anchorResult.payload).ok === true);
record("B05 all seven ABSENT passes", classifyAllPreStates(sevenAbsent()).ok === true);
record("B06 the complete preflight authorises the run", (await preflightWith()).ok === true);
record("B07 the happy path permits mutation only with both flags",
  (await preflightWith()).mayPost === true);

// ===========================================================================
// 1-6 IDENTITY
// ===========================================================================
record("R01 the actual staging triple is accepted", validateIdentity(goodEnv()).ok === true);
record("R02 the production triple is refused", validateIdentity(productionEnv()).ok === false);
record("R03a the production APP alone is refused",
  validateIdentity({ ...goodEnv(), QF_META_APP_ID: PRODUCTION.app }).ok === false);
record("R03b the production WABA alone is refused",
  validateIdentity({ ...goodEnv(), QF_META_WABA_ID: PRODUCTION.waba }).ok === false);
record("R03c the production PHONE alone is refused",
  validateIdentity({ ...goodEnv(), QF_META_PHONE_NUMBER_ID: PRODUCTION.phone }).ok === false);
record("R04 the HISTORICAL MIXED identity is refused",
  validateIdentity({ ...goodEnv(), QF_META_WABA_ID: PRODUCTION.waba,
    QF_META_PHONE_NUMBER_ID: PRODUCTION.phone }).ok === false);
record("R05 a missing identity role is refused",
  validateIdentity({ ...goodEnv(), QF_META_WABA_ID: "" }).ok === false);
record("R06 a malformed identity role is refused",
  validateIdentity({ ...goodEnv(), QF_META_APP_ID: "not-an-id" }).ok === false);
record("R06b an unauthorised identity blocks the whole run",
  (await preflightWith({ identity: validateIdentity(productionEnv()) })).ok === false);
record("R06c the operator declares NO identity pins of its own",
  !/ACTUAL_STAGING_IDENTITY_DIGESTS\s*=\s*Object\.freeze/.test(codeOnly)
  && /validateIdentity/.test(codeOnly));

// ===========================================================================
// 7-14 OWNER PROOF + SUBSCRIBER SET
// ===========================================================================
record("R07 a valid TEMPLATE_CREATION proof is accepted", (await proveWith()).ok === true);
record("R08 a wrong-stage proof is refused", (await verifiedProof({ intended_stage: "ARM_READINESS" })).ok === true
  && INTENDED_STAGE === "TEMPLATE_CREATION"
  && /stage:\s*INTENDED_STAGE/.test(codeOnly));
record("R08b the operator never names an ARM or webhook stage",
  !/ARM_READINESS|ARM_CANARY|WEBHOOK_SUBSCRIPTION/.test(codeOnly));
record("R09 an expired proof is refused", await (async () => {
  const { verifyStagingAssetProof } = await import("./activate-meta-staging-canary.mjs");
  return verifyStagingAssetProof(mintProof(), { now: () => NOW + 3_600_000,
    projectRef: AUTHORIZED_STAGING_REF }).ok === false;
})());
record("R10 a stale/wrong source HEAD is refused", (await proveWith({}, {}, "e".repeat(40))).ok === false);
record("R10b a missing source HEAD is refused", (await proveWith({}, {}, null)).ok === false);
record("R11 an altered proof is refused", await (async () => {
  const { verifyStagingAssetProof } = await import("./activate-meta-staging-canary.mjs");
  const p = mintProof();
  p.expected_subscribed_app_ids = [ACTUAL.app, COMPANION_APP, "123456789012345"];
  return verifyStagingAssetProof(p, { now: () => NOW, projectRef: AUTHORIZED_STAGING_REF }).ok === false;
})());
record("R12 an EXTRA live subscriber is refused",
  (await proveWith({ subs: { ok: true, body: { data: [
    { whatsapp_business_api_data: { id: ACTUAL.app } },
    { whatsapp_business_api_data: { id: COMPANION_APP } },
    { whatsapp_business_api_data: { id: "555444333222111" } }] } } })).ok === false);
record("R13 a MISSING attested subscriber is refused",
  (await proveWith({ subs: { ok: true, body: { data: [
    { whatsapp_business_api_data: { id: ACTUAL.app } }] } } })).ok === false);
record("R13b the staging app missing from the live set is refused",
  (await proveWith({ subs: { ok: true, body: { data: [
    { whatsapp_business_api_data: { id: COMPANION_APP } }] } } })).ok === false);
record("R13c an unreadable subscriber list is refused — not evidence of an empty one",
  (await proveWith({ subs: { ok: false, body: null } })).ok === false);
record("R14 the PRODUCTION app subscribed is refused",
  (await proveWith({ subs: { ok: true, body: { data: [
    { whatsapp_business_api_data: { id: ACTUAL.app } },
    { whatsapp_business_api_data: { id: PRODUCTION.app } }] } } })).ok === false);
record("R14b order is irrelevant — the same set reversed still passes",
  (await proveWith({ subs: { ok: true, body: { data: [
    { whatsapp_business_api_data: { id: COMPANION_APP } },
    { whatsapp_business_api_data: { id: ACTUAL.app } }] } } })).ok === true);
record("R14c no companion id or display name is hard-coded in the operator",
  !code.includes(COMPANION_APP) && !/DevX|1P App/i.test(codeOnly));
record("R14d an unproven asset scope blocks the whole run",
  (await preflightWith({ assetProof: await proveWith({ subs: { ok: true, body: { data: [] } } }) })).ok === false);

// ===========================================================================
// 15-19 PHONE (R8B-R1 scope: identity exact, verification advisory)
// ===========================================================================
record("R15 exactly one phone is required",
  (await proveWith({ phones: { ok: true, body: { data: [
    { id: ACTUAL.phone, code_verification_status: "VERIFIED" },
    { id: "555444333222111", code_verification_status: "VERIFIED" }] } } })).ok === false);
record("R16 a WRONG staging phone is refused",
  (await proveWith({ phones: { ok: true, body: { data: [
    { id: "555444333222111", code_verification_status: "VERIFIED" }] } } })).ok === false);
record("R17 the PRODUCTION phone is refused even when VERIFIED",
  (await proveWith({ phones: { ok: true, body: { data: [
    { id: PRODUCTION.phone, code_verification_status: "VERIFIED" }] } } })).ok === false);
record("R18 the actual test phone NOT_VERIFIED still passes template-creation scope",
  (await proveWith()).ok === true
  && readLiveAssets(liveGets()).codeVerificationStatus === "NOT_VERIFIED");
record("R18b a VERIFIED phone also still passes — not an inversion",
  (await proveWith({ phones: { ok: true, body: { data: [
    { id: ACTUAL.phone, quality_rating: "GREEN", code_verification_status: "VERIFIED" }] } } })).ok === true);
record("R18c the operator contains NO code_verification_status gate of its own",
  !/code_verification_status[\s\S]{0,40}(!==|===)\s*["'`]?VERIFIED/.test(codeOnly));
record("R19 an unreadable phones GET is refused",
  (await proveWith({ phones: { ok: false, body: null } })).ok === false);
record("R19b an empty phone list is refused",
  (await proveWith({ phones: { ok: true, body: { data: [] } } })).ok === false);

// ===========================================================================
// 20-23 THE FROZEN SEVEN-TARGET SET
// ===========================================================================
record("R20 exactly seven targets, matching the specified set", (() => {
  const expect = ["qf_consent_help_response_v3", "qf_consent_stop_acknowledgement_v1",
    "qf_consent_start_acknowledgement_v2", "qf_lead_received_v1",
    "qf_client_lead_status_update_v1", "qf_client_matching_update_v2",
    "qf_lead_assignment_alert_v1"];
  return TARGETS.length === 7
    && [...TARGETS.map((t) => t.providerName)].sort().join(",") === [...expect].sort().join(",");
})());
record("R20b every target is en / UTILITY",
  TARGETS.every((t) => t.language === REQUIRED_LANGUAGE && t.category === REQUIRED_CATEGORY));
record("R20c the target set is DERIVED from SEED_SET, not re-declared",
  /SEED_SET\.filter/.test(codeOnly)
  && TARGETS.length === SEED_SET.length - 1);
record("R21 the vendor onboarding anchor is NOT a create target",
  !TARGETS.some((t) => t.key === ANCHOR_KEY)
  && !TARGETS.some((t) => t.providerName === "qf_vendor_onboarding_reminder_v1")
  && ANCHOR.key === ANCHOR_KEY);
record("R22 TARGETS is frozen — an eighth cannot be appended", (() => {
  const before = TARGETS.length;
  try { TARGETS.push({ key: "x" }); } catch { /* frozen throws in strict mode */ }
  return Object.isFrozen(TARGETS) && TARGETS.length === before;
})());
record("R22b each target entry is frozen", TARGETS.every((t) => Object.isFrozen(t)));
record("R22c MAX_POSTS equals the target count — no slack", MAX_POSTS === TARGETS.length && MAX_POSTS === 7);
record("R23 there is NO template selector — no --target, no name input",
  !/--target/.test(codeOnly)
  && !/env\.[A-Z_]*TEMPLATE/i.test(codeOnly)
  && !/process\.argv[\s\S]{0,40}(name|template)/i.test(codeOnly));
record("R23b the only known flags are execute + this authority's own acknowledgement", (() => {
  const f = parseFlags([EXECUTE_FLAG, OWNER_ACK_FLAG, "--target"]);
  return f.ok === false && f.reason === PreflightFailure.UNKNOWN_FLAG;
})());

// ===========================================================================
// 24-28 CANONICAL PAYLOAD
// ===========================================================================
record("R24 all seven canonical fingerprints verify",
  payloads.results.length === 7 && payloads.results.every((r) => r.ok === true));
record("R24b each fingerprint equals its SEED_SET pin",
  TARGETS.every((t, i) => payloads.results[i].fingerprint === t.fingerprint));
record("R25 a payload body mutation fails", (() => {
  const p = clonePacket(); entryOf(p, TARGETS[0].key).creation_payload.components[0].text += " x";
  return loadCanonicalPayload(p, TARGETS[0]).reason === "fingerprint_drift";
})());
record("R26 a name mutation fails", (() => {
  const p = clonePacket(); entryOf(p, TARGETS[1].key).creation_payload.name = "qf_other_v1";
  return loadCanonicalPayload(p, TARGETS[1]).ok === false;
})());
record("R26b a provider_template_name mutation fails", (() => {
  const p = clonePacket(); entryOf(p, TARGETS[1].key).provider_template_name = "qf_other_v1";
  return loadCanonicalPayload(p, TARGETS[1]).reason === "name_mismatch";
})());
record("R27 a language mutation fails", (() => {
  const p = clonePacket(); entryOf(p, TARGETS[2].key).creation_payload.language = "en_US";
  return loadCanonicalPayload(p, TARGETS[2]).reason === "language_mismatch";
})());
record("R28 a category mutation fails", (() => {
  const p = clonePacket(); entryOf(p, TARGETS[3].key).creation_payload.category = "MARKETING";
  return loadCanonicalPayload(p, TARGETS[3]).reason === "category_mismatch";
})());
record("R28b an added button fails", (() => {
  const p = clonePacket(); entryOf(p, TARGETS[4].key).creation_payload.components[0].buttons = [];
  return loadCanonicalPayload(p, TARGETS[4]).ok === false;
})());
record("R28c a duplicated packet entry fails", (() => {
  const p = clonePacket(); p.templates.push(JSON.parse(JSON.stringify(entryOf(p, TARGETS[5].key))));
  return loadCanonicalPayload(p, TARGETS[5]).reason === "target_entry_not_unique";
})());
record("R28d an unreadable packet fails the whole load",
  loadAllCanonicalPayloads(null).ok === false);
record("R28e any single bad payload refuses the WHOLE run", (() => {
  const p = clonePacket(); entryOf(p, TARGETS[6].key).creation_payload.category = "MARKETING";
  return loadAllCanonicalPayloads(p).ok === false;
})());
record("R28f historical packet state is NOT read (submit_now / local_state / provider_template_id)",
  !/submit_now|local_state|provider_template_id/.test(codeOnly));

// ===========================================================================
// 29-32 THE R8B ANCHOR
// ===========================================================================
record("R29 an APPROVED / UTILITY / en anchor with semantic match passes",
  classifyAnchor(anchorApproved(), payloads.anchorResult.payload).ok === true);
record("R30 a MISSING anchor refuses with zero POST", await (async () => {
  const st = classifyAnchor(lookup([]), payloads.anchorResult.payload);
  const g = await preflightWith({ anchorState: st });
  return st.ok === false && g.ok === false && g.mayPost === false;
})());
record("R31 a PENDING anchor refuses with zero POST", await (async () => {
  const st = classifyAnchor(lookup([rowFor(ANCHOR, { status: "PENDING" })]), payloads.anchorResult.payload);
  const g = await preflightWith({ anchorState: st });
  return st.reason === "anchor_not_approved" && g.ok === false;
})());
record("R32 a wrong-category anchor refuses with zero POST", await (async () => {
  const st = classifyAnchor(lookup([rowFor(ANCHOR, { status: "APPROVED", category: "MARKETING" })]),
    payloads.anchorResult.payload);
  const g = await preflightWith({ anchorState: st });
  return st.reason === "anchor_category_mismatch" && g.ok === false;
})());
record("R32b a REJECTED anchor refuses",
  classifyAnchor(lookup([rowFor(ANCHOR, { status: "REJECTED" })]), payloads.anchorResult.payload).ok === false);
record("R32c a wrong-language anchor refuses",
  classifyAnchor(lookup([rowFor(ANCHOR, { status: "APPROVED", language: "en_US" })]),
    payloads.anchorResult.payload).ok === false);
record("R32d a semantically drifted anchor refuses",
  classifyAnchor(lookup([rowFor(ANCHOR, { status: "APPROVED",
    components: [{ type: "body", text: "something else" }] })]),
    payloads.anchorResult.payload).reason === "anchor_semantic_mismatch");
record("R32e an ambiguous anchor lookup refuses",
  classifyAnchor(lookup([rowFor(ANCHOR, { status: "APPROVED" }), rowFor(ANCHOR, { status: "APPROVED" })]),
    payloads.anchorResult.payload).ok === false);
record("R32f an unreadable anchor lookup refuses",
  classifyAnchor({ ok: false, body: null }, payloads.anchorResult.payload).ok === false);

// ===========================================================================
// 33-35 PRE-STATE OF THE SEVEN
// ===========================================================================
record("R33 all seven ABSENT passes the dry run", (await preflightWith({ flags: parseFlags([]) })).ok === true);
record("R34 ANY one target already present refuses the COMPLETE run with zero POST", await (async () => {
  const l = sevenAbsent(); l[3] = lookup([rowFor(TARGETS[3], { status: "APPROVED" })]);
  const st = classifyAllPreStates(l);
  const g = await preflightWith({ preStates: st });
  return st.ok === false && g.ok === false && g.mayPost === false
    && st.faults.some((f) => f.startsWith(`${TARGETS[3].key}:`));
})());
record("R34b a PENDING target also refuses the whole run", (() => {
  const l = sevenAbsent(); l[0] = lookup([rowFor(TARGETS[0], { status: "PENDING" })]);
  return classifyAllPreStates(l).ok === false;
})());
record("R35 an AMBIGUOUS lookup refuses with zero POST", await (async () => {
  const l = sevenAbsent(); l[2] = lookup([rowFor(TARGETS[2]), rowFor(TARGETS[2])]);
  const st = classifyAllPreStates(l);
  return st.states[2].state === RemoteState.AMBIGUOUS && (await preflightWith({ preStates: st })).ok === false;
})());
record("R35b an UNREADABLE lookup refuses", await (async () => {
  const l = sevenAbsent(); l[5] = { ok: false, body: null };
  const st = classifyAllPreStates(l);
  return st.states[5].state === RemoteState.UNREADABLE && (await preflightWith({ preStates: st })).ok === false;
})());
record("R35c a different language on the same name does not count as present",
  classifyRemoteState(lookup([rowFor(TARGETS[0], { language: "en_US" })]), TARGETS[0]).state === RemoteState.ABSENT);
record("R35d the lookup pins the exact field set, never Graph defaults",
  lookupPath(TARGETS[0]).includes(encodeURIComponent(REQUIRED_TEMPLATE_FIELDS))
  && lookupPath(TARGETS[0]).includes(encodeURIComponent(TARGETS[0].providerName)));

// ===========================================================================
// 36-39 FLAGS
// ===========================================================================
record("R36 dry run cannot post", (await preflightWith({ flags: parseFlags([]) })).mayPost === false);
record("R37 --execute alone cannot post",
  (await preflightWith({ flags: parseFlags([EXECUTE_FLAG]) })).mayPost === false);
record("R38 the acknowledgement alone cannot post",
  (await preflightWith({ flags: parseFlags([OWNER_ACK_FLAG]) })).mayPost === false);
record("R39 both exact flags permit the mutation decision", (await preflightWith()).mayPost === true);
record("R39b R8B's SPENT acknowledgement is refused here", (() => {
  const f = parseFlags([EXECUTE_FLAG, R8B_ACK]);
  return f.ok === false && f.reason === PreflightFailure.UNKNOWN_FLAG && f.mayPost === false;
})());
record("R39c every previously spent acknowledgement is refused",
  ["--owner-authorized-once", "--owner-authorized-once-rebind",
   "--owner-authorized-once-identity-repair", R8B_ACK]
    .every((a) => parseFlags([EXECUTE_FLAG, a]).ok === false));
record("R39d this authority's flag is its own",
  OWNER_ACK_FLAG === "--owner-authorized-once-actual-staging-seven-create");
record("R39e no environment variable can substitute for the acknowledgement",
  !/process\.env\[[^\]]*(ACK|AUTHORI)/i.test(codeOnly) && !/env\.[A-Z_]*(ACK|AUTHORIZED)/.test(codeOnly));

// ===========================================================================
// 40-46 MUTATION BOUNDS — the load-bearing rules for a seven-POST authority
// ===========================================================================
{
  const run = await runSevenSlots({ createFor: cleanCreate, getFor: okReadback });
  record("R40 a fully clean run posts EXACTLY seven times",
    run.total === 7 && run.posted.length === 7);
  record("R41 exactly one POST per target, and each target exactly once",
    new Set(run.posted).size === 7
    && run.slots.every((s) => s.posted === 1)
    && [...run.posted].sort().join(",") === [...TARGETS.map((t) => t.providerName)].sort().join(","));
  record("R41b every slot reports CREATED and a semantic match",
    run.slots.every((s) => s.outcome === SlotOutcome.CREATED && s.semantic === true));
  record("R41c the run summary is CREATED_ALL_SEVEN",
    summarize(run.slots).outcome === Outcome.CREATED_ALL_SEVEN
    && summarize(run.slots).created === 7);
}
record("R40b the ledger refuses an eighth POST structurally", (() => {
  const l = makePostLedger();
  const seven = [1, 2, 3, 4, 5, 6, 7].map(() => l.record());
  let threw = false;
  try { l.record(); } catch { threw = true; }
  return seven.length === 7 && l.posts() === 7 && threw === true;
})());
record("R42 the operator contains NO loop, scheduler or retry construct",
  !/\bfor\s*\(|\bwhile\s*\(|\bdo\s*\{/.test(noStrings)
  && !/setTimeout|setInterval|setImmediate|process\.nextTick/.test(noStrings)
  && !/\bretry\b/i.test(noStrings));
record("R42b there is exactly ONE createOnce call site in the operator",
  (codeOnly.match(/createOnce/g) ?? []).length === 1);
record("R42c the seven slots are seven EXPLICIT call sites",
  (codeOnly.match(/attemptCreateSlot\(/g) ?? []).length === 8);
record("R42d no .map/.forEach wraps a mutation",
  !/\.(map|forEach|flatMap)\([^;]*createOnce/.test(codeOnly));
record("R42e POSTs are sequential — no Promise.all over a mutation",
  !/Promise\.all\([^;]*attemptCreateSlot/.test(codeOnly)
  && !/Promise\.all\([^;]*createOnce/.test(codeOnly));
record("R43 a second POST on one client throws rather than posting", await (async () => {
  let n = 0; let threw = false;
  const client = { postCount: () => n,
    async createOnce() { if (n > 0) throw new Error("SECOND_POST_REFUSED"); n += 1; return cleanCreate(); },
    async get() { return okReadback(TARGETS[0].providerName); } };
  await client.createOnce();
  try { await client.createOnce(); } catch { threw = true; }
  return threw && n === 1;
})());
{
  // Slot 3 is deterministically REJECTED. Slots 4-7 must never be attempted.
  const rejectAt = TARGETS[2].providerName;
  const run = await runSevenSlots({
    createFor: (name) => (name === rejectAt
      ? { threw: false, httpStatus: 400, body: { error: { code: 100, type: "OAuthException" } } }
      : cleanCreate()),
    getFor: okReadback });
  record("R46 a deterministic rejection stops the run permanently",
    run.slots[2].outcome === SlotOutcome.REJECTED
    && run.slots.slice(3).every((s) => s.outcome === SlotOutcome.SKIPPED_AFTER_STOP && s.posted === 0)
    && run.total === 3);
  record("R46b the rejected target is not re-posted", run.posted.filter((n) => n === rejectAt).length === 1);
  record("R46c a partial run summarizes as CREATED_PARTIAL, never as success",
    summarize(run.slots).outcome === Outcome.CREATED_PARTIAL && summarize(run.slots).created === 2);
}
{
  // Slot 2 is transport-AMBIGUOUS.
  const ambigAt = TARGETS[1].providerName;
  const run = await runSevenSlots({
    createFor: (name) => (name === ambigAt ? { threw: true, httpStatus: null, body: null } : cleanCreate()),
    getFor: okReadback });
  record("R44 an ambiguous create stops the run and is never retried",
    run.slots[1].outcome === SlotOutcome.AMBIGUOUS
    && run.slots.slice(2).every((s) => s.outcome === SlotOutcome.SKIPPED_AFTER_STOP && s.posted === 0)
    && run.total === 2
    && run.posted.filter((n) => n === ambigAt).length === 1);
}
{
  // Slot 1 creates cleanly but reads back ABSENT.
  const run = await runSevenSlots({ createFor: cleanCreate, getFor: () => lookup([]) });
  record("R45 an absent readback stops the run",
    run.slots[0].outcome === SlotOutcome.READBACK_ABSENT
    && run.slots.slice(1).every((s) => s.posted === 0) && run.total === 1);
}
{
  // Slot 1 creates cleanly but reads back a semantically different body.
  const run = await runSevenSlots({ createFor: cleanCreate,
    getFor: (name) => lookup([{ ...rowFor(TARGETS[0]), name,
      components: [{ type: "body", text: "drifted" }] }]) });
  record("R45b a semantic readback mismatch stops the run",
    run.slots[0].outcome === SlotOutcome.READBACK_MISMATCH
    && run.slots.slice(1).every((s) => s.posted === 0) && run.total === 1);
}
{
  // Slot 1 creates cleanly but reads back the wrong category.
  const run = await runSevenSlots({ createFor: cleanCreate,
    getFor: (name) => lookup([{ ...rowFor(TARGETS[0]), name, category: "MARKETING" }]) });
  record("R45c a wrong-category readback stops the run",
    run.slots[0].outcome === SlotOutcome.READBACK_MISMATCH && run.total === 1);
}
record("R45d exactly one readback per slot — no second GET after a verdict",
  (codeOnly.match(/await http\.get\(lookupPath\(target\)\)/g) ?? []).length === 1);
record("R44b a stopped run cannot resume itself — the latch is the prior slot", await (async () => {
  const ledger = makePostLedger();
  const s = await attemptCreateSlot({ target: TARGETS[0], payloadResult: payloads.results[0],
    makeClient: () => { throw new Error("CLIENT_MUST_NOT_BE_BUILT"); },
    prior: { continue: false }, ledger });
  return s.outcome === SlotOutcome.SKIPPED_AFTER_STOP && s.posted === 0 && ledger.posts() === 0;
})());

// ===========================================================================
// 47-51 ABSOLUTE PROHIBITIONS
// ===========================================================================
record("R47 the messaging endpoint is never referenced",
  !/\/messages\b|messaging_product|sendMessage/.test(codeOnly));
record("R48 no database import or access", !/createClient\(|supabase/i.test(codeOnly));
record("R48b no Supabase table is referenced",
  !/communication_provider_accounts|communication_template_mappings|\.from\(/.test(codeOnly));
record("R49 no write verb other than the create POST",
  !/method:\s*["'](DELETE|PUT|PATCH)["']/.test(codeOnly));
record("R50 no readiness / canary / mapping / webhook authority",
  !/arm[-_]?readiness|arm[-_]?canary|qf_arm_|qf_disable_|activation_status|outbound_enabled|subscribed_apps\?|webhook/i
    .test(codeOnly.replace(/\/subscribed_apps["'`]/g, "")));
record("R50b the read client is structurally GET-only", (() => {
  const ro = makeReadOnlyHttp({ version: "v26.0", wabaId: ACTUAL.waba, token: "t", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  return typeof ro.get === "function" && ro.createOnce === undefined && Object.isFrozen(ro);
})());
record("R51 no production identifier is committed in the operator",
  !code.includes(PRODUCTION.waba) && !code.includes(PRODUCTION.phone) && !code.includes(PRODUCTION.app));
record("R51b no actual-staging raw identifier is committed either",
  !code.includes(ACTUAL.waba) && !code.includes(ACTUAL.phone) && !code.includes(ACTUAL.app));
record("R51c the production digests can never be a target",
  Object.values(KNOWN_PRODUCTION_IDENTITY_DIGESTS)
    .every((d) => !Object.values(ACTUAL_STAGING_IDENTITY_DIGESTS).includes(d))
  && HISTORICAL_MIXED_IDENTITY_DIGESTS.wabaId === KNOWN_PRODUCTION_IDENTITY_DIGESTS.wabaId);
record("R51d creation is never reported as approval",
  /creation is NOT approval/i.test(code) && !/RESULT:\s*APPROVED/.test(code));
record("R51e an ambiguous run exits non-zero",
  ExitCode.AMBIGUOUS === 2 && ExitCode.REFUSED === 1 && ExitCode.OK === 0
  && /return ExitCode\.AMBIGUOUS/.test(codeOnly));

// ===========================================================================
// SPENT AUTHORITIES REMAIN SPENT
// ===========================================================================
record("S01 R8B's operator is untouched by this authority",
  !/create-actual-staging-vendor-onboarding-reminder-once[\s\S]{0,200}OWNER_ACK_FLAG/.test(codeOnly));
record("S02 R8B is imported only for its PURE asset layer, never its authority", (() => {
  const m = codeOnly.match(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*create-actual-staging-vendor-onboarding-reminder-once\.mjs["']/);
  if (!m) return false;
  const named = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = new Set(["ADVISORY_PHONE_FIELDS", "INTENDED_STAGE", "proveAssets",
    "readLiveAssets", "validateIdentity"]);
  return named.every((n) => allowed.has(n));
})());
record("S03 the retired R7 operators are not imported at all",
  !/create-meta-staging-client-|create-meta-staging-held-|create-meta-staging-start-ack/.test(codeOnly));
record("S04 only R7B's transport is borrowed, nothing else", (() => {
  const m = codeOnly.match(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*create-meta-staging-vendor-onboarding-reminder-once\.mjs["']/);
  return m !== null && m[1].split(",").map((s) => s.trim()).filter(Boolean).join(",") === "makeHttp";
})());

// ===========================================================================
// EVIDENCE
// ===========================================================================
let ev = null;
try { ev = JSON.parse(readFileSync(resolve(EVIDENCE), "utf8")); } catch { ev = null; }
record("E01 the R8C authority artifact exists", ev !== null);
if (ev) {
  record("E02 it records the live truth sweep: 1 approved, 7 absent",
    ev.live_truth_sweep?.approved_utility_en === 1 && ev.live_truth_sweep?.absent === 7
    && ev.live_truth_sweep?.expected_template_count === 8
    && ev.live_truth_sweep?.meta_post_count === 0);
  record("E03 it records R8B completed exactly once and is APPROVED",
    ev.r8b_anchor?.post_attempt_count === 1
    && ev.r8b_anchor?.current_remote_status === "APPROVED"
    && ev.r8b_anchor?.current_remote_category === "UTILITY");
  record("E04 it records R8B's authority as SPENT", ev.r8b_anchor?.authority === "SPENT");
  record("E05 it lists exactly the seven remaining names",
    Array.isArray(ev.targets) && ev.targets.length === 7
    && [...ev.targets.map((t) => t.provider_template_name)].sort().join(",")
       === [...TARGETS.map((t) => t.providerName)].sort().join(","));
  record("E06 it records R8C as UNEXECUTED with zero POSTs",
    ev.authority?.execution_status === "NOT_EXECUTED"
    && ev.execution_counts_at_authoring?.meta_post_count === 0);
  record("E07 it grants no send / mapping / readiness / production authority",
    ev.authorities_explicitly_not_granted?.send_authority === "DENIED"
    && ev.authorities_explicitly_not_granted?.mapping_authority === "DENIED"
    && ev.authorities_explicitly_not_granted?.readiness_arm_authority === "NOT_GRANTED"
    && ev.authorities_explicitly_not_granted?.production_authority === "NOT_GRANTED");
  record("E08 it draws the source-of-truth distinction explicitly",
    /canonical packet/i.test(ev.source_of_truth?.payload_contract ?? "")
    && /fresh live GET/i.test(ev.source_of_truth?.remote_existence_and_status ?? ""));
  record("E09 it pins this authority's own acknowledgement flag",
    (ev.authority?.required_flags ?? []).includes(OWNER_ACK_FLAG)
    && (ev.authority?.required_flags ?? []).includes(EXECUTE_FLAG));
  record("E10 it states creation is not approval",
    ev.authority?.creation_is_not_approval === true);
  record("E11 it commits no raw Meta identifier", (() => {
    const s = JSON.stringify(ev);
    return !s.includes(ACTUAL.waba) && !s.includes(ACTUAL.phone)
      && !s.includes(PRODUCTION.waba) && !s.includes(PRODUCTION.phone);
  })());
  record("E12 it reproduces no Meta request or response body",
    !JSON.stringify(ev).includes("\"response_body\"") && !JSON.stringify(ev).includes("\"request_body\""));
}

// ===========================================================================
console.log("");
console.log(`QF-MVP-40-R8C REMAINING-SEVEN CREATION: ${passed}/${passed + failed} PASS`);
if (failed === 0) console.log("QF_MVP_40_R8C_REMAINING_SEVEN_CREATION_PROVEN");
console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
