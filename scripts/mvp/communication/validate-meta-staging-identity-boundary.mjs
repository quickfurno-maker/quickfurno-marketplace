// ============================================================================
// QF-MVP-40-R8 — validator for the CANONICAL Meta staging identity boundary.
// OFFLINE. Opens no socket, calls no Meta endpoint, touches no database, reads no
// credential and reads no external owner proof.
//
// THE DEFECT THIS FILE EXISTS TO KILL
//   Between R7B and R7N the repository pinned a "staging" identity triple whose WABA and
//   phone digests were in fact the PRODUCTION WABA and PRODUCTION phone. Seven one-shot
//   operators executed against it. Nothing in the repository could detect this, because
//   nothing anywhere asserted that the production assets are NOT the staging assets.
//
//   So the load-bearing rules here are the ones that would have failed on 2026-08-13:
//   the production triple must not classify as staging, in any role, by any route.
//
// Every rule is paired with a mutation that must be killed, and the happy paths are
// asserted first so no rejection test can be vacuous.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ACTUAL_STAGING_IDENTITY_DIGESTS,
  HISTORICAL_AUTHORITY_RETIREMENT,
  HISTORICAL_MIXED_IDENTITY_DIGESTS,
  IDENTITY_ROLES,
  IdentityFault,
  KNOWN_PRODUCTION_IDENTITY_DIGESTS,
  classifyStagingIdentity,
  historicalRetirementBanner,
  isActualStagingIdentity,
  isKnownProductionDigest,
  retireHistoricalMutation,
  sha256Hex,
} from "./metaStagingIdentity.mjs";
import {
  SCOPE_GUARDED_STAGES,
  stagingAssetProofDigest,
  verifyStagingAssetProof,
} from "./activate-meta-staging-canary.mjs";
import { EXPECTED_IDENTITY_DIGESTS as R7B_PINS } from "./create-meta-staging-vendor-onboarding-reminder-once.mjs";
import { OWNER_ACK_FLAG as R8A_ACK } from "./repair-meta-staging-account-identity-once.mjs";

const IDENTITY_MODULE = "scripts/mvp/communication/metaStagingIdentity.mjs";
const AUTHORIZED_STAGING_REF = "uckafzuochmbvtiodmcl";

// The raw ids whose digests the boundary pins. They are public Meta asset ids, not
// secrets, and they appear ONLY here so the rules can be driven with real values.
const ACTUAL = { app: "2097008694503517", waba: "1780494096277768", phone: "1179556411918086" };
const PRODUCTION = { app: "1034375632334278", waba: "27861262223494153", phone: "1333595106493545" };
// The companion app Meta currently attaches to the dedicated test WABA. It is a FIXTURE,
// never an allow-list entry: no rule below may pass because of this id's identity.
const COMPANION_APP = "2202427980234937";

