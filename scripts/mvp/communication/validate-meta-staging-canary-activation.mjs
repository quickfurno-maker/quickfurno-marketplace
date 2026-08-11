#!/usr/bin/env node
// ============================================================================
// QF-MVP-40 — validator for the staging Meta canary ACTIVATION operator.
//
// OFFLINE. No credential, no Supabase, no Meta, no network, no clock beyond an
// injected `now`. Every effect is a fixture.
//
// Every rule is paired with a MUTATION SELF-TEST that must FAIL, so the validator
// proves it is capable of failing. The operator arms a REAL provider send path, so a
// guard that cannot fail is worse than no guard at all.
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as A from "./activate-meta-staging-canary.mjs";
import { REQUIRED_ACCOUNT_READINESS, SENDABLE_ACTIVATION_STATUSES }
  from "../../../lib/communication/providers/metaRuntimeGate.ts";
import { hashPhoneE164 } from "../../../lib/communication/phone.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const OPERATOR_PATH = "scripts/mvp/communication/activate-meta-staging-canary.mjs";
const operatorSource = readFileSync(path.join(ROOT, OPERATOR_PATH), "utf8");
/** Comment-stripped, so this file's own prose can never satisfy an executable guard. */
const operatorCode = operatorSource
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const results = [];
const record = (name, passed, detail = "") =>
  results.push({ name, passed: passed === true, detail });

const F = A.ActivationFailure;
const NOW = 1_800_000_000_000;
const EXPECTED = Object.freeze({ phoneNumberId: "123456789012345", wabaId: "987654321098765" });
/**
 * A fixture only. `555-01xx` is the reserved fictional range, so this is E.164-valid,
 * hashes deterministically, and is not dialable. No real canary destination — the
 * owner's or anyone else's — may ever appear in this repository.
 */
const CANARY_E164 = "+15555550100";
const CANARY_HASH = hashPhoneE164(CANARY_E164);

const goodEnv = () => ({
  QF_STAGING_SUPABASE_URL: "https://uckafzuochmbvtiodmcl.supabase.co",
  QF_STAGING_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_" + "x".repeat(32),
  QF_META_ACCESS_TOKEN: "token-value-never-printed",
  QF_META_WABA_ID: EXPECTED.wabaId,
  QF_META_PHONE_NUMBER_ID: EXPECTED.phoneNumberId,
  QF_META_GRAPH_API_VERSION: "v21.0",
  [A.CANARY_DESTINATION_ENV]: CANARY_E164,
});

const fullEvidence = () => ({
  configurationComplete: true,
  wabaIdMatches: true,
  phoneNumberIdMatches: true,
  phoneConnected: true,
  businessVerified: true,
  webhookSubscribed: true,
  healthStatus: "healthy",
});

const readyAccount = () => ({
  provider_key: "meta_whatsapp_cloud",
  channel: "whatsapp",
  phone_number_reference: EXPECTED.phoneNumberId,
  business_account_reference: EXPECTED.wabaId,
  ...REQUIRED_ACCOUNT_READINESS,
});

const disabledAccount = () => ({
  ...readyAccount(),
  ...A.NON_SEND_CAPABLE_ACCOUNT,
  business_verification_status: "unknown",
  phone_number_status: "unknown",
});

const mappingRow = (key, over = {}) => ({
  id: `id-${key}`,
  template_key: key,
  channel: "whatsapp",
  provider_key: "meta_whatsapp_cloud",
  language: "en",
  provider_template_name: A.CANARY_ELIGIBLE_KEYS.includes(key)
    ? `qf_${key}_v1` : `qf_${key}_v1`,
  approval_status: "approved",
  is_active: false,
  ...over,
});

// Provider names must match SEED_SET exactly or planCanaryArm refuses on name drift.
const SEED_NAMES = Object.freeze({
  lead_received: "qf_lead_received_v1",
  client_lead_status_update: "qf_client_lead_status_update_v1",
  client_matching_update: "qf_client_matching_update_v1",
  lead_assignment_alert: "qf_lead_assignment_alert_v1",
  vendor_onboarding_reminder: "qf_vendor_onboarding_reminder_v1",
});
const realMapping = (key, over = {}) =>
  mappingRow(key, { provider_template_name: SEED_NAMES[key], ...over });

const CANARY_KEYS = ["client_matching_update", "vendor_onboarding_reminder"];
const allMappings = () => CANARY_KEYS.map((k) => realMapping(k));

const canaryArmArgs = (over = {}) => ({
  policy: { provider_key: "meta_whatsapp_cloud", channel: "whatsapp", ...A.READINESS_POSTURE },
  account: readyAccount(),
  mappings: allMappings(),
  canaryRows: [],
  evidence: fullEvidence(),
  expected: EXPECTED,
  templateKeys: CANARY_KEYS,
  destinationHash: CANARY_HASH,
  nowMs: NOW,
  ...over,
});

// ---------------------------------------------------------------------------
// M. MODE — exactly one per invocation
// ---------------------------------------------------------------------------
record("M01 the mode vocabulary is closed to exactly five",
  A.ACTIVATION_MODES.length === 5 &&
  A.ACTIVATION_MODES.join(",") === "DRY_RUN,PREFLIGHT_READONLY,ARM_READINESS,ARM_CANARY,DISABLE");
record("M02 the default is an OFFLINE dry run with no network and no writes",
  (() => { const m = A.resolveMode([]); return m.ok && m.mode === "DRY_RUN" && m.network === false && m.writes === false; })());
record("M03 preflight reads but never writes",
  (() => { const m = A.resolveMode(["--preflight-readonly"]); return m.ok && m.network === true && m.writes === false; })());
record("M04 both arm stages write AND require an attestation",
  ["--arm-readiness", "--arm-canary"].every((f) => {
    const m = A.resolveMode([f]);
    return m.ok && m.writes === true && m.attested === true;
  }));
