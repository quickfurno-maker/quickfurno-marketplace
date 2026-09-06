// ============================================================================
// QF-MVP-80.17A-R1 — controlled historical intent reconciliation validator.
// OFFLINE. No network, no database, no credential, no send, no production read.
//
// WHY THIS EXISTS
//   QF-MVP-80.17A repaired the LIVE lifecycle: a verified Meta delivery webhook
//   now converges the derived lead-assignment intent. It cannot converge the ONE
//   historical anomaly the QF-MVP-80.16D-R2 trial left behind (canonical message
//   `failed`, derived intent `dispatched`), because no further webhook is coming.
//   R1 is the one-shot operator for exactly that row — and the whole safety
//   argument is its narrowness.
//
// HOW IT CHECKS
//   Every decision the operator makes is EXECUTED here against the real pure
//   operator contract and the real repository authorities: flag parsing, the
//   production project fence, the frozen trial window, candidate identity, the
//   planned write (through the deployed 80.17A contract itself), attestation
//   validity, summary certification and post-state certification.
//
//   Source text is read only for the NEGATIVE containment claims — no send, no
//   provider, no fetch, no INSERT, no direct UPDATE, no retry, no second service
//   call — which no execution can demonstrate. Those checks run on CODE ONLY:
//   comments are stripped first, so the comments that deliberately NAME a
//   forbidden pattern can never fail the build.
// ============================================================================

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  R1,
  R1CandidateState,
  R1FailureEvidence,
  R1Mode,
  R1Refusal,
  assertCanonAgrees,
  buildR1Attestation,
  certifyR1PostState,
  certifyR1Summary,
  certifyR1WritePlan,
  classifyR1FailureEvidence,
  classifyR1Pair,
  decideR1Discovery,
  decideR1Environment,
  digestOf,
  isInsideR1TrialWindow,
  isR1AttestationPathOutsideRepo,
  parseR1Args,
  projectRefOfSupabaseUrl,
  r1EvidenceDigest,
  r1FailureCodeIsSafeToPrint,
  r1ModeMayReadDatabase,
  r1ModeMayWrite,
  validateR1Attestation,
} from "./qf-mvp-80-17a-r1-operator-contract.mjs";

import {
  LeadAssignmentReconcileOutcome as OUT,
  LEAD_ASSIGNMENT_RECONCILE_COLUMN,
  LEAD_ASSIGNMENT_RECONCILE_TABLE,
  evaluateLeadAssignmentReconciliation as evaluate,
} from "../../../lib/communication/leadAssignmentResultContract.ts";
import {
  INTENT_ENTITY_TYPE,
  IntentResultStatus,
  projectIntentStatus,
} from "../../../lib/communication/campaignResultContract.ts";
import {
  LEAD_ASSIGNMENT_AGGREGATE_TYPE,
  LEAD_ASSIGNMENT_INTENT_CHANNEL,
  LEAD_ASSIGNMENT_TEMPLATE_KEY,
  LEAD_ASSIGNMENT_TEMPLATE_PURPOSE,
  leadAssignmentMessageIdempotencyKey,
} from "../../../lib/communication/leadAssignmentDispatchContract.ts";
import { META_WHATSAPP_ADAPTER_PROVIDER } from "../../../lib/communication/inboundConsentCommandInput.ts";

const require = createRequire(import.meta.url);

const OPERATOR_PATH = "scripts/mvp/communication/reconcile-qf-mvp-80-17a-r1-once.mjs";
const CONTRACT_PATH = "scripts/mvp/communication/qf-mvp-80-17a-r1-operator-contract.mjs";
const LOADER_PATH = "scripts/mvp/operator/qf-mvp-80-17a-r1-runtime-register.cjs";
const MVP_LOADER_PATH = "scripts/mvp/loader/tsResolveHooks.mjs";
const MVP_REGISTER_PATH = "scripts/mvp/loader/register.mjs";
const SERVICE_PATH = "services/leadAssignmentResultService.ts";
const DISPATCH_PATH = "services/leadAssignmentDispatchService.ts";
const DISPATCH_CONTRACT_PATH = "lib/communication/leadAssignmentDispatchContract.ts";
const WEBHOOK_PATH = "services/metaWhatsAppWebhookService.ts";
const PROVIDER_PATH = "lib/communication/providers/metaCloudWhatsAppProvider.ts";

const rawOf = (p) => readFileSync(resolve(p), "utf8");
const codeOf = (p) => rawOf(p).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

const OPERATOR_CODE = codeOf(OPERATOR_PATH);
const CONTRACT_CODE = codeOf(CONTRACT_PATH);
const LOADER_CODE = codeOf(LOADER_PATH);
const SERVICE_CODE = codeOf(SERVICE_PATH);
const DISPATCH_CODE = codeOf(DISPATCH_PATH);
const DISPATCH_CONTRACT_CODE = codeOf(DISPATCH_CONTRACT_PATH);
const WEBHOOK_CODE = codeOf(WEBHOOK_PATH);
const MVP_LOADER_RAW = rawOf(MVP_LOADER_PATH);
const MVP_REGISTER_RAW = rawOf(MVP_REGISTER_PATH);

// The operator-only loader is INERT on require: installation happens inside
// loadR1Runtime(), which this offline suite never calls.
const loader = require(resolve(LOADER_PATH));

// ---------------------------------------------------------------------------
// canon — assembled from the REAL repository authorities, exactly as the
// operator's loader assembles it. No string is retyped here.
// ---------------------------------------------------------------------------

const canon = {
  aggregateType: LEAD_ASSIGNMENT_AGGREGATE_TYPE,
  intentChannel: LEAD_ASSIGNMENT_INTENT_CHANNEL,
  templatePurpose: LEAD_ASSIGNMENT_TEMPLATE_PURPOSE,
  templateKey: LEAD_ASSIGNMENT_TEMPLATE_KEY,
  idempotencyKeyFor: leadAssignmentMessageIdempotencyKey,
  intentEntityType: INTENT_ENTITY_TYPE,
  project: projectIntentStatus,
  dispatchedIntentStatus: IntentResultStatus.DISPATCHED,
  failedIntentStatus: IntentResultStatus.FAILED,
  provider: META_WHATSAPP_ADAPTER_PROVIDER,
  reconcileTable: LEAD_ASSIGNMENT_RECONCILE_TABLE,
  reconcileColumn: LEAD_ASSIGNMENT_RECONCILE_COLUMN,
};

const INTENT_ID = "6b0f5e6c-4d9a-4f2b-9a71-1c53f0b8ad42";
const MESSAGE_ID = "b1c9d7e2-3a45-4f66-8b90-2d4e6f8a0c13";
const IN_WINDOW = "2026-09-05T18:03:05.000Z";
const DISPATCHED_AT = "2026-09-05T18:03:06.000Z";

const intentOf = (over = {}) => ({
  id: INTENT_ID,
  aggregate_type: canon.aggregateType,
  channel: canon.intentChannel,
  template_purpose: canon.templatePurpose,
  status: canon.dispatchedIntentStatus,
  created_at: IN_WINDOW,
  dispatched_at: DISPATCHED_AT,
  ...over,
});