/** Executable code only. Every operator here DISCUSSES what it must not do, so a raw
 *  text scan would be satisfied by prose and defeated by it in equal measure. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");

const identitySrc = readFileSync(resolve(IDENTITY_MODULE), "utf8");
const identityCodeOnly = stripComments(identitySrc);

const RETIRED_OPERATORS = Object.freeze([
  ["scripts/mvp/communication/create-meta-staging-vendor-onboarding-reminder-once.mjs", "QF-MVP-40-R7B", "mayPost"],
  ["scripts/mvp/communication/create-meta-staging-client-matching-update-once.mjs", "QF-MVP-40-R7I", "mayPost"],
  ["scripts/mvp/communication/create-meta-staging-client-lead-status-update-once.mjs", "QF-MVP-40-R7K", "mayPost"],
  ["scripts/mvp/communication/create-meta-staging-held-utility-recovery-once.mjs", "QF-MVP-40-R7L", "mayPost"],
  ["scripts/mvp/communication/create-meta-staging-start-ack-v2-repair-once.mjs", "QF-MVP-40-R7M", "mayPost"],
  ["scripts/mvp/communication/create-meta-staging-client-matching-update-v2-once.mjs", "QF-MVP-40-R7N", "mayPost"],
  ["scripts/mvp/communication/rebind-meta-staging-provider-account-once.mjs", "QF-MVP-40-R7C", "mayWrite"],
]);

let passed = 0;
let failed = 0;
const record = (label, ok) => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}`); }
};

const actualEnv = () => ({ appId: ACTUAL.app, wabaId: ACTUAL.waba, phoneNumberId: ACTUAL.phone });
const productionEnv = () => ({ appId: PRODUCTION.app, wabaId: PRODUCTION.waba, phoneNumberId: PRODUCTION.phone });

// ===========================================================================
// BASELINE — the happy paths must work, or every rejection test below is vacuous.
// ===========================================================================
record("B01 the actual staging triple classifies as staging", classifyStagingIdentity(actualEnv()).ok === true);
record("B02 isActualStagingIdentity agrees with the classifier", isActualStagingIdentity(actualEnv()) === true);
record("B03 the pinned digests are the digests of the actual raw ids",
  sha256Hex(ACTUAL.app) === ACTUAL_STAGING_IDENTITY_DIGESTS.appId
  && sha256Hex(ACTUAL.waba) === ACTUAL_STAGING_IDENTITY_DIGESTS.wabaId
  && sha256Hex(ACTUAL.phone) === ACTUAL_STAGING_IDENTITY_DIGESTS.phoneNumberId);
record("B04 the production pins are the digests of the production raw ids",
  sha256Hex(PRODUCTION.app) === KNOWN_PRODUCTION_IDENTITY_DIGESTS.appId
  && sha256Hex(PRODUCTION.waba) === KNOWN_PRODUCTION_IDENTITY_DIGESTS.wabaId
  && sha256Hex(PRODUCTION.phone) === KNOWN_PRODUCTION_IDENTITY_DIGESTS.phoneNumberId);

// ===========================================================================
// IDENTITY — production must never classify as staging. These are the rules that
// would have caught the defect on 2026-08-13.
// ===========================================================================
record("I01 the full production triple is REJECTED as staging", classifyStagingIdentity(productionEnv()).ok === false);
record("I02 the production WABA alone is rejected", (() => {
  const r = classifyStagingIdentity({ ...actualEnv(), wabaId: PRODUCTION.waba });
  return r.ok === false
    && r.faults.includes(`${IdentityFault.NOT_ACTUAL_STAGING}:wabaId`)
    && r.faults.includes(`${IdentityFault.IS_PRODUCTION}:wabaId`);
})());
record("I03 the production phone alone is rejected", (() => {
  const r = classifyStagingIdentity({ ...actualEnv(), phoneNumberId: PRODUCTION.phone });
  return r.ok === false
    && r.faults.includes(`${IdentityFault.NOT_ACTUAL_STAGING}:phoneNumberId`)
    && r.faults.includes(`${IdentityFault.IS_PRODUCTION}:phoneNumberId`);
})());
record("I04 the production app alone is rejected", (() => {
  const r = classifyStagingIdentity({ ...actualEnv(), appId: PRODUCTION.app });
  return r.ok === false && r.faults.includes(`${IdentityFault.IS_PRODUCTION}:appId`);
})());
record("I05 every production digest is recognised in ANY role",
  Object.values(KNOWN_PRODUCTION_IDENTITY_DIGESTS).every((d) => isKnownProductionDigest(d) === true));
record("I06 an actual staging digest is NOT flagged as production",
  Object.values(ACTUAL_STAGING_IDENTITY_DIGESTS).every((d) => isKnownProductionDigest(d) === false));
record("I07 the HISTORICAL MIXED triple is rejected as staging",
  classifyStagingIdentity({ appId: ACTUAL.app, wabaId: PRODUCTION.waba, phoneNumberId: PRODUCTION.phone }).ok === false);
record("I08 the historical pins really are staging-app + production WABA/phone",
  HISTORICAL_MIXED_IDENTITY_DIGESTS.appId === ACTUAL_STAGING_IDENTITY_DIGESTS.appId
  && HISTORICAL_MIXED_IDENTITY_DIGESTS.wabaId === KNOWN_PRODUCTION_IDENTITY_DIGESTS.wabaId
  && HISTORICAL_MIXED_IDENTITY_DIGESTS.phoneNumberId === KNOWN_PRODUCTION_IDENTITY_DIGESTS.phoneNumberId);
record("I09 an arbitrary third-party triple is rejected",
  classifyStagingIdentity({ appId: "999888777666555", wabaId: "888777666555444", phoneNumberId: "777666555444333" }).ok === false);

// -- missing / malformed ----------------------------------------------------
record("I10 a missing role is rejected as MISSING, not silently skipped", (() => {
  const r = classifyStagingIdentity({ appId: ACTUAL.app, wabaId: ACTUAL.waba });
  return r.ok === false && r.faults.includes(`${IdentityFault.MISSING}:phoneNumberId`);
})());
record("I11 an empty-string role is rejected",
  classifyStagingIdentity({ ...actualEnv(), wabaId: "" }).faults.includes(`${IdentityFault.MISSING}:wabaId`));
record("I12 a null role is rejected",
  classifyStagingIdentity({ ...actualEnv(), phoneNumberId: null }).faults.includes(`${IdentityFault.MISSING}:phoneNumberId`));
record("I13 a non-identifier role is MALFORMED, not merely unauthorised",
  classifyStagingIdentity({ ...actualEnv(), wabaId: "not-an-id" }).faults.includes(`${IdentityFault.MALFORMED}:wabaId`));
record("I14 a too-short numeric id is malformed",
  classifyStagingIdentity({ ...actualEnv(), appId: "12345" }).faults.includes(`${IdentityFault.MALFORMED}:appId`));
record("I15 an empty object is rejected with one fault per role",
  classifyStagingIdentity({}).faults.length === IDENTITY_ROLES.length);
record("I16 a digest supplied where a raw id belongs is rejected",
  classifyStagingIdentity({ ...actualEnv(), wabaId: ACTUAL_STAGING_IDENTITY_DIGESTS.wabaId }).ok === false);

// -- the boundary must not be nameable --------------------------------------
record("I17 no display name, WABA name or verified name appears in the module",
  !/verified_name|display_name|waba_name|account_name/i.test(identityCodeOnly));
record("I18 the classifier reads ONLY the three id roles — no label input", (() => {
  const withLabels = { ...actualEnv(), environment: "STAGING", label: "QuickFurno Staging", name: "test" };
  const bare = classifyStagingIdentity(actualEnv());
  const labelled = classifyStagingIdentity(withLabels);
  // Labels must be inert: adding them changes nothing, and they cannot rescue a bad id.
  const rescued = classifyStagingIdentity({ ...productionEnv(), environment: "STAGING", label: "test" });
  return bare.ok === labelled.ok && rescued.ok === false;
})());
record("I19 the word 'test' can never authorise anything",
  !/["'`]test["'`]/i.test(identityCodeOnly));

// ===========================================================================
// SINGLE SOURCE OF TRUTH — future operators import the corrected pins; the historical
// operators keep the historical ones.
// ===========================================================================
record("S01 the actual staging pins are declared exactly once, in the boundary module",
  /ACTUAL_STAGING_IDENTITY_DIGESTS\s*=\s*Object\.freeze/.test(identityCodeOnly));
record("S02 R7B's pins ARE the historical mixed pins, not the actual staging ones",
  R7B_PINS === HISTORICAL_MIXED_IDENTITY_DIGESTS
  && R7B_PINS.wabaId === KNOWN_PRODUCTION_IDENTITY_DIGESTS.wabaId);
record("S03 R7B does NOT import the actual staging pins", (() => {
  // Comment-stripped: R7B's header legitimately EXPLAINS that the actual pins are
  // deliberately not wired in. Prose about a rule is not a violation of it.
  return !/ACTUAL_STAGING_IDENTITY_DIGESTS/.test(stripComments(readFileSync(resolve(RETIRED_OPERATORS[0][0]), "utf8")));
})());
record("S04 the new repair operator imports the ACTUAL staging pins", (() => {
  const src = readFileSync(resolve("scripts/mvp/communication/repair-meta-staging-account-identity-once.mjs"), "utf8");
  return /ACTUAL_STAGING_IDENTITY_DIGESTS/.test(src) && /metaStagingIdentity\.mjs/.test(src);
})());
record("S05 the new creation operator imports the ACTUAL staging pins", (() => {
  const src = readFileSync(resolve("scripts/mvp/communication/create-actual-staging-vendor-onboarding-reminder-once.mjs"), "utf8");
  return /classifyStagingIdentity/.test(src) && /metaStagingIdentity\.mjs/.test(src);
})());
record("S06 no operator re-declares a staging digest literal outside the boundary module", (() => {
  const literal = ACTUAL_STAGING_IDENTITY_DIGESTS.wabaId;
  const offenders = RETIRED_OPERATORS.map(([p]) => p)
    .concat([
      "scripts/mvp/communication/repair-meta-staging-account-identity-once.mjs",
      "scripts/mvp/communication/create-actual-staging-vendor-onboarding-reminder-once.mjs",
    ])
    .filter((p) => readFileSync(resolve(p), "utf8").includes(literal));
  return offenders.length === 0;
})());

// ===========================================================================
// HISTORICAL AUTHORITY RETIREMENT — a spent authority must not become a new one.
// ===========================================================================
record("H01 retireHistoricalMutation forces the mutation bit false",
  retireHistoricalMutation({ execute: true, ownerAck: true, mayPost: true },
    { operatorId: "X", mutationKey: "mayPost" }).mayPost === false);
record("H02 the retired flag object is frozen — a later line cannot re-enable it", (() => {
  const f = retireHistoricalMutation({ mayWrite: true }, { operatorId: "X", mutationKey: "mayWrite" });
  try { f.mayWrite = true; } catch { /* strict mode throws; both outcomes are fine */ }
  return f.mayWrite === false && Object.isFrozen(f);
})());
record("H03 retirement refuses to run without an explicit operator id and gate name", (() => {
  let threwA = false; let threwB = false;
  try { retireHistoricalMutation({}, { mutationKey: "mayPost" }); } catch { threwA = true; }
  try { retireHistoricalMutation({}, { operatorId: "X" }); } catch { threwB = true; }
  return threwA && threwB;
})());
record("H04 retirement preserves the other flags — it disables, it does not blank", (() => {
  const f = retireHistoricalMutation({ execute: true, ownerAck: true, mayPost: true },
    { operatorId: "X", mutationKey: "mayPost" });
  return f.execute === true && f.ownerAck === true && f.historicalAuthorityRetired === true;
})());
record("H05 the banner names the retirement and carries no authorisation language", (() => {
  const b = historicalRetirementBanner("QF-MVP-40-R7B");
  return typeof b === "string"
    && b.includes(HISTORICAL_AUTHORITY_RETIREMENT)
    && b.includes("QF-MVP-40-R7B")
    && !/AUTHORISED|AUTHORIZED|GRANTED/i.test(b);
})());