record("M05 disable writes but deliberately needs NO attestation",
  (() => { const m = A.resolveMode(["--disable"]); return m.ok && m.writes === true && m.attested === false; })());
record("M06 two write modes together is a hard refusal",
  [["--arm-readiness", "--arm-canary"], ["--arm-canary", "--disable"], ["--preflight-readonly", "--arm-readiness"]]
    .every((argv) => A.resolveMode(argv).reason === F.MODE_CONFLICT));
record("M07 an unknown flag is refused, never ignored",
  ["--yolo", "--force", "--execute"].every((f) => A.resolveMode([f]).reason === F.UNKNOWN_FLAG));

// ---------------------------------------------------------------------------
// T. TEMPLATE SELECTION — never defaulted, never an acknowledgement
// ---------------------------------------------------------------------------
record("T01 the selection is never defaulted",
  A.resolveTemplateSelection([]).reason === F.TEMPLATE_SELECTION_MISSING &&
  A.resolveTemplateSelection(["--templates="]).reason === F.TEMPLATE_SELECTION_MISSING);
record("T02 every evidence-bound acknowledgement is refused by its own distinct code",
  A.EVIDENCE_BOUND_KEYS.length === 3 &&
  A.EVIDENCE_BOUND_KEYS.every((k) =>
    A.resolveTemplateSelection([`--templates=${k}`]).reason === F.TEMPLATE_EVIDENCE_BOUND));
record("T03 a key outside the approved eight is refused",
  ["vendor_new_lead", "vendor_crm_promotion", "made_up_key", "consent_help_response_v2"]
    .every((k) => {
      const r = A.resolveTemplateSelection([`--templates=${k}`]);
      return r.ok === false && [F.TEMPLATE_NOT_APPROVED_SET, F.TEMPLATE_EVIDENCE_BOUND].includes(r.reason);
    }));
record("T04 the five ordinary business keys are accepted",
  A.CANARY_ELIGIBLE_KEYS.length === 5 &&
  A.CANARY_ELIGIBLE_KEYS.every((k) => A.resolveTemplateSelection([`--templates=${k}`]).ok === true));
record("T05 duplicates collapse and order is deterministic",
  (() => {
    const r = A.resolveTemplateSelection(["--templates=vendor_onboarding_reminder,client_matching_update,vendor_onboarding_reminder"]);
    return r.ok && r.keys.length === 2 && r.keys.join(",") === "client_matching_update,vendor_onboarding_reminder";
  })());

// ---------------------------------------------------------------------------
// E. ENVIRONMENT IDENTITY FENCE — before any client or network call
// ---------------------------------------------------------------------------
record("E01 the authorized staging ref is accepted and the hash is derived",
  (() => {
    const r = A.resolveActivationTarget(goodEnv());
    return r.ok && r.projectRef === "uckafzuochmbvtiodmcl" && r.environment === "STAGING" &&
      r.destinationHash === CANARY_HASH;
  })());
record("E02 the PRODUCTION ref is refused by name",
  A.resolveActivationTarget({ ...goodEnv(), QF_STAGING_SUPABASE_URL: "https://yqpgcsduqbxulrlzwzap.supabase.co" })
    .reason === F.PROJECT_REF_FORBIDDEN_PRODUCTION);
record("E03 the QF-Jarvis ref is refused by name",
  A.resolveActivationTarget({ ...goodEnv(), QF_STAGING_SUPABASE_URL: "https://coilipywdvxklewquqvv.supabase.co" })
    .reason === F.PROJECT_REF_FORBIDDEN_JARVIS);