const messageOf = (over = {}) => ({
  id: MESSAGE_ID,
  channel: canon.intentChannel,
  template_key: canon.templateKey,
  entity_type: canon.intentEntityType,
  entity_id: INTENT_ID,
  idempotency_key: canon.idempotencyKeyFor(INTENT_ID),
  status: R1.CANONICAL_MESSAGE_STATUS_FAILED,
  provider: canon.provider,
  provider_message_id: "wamid.HISTORICAL_TRIAL",
  provider_account_id: "9f1d2c3b-4a5e-4b6c-8d7e-0f1a2b3c4d5e",
  failure_code: "131026",
  ...over,
});

const classify = (i, m) => classifyR1Pair({ intent: i, message: m, canon });
const stateOf = (i, m) => classify(i, m).state;
const candidateOf = (over = {}, mover = {}) => classify(intentOf(over), messageOf(mover)).candidate;

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
function assert(c, m) { if (!c) throw new Error(m); }
const eq = (a, b, m) => assert(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
const absent = (code, re, label) => assert(!re.test(code), `${label} must not appear`);

// ---- 1-5. mode model: dry run by default -----------------------------------

check("1 no flags -> offline no-op that cannot write", () => {
  const p = parseR1Args([]);
  eq(p.mode, R1Mode.OFFLINE_NOOP, "mode");
  eq(r1ModeMayWrite(p.mode), false, "no write");
  eq(r1ModeMayReadDatabase(p.mode), false, "no database at all");
});

check("2 --preflight-readonly may read but may NEVER write", () => {
  const p = parseR1Args([R1.PREFLIGHT_FLAG]);
  eq(p.mode, R1Mode.PREFLIGHT_READONLY, "mode");
  eq(r1ModeMayReadDatabase(p.mode), true, "reads allowed");
  eq(r1ModeMayWrite(p.mode), false, "writes forbidden");
});

check("3 --execute without the owner acknowledgement is refused", () => {
  const p = parseR1Args([R1.EXECUTE_FLAG]);
  eq(p.mode, R1Mode.REFUSED, "mode");
  eq(p.reason, R1Refusal.EXECUTE_WITHOUT_OWNER_ACKNOWLEDGEMENT, "reason");
  eq(r1ModeMayWrite(p.mode), false, "no write");
});

check("4 the owner acknowledgement alone never writes", () => {
  const p = parseR1Args([R1.OWNER_ACK_FLAG]);
  eq(p.reason, R1Refusal.ACKNOWLEDGEMENT_WITHOUT_EXECUTE, "reason");
  eq(r1ModeMayWrite(p.mode), false, "no write");
});

check("5 unknown, duplicated and conflicting flags are refused", () => {
  for (const argv of [["--force"], ["--yes"], ["-x"], ["--execute=1"], [""]]) {
    eq(parseR1Args(argv).reason, R1Refusal.UNKNOWN_FLAG, `unknown ${JSON.stringify(argv)}`);
  }
  eq(parseR1Args([R1.PREFLIGHT_FLAG, R1.PREFLIGHT_FLAG]).reason, R1Refusal.DUPLICATE_FLAG, "duplicate");
  eq(parseR1Args([R1.PREFLIGHT_FLAG, R1.EXECUTE_FLAG, R1.OWNER_ACK_FLAG]).reason,
    R1Refusal.CONFLICTING_MODES, "conflicting");
  const ok = parseR1Args([R1.EXECUTE_FLAG, R1.OWNER_ACK_FLAG]);
  eq(ok.mode, R1Mode.EXECUTE, "the one execute form is accepted");
});

// ---- 6-10. production environment fence ------------------------------------

const envOf = (ref, key = true) =>
  decideR1Environment({ supabaseUrl: `https://${ref}.supabase.co`, serviceRoleKeyPresent: key });

check("6 the exact QuickFurno production project ref is allowed", () => {
  const d = envOf(R1.PRODUCTION_PROJECT_REF);
  eq(d.allowed, true, "allowed");
  eq(d.projectRef, R1.PRODUCTION_PROJECT_REF, "ref");
});

check("7 the staging project ref is refused by name", () => {
  eq(envOf(R1.STAGING_PROJECT_REF).allowed, false, "refused");
  eq(envOf(R1.STAGING_PROJECT_REF).reason, R1Refusal.PROJECT_REF_IS_STAGING, "reason");
});

check("8 the Jarvis project ref is refused by name", () => {
  eq(envOf(R1.JARVIS_PROJECT_REF).reason, R1Refusal.PROJECT_REF_IS_JARVIS, "reason");
});

check("9 an unknown or unparsable project is refused", () => {
  eq(envOf("abcdefghijklmnopqrst").reason, R1Refusal.PROJECT_REF_UNKNOWN, "unknown ref");
  eq(decideR1Environment({ supabaseUrl: "", serviceRoleKeyPresent: true }).reason,
    R1Refusal.SUPABASE_URL_MISSING, "missing url");
  eq(decideR1Environment({ supabaseUrl: "not-a-url", serviceRoleKeyPresent: true }).reason,
    R1Refusal.SUPABASE_URL_UNPARSABLE, "unparsable url");
  eq(projectRefOfSupabaseUrl("https://example.com"), null, "foreign host has no ref");
});

check("10 a missing service-role key refuses before any client is built", () => {
  eq(envOf(R1.PRODUCTION_PROJECT_REF, false).reason, R1Refusal.SERVICE_ROLE_KEY_MISSING, "reason");
  eq(envOf(R1.PRODUCTION_PROJECT_REF, false).allowed, false, "refused");
  // Order is load-bearing: the operator constructs the client only after this.
  const fence = OPERATOR_CODE.indexOf("decideR1Environment");
  const client = OPERATOR_CODE.indexOf("runtime.adminClient()");
  assert(fence > 0 && client > fence, "the environment fence precedes client construction");
  assert(/if \(!env\.allowed\) refuse\(env\.reason\)/.test(OPERATOR_CODE), "a refused fence stops the run");
  // The staging environment variables are never read.
  absent(OPERATOR_CODE, /QF_STAGING_/, "staging environment variables");
});

// ---- 11-12. the frozen trial window ----------------------------------------

check("11 the trial window is exactly the fixed 30-minute fence", () => {
  eq(R1.TRIAL_WINDOW_START_ISO, "2026-09-05T18:00:00.000Z", "start");
  eq(R1.TRIAL_WINDOW_END_ISO, "2026-09-05T18:30:00.000Z", "end");
  eq(isInsideR1TrialWindow("2026-09-05T18:00:00.000Z"), true, "start is inclusive");
  eq(isInsideR1TrialWindow(IN_WINDOW), true, "the trial lead is inside");
  eq(isInsideR1TrialWindow("2026-09-05T18:30:00.000Z"), false, "end is exclusive");
  eq(isInsideR1TrialWindow("2026-09-05T17:59:59.999Z"), false, "before");
  eq(isInsideR1TrialWindow("2026-09-05T19:00:00.000Z"), false, "after");
  eq(isInsideR1TrialWindow("not-a-date"), false, "unparsable is outside, never inside");
  eq(isInsideR1TrialWindow(null), false, "absent is outside");
});

check("12 no caller argument can widen the window", () => {
  // The window lives in a frozen constant; the ONLY accepted tokens are the
  // three mode flags, so there is no argument shape that could carry a date.
  assert(Object.isFrozen(R1), "R1 constants are frozen");
  for (const argv of [
    ["--since=2026-01-01"], ["--window", "9999"], ["--from", "2026-09-01T00:00:00Z"],
    ["--all"], ["--limit=50"], ["--intent-id", INTENT_ID],
  ]) {
    eq(parseR1Args(argv).reason, R1Refusal.UNKNOWN_FLAG, `refused ${argv[0]}`);
  }
  const before = R1.TRIAL_WINDOW_START_ISO;
  try { R1.TRIAL_WINDOW_START_ISO = "1970-01-01T00:00:00.000Z"; } catch { /* strict mode */ }
  eq(R1.TRIAL_WINDOW_START_ISO, before, "the fence cannot be reassigned");
  assert(/\.gte\("created_at", R1\.TRIAL_WINDOW_START_ISO\)/.test(OPERATOR_CODE), "query pins the start");
  assert(/\.lt\("created_at", R1\.TRIAL_WINDOW_END_ISO\)/.test(OPERATOR_CODE), "query pins the end");
});

// ---- 13-15. exactly one candidate ------------------------------------------

check("13 zero candidates is a refusal, never a repair", () => {
  const d = decideR1Discovery([]);
  eq(d.state, R1Mode.REFUSED, "state");
  eq(d.reason, R1Refusal.NO_CANDIDATE, "reason");
  eq(d.candidate, null, "no candidate");
});

check("14 more than one candidate is a refusal", () => {
  const two = [classify(intentOf(), messageOf()), classify(intentOf(), messageOf({ id: "other" }))];
  eq(two.every((r) => r.state === R1CandidateState.CANDIDATE), true, "both are candidates");
  const d = decideR1Discovery(two);
  eq(d.state, R1Mode.REFUSED, "state");
  eq(d.reason, R1Refusal.MULTIPLE_CANDIDATES, "reason");
});

check("15 exactly one candidate is eligible", () => {
  const d = decideR1Discovery([classify(intentOf(), messageOf())]);
  eq(d.state, R1CandidateState.CANDIDATE, "state");
  eq(d.candidate.intentId, INTENT_ID, "intent");
  eq(d.candidate.messageId, MESSAGE_ID, "message");
  eq(d.candidate.observedIntentStatus, canon.dispatchedIntentStatus, "observed status");
});

// ---- 16-20. exact candidate semantics --------------------------------------

check("16 a pending historical intent is never repairable", () => {
  eq(stateOf(intentOf({ status: IntentResultStatus.PENDING }), messageOf()),
    R1CandidateState.REFUSED_INTENT_STATUS_NOT_REPAIRABLE, "pending");
  eq(decideR1Discovery([classify(intentOf({ status: IntentResultStatus.PENDING }), messageOf())]).reason,
    R1Refusal.NO_CANDIDATE, "and it produces no candidate");
});

check("17 a delivered intent is not writable by this operator", () => {
  eq(stateOf(intentOf({ status: IntentResultStatus.DELIVERED }), messageOf()),
    R1CandidateState.REFUSED_INTENT_STATUS_NOT_REPAIRABLE, "delivered");
  eq(stateOf(intentOf({ status: IntentResultStatus.UNCERTAIN }), messageOf()),
    R1CandidateState.REFUSED_INTENT_STATUS_NOT_REPAIRABLE, "uncertain");
});

check("18 failed intent + failed message is ALREADY_RECONCILED, read-only", () => {
  const row = classify(intentOf({ status: canon.failedIntentStatus }), messageOf());
  eq(row.state, R1CandidateState.ALREADY_RECONCILED, "state");
  eq(row.candidate, undefined, "no write candidate is produced");
  const d = decideR1Discovery([row]);
  eq(d.state, R1CandidateState.ALREADY_RECONCILED, "verdict");
  eq(d.candidate, null, "nothing to write");
});

check("19 dispatched intent + failed message is THE candidate", () => {
  eq(stateOf(intentOf(), messageOf()), R1CandidateState.CANDIDATE, "state");
});

check("20 a message that is not failed is refused for historical repair", () => {
  for (const s of ["delivered", "read", "sent", "accepted", "queued", "dead_letter", "cancelled"]) {
    eq(stateOf(intentOf(), messageOf({ status: s })),
      R1CandidateState.REFUSED_MESSAGE_STATUS_NOT_FAILED, `message ${s}`);
  }
});

// ---- 21-29. linkage fences -------------------------------------------------

check("21 a foreign aggregate type is not this lane", () => {
  eq(stateOf(intentOf({ aggregate_type: "vendor_campaign" }), messageOf()),
    R1CandidateState.REFUSED_INTENT_NOT_LEAD_ASSIGNMENT, "aggregate");
});

check("22 a channel mismatch is refused on both rows", () => {
  eq(stateOf(intentOf({ channel: "sms" }), messageOf()), R1CandidateState.REFUSED_INTENT_CHANNEL, "intent");
  eq(stateOf(intentOf(), messageOf({ channel: "sms" })), R1CandidateState.REFUSED_MESSAGE_CHANNEL, "message");
});

check("23 a foreign template purpose is refused", () => {
  eq(stateOf(intentOf({ template_purpose: "vendor_campaign_message" }), messageOf()),
    R1CandidateState.REFUSED_INTENT_PURPOSE, "purpose");
});

check("24 a foreign message entity_type is refused", () => {
  eq(stateOf(intentOf(), messageOf({ entity_type: "lead" })), R1CandidateState.REFUSED_MESSAGE_ENTITY_TYPE, "entity type");
});

check("25 a message pointing at another intent is refused", () => {
  eq(stateOf(intentOf(), messageOf({ entity_id: "11111111-2222-4333-8444-555555555555" })),
    R1CandidateState.REFUSED_MESSAGE_ENTITY_ID, "entity id");
});

check("26 a foreign template key is refused", () => {
  eq(stateOf(intentOf(), messageOf({ template_key: "lead_received" })),
    R1CandidateState.REFUSED_MESSAGE_TEMPLATE, "template");
});

check("27 a mismatched deterministic idempotency key is refused", () => {
  const foreign = canon.idempotencyKeyFor("99999999-8888-4777-8666-555555555555");
  eq(stateOf(intentOf(), messageOf({ idempotency_key: foreign })),
    R1CandidateState.REFUSED_MESSAGE_IDEMPOTENCY_KEY, "foreign key");
  eq(stateOf(intentOf(), messageOf({ idempotency_key: null })),
    R1CandidateState.REFUSED_MESSAGE_IDEMPOTENCY_KEY, "absent key");
  eq(stateOf(intentOf(), messageOf({ provider: "mock" })),
    R1CandidateState.REFUSED_MESSAGE_PROVIDER, "foreign provider");
});

check("28 a message with no provider_message_id is refused", () => {
  for (const v of [null, undefined, ""]) {
    eq(stateOf(intentOf(), messageOf({ provider_message_id: v })),
      R1CandidateState.REFUSED_MESSAGE_PROVIDER_MESSAGE_ID_MISSING, `id ${JSON.stringify(v)}`);
  }
});

check("29 a message with no provider_account_id is refused", () => {
  for (const v of [null, undefined, ""]) {
    eq(stateOf(intentOf(), messageOf({ provider_account_id: v })),
      R1CandidateState.REFUSED_MESSAGE_PROVIDER_ACCOUNT_ID_MISSING, `acct ${JSON.stringify(v)}`);
  }
  eq(stateOf(intentOf(), null), R1CandidateState.REFUSED_MESSAGE_MISSING, "no message at all");
  eq(stateOf(null, messageOf()), R1CandidateState.REFUSED_INTENT_MISSING, "no intent at all");
});

check("29b an intent outside the frozen window is refused even if perfect", () => {
  eq(stateOf(intentOf({ created_at: "2026-09-05T17:59:00.000Z" }), messageOf()),
    R1CandidateState.REFUSED_INTENT_OUTSIDE_TRIAL_WINDOW, "just before");
  eq(stateOf(intentOf({ created_at: "2026-09-05T18:30:00.000Z" }), messageOf()),
    R1CandidateState.REFUSED_INTENT_OUTSIDE_TRIAL_WINDOW, "at the exclusive end");
  eq(stateOf(intentOf({ created_at: null }), messageOf()),
    R1CandidateState.REFUSED_INTENT_OUTSIDE_TRIAL_WINDOW, "no timestamp");
});

// ---- 30-35. the planned write, proved through the REAL 80.17A contract -----

const plannedDecision = () => evaluate({ intent: intentOf(), message: messageOf() });

check("30 the real 80.17A decision must be APPLIED before an attestation exists", () => {
  const d = plannedDecision();
  eq(d.outcome, OUT.APPLIED, "outcome");
  const cert = certifyR1WritePlan({ decision: d, canon, appliedOutcome: OUT.APPLIED });
  eq(cert.certified, true, `certified (${cert.reason})`);
  // Anything the contract does not approve blocks the attestation.
  const refused = evaluate({ intent: intentOf({ status: canon.failedIntentStatus }), message: messageOf() });
  eq(certifyR1WritePlan({ decision: refused, canon, appliedOutcome: OUT.APPLIED }).certified, false,
    "a non-APPLIED decision is never certified");
  assert(/certifyR1WritePlan/.test(OPERATOR_CODE) && /if \(!planCertified\.certified\) refuse/.test(OPERATOR_CODE),
    "the operator refuses on an uncertified plan");
});

check("31 the derived target is failed, and it comes from the message alone", () => {
  eq(plannedDecision().derived, canon.failedIntentStatus, "derived");
  eq(projectIntentStatus(R1.CANONICAL_MESSAGE_STATUS_FAILED), canon.failedIntentStatus,
    "the shared authority agrees with the repaired message status");
  eq(certifyR1WritePlan({
    decision: { ...plannedDecision(), derived: IntentResultStatus.DELIVERED },
    canon, appliedOutcome: OUT.APPLIED,
  }).reason, "PLAN_DERIVED_NOT_FAILED", "any other target is refused");
});

check("32 the write plan targets exactly communication_intents", () => {
  eq(plannedDecision().plan.table, LEAD_ASSIGNMENT_RECONCILE_TABLE, "table");
  eq(LEAD_ASSIGNMENT_RECONCILE_TABLE, "communication_intents", "the authority names the derived table");
});

check("33 the patch is exactly one field: status", () => {
  const patch = plannedDecision().plan.patch;
  eq(Object.keys(patch).length, 1, "one column");
  eq(Object.keys(patch)[0], LEAD_ASSIGNMENT_RECONCILE_COLUMN, "the column");
  eq(patch[LEAD_ASSIGNMENT_RECONCILE_COLUMN], canon.failedIntentStatus, "the value");
});

check("34 the patch never contains dispatched_at", () => {
  const d = plannedDecision();
  assert(!Object.prototype.hasOwnProperty.call(d.plan.patch, "dispatched_at"), "patch is clean");
  absent(OPERATOR_CODE.replace(/dispatched_at/g, (m, i) =>
    /INTENT_COLUMNS|before\.|post |line\(/.test(OPERATOR_CODE.slice(Math.max(0, i - 60), i)) ? "" : m),
    /dispatched_at\s*:/, "a dispatched_at assignment");
  eq(certifyR1WritePlan({
    decision: { ...d, plan: { ...d.plan, patch: { ...d.plan.patch, dispatched_at: "now" } } },
    canon, appliedOutcome: OUT.APPLIED,
  }).reason, "PLAN_PATCH_TOUCHES_DISPATCHED_AT", "a widened patch is refused");
});

check("35 the write carries exactly the three CAS fences", () => {
  const filters = plannedDecision().plan.filters;
  eq(filters.length, 3, "three fences");
  const f = Object.fromEntries(filters);
  eq(f.id, INTENT_ID, "exact id");
  eq(f.aggregate_type, canon.aggregateType, "lane");
  eq(f[LEAD_ASSIGNMENT_RECONCILE_COLUMN], canon.dispatchedIntentStatus, "compare-and-set on the observed status");
  const d = plannedDecision();
  eq(certifyR1WritePlan({
    decision: { ...d, plan: { ...d.plan, filters: filters.slice(0, 2) } },
    canon, appliedOutcome: OUT.APPLIED,
  }).reason, "PLAN_FENCES_NOT_THREE", "a dropped fence is refused");
});

// ---- 36-43. the single-use attestation -------------------------------------

const REPO = "/var/www/quickfurno-marketplace";
const freshAttestation = (nowMs = 1_770_000_000_000) =>
  buildR1Attestation({ candidate: candidateOf(), projectRef: R1.PRODUCTION_PROJECT_REF, gitSha: "abc123", nowMs });

const validateWith = (over, nowMs = 1_770_000_000_000) =>
  validateR1Attestation({
    attestation: over,
    nowMs,
    projectRef: R1.PRODUCTION_PROJECT_REF,
    gitSha: "abc123",
    candidate: candidateOf(),
  });

check("36 the attestation lives outside the repository", () => {
  eq(isR1AttestationPathOutsideRepo("/tmp/qf-mvp-80-17a-r1-attestation.json", REPO), true, "tmp is outside");
  eq(isR1AttestationPathOutsideRepo(`${REPO}/attestation.json`, REPO), false, "inside is refused");
  eq(isR1AttestationPathOutsideRepo(`${REPO}/scripts/a.json`, REPO), false, "nested inside is refused");
  eq(isR1AttestationPathOutsideRepo(REPO, REPO), false, "the root itself is inside");
  assert(/tmpdir\(\)/.test(OPERATOR_CODE), "the operator writes it to the OS temp directory");
  assert(/isR1AttestationPathOutsideRepo\(ATTESTATION_PATH, REPO_ROOT\)/.test(OPERATOR_CODE),
    "and proves that at runtime");
  assert(/mode: 0o600/.test(OPERATOR_CODE), "owner-only permissions");
});

check("37 the attestation TTL is at most fifteen minutes", () => {
  eq(R1.ATTESTATION_TTL_MS, 15 * 60 * 1000, "ttl");
  const a = freshAttestation();
  eq(a.expiresAtMs - a.issuedAtMs, R1.ATTESTATION_TTL_MS, "bound window");
  eq(validateWith({ ...a, ttlMs: 60 * 60 * 1000, expiresAtMs: a.issuedAtMs + 60 * 60 * 1000 }).reason,
    R1Refusal.ATTESTATION_TTL_TOO_LONG, "a longer TTL is refused, not clamped");
});

check("38 an expired or missing attestation is refused", () => {
  const a = freshAttestation();
  eq(validateWith(a).ok, true, "fresh is valid");
  eq(validateWith(a, a.expiresAtMs + 1).reason, R1Refusal.ATTESTATION_EXPIRED, "expired");
  eq(validateWith(null).reason, R1Refusal.ATTESTATION_MISSING, "missing");
  eq(validateWith({ schema: "unparsable" }).reason, R1Refusal.ATTESTATION_SCHEMA_MISMATCH, "wrong schema");
  eq(validateWith({ ...a, intentId: "" }).reason, R1Refusal.ATTESTATION_MALFORMED, "malformed");
});

check("39 a changed git SHA or project ref is refused", () => {
  const a = freshAttestation();
  eq(validateR1Attestation({
    attestation: a, nowMs: a.issuedAtMs, projectRef: R1.PRODUCTION_PROJECT_REF,
    gitSha: "deadbee", candidate: candidateOf(),
  }).reason, R1Refusal.ATTESTATION_GIT_SHA_CHANGED, "git sha");
  eq(validateR1Attestation({
    attestation: a, nowMs: a.issuedAtMs, projectRef: R1.STAGING_PROJECT_REF,
    gitSha: "abc123", candidate: candidateOf(),
  }).reason, R1Refusal.ATTESTATION_PROJECT_REF_CHANGED, "project ref");
});

check("40 a changed candidate status is refused", () => {
  const a = freshAttestation();
  eq(validateR1Attestation({
    attestation: a, nowMs: a.issuedAtMs, projectRef: R1.PRODUCTION_PROJECT_REF, gitSha: "abc123",
    candidate: { ...candidateOf(), observedIntentStatus: canon.failedIntentStatus },
  }).reason, R1Refusal.ATTESTATION_STATE_CHANGED, "intent moved under us");
});

check("41 a changed canonical message state is refused", () => {
  const a = freshAttestation();
  eq(validateR1Attestation({
    attestation: a, nowMs: a.issuedAtMs, projectRef: R1.PRODUCTION_PROJECT_REF, gitSha: "abc123",
    candidate: { ...candidateOf(), canonicalMessageStatus: "delivered" },
  }).reason, R1Refusal.ATTESTATION_STATE_CHANGED, "message moved under us");
  eq(validateR1Attestation({
    attestation: a, nowMs: a.issuedAtMs, projectRef: R1.PRODUCTION_PROJECT_REF, gitSha: "abc123",
    candidate: { ...candidateOf(), messageId: MESSAGE_ID.replace("b1", "c2") },
  }).reason, R1Refusal.ATTESTATION_CANDIDATE_CHANGED, "a different message");
});

check("42 changed linkage or tampered evidence is refused", () => {
  const a = freshAttestation();
  eq(validateR1Attestation({
    attestation: a, nowMs: a.issuedAtMs, projectRef: R1.PRODUCTION_PROJECT_REF, gitSha: "abc123",
    candidate: { ...candidateOf(), idempotencyKey: canon.idempotencyKeyFor(MESSAGE_ID) },
  }).reason, R1Refusal.ATTESTATION_LINKAGE_CHANGED, "linkage");
  const tampered = { ...a, evidenceDigest: r1EvidenceDigest({ ...a, intentId: "other" }) };
  eq(validateWith(tampered).reason, R1Refusal.ATTESTATION_EVIDENCE_CHANGED, "tampered digest");
});

check("43 a second candidate appearing after the preflight refuses the execution", () => {
  // Execute re-runs the FULL discovery before the attestation is even consulted.
  const two = decideR1Discovery([classify(intentOf(), messageOf()), classify(intentOf(), messageOf({ id: "x" }))]);
  eq(two.reason, R1Refusal.MULTIPLE_CANDIDATES, "discovery refuses first");
  const discover = OPERATOR_CODE.indexOf("await discover(db, canon)");
  const attest = OPERATOR_CODE.indexOf("validateR1Attestation({");
  const call = OPERATOR_CODE.indexOf("await runtime.reconcile({");
  assert(discover > 0 && attest > discover && call > attest,
    "order is discovery -> attestation -> the single service call");
  assert(/rmSync\(ATTESTATION_PATH/.test(OPERATOR_CODE), "the attestation is single use");
  const consume = OPERATOR_CODE.indexOf("rmSync(ATTESTATION_PATH");
  assert(consume < call, "it is consumed BEFORE the write, so a crash cannot leave it reusable");
});

// ---- 44-47. the deployed authority does the work ---------------------------

check("44 execution calls the real reconcileLeadAssignmentDeliveryResults exactly once", () => {
  eq((OPERATOR_CODE.match(/runtime\.reconcile\(/g) ?? []).length, 1, "one call site");
  eq((LOADER_CODE.match(/reconcileLeadAssignmentDeliveryResults/g) ?? []).length, 1, "bound once, from the real service");
  assert(/service\.reconcileLeadAssignmentDeliveryResults/.test(LOADER_CODE), "it is the deployed service's export");
  assert(/services", "leadAssignmentResultService\.ts/.test(LOADER_CODE), "loaded from services/leadAssignmentResultService.ts");
  // No loop, no map, no retry wrapper around the call.
  absent(OPERATOR_CODE, /for\s*\([^)]*\)\s*\{[^}]*runtime\.reconcile/, "a looped service call");
  assert(/calls \+= 1;/.test(OPERATOR_CODE), "calls are counted");
  eq((OPERATOR_CODE.match(/calls \+= 1;/g) ?? []).length, 1, "and incremented exactly once");
});

check("45 the operator cannot call CommunicationService or any send method", () => {
  for (const [re, label] of [
    [/CommunicationService/, "CommunicationService"],
    [/sendResolvedTemplate/, "sendResolvedTemplate"],
    [/sendTemplateMessage/, "sendTemplateMessage"],
    [/sendAuthenticationMessage/, "sendAuthenticationMessage"],
    [/\.send\s*\(/, "a send call"],
    [/processWebhook/, "a webhook replay"],
    [/normalizeMetaDeliveryWebhook/, "webhook payload parsing"],
  ]) {
    absent(OPERATOR_CODE, re, label);
    absent(CONTRACT_CODE, re, label);
    absent(LOADER_CODE, re, label);
  }
});

check("46 the operator cannot construct a provider adapter", () => {
  for (const code of [OPERATOR_CODE, CONTRACT_CODE, LOADER_CODE]) {
    absent(code, /new\s+[A-Za-z]*Provider/, "a provider construction");
    absent(code, /MetaCloudWhatsAppProvider/, "the Meta adapter");
    absent(code, /FetchHttpTransport/, "an HTTP transport");
  }
  // The loader REFUSES to load provider modules at all.
  eq(loader.r1LoaderDeniesModule("/repo/lib/communication/providers/metaCloudWhatsAppProvider.ts"), true,
    "provider modules are denied");
  eq(loader.r1LoaderDeniesModule("\\repo\\lib\\communication\\providers\\metaWhatsAppInbound.ts"), true,
    "denied on Windows paths too");
  eq(loader.r1LoaderDeniesModule("/repo/services/communicationService.ts"), true, "CommunicationService is denied");
  eq(loader.r1LoaderDeniesModule("/repo/services/leadAssignmentDispatchService.ts"), true, "the dispatcher is denied");
  eq(loader.r1LoaderDeniesModule("/repo/services/metaWhatsAppWebhookService.ts"), true, "the webhook service is denied");
  eq(loader.r1LoaderDeniesModule("/repo/services/leadAssignmentResultService.ts"), false,
    "the ONE permitted service still loads");
  eq(loader.r1LoaderDeniesModule("/repo/lib/supabase.ts"), false, "the client factory still loads");
});

check("47 no fetch, no Graph API, no /messages endpoint anywhere in the operator", () => {
  for (const code of [OPERATOR_CODE, CONTRACT_CODE, LOADER_CODE]) {
    absent(code, /(?<![A-Za-z.])fetch\s*\(/, "fetch");
    absent(code, /graph\.facebook\.com/, "a Graph API host");
    absent(code, /\/v\d+\.\d+\//, "a Graph API version path");
    absent(code, /\/messages/, "a /messages endpoint");
    absent(code, /https?:\/\/(?!\$)[a-z]/i, "a hard-coded outbound URL");
  }
});

// ---- 48-61. structural containment -----------------------------------------

check("48-51 no INSERT, no UPDATE, no upsert, no delete, no RPC", () => {
  for (const [re, label] of [
    [/\.insert\s*\(/, "an INSERT"],
    [/\.upsert\s*\(/, "an upsert"],
    [/(?<!createHash\("sha256"\))\.update\s*\(/, "a direct UPDATE"],
    [/\.delete\s*\(/, "a DELETE"],
    [/\.rpc\s*\(/, "an RPC"],
    [/execute_sql|executeSql/, "raw SQL execution"],
    [/\bUPDATE\s+\w+\s+SET\b/i, "a hand-written UPDATE statement"],
  ]) {
    absent(OPERATOR_CODE, re, label);
    absent(CONTRACT_CODE, re, label);
    absent(LOADER_CODE, re, label);
  }
  // Reads only. The single write in the whole run belongs to the deployed service.
  assert(/\.select\(/.test(OPERATOR_CODE), "the operator reads");
});

check("52-53 there is no direct status repair and no fallback that could add one", () => {
  absent(OPERATOR_CODE, /status['"]?\s*:\s*['"]failed/, "a hand-built status patch");
  absent(OPERATOR_CODE, /desiredStatus|targetStatus|forceStatus/, "a caller-supplied target status");
  absent(CONTRACT_CODE, /desiredStatus|targetStatus|forceStatus/, "a caller-supplied target status");
  // The refusal paths stop; they never fall through to a second strategy.
  assert(/refuse\("RECONCILIATION_CALL_THREW", 3\)/.test(OPERATOR_CODE), "a throw is a refusal");
  assert(/process\.exit\(3\)/.test(OPERATOR_CODE), "an uncertified result exits non-zero");
});

check("54-59 no credit, assignment, vendor, lead, n8n or scheduler surface", () => {
  const TABLES = OPERATOR_CODE.match(/\.from\("([a-z_]+)"\)/g) ?? [];
  const names = new Set(TABLES.map((t) => t.replace(/\.from\("|"\)/g, "")));
  eq(names.size, 2, `only two tables are ever named (${[...names].join(",")})`);
  assert(names.has("communication_intents") && names.has("communication_messages"), "and they are the two derived/canonical tables");
  for (const [re, label] of [
    [/credit|wallet|ledger/i, "a credit surface"],
    [/lead_assignment_approvals|assignment_receipt/i, "an assignment write"],
    [/vendor_profiles|vendors/i, "a vendor surface"],
    [/\bleads\b/i, "a lead surface"],
    [/n8n/i, "an n8n call"],
    [/cron|scheduler/i, "a scheduler"],
    [/quarantine|consent_|package/i, "quarantine, consent or package state"],
  ]) {
    absent(OPERATOR_CODE, re, label);
  }
});

check("60-61 no webhook replay and no Meta credential is read", () => {
  for (const code of [OPERATOR_CODE, CONTRACT_CODE, LOADER_CODE]) {
    absent(code, /WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET|WHATSAPP_WEBHOOK_VERIFY_TOKEN/, "a Meta credential");
    absent(code, /QF_CRON_SECRET/, "the scheduler secret");
    absent(code, /PHONE_NUMBER_ID|WABA_ID|appSecret/, "Meta account identity");
    absent(code, /replay|redeliver/i, "a replay path");
  }
  // The only environment variables read are the two the client itself needs.
  const envs = new Set((OPERATOR_CODE.match(/process\.env\.[A-Z_]+/g) ?? []).map((s) => s.split(".").pop()));
  eq(envs.size, 2, `exactly two environment reads (${[...envs].join(",")})`);
  assert(envs.has("NEXT_PUBLIC_SUPABASE_URL") && envs.has("SUPABASE_SERVICE_ROLE_KEY"), "and they are the client's own");
});

// ---- 62-67. certifying the outcome -----------------------------------------

const SUMMARY_OK = { examined: 1, applied: 1, unchanged: 0, notApplicable: 0, concurrent: 0, refused: 0, outcomes: { APPLIED: 1 } };

check("62 only applied = 1 with a matching outcome tally is certified", () => {
  eq(certifyR1Summary(SUMMARY_OK).certified, true, "the exact success shape");
  eq(certifyR1Summary({ ...SUMMARY_OK, applied: 0 }).certified, false, "applied 0");
  eq(certifyR1Summary({ ...SUMMARY_OK, examined: 2 }).certified, false, "two rows examined");
  eq(certifyR1Summary({ ...SUMMARY_OK, unchanged: 1 }).certified, false, "an unchanged row");
  eq(certifyR1Summary({ ...SUMMARY_OK, notApplicable: 1 }).certified, false, "a not-applicable row");
  eq(certifyR1Summary({ ...SUMMARY_OK, outcomes: {} }).certified, false, "no APPLIED tally");
  eq(certifyR1Summary(null).certified, false, "no summary at all");
});

check("63 a CONCURRENT_MODIFICATION result is never certified", () => {
  const r = certifyR1Summary({ ...SUMMARY_OK, applied: 0, concurrent: 1, outcomes: { CONCURRENT_MODIFICATION: 1 } });
  eq(r.certified, false, "not certified");
  eq(r.reason, "NOT_CERTIFIED_CONCURRENT_MODIFICATION", "named reason");
  // Even a summary that otherwise looks perfect is refused if concurrent > 0.
  eq(certifyR1Summary({ ...SUMMARY_OK, concurrent: 1 }).certified, false, "concurrent poisons a success");
});

check("64 a refused or failed write is never certified", () => {
  const r = certifyR1Summary({ ...SUMMARY_OK, applied: 0, refused: 1, outcomes: { REFUSED_WRITE_FAILED: 1 } });
  eq(r.certified, false, "not certified");
  eq(r.reason, "NOT_CERTIFIED_WRITE_REFUSED", "named reason");
});

check("65 there is no automatic retry anywhere", () => {
  absent(OPERATOR_CODE, /setTimeout|setInterval|while\s*\(/, "a wait or spin loop");
  absent(OPERATOR_CODE, /attempt|backoff|maxRetries|retryCount/i, "retry machinery");
  assert(/automatic retry/.test(rawOf(OPERATOR_PATH)), "the operator states the no-retry rule to the reader");
  // A failed run exits; it does not fall through to a second call.
  const call = OPERATOR_CODE.indexOf("await runtime.reconcile({");
  eq(OPERATOR_CODE.indexOf("await runtime.reconcile({", call + 1), -1, "there is no second call site");
});

check("66-67 ALREADY_RECONCILED requires the exact lineage, never merely zero drift", () => {
  // Zero rows found is NO_CANDIDATE — never a success claim.
  eq(decideR1Discovery([]).reason, R1Refusal.NO_CANDIDATE, "empty is not reconciled");
  // A row that fails linkage is not reconciled either, even at the right status.
  eq(stateOf(intentOf({ status: canon.failedIntentStatus }), messageOf({ idempotency_key: "wrong" })),
    R1CandidateState.REFUSED_MESSAGE_IDEMPOTENCY_KEY, "broken linkage is refused, not reconciled");
  eq(decideR1Discovery([classify(intentOf({ status: canon.failedIntentStatus }), messageOf({ idempotency_key: "wrong" }))]).reason,
    R1Refusal.NO_CANDIDATE, "and it yields no verdict of success");
  // Only the fully proved historical pair earns it.
  eq(decideR1Discovery([classify(intentOf({ status: canon.failedIntentStatus }), messageOf())]).state,
    R1CandidateState.ALREADY_RECONCILED, "the exact lineage does");
});

check("67b the post-state read-back proves the canonical row was not rewritten", () => {
  const before = candidateOf();
  const after = { message: { ...messageOf() }, intent: intentOf({ status: canon.failedIntentStatus }) };
  eq(certifyR1PostState({ ...after, canon, before }).certified, true, "the expected post-state");
  eq(certifyR1PostState({ ...after, message: { ...after.message, status: "delivered" }, canon, before }).reason,
    "POST_CANONICAL_MESSAGE_MUTATED", "a rewritten canonical message fails");
  eq(certifyR1PostState({ ...after, intent: intentOf({ status: canon.dispatchedIntentStatus }), canon, before }).reason,
    "POST_INTENT_NOT_CONVERGED", "an unconverged intent fails");
  eq(certifyR1PostState({
    ...after, intent: intentOf({ status: canon.failedIntentStatus, dispatched_at: "2026-09-06T00:00:00.000Z" }),
    canon, before,
  }).reason, "POST_DISPATCHED_AT_MUTATED", "a rewritten dispatched_at fails");
});

// ---- 68-72. scope freeze ---------------------------------------------------

check("68 historical parked pending intents stay unreachable", () => {
  // R1 selects nothing by status; it classifies, and `pending` never becomes a
  // candidate. The dispatcher's own selector is likewise untouched.
  eq(stateOf(intentOf({ status: IntentResultStatus.PENDING }), messageOf()),
    R1CandidateState.REFUSED_INTENT_STATUS_NOT_REPAIRABLE, "pending is not repairable");
  absent(OPERATOR_CODE, /"pending"/, "the operator never names the pending status");
  assert(/\.eq\("status", LEAD_ASSIGNMENT_SELECTABLE_STATUS\)/.test(DISPATCH_CODE),
    "the dispatcher still selects only the pending status");
});

check("69-70 the activation boundary and the dispatcher are unchanged", () => {
  assert(/\.gt\("created_at", boundary\.notBeforeIso\)/.test(DISPATCH_CODE),
    "the first-dispatch activation boundary fence is unchanged");
  assert(/LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY =[\s\S]{0,8}"lead_assignment_dispatch_activation"/
    .test(DISPATCH_CONTRACT_CODE), "the activation policy key is unchanged");
  assert(/LEAD_ASSIGNMENT_SELECTABLE_STATUS: IntentResultStatusValue =[\s\S]{0,8}IntentResultStatus\.PENDING/
    .test(DISPATCH_CONTRACT_CODE), "selectable status is still PENDING only");
  assert(/advanceLeadAssignmentIntentStatus/.test(DISPATCH_CODE), "the dispatcher's own status advance is intact");
  for (const code of [OPERATOR_CODE, CONTRACT_CODE, LOADER_CODE]) {
    absent(code, /LEAD_ASSIGNMENT_ACTIVATION_POLICY_KEY|notBeforeIso/, "an activation-boundary reference");
    absent(code, /advanceLeadAssignmentIntentStatus/, "the dispatcher's writer");
  }
});

check("71 the 80.16C permanent-recipient close is intact", () => {
  assert(/failLeadAssignmentIntentOnPermanentRecipientRefusal/.test(DISPATCH_CODE), "80.16C close still present");
  absent(OPERATOR_CODE, /failLeadAssignmentIntentOnPermanentRecipientRefusal/, "R1 does not touch it");
});

check("72 the deployed 80.17A webhook semantics are unchanged", () => {
  assert(/reconcileLeadAssignmentDeliveryResults/.test(WEBHOOK_CODE), "step 12 still wired");
  assert(/classifyReconcileWriteResult/.test(SERVICE_CODE), "the CAS-miss classifier is still the write authority");
  assert(/readonly concurrent: number/.test(SERVICE_CODE), "the concurrent counter the operator certifies still exists");
  // R1 adds nothing to the service and takes nothing away.
  absent(OPERATOR_CODE, /export (async )?function reconcile/, "a second reconciler");
});

check("72b the OFFLINE MVP loader safety contract is untouched", () => {
  assert(/FORBIDDEN = \/\(\^\|\\\/\)\(supabase\|services\)/.test(MVP_LOADER_RAW),
    "the offline hook still refuses supabase/services");
  assert(/It NEVER maps the "@\/\.\.\." path alias/.test(MVP_LOADER_RAW), "and still never maps the alias");
  assert(/register\('\.\/tsResolveHooks\.mjs'/.test(MVP_REGISTER_RAW), "register.mjs still registers only that hook");
  // The operator loader is a SEPARATE file and is never registered by the MVP runner.
  absent(MVP_LOADER_RAW, /80-17a-r1/, "the offline loader knows nothing about R1");
  absent(MVP_REGISTER_RAW, /80-17a-r1/, "and neither does its registration");
});

// ---- privacy and evidence --------------------------------------------------

check("P1 identifiers are reported as digests and never in the clear", () => {
  const d = digestOf(INTENT_ID);
  assert(d.startsWith("sha256:") && !d.includes(INTENT_ID), "digest, not the id");
  eq(digestOf(null), "sha256:absent", "absent is named, not guessed");
  for (const [re, label] of [
    [/destination|recipient_ref|phone|msisdn/i, "a destination or phone reference"],
    [/destination_hash|destination_masked/, "destination columns"],
    [/client_name|customer_name/i, "a client name"],
  ]) {
    absent(OPERATOR_CODE, re, label);
  }
  // Column lists are the privacy fence: the operator can only read what it names.
  const cols = OPERATOR_CODE.match(/(INTENT|MESSAGE)_COLUMNS =\s*([\s\S]*?);/g).join(" ");
  absent(cols, /destination|recipient|variables|metadata/, "a sensitive column");
});

check("P2 the 131026 trial evidence is three-valued and never weakens identity", () => {
  eq(classifyR1FailureEvidence("131026"), R1FailureEvidence.MATCHES_KNOWN_TRIAL, "the known code");
  eq(classifyR1FailureEvidence("131047"), R1FailureEvidence.CONTRADICTS_KNOWN_TRIAL, "a different numeric code");
  eq(classifyR1FailureEvidence(null), R1FailureEvidence.UNPROVEN, "absent");
  eq(classifyR1FailureEvidence("meta:131026"), R1FailureEvidence.UNPROVEN, "an unknown spelling is never assumed");
  eq(r1FailureCodeIsSafeToPrint("131026"), true, "a bare numeric code may be printed");
  eq(r1FailureCodeIsSafeToPrint("recipient +9177..."), false, "anything else may not");
  // A contradiction stops the run; it never relaxes the candidate rules.
  assert(/CONTRADICTS_KNOWN_TRIAL/.test(OPERATOR_CODE) && /refuse\("FAILURE_EVIDENCE_CONTRADICTS_KNOWN_TRIAL"\)/.test(OPERATOR_CODE),
    "the operator stops on a contradiction");
  eq(stateOf(intentOf(), messageOf({ failure_code: "131047" })), R1CandidateState.CANDIDATE,
    "and identity itself is decided without the failure code");
});

check("P3 canon comes from the real authorities, never a second copy", () => {
  eq(assertCanonAgrees(canon).ok, true, "the real canon agrees with the projection authority");
  eq(assertCanonAgrees({ ...canon, project: () => IntentResultStatus.DELIVERED }).reason,
    R1Refusal.CANON_DISAGREES_WITH_AUTHORITY, "a drifted projection refuses");
  eq(assertCanonAgrees({ ...canon, aggregateType: "" }).reason,
    R1Refusal.CANON_DISAGREES_WITH_AUTHORITY, "a missing identifier refuses");
  // No lane identifier is retyped in the pure contract or the operator.
  for (const literal of [
    LEAD_ASSIGNMENT_AGGREGATE_TYPE, LEAD_ASSIGNMENT_TEMPLATE_KEY,
    LEAD_ASSIGNMENT_TEMPLATE_PURPOSE, INTENT_ENTITY_TYPE, META_WHATSAPP_ADAPTER_PROVIDER,
  ]) {
    absent(CONTRACT_CODE, new RegExp(`"${literal}"`), `a hard-coded copy of ${literal}`);
    absent(OPERATOR_CODE, new RegExp(`"${literal}"`), `a hard-coded copy of ${literal}`);
  }
  // And the adapter key the operator matches IS the key the live webhook passes.
  const providerKey = /META_WHATSAPP_CLOUD_PROVIDER_KEY\s*=\s*"([a-z_]+)"/.exec(rawOf(PROVIDER_PATH));
  assert(providerKey !== null, "the provider module still exports its key");
  eq(providerKey[1], META_WHATSAPP_ADAPTER_PROVIDER, "the two authorities agree on the persisted provider key");
  assert(new RegExp(`provider: META_WHATSAPP_CLOUD_PROVIDER_KEY`).test(WEBHOOK_CODE),
    "and that is what the live webhook hands the same service");
});

// ---- mutants: prove these rules can actually fail ---------------------------

check("M1 mutant: 'at least one candidate' would repair an ambiguous set", () => {
  const two = [classify(intentOf(), messageOf()), classify(intentOf(), messageOf({ id: "x" }))];
  eq(decideR1Discovery(two).reason, R1Refusal.MULTIPLE_CANDIDATES, "the real rule refuses");
  const naive = two.filter((r) => r.state === R1CandidateState.CANDIDATE).length >= 1;
  assert(naive === true, "the mutant would proceed");
});

check("M2 mutant: dropping the time fence would admit an unrelated intent", () => {
  const stray = intentOf({ created_at: "2026-09-06T09:00:00.000Z" });
  eq(stateOf(stray, messageOf()), R1CandidateState.REFUSED_INTENT_OUTSIDE_TRIAL_WINDOW, "the real rule refuses");
  const naive = { ...classify({ ...stray, created_at: IN_WINDOW }, messageOf()) };
  eq(naive.state, R1CandidateState.CANDIDATE, "without the fence it would be a candidate");
});

check("M3 mutant: accepting any supabase.co host would accept staging", () => {
  eq(envOf(R1.STAGING_PROJECT_REF).allowed, false, "the real rule refuses");
  const naive = /\.supabase\.co$/.test(`${R1.STAGING_PROJECT_REF}.supabase.co`);
  assert(naive === true, "a host-suffix check alone would allow it");
});

check("M4 mutant: 'any non-terminal intent' would repair a parked pending row", () => {
  eq(stateOf(intentOf({ status: IntentResultStatus.PENDING }), messageOf()),
    R1CandidateState.REFUSED_INTENT_STATUS_NOT_REPAIRABLE, "the real rule refuses");
  const naive = IntentResultStatus.PENDING !== canon.failedIntentStatus;
  assert(naive === true, "a 'not already failed' rule would admit pending");
});

check("M5 mutant: a direct UPDATE fallback would exist in the source", () => {
  absent(OPERATOR_CODE, /(?<!createHash\("sha256"\))\.update\s*\(/, "the real operator has no update");
  const naive = 'db.from("communication_intents").update({ status: "failed" })';
  assert(/\.update\s*\(/.test(naive), "the mutant is exactly what the source check catches");
});

check("M6 mutant: retrying a CONCURRENT_MODIFICATION would be uncertified anyway", () => {
  const concurrent = { ...SUMMARY_OK, applied: 0, concurrent: 1, outcomes: { CONCURRENT_MODIFICATION: 1 } };
  eq(certifyR1Summary(concurrent).certified, false, "not certified");
  absent(OPERATOR_CODE, /concurrent[\s\S]{0,80}runtime\.reconcile/, "no retry-on-concurrent path");
});

check("M7 mutant: a second service call would break the single-call proof", () => {
  eq((OPERATOR_CODE.match(/runtime\.reconcile\(/g) ?? []).length, 1, "exactly one call site");
  const naive = "await runtime.reconcile(a); await runtime.reconcile(a);";
  eq((naive.match(/runtime\.reconcile\(/g) ?? []).length, 2, "the mutant is detectable");
});

check("M8 mutant: 'no drift rows' as success would claim an unproved repair", () => {
  eq(decideR1Discovery([]).state, R1Mode.REFUSED, "the real rule refuses");
  const naive = [].filter((r) => r.state === R1CandidateState.CANDIDATE).length === 0
    ? R1CandidateState.ALREADY_RECONCILED : R1Mode.REFUSED;
  eq(naive, R1CandidateState.ALREADY_RECONCILED, "the mutant would declare success on an empty read");
  assert(naive !== decideR1Discovery([]).state, "real and mutant must differ");
});

check("M9 mutant: a caller-supplied desired status is ignored by the real contract", () => {
  const d = evaluate({
    intent: intentOf(), message: messageOf(),
    desiredStatus: IntentResultStatus.DELIVERED, force: true,
  });
  eq(d.plan.patch[LEAD_ASSIGNMENT_RECONCILE_COLUMN], canon.failedIntentStatus, "the message alone decides");
  absent(OPERATOR_CODE, /desiredStatus/, "and the operator never offers one");
});

check("M10 mutant: dropping the idempotency-key fence would cross-link intents", () => {
  const foreign = messageOf({ idempotency_key: canon.idempotencyKeyFor("99999999-8888-4777-8666-555555555555") });
  eq(stateOf(intentOf(), foreign), R1CandidateState.REFUSED_MESSAGE_IDEMPOTENCY_KEY, "the real rule refuses");
  assert(foreign.entity_id === INTENT_ID && foreign.template_key === canon.templateKey &&
    foreign.status === R1.CANONICAL_MESSAGE_STATUS_FAILED,
    "every OTHER fact still agrees — which is why the key is load-bearing");
});

// ============================================================================
let passed = 0;
const failures = [];
for (const { name, fn } of checks) {
  try { fn(); passed += 1; console.log(`   ok    ${name}`); }
  catch (e) { failures.push(`   FAIL  ${name} — ${e.message}`); console.log(`   FAIL  ${name} — ${e.message}`); }
}
console.log(`\n${"=".repeat(78)}`);
console.log(`QF-MVP-80.17A-R1 controlled historical reconciliation — passed ${passed}, failed ${failures.length}`);
if (failures.length) { console.log("\nFAILURES:"); for (const l of failures) console.log(l); }
console.log("=".repeat(78));
process.exit(failures.length ? 1 : 0);