for (const [path, operatorId, mutationKey] of RETIRED_OPERATORS) {
  const src = readFileSync(resolve(path), "utf8");
  const short = operatorId.replace("QF-MVP-40-", "");
  record(`H10-${short} ${short} routes its flags through retireHistoricalMutation`,
    new RegExp(`retireHistoricalMutation\\([\\s\\S]{0,80}operatorId:\\s*"${operatorId}"[\\s\\S]{0,60}mutationKey:\\s*"${mutationKey}"`).test(src));
  record(`H11-${short} ${short} retires BEFORE its first network/database call`, (() => {
    const retireAt = src.indexOf("retireHistoricalMutation(parsed");
    // The first thing that can leave the process: a Supabase client, a fetch, or an await.
    const firstEffect = [src.indexOf("createClient("), src.indexOf("makeHttp({"), src.indexOf("selectAccount()")]
      .filter((i) => i >= 0);
    const entryAt = src.indexOf("if (isEntry) {");
    const effectsAfterEntry = firstEffect.filter((i) => i > entryAt);
    return retireAt > 0 && (effectsAfterEntry.length === 0 || retireAt < Math.min(...effectsAfterEntry));
  })());
  record(`H12-${short} ${short} prints the retirement banner`,
    /historicalRetirementBanner\(/.test(src));
}

record("H20 the new repair authority does NOT reuse a spent acknowledgement", (() => {
  const spent = new Set(["--owner-authorized-once", "--owner-authorized-once-rebind"]);
  return !spent.has(R8A_ACK) && R8A_ACK === "--owner-authorized-once-identity-repair";
})());
record("H21 the new creation authority does NOT reuse a spent acknowledgement", (() => {
  const src = readFileSync(resolve("scripts/mvp/communication/create-actual-staging-vendor-onboarding-reminder-once.mjs"), "utf8");
  return /OWNER_ACK_FLAG\s*=\s*"--owner-authorized-once-actual-staging-create"/.test(src);
})());
record("H22 the two new authorities do not share one acknowledgement flag", (() => {
  const src = readFileSync(resolve("scripts/mvp/communication/create-actual-staging-vendor-onboarding-reminder-once.mjs"), "utf8");
  return !src.includes(R8A_ACK);
})());

// ===========================================================================
// SUBSCRIBER SET — exact owner-attested equality, reused from QF-MVP-40-R7A.
// A display name is never evidence and no companion id is ever hard-coded as safe.
// ===========================================================================
const NOW = 1_800_000_000_000;
const HEAD = "a".repeat(40);

function mintProof(overrides = {}) {
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
    intended_stage: "TEMPLATE_CREATION",
    prohibited_asset_ids: [PRODUCTION.waba, PRODUCTION.phone, PRODUCTION.app],
    issued_at_ms: NOW - 60_000,
    expires_at_ms: NOW + 600_000,
    ...overrides,
  };
  body.proof_sha256 = stagingAssetProofDigest(body);
  return body;
}
const verify = (p) => verifyStagingAssetProof(p, { now: () => NOW, projectRef: AUTHORIZED_STAGING_REF });