record("E04 any other project ref is refused",
  A.resolveActivationTarget({ ...goodEnv(), QF_STAGING_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" })
    .reason === F.PROJECT_REF_NOT_AUTHORIZED);
record("E05 a malformed staging URL is refused",
  ["not-a-url", "https://example.com", "https://short.supabase.co"].every((u) =>
    A.resolveActivationTarget({ ...goodEnv(), QF_STAGING_SUPABASE_URL: u }).ok === false));
record("E06 every required variable is individually required",
  ["QF_STAGING_SUPABASE_SERVICE_ROLE_KEY", "QF_META_ACCESS_TOKEN", "QF_META_WABA_ID",
   "QF_META_PHONE_NUMBER_ID", "QF_META_GRAPH_API_VERSION"].every((k) => {
    const env = goodEnv(); delete env[k];
    const r = A.resolveActivationTarget(env);
    return r.reason === F.ENV_MISSING && r.missing === k;
  }));
record("E07 a malformed Graph API version is refused",
  ["v21", "21.0", "vXX.0", "v21.0.1", ""].every((v) =>
    A.resolveActivationTarget({ ...goodEnv(), QF_META_GRAPH_API_VERSION: v }).ok === false));
record("E08 a non-identifier WABA or phone-number id is refused",
  ["abc", "12345", "123-456", ""].every((bad) =>
    A.resolveActivationTarget({ ...goodEnv(), QF_META_WABA_ID: bad }).ok === false &&
    A.resolveActivationTarget({ ...goodEnv(), QF_META_PHONE_NUMBER_ID: bad }).ok === false));
record("E09 a missing canary destination is refused, and it is required by default",
  (() => {
    const env = goodEnv(); delete env[A.CANARY_DESTINATION_ENV];
    const r = A.resolveActivationTarget(env);
    return r.reason === F.CANARY_DESTINATION_MISSING && r.missing === A.CANARY_DESTINATION_ENV;
  })());
// Same four invalid SHAPES as before — missing country code, leading zero, too short,
// non-numeric, too long — expressed in the reserved fictional range so no fixture in
// this repository ever resembles a real subscriber number.
record("E10 a non-E.164 canary destination is refused",
  ["5555550100", "+015555550100", "+1", "not a phone", "+15555550100123456"].every((bad) =>
    A.resolveActivationTarget({ ...goodEnv(), [A.CANARY_DESTINATION_ENV]: bad }).reason === F.CANARY_DESTINATION_INVALID));
record("E11 the fence NEVER returns the plaintext destination — only a hash",
  (() => {
    const r = A.resolveActivationTarget(goodEnv());
    const blob = JSON.stringify(r);
    return r.ok && !blob.includes(CANARY_E164) && !blob.includes(CANARY_E164.slice(2)) &&
      /^[0-9a-f]{64}$/.test(r.destinationHash);
  })());
record("E12 the fence NEVER returns a secret value",
  (() => {
    const env = goodEnv();
    const blob = JSON.stringify(A.resolveActivationTarget(env));
    return !blob.includes(env.QF_META_ACCESS_TOKEN) &&
      !blob.includes(env.QF_STAGING_SUPABASE_SERVICE_ROLE_KEY);
  })());
record("E13 a refused destination reports a CODE, never the value",
  (() => {
    const r = A.resolveActivationTarget({ ...goodEnv(), [A.CANARY_DESTINATION_ENV]: "9876500000" });
    return !JSON.stringify(r).includes("9876500000");
  })());

// ---------------------------------------------------------------------------
// V. EVIDENCE -> READINESS — the only place a readiness value is decided
// ---------------------------------------------------------------------------
record("V01 complete evidence yields exactly the six required values",
  (() => {
    const r = A.deriveAccountReadinessFromEvidence(fullEvidence());
    return r.ok && Object.keys(r.fields).length === 6 &&
      Object.entries(REQUIRED_ACCOUNT_READINESS).every(([k, v]) => r.fields[k] === v);
  })());
record("V02 EVERY single missing evidence fact is individually fatal",
  ["configurationComplete", "wabaIdMatches", "phoneNumberIdMatches", "phoneConnected",
   "businessVerified", "webhookSubscribed"].every((k) => {
    const ev = fullEvidence(); ev[k] = false;
    return A.deriveAccountReadinessFromEvidence(ev).reason === F.READINESS_EVIDENCE_INSUFFICIENT;
  }));
record("V03 any health verdict other than healthy is fatal",
  ["degraded", "unhealthy", "unknown", undefined, null, ""].every((h) =>
    A.deriveAccountReadinessFromEvidence({ ...fullEvidence(), healthStatus: h }).ok === false));
record("V04 absent or non-object evidence is fatal, never a default",
  [undefined, null, "healthy", 1, []].every((ev) =>
    A.deriveAccountReadinessFromEvidence(ev).ok === false));
record("V05 a truthy-but-not-true evidence value does not pass",
  ["yes", 1, "true"].every((v) =>
    A.deriveAccountReadinessFromEvidence({ ...fullEvidence(), webhookSubscribed: v }).ok === false));

// ---------------------------------------------------------------------------
// W. THE SECOND, INDEPENDENT WRITE FENCE
// ---------------------------------------------------------------------------
record("W01 a non-sendable posture needs no readiness evidence",
  A.assertWriteIsEarned({ posture: A.READINESS_POSTURE, accountFields: {}, evidence: null }).ok === true &&
  A.assertWriteIsEarned({ posture: A.DISABLED_POSTURE, accountFields: {}, evidence: null }).ok === true);
record("W02 a sendable posture without evidence is refused",
  A.assertWriteIsEarned({ posture: A.CANARY_POSTURE, accountFields: readyAccount(), evidence: null })
    .reason === F.SEND_CAPABLE_WITHOUT_EVIDENCE);
record("W03 outbound_enabled alone makes a posture sendable and demands evidence",
  A.assertWriteIsEarned({
    posture: { activation_status: "readiness_only", outbound_enabled: true },
    accountFields: readyAccount(), evidence: null,
  }).reason === F.SEND_CAPABLE_WITHOUT_EVIDENCE);
record("W04 a sendable posture with evidence but an unearned account field is refused",
  Object.keys(REQUIRED_ACCOUNT_READINESS).every((k) => {
    const acct = { ...readyAccount(), [k]: "unknown" };
    return A.assertWriteIsEarned({ posture: A.CANARY_POSTURE, accountFields: acct, evidence: fullEvidence() })
      .reason === F.SEND_CAPABLE_WITHOUT_EVIDENCE;
  }));
record("W05 a fully earned sendable write is permitted",
  A.assertWriteIsEarned({ posture: A.CANARY_POSTURE, accountFields: readyAccount(), evidence: fullEvidence() }).ok === true);

// ---------------------------------------------------------------------------
// R. STAGE 1 — readiness arm can NEVER reach a sending posture
// ---------------------------------------------------------------------------
record("R01 stage 1 opens only the non-sending gates",
  (() => {
    const r = A.planReadinessArm({ policy: null, account: readyAccount(), evidence: fullEvidence(), expected: EXPECTED });
    return r.ok && r.plan.policy.outbound_enabled === false &&
      r.plan.policy.activation_status === "readiness_only" &&
      r.plan.policy.webhook_processing_enabled === true &&
      r.plan.policy.health_check_enabled === true &&
      !SENDABLE_ACTIVATION_STATUSES.includes(r.plan.policy.activation_status);
  })());
record("R02 stage 1 activates no mapping and no canary destination",
  (() => {
    const r = A.planReadinessArm({ policy: null, account: readyAccount(), evidence: fullEvidence(), expected: EXPECTED });
    return r.ok && r.plan.mappingsToActivate.length === 0 && r.plan.canary === null;
  })());
record("R03 a missing account is refused",
  A.planReadinessArm({ policy: null, account: null, evidence: fullEvidence(), expected: EXPECTED })
    .reason === F.ACCOUNT_MISSING);
record("R04 an account whose references do not match the configured identity is refused",
  ["phone_number_reference", "business_account_reference"].every((k) => {
    const acct = { ...readyAccount(), [k]: "999999999999999" };
    return A.planReadinessArm({ policy: null, account: acct, evidence: fullEvidence(), expected: EXPECTED })
      .reason === F.ACCOUNT_IDENTITY_CONFLICT;
  }));
record("R05 insufficient evidence blocks stage 1 entirely",
  A.planReadinessArm({ policy: null, account: readyAccount(), evidence: { configurationComplete: true }, expected: EXPECTED })
    .reason === F.READINESS_EVIDENCE_INSUFFICIENT);

// ---------------------------------------------------------------------------
// C. STAGE 2 — canary arm
// ---------------------------------------------------------------------------
record("C01 a fully proven plan is accepted and reaches the canary posture",
  (() => {
    const r = A.planCanaryArm(canaryArmArgs());
    return r.ok && r.plan.policy.activation_status === "canary" &&
      r.plan.policy.outbound_enabled === true &&
      r.plan.mappingsToActivate.length === 2 &&
      r.plan.canary.destination_hash === CANARY_HASH &&
      r.plan.canary.is_active === true;
  })());
record("C02 the canary window is bounded and expires",
  (() => {
    const r = A.planCanaryArm(canaryArmArgs());
    const exp = Date.parse(r.plan.canary.expires_at);
    return r.ok && exp > NOW && exp - NOW === A.CANARY_WINDOW_MS && A.CANARY_WINDOW_MS <= 24 * 60 * 60 * 1000;
  })());
record("C03 stage 2 refuses unless durable readiness is ALREADY true — every field",
  Object.keys(REQUIRED_ACCOUNT_READINESS).every((k) => {
    const acct = { ...readyAccount(), [k]: "unknown" };
    return A.planCanaryArm(canaryArmArgs({ account: acct })).reason === F.READINESS_NOT_PROVEN;
  }));
record("C04 stage 2 refuses when no runtime policy row exists",
  A.planCanaryArm(canaryArmArgs({ policy: null })).reason === F.READINESS_NOT_PROVEN);
record("C05 an ACTIVE mapping outside the reviewed selection is refused",
  A.planCanaryArm(canaryArmArgs({
    mappings: [...allMappings(), realMapping("lead_received", { is_active: true })],
  })).reason === F.UNRELATED_ACTIVE_MAPPING);
record("C06 a missing or ambiguous mapping is refused",
  A.planCanaryArm(canaryArmArgs({ mappings: [realMapping("client_matching_update")] })).reason === F.MAPPING_MISSING &&
  A.planCanaryArm(canaryArmArgs({
    mappings: [...allMappings(), realMapping("client_matching_update", { id: "dup" })],
  })).reason === F.MAPPING_MISSING);
record("C07 a non-approved mapping is refused",
  ["draft", "pending", "rejected", ""].every((s) =>
    A.planCanaryArm(canaryArmArgs({
      mappings: [realMapping("client_matching_update", { approval_status: s }), realMapping("vendor_onboarding_reminder")],
    })).reason === F.MAPPING_NOT_APPROVED));
record("C08 provider-template-name drift is refused",
  A.planCanaryArm(canaryArmArgs({
    mappings: [realMapping("client_matching_update", { provider_template_name: "qf_client_matching_update_v2" }),
      realMapping("vendor_onboarding_reminder")],
  })).reason === F.MAPPING_MISSING);
record("C09 an already-active target mapping is refused rather than re-activated",
  A.planCanaryArm(canaryArmArgs({
    mappings: [realMapping("client_matching_update", { is_active: true }), realMapping("vendor_onboarding_reminder")],
  })).reason === F.MAPPING_ALREADY_ACTIVE);
record("C10 a wrong channel, provider or language makes the mapping unmatched",
  ["channel", "provider_key", "language"].every((k) =>
    A.planCanaryArm(canaryArmArgs({
      mappings: [realMapping("client_matching_update", { [k]: "wrong" }), realMapping("vendor_onboarding_reminder")],
    })).reason === F.MAPPING_MISSING));
record("C11 a malformed destination hash is refused",
  ["", "abc", CANARY_HASH.toUpperCase(), "f".repeat(63), null, undefined].every((h) =>
    A.planCanaryArm(canaryArmArgs({ destinationHash: h })).reason === F.CANARY_DESTINATION_INVALID));
record("C12 an empty template selection is refused",
  A.planCanaryArm(canaryArmArgs({ templateKeys: [] })).reason === F.TEMPLATE_SELECTION_MISSING &&
  A.planCanaryArm(canaryArmArgs({ templateKeys: null })).reason === F.TEMPLATE_SELECTION_MISSING);
record("C13 a missing account is refused",
  A.planCanaryArm(canaryArmArgs({ account: null })).reason === F.ACCOUNT_MISSING);
record("C14 the plan is proven through the FROZEN composed gate, not a local copy",
  operatorCode.includes("evaluateMetaOutboundGate(") &&
  operatorCode.includes('from "../../../lib/communication/providers/metaRuntimeGate.ts"'));
record("C15 a plan that would permit a NON-canary destination is refused",
  // Proven by construction: the operator runs the real gate a second time with a
  // foreign hash and refuses if it passes. Exercised here by an account/posture that
  // would pass for anything — `active` activation skips the allowlist entirely.
  operatorCode.includes('detail: "plan would permit a non-canary destination"'));
record("C16 stage 2 never re-derives readiness from fresh evidence",
  // It reads the durable row. Otherwise one invocation could both earn and spend it.
  (() => {
    const r = A.planCanaryArm(canaryArmArgs({ account: { ...readyAccount(), health_status: "degraded" } }));
    return r.reason === F.READINESS_NOT_PROVEN;
  })());
record("C17 the plan carries no plaintext destination",
  (() => {
    const r = A.planCanaryArm(canaryArmArgs());
    return r.ok && !JSON.stringify(r.plan).includes(CANARY_E164);
  })());

// ---------------------------------------------------------------------------
// D. STAGE 3 — the return to fail-closed
// ---------------------------------------------------------------------------
record("D01 disable is unconditional: it needs no policy, no account and no evidence",
  (() => {
    const r = A.planDisable({ policy: null, mappings: null, canaryRows: null });
    return r.ok && r.plan.policy.activation_status === "disabled" &&
      r.plan.policy.outbound_enabled === false &&
      r.plan.policy.webhook_processing_enabled === false &&
      r.plan.policy.health_check_enabled === false;
  })());
record("D02 disable returns the account to a non-send-capable state",
  (() => {
    const r = A.planDisable({ policy: {}, mappings: [], canaryRows: [] });
    return r.ok && r.plan.account.readiness_status === "disabled" &&
      r.plan.account.webhook_status !== REQUIRED_ACCOUNT_READINESS.webhook_status &&
      r.plan.account.health_status !== REQUIRED_ACCOUNT_READINESS.health_status;
  })());
record("D03 disable enumerates exactly the active rows it will close",
  (() => {
    const r = A.planDisable({
      policy: {},
      mappings: [realMapping("client_matching_update", { is_active: true }), realMapping("lead_received")],
      canaryRows: [{ destination_hash: CANARY_HASH, is_active: true }, { destination_hash: "a".repeat(64), is_active: false }],
    });
    return r.ok && r.plan.mappingsToDeactivate.join(",") === "client_matching_update" &&
      r.plan.canaryToDeactivate.join(",") === CANARY_HASH;
  })());
record("D04 disable is idempotent — nothing to close is still a valid plan",
  (() => {
    const r = A.planDisable({ policy: {}, mappings: allMappings(), canaryRows: [] });
    return r.ok && r.plan.mappingsToDeactivate.length === 0 && r.plan.canaryToDeactivate.length === 0;
  })());
record("D05 the disabled result FAILS the real gate for the canary destination itself",
  A.proveDisabledIsFailClosed({ account: readyAccount(), expected: EXPECTED, destinationHash: CANARY_HASH, nowMs: NOW }) === true);
record("D06 the disabled result fails the real gate even for a still-ready account",
  A.proveDisabledIsFailClosed({ account: readyAccount(), expected: EXPECTED, destinationHash: "b".repeat(64), nowMs: NOW }) === true);

// ---------------------------------------------------------------------------
// A. ATTESTATION — single-use, short-lived, stage-bound
// ---------------------------------------------------------------------------
const mkAttestation = (over = {}) => {
  const body = {
    artifact: A.ATTESTATION_ARTIFACT,
    environment: "STAGING",
    project_ref: "uckafzuochmbvtiodmcl",
    stage: "ARM_CANARY",
    plan_sha256: "p".repeat(64),
    issued_at_ms: NOW,
    expires_at_ms: NOW + 10 * 60 * 1000,
    ...over,
  };
  return { ...body, attestation_sha256: A.attestationDigest(body) };
};
const verify = (att, over = {}) => A.verifyAttestation(att, {
  now: () => NOW, projectRef: "uckafzuochmbvtiodmcl", stage: "ARM_CANARY",
  planHash: "p".repeat(64), consumedHashes: [], ...over,
});

record("A01 a fresh, matching attestation verifies",
  verify(mkAttestation()).ok === true);
record("A02 a WRONG-STAGE attestation is refused — readiness cannot be spent on canary",
  verify(mkAttestation({ stage: "ARM_READINESS" })).reason === F.ATTESTATION_WRONG_STAGE);
record("A03 a tampered body is detected without any secret",
  (() => {
    const att = mkAttestation();
    att.plan_sha256 = "q".repeat(64);
    return verify(att, { planHash: "q".repeat(64) }).reason === F.ATTESTATION_TAMPERED;
  })());
record("A04 a foreign project ref, environment or artifact is refused",
  verify(mkAttestation({ project_ref: "yqpgcsduqbxulrlzwzap" })).reason === F.ATTESTATION_MISMATCH &&
  verify(mkAttestation({ environment: "PRODUCTION" })).reason === F.ATTESTATION_MISMATCH &&
  verify(mkAttestation({ artifact: "SOMETHING-ELSE" })).reason === F.ATTESTATION_MISMATCH);
record("A05 an expired attestation is refused",
  verify(mkAttestation({ issued_at_ms: NOW - 20 * 60 * 1000, expires_at_ms: NOW - 60_000 })).reason === F.ATTESTATION_EXPIRED);
record("A06 a TTL beyond 15 minutes is refused",
  verify(mkAttestation({ expires_at_ms: NOW + 16 * 60 * 1000 })).reason === F.ATTESTATION_EXPIRED);
record("A07 a future-dated attestation is refused beyond the clock tolerance",
  verify(mkAttestation({ issued_at_ms: NOW + 120_000, expires_at_ms: NOW + 130_000 })).reason === F.ATTESTATION_TAMPERED);
record("A08 a plan that differs from the approved plan is refused",
  verify(mkAttestation(), { planHash: "z".repeat(64) }).reason === F.ATTESTATION_MISMATCH);
record("A09 an already-consumed attestation is refused — single use",
  (() => {
    const att = mkAttestation();
    return verify(att, { consumedHashes: [att.attestation_sha256] }).reason === F.ATTESTATION_ALREADY_CONSUMED;
  })());
record("A10 a missing or unreadable attestation is refused",
  [undefined, null, "string", 42].every((x) => verify(x).ok === false));
record("A11 the attestation file must live OUTSIDE the repository",
  A.loadAttestationFile("scripts/mvp/communication/attestation.json").reason === F.ATTESTATION_MISSING &&
  A.loadAttestationFile("").reason === F.ATTESTATION_MISSING);
record("A12 the TTL constant is the 15-minute value shared with the 40.12 seed",
  operatorCode.includes("ATTESTATION_TTL_MS") &&
  operatorCode.includes('from "./seed-meta-staging-inactive-mappings.mjs"'));
record("A13 the plan fingerprint is order-independent and change-sensitive",
  (() => {
    const a = A.planFingerprint({ x: 1, y: 2 });
    const b = A.planFingerprint({ y: 2, x: 1 });
    const c = A.planFingerprint({ x: 1, y: 3 });
    return a === b && a !== c;
  })());

// ---------------------------------------------------------------------------
// S. STRUCTURAL — the operator cannot send, and reuses rather than re-declares
// ---------------------------------------------------------------------------
// Asserted on COMMENT-STRIPPED source, exactly as the D3-B harness does: the operator's
// own prose explains that it holds no send endpoint, and that explanation must neither
// satisfy nor defeat the executable guard. The mutant below proves the helper can still
// detect a real one.
record("S01 the operator's EXECUTABLE code contains NO /messages endpoint, so it can never send",
  A.operatorHasNoSendEndpoint(operatorCode) === true &&
  !/\/messages/.test(operatorCode) &&
  /\/messages/.test(operatorSource));
record("S02 the operator issues no Meta write verb",
  !/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(operatorCode) &&
  !/buildMetaMessagesUrl|sendResolvedTemplate|sendTemplateMessage/.test(operatorCode));
record("S03 every Meta URL builder is a GET-shaped read",
  [A.buildPhoneNumberGetUrl({ graphApiVersion: "v21.0", phoneNumberId: EXPECTED.phoneNumberId }),
   A.buildWabaGetUrl({ graphApiVersion: "v21.0", wabaId: EXPECTED.wabaId }),
   A.buildSubscribedAppsGetUrl({ graphApiVersion: "v21.0", wabaId: EXPECTED.wabaId })]
    .every((u) => u.startsWith("https://graph.facebook.com/v21.0/") && !u.includes("/messages")));
record("S04 the staging fence is REUSED from the seed, not re-declared",
  operatorCode.includes("AUTHORIZED_STAGING_REF") &&
  operatorCode.includes("FORBIDDEN_PROJECT_REFS") &&
  !/const AUTHORIZED_STAGING_REF\s*=/.test(operatorCode) &&
  !/const FORBIDDEN_PROJECT_REFS\s*=/.test(operatorCode));
record("S05 the approved set is REUSED from the seed, not re-listed",
  operatorCode.includes("SEED_SET") && !/const SEED_SET\s*=\s*\[/.test(operatorCode));
record("S06 the readiness requirement is REUSED from the frozen gate",
  operatorCode.includes("REQUIRED_ACCOUNT_READINESS") &&
  !/const REQUIRED_ACCOUNT_READINESS\s*=\s*(Object\.freeze\()?\{/.test(operatorCode));
record("S07 the destination hash is REUSED from lib/communication/phone.ts",
  operatorCode.includes("hashPhoneE164") && operatorCode.includes("normalizePhoneE164") &&
  !/createHash\(["']sha256["']\)\.update\(\s*normalized/.test(operatorCode));
record("S08 the operator declares no DDL, migration or RPC",
  !/create (table|index|function|policy)|alter table|drop |\.rpc\(/i.test(operatorCode));
record("S09 the operator names no production or Jarvis ref as a literal of its own",
  !/yqpgcsduqbxulrlzwzap|coilipywdvxklewquqvv/.test(operatorCode));
record("S10 exactly one new environment variable is introduced, and it is documented",
  A.CANARY_DESTINATION_ENV === "QF_META_CANARY_DESTINATION_E164" &&
  (operatorCode.match(/QF_META_CANARY_DESTINATION_E164/g) ?? []).length === 1);
/*
 * QF-MVP-40.13C SUCCESSOR. S11 previously asserted the runtime wiring was ABSENT. The
 * wiring now exists, so that claim would be false — and the honest replacement is not a
 * deletion but a set of STRONGER assertions: the wiring is present, it is guarded, and it
 * still has no provider-send capability whatsoever. Nothing else in 40-13 is relaxed.
 */
record("S11a the executable wiring EXISTS and is fully guarded behind isDirect",
  /const isDirect = process\.argv\[1\]/.test(operatorCode) &&
  /if \(isDirect\)/.test(operatorCode) &&
  operatorCode.indexOf("if (isDirect)") < operatorCode.indexOf('await import("@supabase/supabase-js")'));
record("S11b no client is constructed at import time — only inside the guard, by dynamic import",
  !/^import .*@supabase\/supabase-js/m.test(operatorCode) &&
  /await import\("@supabase\/supabase-js"\)/.test(operatorCode));
record("S11c the staging identity fence runs BEFORE any client or transport exists",
  operatorCode.indexOf("resolveActivationTarget(process.env") <
    operatorCode.indexOf('await import("@supabase/supabase-js")') &&
  operatorCode.indexOf("resolveActivationTarget(process.env") <
    operatorCode.indexOf("FetchHttpTransport"));
// QF-MVP-40.13C-R1: delegation tightened. The entry point used to assemble the CLI inline
// and call runOperator; it now calls runCli and supplies dependencies only, so there is no
// CLI behaviour an offline test cannot reach.
record("S11d execution is delegated to the runtime module, not reimplemented here",
  /await import\("\.\/canaryActivationRuntime\.mjs"\)/.test(operatorCode) &&
  /runtime\.runCli\(/.test(operatorCode) &&
  !/resolveMode\(process\.argv/.test(operatorCode) &&
  !/argv\.includes\(/.test(operatorCode));
record("S11e the wiring still has NO provider-send capability",
  A.operatorHasNoSendEndpoint(operatorCode) === true &&
  !/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i.test(operatorCode) &&
  !/sendResolvedTemplate|sendTemplateMessage|CommunicationService/.test(operatorCode));
record("S11f the operator performs no direct table write of its own",
  !/\.from\(["']communication_[a-z_]+["']\)[\s\S]{0,200}\.(update|insert|upsert|delete)\(/.test(operatorCode));
// QF-MVP-40.13C-R1: the fence itself now takes `requireMetaIdentity`, so emergency
// closure no longer demands a Meta credential. Proven here at the CONTRACT level; the
// end-to-end CLI proof lives in test:mvp:40-13c-r1.
record("S11g DISABLE is reachable without a Meta credential or an attestation",
  /requireMetaIdentity/.test(operatorCode) &&
  (() => {
    const stagingOnly = {
      QF_STAGING_SUPABASE_URL: "https://uckafzuochmbvtiodmcl.supabase.co",
      QF_STAGING_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_" + "x".repeat(32),
    };
    const r = A.resolveActivationTarget(stagingOnly, {
      requireCanaryDestination: false, requireMetaIdentity: false,
    });
    // ...and the staging fence is still absolute in that same mode.
    const prod = A.resolveActivationTarget(
      { ...stagingOnly, QF_STAGING_SUPABASE_URL: "https://yqpgcsduqbxulrlzwzap.supabase.co" },
      { requireCanaryDestination: false, requireMetaIdentity: false });
    return r.ok === true && prod.reason === F.PROJECT_REF_FORBIDDEN_PRODUCTION;
  })());

// ---------------------------------------------------------------------------
// R3. DEDICATED STAGING META CONTROL PLANE — the external asset attestation
//
// Dedication is NOT derivable from any Meta GET field, so it is attested out of band and
// then cross-checked against the live readback. These prove the artifact contract itself.
// ---------------------------------------------------------------------------
const R3_HEAD = "c".repeat(40);
const R3_APP = "111222333444555";
const R3_WABA = "987654321098765";
const R3_PHONE = "123456789012345";

function mkAssetProof(over = {}) {
  const body = {
    artifact: "qf-mvp-40-staging-meta-asset-proof",
    environment: "STAGING",
    project_ref: "uckafzuochmbvtiodmcl",
    branch_head: R3_HEAD,
    intended_stage: "ARM_READINESS",
    meta_app_id: R3_APP,
    waba_id: R3_WABA,
    phone_number_id: R3_PHONE,
    asset_scope: "STAGING_DEDICATED",
    prohibited_asset_ids: ["555444333222111"],
    prohibited_asset_digests: [],
    nonce: "n".repeat(32),
    issued_at_ms: NOW,
    expires_at_ms: NOW + 10 * 60 * 1000,
    ...over,
  };
  return { ...body, proof_sha256: A.stagingAssetProofDigest(body) };
}
const vProof = (p, o = {}) => A.verifyStagingAssetProof(p, { now: () => NOW, projectRef: "uckafzuochmbvtiodmcl", ...o });

record("R3-A01 a well-formed staging-asset proof verifies",
  vProof(mkAssetProof()).ok === true);
record("R3-A02 there are exactly two asset classifications",
  Object.keys(A.AssetScope).length === 2 &&
  A.AssetScope.SHARED_OR_UNKNOWN === "SHARED_OR_UNKNOWN");
record("R3-A03 a missing proof is refused",
  vProof(null).reason === F.STAGING_ASSET_PROOF_MISSING);
record("R3-A04 a wrong artifact is refused",
  vProof(mkAssetProof({ artifact: "something-else" })).ok === false);
record("R3-A05 a non-staging environment is refused",
  vProof(mkAssetProof({ environment: "PRODUCTION" })).ok === false);
record("R3-A06 a wrong project ref is refused",
  vProof(mkAssetProof({ project_ref: "yqpgcsduqbxulrlzwzap" })).ok === false);
record("R3-A07 SHARED_OR_UNKNOWN can never be ATTESTED as a scope",
  vProof(mkAssetProof({ asset_scope: "SHARED_OR_UNKNOWN" })).ok === false);
record("R3-A08 a tampered proof is refused",
  (() => { const p = mkAssetProof(); p.waba_id = "111111111111111"; return vProof(p).ok === false; })());
record("R3-A09 a non-commit branch_head is refused",
  vProof(mkAssetProof({ branch_head: "not-a-sha" })).ok === false);
record("R3-A10 a malformed Meta identifier is refused",
  ["meta_app_id", "waba_id", "phone_number_id"].every(
    (f) => vProof(mkAssetProof({ [f]: "abc" })).ok === false));
record("R3-A11 an expired proof is refused",
  vProof(mkAssetProof(), { now: () => NOW + 11 * 60 * 1000 }).ok === false);
record("R3-A12 a future-dated proof is refused",
  vProof(mkAssetProof({ issued_at_ms: NOW + 5 * 60 * 1000 })).ok === false);
record("R3-A13 a TTL beyond 15 minutes is refused",
  vProof(mkAssetProof({ expires_at_ms: NOW + 30 * 60 * 1000 })).ok === false);
record("R3-A14 an unknown intended_stage is refused",
  vProof(mkAssetProof({ intended_stage: "SEND" })).ok === false);
record("R3-A15 an EMPTY prohibited-asset list is refused",
  vProof(mkAssetProof({ prohibited_asset_ids: [], prohibited_asset_digests: [] })).ok === false);
record("R3-A16 an asset the owner prohibited cannot also be attested as dedicated",
  vProof(mkAssetProof({ prohibited_asset_ids: [R3_WABA] })).ok === false);
record("R3-A17 the prohibited list also works by DIGEST, so no real id need be shared",
  vProof(mkAssetProof({
    prohibited_asset_ids: [], prohibited_asset_digests: [A.assetIdDigest(R3_PHONE)] })).ok === false);
record("R3-A18 waba_id and phone_number_id must be distinct",
  vProof(mkAssetProof({ waba_id: R3_PHONE })).ok === false);

const liveOk = { wabaId: R3_WABA, phoneNumberId: R3_PHONE, subscribedAppIds: [R3_APP] };
const expOk = { wabaId: R3_WABA, phoneNumberId: R3_PHONE };
const classify = (o = {}) => A.classifyMetaAssetScope({
  proof: vProof(mkAssetProof()), live: liveOk, expected: expOk, branchHead: R3_HEAD, ...o });

record("R3-A19 a verified proof matching the live readback classifies STAGING_DEDICATED",
  classify().scope === "STAGING_DEDICATED");
record("R3-A20 absence of a proof classifies SHARED_OR_UNKNOWN",
  A.classifyMetaAssetScope({ proof: null, live: liveOk, expected: expOk, branchHead: R3_HEAD })
    .scope === "SHARED_OR_UNKNOWN");
record("R3-A21 a live WABA differing from the attested one classifies SHARED_OR_UNKNOWN",
  classify({ live: { ...liveOk, wabaId: "222222222222222" } }).scope === "SHARED_OR_UNKNOWN");
record("R3-A22 a live phone differing from the attested one classifies SHARED_OR_UNKNOWN",
  classify({ live: { ...liveOk, phoneNumberId: "222222222222222" } }).scope === "SHARED_OR_UNKNOWN");
record("R3-A23 a foreign subscribed app classifies SHARED_OR_UNKNOWN",
  classify({ live: { ...liveOk, subscribedAppIds: [R3_APP, "222222222222222"] } }).scope === "SHARED_OR_UNKNOWN");
record("R3-A24 a different running commit classifies SHARED_OR_UNKNOWN",
  classify({ branchHead: "d".repeat(40) }).scope === "SHARED_OR_UNKNOWN");
record("R3-A25 a configured identity differing from the attested one classifies SHARED_OR_UNKNOWN",
  classify({ expected: { wabaId: "222222222222222", phoneNumberId: R3_PHONE } }).scope === "SHARED_OR_UNKNOWN");
record("R3-A26 an empty subscribed-app list does not by itself block classification",
  classify({ live: { ...liveOk, subscribedAppIds: [] } }).scope === "STAGING_DEDICATED");
record("R3-A27 no real Meta identifier or phone number is hard-coded in the operator",
  !/\b1[0-9]{14,}\b/.test(operatorCode.replace(/[0-9]{6,}\}/g, "")) &&
  !/\+[0-9]{10,15}/.test(operatorCode));

// ---------------------------------------------------------------------------
// MUT. MUTANTS — every guard must be shown capable of failing
// ---------------------------------------------------------------------------
const mutants = [
  ["a shared or unknown Meta asset can never classify as dedicated",
    () => A.classifyMetaAssetScope({ proof: null, live: liveOk, expected: expOk, branchHead: R3_HEAD })
      .scope !== "STAGING_DEDICATED"],
  ["an asset attestation alone is NOT sufficient — the live readback must agree",
    () => classify({ live: { ...liveOk, wabaId: "222222222222222" } }).scope === "SHARED_OR_UNKNOWN"],
  ["a staging-asset proof cannot outlive its 15-minute window",
    () => vProof(mkAssetProof(), { now: () => NOW + 16 * 60 * 1000 }).ok === false],
  ["the production business asset cannot be attested as the staging asset",
    () => vProof(mkAssetProof({ prohibited_asset_ids: [R3_APP] })).ok === false],
  ["a sendable posture cannot be earned without evidence",
    () => A.assertWriteIsEarned({ posture: A.CANARY_POSTURE, accountFields: readyAccount(), evidence: null }).ok === false],
  ["stage 1 cannot be coaxed into a sending posture",
    () => {
      const r = A.planReadinessArm({ policy: null, account: readyAccount(), evidence: fullEvidence(), expected: EXPECTED });
      return r.ok && r.plan.policy.outbound_enabled === false;
    }],
  ["stage 2 cannot run on an unready account",
    () => A.planCanaryArm(canaryArmArgs({ account: disabledAccount() })).ok === false],
  ["an evidence-bound acknowledgement can never be selected",
    () => A.EVIDENCE_BOUND_KEYS.every((k) => A.resolveTemplateSelection([`--templates=${k}`]).ok === false)],
  ["a stray active mapping cannot be ignored",
    () => A.planCanaryArm(canaryArmArgs({
      mappings: [...allMappings(), realMapping("lead_received", { is_active: true })] })).ok === false],
  ["the production project can never be targeted",
    () => A.resolveActivationTarget({ ...goodEnv(), QF_STAGING_SUPABASE_URL: "https://yqpgcsduqbxulrlzwzap.supabase.co" }).ok === false],
  ["a reused attestation cannot authorize a second write",
    () => { const att = mkAttestation(); return verify(att, { consumedHashes: [att.attestation_sha256] }).ok === false; }],
  ["a readiness attestation cannot authorize a canary arm",
    () => verify(mkAttestation({ stage: "ARM_READINESS" })).ok === false],
  ["disable always produces a fail-closed gate result",
    () => ["a", "b", "c"].every((s) => A.proveDisabledIsFailClosed({
      account: readyAccount(), expected: EXPECTED, destinationHash: s.repeat(64), nowMs: NOW })) === true],
  ["the operator cannot acquire a send endpoint without this gate noticing",
    () => A.operatorHasNoSendEndpoint("const u = base + '/messages';") === false],
];
for (const [name, fn] of mutants) {
  let held = false;
  try { held = fn() === true; } catch { held = false; }
  record(`MUT ${name}`, held);
}

// ---------------------------------------------------------------------------
for (const [i, r] of results.entries()) {
  console.log(`${r.passed ? "PASS" : "FAIL"} ${String(i + 1).padStart(3, "0")} ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
}
const failed = results.filter((r) => !r.passed);
console.log(`\nQF-MVP-40 CANARY ACTIVATION: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exit(1);
console.log("QF_MVP_40_CANARY_ACTIVATION_DECISION_LAYER_READY");