record("X01 the exact owner-attested two-app set verifies", verify(mintProof()).ok === true);
record("X02 the attested set is canonicalised, so ORDER is irrelevant", (() => {
  const a = verify(mintProof({ expected_subscribed_app_ids: [ACTUAL.app, COMPANION_APP] }));
  const b = verify(mintProof({ expected_subscribed_app_ids: [COMPANION_APP, ACTUAL.app] }));
  return a.ok && b.ok
    && JSON.stringify(a.expectedSubscribedAppIds) === JSON.stringify(b.expectedSubscribedAppIds);
})());
record("X03 a set omitting the staging app is refused",
  verify(mintProof({ expected_subscribed_app_ids: [COMPANION_APP] })).ok === false);
record("X04 an empty attested set is refused",
  verify(mintProof({ expected_subscribed_app_ids: [] })).ok === false);
record("X05 a duplicated entry is refused — an 'exact set' cannot contain a duplicate",
  verify(mintProof({ expected_subscribed_app_ids: [ACTUAL.app, ACTUAL.app] })).ok === false);
record("X06 attesting the PRODUCTION app is refused — it is on the prohibited list",
  verify(mintProof({ expected_subscribed_app_ids: [ACTUAL.app, PRODUCTION.app] })).ok === false);
record("X07 a prohibited WABA cannot also be attested as the staging WABA",
  verify(mintProof({ waba_id: PRODUCTION.waba })).ok === false);
record("X08 a non-identifier subscriber entry is refused",
  verify(mintProof({ expected_subscribed_app_ids: [ACTUAL.app, "WA DevX Webhook Events 1P App"] })).ok === false);
record("X09 an empty prohibited list is refused — 'nothing is forbidden' is not a proof",
  verify(mintProof({ prohibited_asset_ids: [] })).ok === false);
record("X10 a tampered proof digest is refused", (() => {
  const p = mintProof();
  p.expected_subscribed_app_ids = [ACTUAL.app, COMPANION_APP, "123456789012345"];
  return verify(p).ok === false;
})());
record("X11 an expired proof is refused",
  verifyStagingAssetProof(mintProof(), { now: () => NOW + 3_600_000, projectRef: AUTHORIZED_STAGING_REF }).ok === false);
record("X12 a proof whose TTL exceeds 15 minutes is refused",
  verify(mintProof({ issued_at_ms: NOW - 60_000, expires_at_ms: NOW + 3_600_000 })).ok === false);
record("X13 the companion app id is a FIXTURE here and is hard-coded nowhere in source", (() => {
  const files = RETIRED_OPERATORS.map(([p]) => p).concat([
    IDENTITY_MODULE,
    "scripts/mvp/communication/repair-meta-staging-account-identity-once.mjs",
    "scripts/mvp/communication/create-actual-staging-vendor-onboarding-reminder-once.mjs",
    "scripts/mvp/communication/activate-meta-staging-canary.mjs",
  ]);
  return files.every((p) => !readFileSync(resolve(p), "utf8").includes(COMPANION_APP));
})());
record("X14 no source file trusts the companion's DISPLAY NAME", (() => {
  const files = [IDENTITY_MODULE, "scripts/mvp/communication/activate-meta-staging-canary.mjs",
    "scripts/mvp/communication/create-actual-staging-vendor-onboarding-reminder-once.mjs"];
  return files.every((p) => {
    const src = readFileSync(resolve(p), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
    return !/DevX|1P App/i.test(src);
  });
})());
record("X15 the subscriber cap was NOT widened into an unbounded allowlist",
  verify(mintProof({ expected_subscribed_app_ids: Array.from({ length: 9 },
    (_, i) => String(100000000000000 + i)).concat([ACTUAL.app]) })).ok === false);

// ===========================================================================
// STAGE BINDING — TEMPLATE_CREATION is a stage, and stages are not substitutable.
// ===========================================================================
record("T01 TEMPLATE_CREATION is a scope-guarded stage", SCOPE_GUARDED_STAGES.includes("TEMPLATE_CREATION"));
record("T02 the pre-existing stages are unchanged",
  ["PREFLIGHT_READONLY", "ARM_READINESS", "ARM_CANARY", "WEBHOOK_SUBSCRIPTION"]
    .every((s) => SCOPE_GUARDED_STAGES.includes(s)));
record("T03 the stage list did not become open-ended", SCOPE_GUARDED_STAGES.length === 5);
record("T04 a TEMPLATE_CREATION proof verifies", verify(mintProof()).ok === true);
record("T05 an unknown stage is still refused",
  verify(mintProof({ intended_stage: "TEMPLATE_DELETION" })).ok === false);
record("T06 a missing stage is still refused",
  verify(mintProof({ intended_stage: undefined })).ok === false);
record("T07 the creation operator demands the TEMPLATE_CREATION stage by name", (() => {
  const src = readFileSync(resolve("scripts/mvp/communication/create-actual-staging-vendor-onboarding-reminder-once.mjs"), "utf8");
  return /INTENDED_STAGE\s*=\s*"TEMPLATE_CREATION"/.test(src) && /stage:\s*INTENDED_STAGE/.test(src);
})());
record("T08 the creation operator never names an ARM stage", (() => {
  const src = readFileSync(resolve("scripts/mvp/communication/create-actual-staging-vendor-onboarding-reminder-once.mjs"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
  return !/ARM_READINESS|ARM_CANARY|WEBHOOK_SUBSCRIPTION/.test(src);
})());
record("T09 the stage comparison in the proof adapter is exact equality", (() => {
  const src = readFileSync(resolve("scripts/mvp/communication/activate-meta-staging-canary.mjs"), "utf8");
  return /if \(stage && parsed\.intended_stage !== stage\)/.test(src);
})());
record("T10 adding the stage granted no POST by itself — it is only a proof label", (() => {
  const src = readFileSync(resolve("scripts/mvp/communication/activate-meta-staging-canary.mjs"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
  // The literal must appear ONLY in the stage list, nowhere in a branch that acts.
  return (src.match(/TEMPLATE_CREATION/g) ?? []).length === 1;
})());

// ===========================================================================
console.log("");
console.log(`QF-MVP-40-R8 IDENTITY BOUNDARY: ${passed}/${passed + failed} PASS`);
if (failed === 0) console.log("QF_MVP_40_R8_IDENTITY_BOUNDARY_PROVEN");
console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
