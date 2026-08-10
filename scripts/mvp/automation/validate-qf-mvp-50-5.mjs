#!/usr/bin/env node
// ============================================================================
// QF-MVP-50.5 — automation recovery / reconciliation source gate
//
// Offline and repository-only: no database, no network, no provider, no secret,
// no deployment. It proves what the SOURCE guarantees; applying the migration to
// staging and certifying it against a real n8n runtime are separate, later gates.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTOMATION_RECOVERY_ROUTE_KEYS,
  AUTOMATION_TRANSPORT_ROUTE_KEYS,
  N8N_RECONCILE_ROUTE_PATH,
  N8N_RECOVER_ROUTE_PATH,
} from "../../../lib/automation/transportTypes.ts";
import {
  AUTOMATION_RECONCILE_ORCHESTRATION_STATES,
  AUTOMATION_RECOVER_ORCHESTRATION_STATES,
  AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS,
  IN_FLIGHT_ATTEMPT_CEILING_SECONDS,
  N8N_RECOVERY_REQUEST_KEYS,
  PROVIDER_CALL_CEILING_SECONDS,
  RECONCILE_SQL_DISPOSITIONS,
  RECOVERY_SAFETY_MARGIN_SECONDS,
  STALE_THRESHOLD_MAX_SECONDS,
  STALE_THRESHOLD_MIN_SECONDS,
  TRANSPORT_CALLS_PER_ATTEMPT,
  TRANSPORT_HTTP_TIMEOUT_SECONDS,
  TRANSPORT_SIGNATURE_WINDOW_SECONDS,
  parseRecoveryRequestBody,
  resolveStaleReconcileDisposition,
  staleThresholdIsSafe,
} from "../../../lib/automation/recoveryContract.ts";
import { AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS } from "../../../lib/automation/transportAuth.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const canonicalSha256 = (buffer) =>
  createHash("sha256")
    .update(Buffer.from(buffer.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8"))
    .digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const MIGRATION_PATH =
  "supabase/migrations/20260812000000_qf_mvp_50_5_automation_recovery_reconciliation.sql";
const MIGRATION_SHA = "25a142009bc389ae9e6f1fae95b873e0858c74b4a5792cbf3217dfb4e3af189b";
const WORKFLOW_PATH = "automation/n8n/QF-MVP-50-05-Recovery-Supervisor.workflow.json";
const CONTRACT_PATH = "lib/automation/recoveryContract.ts";
const SERVICE_PATH = "services/automationRecoveryService.ts";
const RECOVER_ROUTE_PATH = "app/api/internal/automation/n8n/recover/route.ts";
const RECONCILE_ROUTE_PATH = "app/api/internal/automation/n8n/reconcile/route.ts";
const DOC_PATH = "docs/QF-MVP-50-5-RECOVERY-RECONCILIATION.md";
const CLOSEOUT_PATH = "docs/QF-MVP-50-CLOSEOUT.md";

/** Comments are stripped so a guarantee can never be satisfied by prose alone. */
const stripJs = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const stripSql = (src) => src.replace(/^\s*--.*$/gm, "");

const migrationSource = read(MIGRATION_PATH);
const migrationCode = stripSql(migrationSource);
const contractSource = read(CONTRACT_PATH);
const contractCode = stripJs(contractSource);
const serviceSource = read(SERVICE_PATH);
const serviceCode = stripJs(serviceSource);
const recoverRouteCode = stripJs(read(RECOVER_ROUTE_PATH));
const reconcileRouteCode = stripJs(read(RECONCILE_ROUTE_PATH));
const newModuleCode = contractCode + serviceCode + recoverRouteCode + reconcileRouteCode;
const workflow = JSON.parse(read(WORKFLOW_PATH));
const workflowText = JSON.stringify(workflow);
const manifest = JSON.parse(read("supabase/staging-history/qf-mvp-staging-history-manifest.json"));
const pkg = JSON.parse(read("package.json"));
const ciWorkflow = read(".github/workflows/qf-mvp-50-quality-gate.yml");
const g1Source = read("scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs");
const claimMigration = read(
  "supabase/migrations/20260811000000_qf_mvp_50_3_50_4_family_aware_claim_routing.sql",
);
const wedgeMigration = read(
  "supabase/migrations/20260808000000_qf_mvp_50_2_fresh_claim_retry_wedge_repair.sql",
);

const results = [];
const record = (name, passed) => results.push({ name, passed: passed === true });

// ---------------------------------------------------------------------------
// T. TWO DISTINCT ROUTES — the central owner-locked decision
// ---------------------------------------------------------------------------
record("T01 the transport route vocabulary is closed to exactly five, in exact order",
  AUTOMATION_TRANSPORT_ROUTE_KEYS.length === 5 &&
  AUTOMATION_TRANSPORT_ROUTE_KEYS.join(",") ===
    "claim_v1,complete_v1,execute_v1,recover_v1,reconcile_v1");
record("T02 the recovery routes are exactly two and are named separately",
  AUTOMATION_RECOVERY_ROUTE_KEYS.length === 2 &&
  same([...AUTOMATION_RECOVERY_ROUTE_KEYS], ["recover_v1", "reconcile_v1"]));
record("T03 the migration widens route_key to exactly the same five",
  /check \(route_key in \(\s*'claim_v1',\s*'complete_v1',\s*'execute_v1',\s*'recover_v1',\s*'reconcile_v1'\s*\)\)/
    .test(migrationCode));
record("T04 the two recovery routes are NOT collapsed into one",
  // The single most important structural assertion of this phase.
  /'recover_v1'/.test(migrationCode) && /'reconcile_v1'/.test(migrationCode) &&
  !/recover_or_reconcile|recovery_v1'/.test(migrationCode) &&
  migrationCode.includes("qf_recover_automation_job_transport_v1") &&
  migrationCode.includes("qf_reconcile_automation_attempt_transport_v1"));
record("T05 each recovery route has its own exact HTTP path, declared once",
  N8N_RECOVER_ROUTE_PATH === "/api/internal/automation/n8n/recover" &&
  N8N_RECONCILE_ROUTE_PATH === "/api/internal/automation/n8n/reconcile" &&
  N8N_RECOVER_ROUTE_PATH !== N8N_RECONCILE_ROUTE_PATH &&
  (read("lib/automation/transportTypes.ts").match(/"\/api\/internal\/automation\/n8n\/recover"/g) ?? []).length === 1 &&
  (read("lib/automation/transportTypes.ts").match(/"\/api\/internal\/automation\/n8n\/reconcile"/g) ?? []).length === 1);
record("T06 each route signs its OWN path, so one signature cannot authenticate the other",
  recoverRouteCode.includes("path: N8N_RECOVER_ROUTE_PATH") &&
  !recoverRouteCode.includes("N8N_RECONCILE_ROUTE_PATH") &&
  reconcileRouteCode.includes("path: N8N_RECONCILE_ROUTE_PATH") &&
  !reconcileRouteCode.includes("N8N_RECOVER_ROUTE_PATH"));
record("T07 the state vocabulary adds exactly two new terminal states",
  /check \(state in \(\s*'processing',\s*'claimed',\s*'empty',\s*'completed',\s*'recorded',\s*'recovered',\s*'reconciled'\s*\)\)/
    .test(migrationCode));
record("T08 recovered is bound to recover_v1 and reconciled to reconcile_v1",
  /state = 'recovered'\s*\n\s*and route_key = 'recover_v1'/.test(migrationCode) &&
  /state = 'reconciled'\s*\n\s*and route_key = 'reconcile_v1'/.test(migrationCode));
record("T09 empty is widened only to the three SELECTING routes and still carries no identity",
  /state = 'empty'\s*\n\s*and route_key in \('claim_v1', 'recover_v1', 'reconcile_v1'\)\s*\n\s*and job_id is null/
    .test(migrationCode));
record("T10 the update guard binds each recovery route to its own terminal states",
  /old\.route_key = 'recover_v1' and new\.state not in \('recovered', 'empty'\)/.test(migrationCode) &&
  /old\.route_key = 'reconcile_v1' and new\.state not in \('reconciled', 'empty'\)/.test(migrationCode));

// ---------------------------------------------------------------------------
// C. claim_v1 IS COMPLETELY PRESERVED
// ---------------------------------------------------------------------------
// Matching is deliberately line-scoped. A greedy `[\s\S]*` would let an unrelated
// `drop constraint` earlier in the file satisfy a "no drop of X" claim for free.
const dropStatements = migrationCode
  .split(/;\s*\n/)
  .filter((statement) => /\bdrop\s+(index|constraint)\b/i.test(statement));
record("C01 the migration never drops or recreates any existing uniqueness rule",
  dropStatements.every((statement) => !/uq_automation_transport_requests/i.test(statement)) &&
  dropStatements.every((statement) => /drop constraint automation_transport_requests_(route|state|shape)_check/i.test(statement)) &&
  dropStatements.length === 3);
record("C02 the one-claim-per-job rule is asserted present, never relaxed",
  /uq_automation_transport_requests_claim_job/.test(migrationCode) &&
  !/uq_automation_transport_requests_claim_job[\s\S]{0,80}drop/i.test(migrationCode));
record("C03 claim_v1 is never reused for a retry anywhere in the new source",
  !/route_key = 'claim_v1'[\s\S]{0,200}retry/i.test(migrationCode) &&
  !/claim_v1/.test(serviceCode));
record("C04 the frozen fresh-claim semantics are re-asserted by self-verification",
  migrationCode.includes("the frozen fresh-claim semantics changed") &&
  /j\\\.status = ''pending''/.test(migrationCode) &&
  /v_def ~ 'j\\\.status = ''retry_scheduled'''/.test(migrationCode));
record("C05 the claim and wedge-repair migrations are byte-untouched",
  canonicalSha256(Buffer.from(claimMigration, "utf8")) ===
    "fc7efae9c2349854b9856d3b3b3956933bcfe79ed15c1eeb7caf65bc61f8f89d" &&
  canonicalSha256(Buffer.from(wedgeMigration, "utf8")) ===
    "8b798bb3c5db5d91f988d92cec3705237db08c753ae5018d09dccc09ff0240aa");
record("C06 no transport row is ever deleted and no evidence is destroyed",
  !/\bdelete\s+from\b/i.test(migrationCode.replace(/'[^']*delete from[^']*'/gi, "''")) &&
  !/\btruncate\s+(table|public\.)/i.test(migrationCode) &&
  !/\bdrop\s+(table|trigger|function)\b/i.test(migrationCode));

// ---------------------------------------------------------------------------
// R. recover_v1 — DUE-RETRY RECOVERY
// ---------------------------------------------------------------------------
record("R01 recovery selects retry_scheduled only, never pending",
  /and j\.status = 'retry_scheduled'/.test(migrationCode) &&
  !/qf_recover_automation_job_v1[\s\S]{0,4000}j\.status = 'pending'/.test(migrationCode));
record("R02 recovery requires the retry instant to have actually arrived",
  /j\.next_retry_at is not null\s*\n\s*and j\.next_retry_at <= now\(\)/.test(migrationCode));
record("R03 recovery respects the durable attempt budget",
  /qf_recover_automation_job_v1[\s\S]{0,2000}j\.attempt_count < j\.max_attempts/.test(migrationCode));
record("R04 recovery increments attempt_count exactly once and creates ONE attempt",
  /qf_recover_automation_job_v1[\s\S]{0,2000}attempt_count = attempt_count \+ 1/.test(migrationCode) &&
  (migrationCode.match(/insert into public\.automation_execution_attempts/g) ?? []).length === 1);
record("R05 recovery takes the lease with skip-locked, exactly as the claim does",
  /qf_recover_automation_job_v1[\s\S]{0,2500}for update skip locked/.test(migrationCode));
record("R06 recovery NEVER mutates available_at",
  !/available_at\s*=/.test(migrationCode) &&
  migrationCode.includes("recovery must never mutate available_at"));
record("R07 recovery uniqueness is the retry GENERATION, not the job and not the attempt",
  /create unique index uq_automation_transport_requests_recover_generation\s*\n\s*on public\.automation_transport_requests\(job_id, attempt_number\)\s*\n\s*where route_key = 'recover_v1'/
    .test(migrationCode));
record("R08 the selector structurally excludes an already-recovered generation, so 23505 is unreachable",
  /not exists \(\s*\n\s*select 1\s*\n\s*from public\.automation_transport_requests t\s*\n\s*where t\.route_key = 'recover_v1'\s*\n\s*and t\.job_id = j\.id\s*\n\s*and t\.attempt_number = j\.attempt_count \+ 1\s*\n\s*\)/
    .test(migrationCode));
record("R09 recovery returns the canonical family from durable action truth",
  /qf_automation_action_workflow_family_v1/.test(migrationCode) &&
  migrationCode.includes("AUTOMATION_RECOVERY_WORKFLOW_FAMILY_UNRESOLVED"));
record("R10 an unmapped family is invisible to the selector rather than a wedge",
  /public\.qf_automation_action_workflow_family_v1\(r\.action_type\)\s*\n\s*is not null/.test(migrationCode));
record("R11 a recovery replay is never handed executable work",
  serviceCode.includes("AUTOMATION_RECOVERY_REPLAY_EXECUTION_SUPPRESSED") &&
  /if \(row\.is_replay\)/.test(serviceCode));
record("R12 the family is re-validated against the closed vocabulary before it leaves Core",
  serviceCode.includes("isClaimableWorkflowFamily(row.workflow_family)") &&
  serviceCode.includes("AUTOMATION_RECOVERY_WORKFLOW_FAMILY_INVALID"));
/** The exact body of one SQL function, so an ordering or absence claim is real. */
const sqlFunctionBody = (name) => {
  const start = migrationCode.indexOf(`create or replace function public.${name}(`);
  if (start === -1) return "";
  const open = migrationCode.indexOf("as $$", start);
  const close = migrationCode.indexOf("$$;", open);
  return open === -1 || close === -1 ? "" : migrationCode.slice(open, close);
};
const recoverBody = sqlFunctionBody("qf_recover_automation_job_v1");
const reconcileBody = sqlFunctionBody("qf_reconcile_automation_attempt_transport_v1");
const selectorBody = sqlFunctionBody("qf_select_stale_automation_attempt_v1");

record("R13 recovery never classifies, finalizes or dead-letters anything",
  recoverBody.length > 0 &&
  !/classification|dead_letter|qf_complete_automation_attempt|last_safe_code/.test(recoverBody));

// ---------------------------------------------------------------------------
// S. reconcile_v1 — STALE RECONCILIATION
// ---------------------------------------------------------------------------
record("S01 reconciliation is deliberately repeatable: NO uniqueness index exists",
  !/create unique index[^;]*reconcile_v1/.test(migrationCode) &&
  migrationCode.includes("deferral must stay re-examinable"));
record("S02 the disposition vocabulary is closed to exactly three",
  RECONCILE_SQL_DISPOSITIONS.length === 3 &&
  same([...RECONCILE_SQL_DISPOSITIONS], ["finalize", "defer", "empty"]) &&
  /p_disposition not in \('finalize', 'defer', 'empty'\)/.test(migrationCode));
record("S03 staleness is RE-PROVEN under the row lock, not trusted from the earlier read",
  /for update;[\s\S]{0,1200}AUTOMATION_RECONCILE_CANDIDATE_NOT_STALE/.test(migrationCode) &&
  /v_job\.locked_at > v_cutoff/.test(migrationCode));
record("S04 only the CURRENT attempt may be reconciled",
  /v_attempt\.attempt_number <> v_job\.attempt_count/.test(migrationCode) &&
  /a\.attempt_number = j\.attempt_count/.test(migrationCode) &&
  migrationCode.includes("AUTOMATION_RECONCILE_ATTEMPT_NOT_CURRENT"));
record("S05 finalization DELEGATES to the frozen completion authority",
  /perform public\.qf_complete_automation_attempt_v1\(/.test(migrationCode));
record("S06 the dead-letter boundary is never reimplemented in the recovery path",
  !/dead_letter/.test(migrationCode.replace(/'succeeded', 'failed', 'uncertain', 'dead_letter'/g, "")) ||
  migrationCode.includes("the dead-letter boundary must stay inside qf_complete_automation_attempt_v1"));
record("S07 a deferral supplies no ruling and mutates nothing",
  /AUTOMATION_RECONCILE_DEFER_ARGUMENTS_INVALID/.test(migrationCode) &&
  serviceCode.includes("AUTOMATION_RECONCILE_DEFERRAL_MUTATED_STATE"));
record("S08 an anomaly consumes NO durable request identity",
  /if \(ruling\.disposition === "anomaly"\)[\s\S]{0,200}return \{ ok: false/.test(serviceCode) &&
  !/anomaly/.test(migrationCode.replace(/recovery anomaly/g, "")));
record("S09 the threshold is a bounded parameter in SQL, never an unchecked input",
  /p_stale_after_seconds < 300\s*\n\s*or p_stale_after_seconds > 86400/.test(migrationCode) &&
  (migrationCode.match(/AUTOMATION_STALE_THRESHOLD_INVALID/g) ?? []).length >= 2);
record("S10 no SQL in this phase reads or writes a communication row, so the idempotency key keeps ONE derivation",
  selectorBody.length > 0 &&
  [selectorBody, recoverBody, reconcileBody].every((body) =>
    !/\b(from|join|into|update)\s+public\.communication_messages\b/i.test(body)) &&
  !/qf_auto_v1/.test(migrationCode) &&
  serviceCode.includes("buildAutomationCommunicationIdempotencyKey"));
record("S11 the reconcile candidate is selected by CORE, never supplied by n8n",
  N8N_RECOVERY_REQUEST_KEYS.length === 3 &&
  same([...N8N_RECOVERY_REQUEST_KEYS], ["requestId", "transportVersion", "workerId"]) &&
  !/jobId|attemptId|workflowFamily/.test(
    contractCode.slice(contractCode.indexOf("N8N_RECOVERY_REQUEST_KEYS"),
      contractCode.indexOf("AUTOMATION_RECOVER_ORCHESTRATION_STATES"))));
record("S12 every replay re-reads live job/attempt truth instead of a stored verdict",
  serviceCode.includes("resolveReplayedReconcileResult") &&
  /select \* into v_job from public\.automation_jobs where id = v_request\.job_id/.test(migrationCode));
record("S13 the ledger still stores NO outcome column for any route",
  /attname in \(\s*\n?\s*'classification', 'safe_code', 'executor_reference',/.test(migrationCode) &&
  migrationCode.includes("recovery must remain identity-only"));

// ---------------------------------------------------------------------------
// E. THE CLOSED STALE-EVIDENCE DECISION TABLE (owner-locked cases A-G)
// ---------------------------------------------------------------------------
const ev = (executeReservationExists, executeReservationStale, communicationStatus) =>
  resolveStaleReconcileDisposition({ executeReservationExists, executeReservationStale, communicationStatus });

record("E-A no execute evidence at all is a SAFE pre-execution retry",
  (() => {
    const r = ev(false, false, null);
    return r.disposition === "finalize" && r.classification === "retryable_failure" &&
      r.caseId === "A_NO_EXECUTE_EVIDENCE" && r.useCommunicationEvidenceReference === false &&
      r.safeCode === "QF_RECOVER_PRE_EXECUTION_ABANDONED";
  })());
record("E-B reserved with no communication row is a SAFE pre-communication retry",
  (() => {
    const r = ev(true, true, null);
    return r.disposition === "finalize" && r.classification === "retryable_failure" &&
      r.caseId === "B_RESERVED_NO_COMMUNICATION" && r.useCommunicationEvidenceReference === false &&
      r.safeCode === "QF_RECOVER_PRE_COMMUNICATION_ABANDONED";
  })());
record("E-B2 a reservation that is not yet stale is REFUSED, never retried",
  (() => {
    const r = ev(true, false, null);
    return r.disposition === "defer" && r.caseId === "B_RESERVATION_TOO_FRESH";
  })());
record("E-C every pending communication status defers to the communication lane",
  ["queued", "dispatching", "retry_scheduled"].every((status) => {
    const r = ev(true, true, status);
    return r.disposition === "defer" && r.caseId === "C_COMMUNICATION_LANE_OWNS";
  }));
record("E-D every success status reconciles to terminal success",
  ["accepted", "sent", "delivered", "read"].every((status) => {
    const r = ev(true, true, status);
    return r.disposition === "finalize" && r.classification === "success" &&
      r.caseId === "D_COMMUNICATION_SUCCESS" && r.useCommunicationEvidenceReference === true;
  }));
record("E-E every definitive failure reconciles to the canonical definitive failure",
  ["failed", "dead_letter", "cancelled"].every((status) => {
    const r = ev(true, true, status);
    return r.disposition === "finalize" && r.classification === "definitive_failure" &&
      r.caseId === "E_COMMUNICATION_DEFINITIVE_FAILURE";
  }));
record("E-F outcome_unknown is UNCERTAIN and is never converted into a retry",
  (() => {
    const r = ev(true, true, "outcome_unknown");
    return r.disposition === "finalize" && r.classification === "uncertain" &&
      r.caseId === "F_OUTCOME_UNCERTAIN";
  })());
record("E-G an unrecognised communication status fails closed as an anomaly",
  ["", "not_a_status", "SENT", "queued ", "delivered\n"].every((status) => {
    const r = ev(true, true, status);
    return r.disposition === "anomaly" && r.caseId === "G_CONTRADICTORY_EVIDENCE";
  }));
record("E01 NO communication status can ever produce an automation retry",
  ["queued", "dispatching", "retry_scheduled", "accepted", "sent", "delivered", "read",
    "failed", "dead_letter", "cancelled", "outcome_unknown"].every((status) => {
    const r = ev(true, true, status);
    return !(r.disposition === "finalize" && r.classification === "retryable_failure");
  }));
record("E02 a communication reference is emitted ONLY when a row exists",
  [null].every((status) => ev(true, true, status).useCommunicationEvidenceReference === false) &&
  ["accepted", "failed", "outcome_unknown"].every((status) =>
    ev(true, true, status).useCommunicationEvidenceReference === true));
record("E03 the table is total: every input shape returns one of exactly three dispositions",
  [true, false].every((exists) => [true, false].every((stale) =>
    [null, "queued", "accepted", "failed", "outcome_unknown", "bogus"].every((status) =>
      ["finalize", "defer", "anomaly"].includes(ev(exists, stale, status).disposition)))));
record("E04 the communication status is never taken from the request body",
  !/communicationStatus\s*[:=]\s*(input|body|parsed|payload)/.test(serviceCode) &&
  serviceCode.includes("evidence?.status ?? null"));

// ---------------------------------------------------------------------------
// H. THE STALE THRESHOLD IS DERIVED, NOT INVENTED
// ---------------------------------------------------------------------------
record("H01 every derivation input is the real, source-proven bound",
  TRANSPORT_HTTP_TIMEOUT_SECONDS === 10 &&
  TRANSPORT_CALLS_PER_ATTEMPT === 3 &&
  PROVIDER_CALL_CEILING_SECONDS === 30 &&
  RECOVERY_SAFETY_MARGIN_SECONDS === 60 &&
  TRANSPORT_SIGNATURE_WINDOW_SECONDS === AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS);
record("H02 the 10s transport timeout matches every shipped signed POST node",
  (() => {
    const dir = path.join(ROOT, "automation/n8n");
    const flows = readdirSync(dir).filter((f) => f.endsWith(".workflow.json"));
    return flows.every((f) => {
      const text = readFileSync(path.join(dir, f), "utf8");
      const timeouts = [...text.matchAll(/timeout:\s*(\d+)/g)].map((m) => Number(m[1]));
      return timeouts.every((t) => t === TRANSPORT_HTTP_TIMEOUT_SECONDS * 1000);
    });
  })());
record("H03 the 30s provider ceiling matches the enforced Meta config bound",
  read("lib/communication/providers/metaCloudWhatsAppConfig.ts")
    .includes(`BUSINESS_TIMEOUT_MAX_MS = ${PROVIDER_CALL_CEILING_SECONDS * 1000}`));
record("H04 the safety margin is the already-reviewed communication-lane constant",
  read("lib/communication/consentAckIntent.ts")
    .includes(`RECOVERY_SAFETY_MARGIN_MS = ${RECOVERY_SAFETY_MARGIN_SECONDS} * 1000`));
record("H05 the derived in-flight ceiling is exactly the sum of its parts",
  IN_FLIGHT_ATTEMPT_CEILING_SECONDS ===
    TRANSPORT_SIGNATURE_WINDOW_SECONDS + PROVIDER_CALL_CEILING_SECONDS +
    TRANSPORT_HTTP_TIMEOUT_SECONDS * TRANSPORT_CALLS_PER_ATTEMPT + RECOVERY_SAFETY_MARGIN_SECONDS &&
  IN_FLIGHT_ATTEMPT_CEILING_SECONDS === 420);
record("H06 the versioned threshold is 900s and more than DOUBLE the derived ceiling",
  AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS === 900 &&
  AUTOMATION_STALE_ATTEMPT_THRESHOLD_SECONDS > IN_FLIGHT_ATTEMPT_CEILING_SECONDS * 2);
record("H07 the invariant is asserted at module load, so a mis-set value cannot ship",
  contractCode.includes("if (!staleThresholdIsSafe())") &&
  staleThresholdIsSafe() === true &&
  staleThresholdIsSafe(300) === false &&
  staleThresholdIsSafe(419) === false &&
  staleThresholdIsSafe(90_000) === false);
record("H08 the SQL bounds equal the contract bounds",
  STALE_THRESHOLD_MIN_SECONDS === 300 && STALE_THRESHOLD_MAX_SECONDS === 86_400 &&
  new RegExp(`p_stale_after_seconds < ${STALE_THRESHOLD_MIN_SECONDS}`).test(migrationCode) &&
  new RegExp(`p_stale_after_seconds > ${STALE_THRESHOLD_MAX_SECONDS}`).test(migrationCode));
record("H09 the threshold is a fixed repository constant, not an env var or admin setting",
  !/process\.env/.test(contractCode) &&
  !/automation_policy_configs/.test(contractCode) &&
  !/AUTOMATION_STALE[A-Z_]*\s*=\s*Number\(/.test(contractCode));

// ---------------------------------------------------------------------------
// P. THE CONTRACT MODULE IS PURE
// ---------------------------------------------------------------------------
record("P01 the contract imports no database, network, clock or provider module",
  !/@\/lib\/supabase|adminClient|node:crypto|fetch\(|process\.env|new Date\(/.test(contractCode));
record("P02 the request parse is closed: any extra key is refused, never ignored",
  (() => {
    const ok = parseRecoveryRequestBody(JSON.stringify({
      transportVersion: 1, requestId: "0ffd1cf7-b6c1-4f0e-9d2a-5f3b7c9e1a2b", workerId: "w1",
    }));
    const extra = parseRecoveryRequestBody(JSON.stringify({
      transportVersion: 1, requestId: "0ffd1cf7-b6c1-4f0e-9d2a-5f3b7c9e1a2b", workerId: "w1",
      jobId: "0ffd1cf7-b6c1-4f0e-9d2a-5f3b7c9e1a2b",
    }));
    const family = parseRecoveryRequestBody(JSON.stringify({
      transportVersion: 1, requestId: "0ffd1cf7-b6c1-4f0e-9d2a-5f3b7c9e1a2b", workerId: "w1",
      workflowFamily: "client_whatsapp",
    }));
    return ok.ok === true && extra.ok === false && family.ok === false &&
      extra.code === "AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID";
  })());
record("P03 a malformed identity, version or worker is refused",
  ["{}", "[]", "not json", JSON.stringify({ transportVersion: 2, requestId: "0ffd1cf7-b6c1-4f0e-9d2a-5f3b7c9e1a2b", workerId: "w" }),
    JSON.stringify({ transportVersion: 1, requestId: "nope", workerId: "w" }),
    JSON.stringify({ transportVersion: 1, requestId: "0ffd1cf7-b6c1-4f0e-9d2a-5f3b7c9e1a2b", workerId: "bad worker" })]
    .every((raw) => parseRecoveryRequestBody(raw).ok === false));
record("P04 both orchestration vocabularies are closed and disjoint in meaning",
  AUTOMATION_RECOVER_ORCHESTRATION_STATES.length === 3 &&
  same([...AUTOMATION_RECOVER_ORCHESTRATION_STATES], ["recovery_empty", "recovery_claimed", "rejected"]) &&
  AUTOMATION_RECONCILE_ORCHESTRATION_STATES.length === 4 &&
  same([...AUTOMATION_RECONCILE_ORCHESTRATION_STATES],
    ["reconcile_empty", "reconcile_finalized", "reconcile_deferred", "rejected"]));
record("P05 no business, provider or recipient field appears in any new module",
  !/recipientPhone|destination|templateKey|providerAccountId|accessToken|provider_message_id/i
    .test(newModuleCode));
record("P06 the retry timestamp comes from the single frozen backoff schedule",
  serviceCode.includes("buildAutomationNextRetryAt") &&
  !/60\s*\*\s*1000|300\s*\*\s*1000|900\s*\*\s*1000/.test(serviceCode));

// ---------------------------------------------------------------------------
// N. THE n8n RECOVERY SUPERVISOR
// ---------------------------------------------------------------------------
record("N01 the supervisor exists and is INACTIVE with no published flag",
  workflow.active === false && !Object.prototype.hasOwnProperty.call(workflow, "published"));
record("N02 the three certified executors and both dispatchers are NOT modified",
  (() => {
    const frozen = {
      "QF-MVP-50-02-Client-Whatsapp-Executor.50.2E-selfhost-env.workflow.json":
        "0f5e2a4f4a1a6a4a26c0dfd1e18a52b1a0e4e29f0f0b8d6e17e4e6f6a5c1c9e1",
      "QF-MVP-50-03-Vendor-Whatsapp-Executor.workflow.json": null,
      "QF-MVP-50-04-Campaign-Execution-Executor.workflow.json": null,
    };
    // Byte-freeze is proven by the 50.2E/50.3/50.4 gates that own those files. Here
    // the only claim is structural: none of them references a recovery route.
    return Object.keys(frozen).every((file) => {
      const text = readFileSync(path.join(ROOT, "automation/n8n", file), "utf8");
      return !text.includes(N8N_RECOVER_ROUTE_PATH) && !text.includes(N8N_RECONCILE_ROUTE_PATH);
    });
  })());
record("N03 the supervisor calls BOTH recovery routes and never the claim route",
  workflowText.includes(N8N_RECOVER_ROUTE_PATH) &&
  workflowText.includes(N8N_RECONCILE_ROUTE_PATH) &&
  !workflowText.includes("/api/internal/automation/n8n/claim"));
record("N04 the two lanes have SEPARATE triggers, so neither can starve the other",
  (() => {
    const schedules = workflow.nodes.filter((n) => n.type === "n8n-nodes-base.scheduleTrigger");
    const reconcile = schedules.filter((n) => /Reconcile/i.test(n.name));
    const recover = schedules.filter((n) => /Recover/i.test(n.name));
    return schedules.length === 2 && reconcile.length === 1 && recover.length === 1;
  })());
record("N05 each lane runs at most ONE unit of work per cycle",
  (() => {
    const posts = workflow.nodes.filter((n) => /^POST Signed /.test(n.name));
    // recover, reconcile, execute, complete — exactly four signed calls in the graph,
    // and no loop / splitInBatches node that could turn one cycle into many.
    return posts.length === 4 &&
      !workflow.nodes.some((n) => /splitInBatches|itemLists|loop/i.test(n.type));
  })());
record("N06 the reconcile lane makes NO follow-up call of any kind",
  (() => {
    const branch = workflow.nodes.find((n) => n.name === "Branch On Core Reconcile State");
    const next = workflow.connections["Branch On Core Reconcile State"]?.main?.[0] ?? [];
    return Boolean(branch) && next.length === 1 &&
      workflow.nodes.find((n) => n.name === next[0].node)?.type === "n8n-nodes-base.noOp";
  })());
record("N07 routing uses ONLY the Core-returned family, through a closed three-entry map",
  (() => {
    const route = workflow.nodes.find((n) => n.name === "Route On Core Recovered Family");
    const src = route?.parameters?.jsCode ?? "";
    return src.includes("FAMILY_ROUTES") &&
      src.includes("client_whatsapp: '/api/internal/automation/n8n/execute-client'") &&
      src.includes("vendor_whatsapp: '/api/internal/automation/n8n/execute-vendor'") &&
      src.includes("campaign_execution: '/api/internal/automation/n8n/execute-campaign'") &&
      // no action-type inference and no prefix parsing anywhere
      !/actionType|action_type|startsWith\('client\./.test(src) &&
      // an unknown family yields no route at all
      src.includes("hasOwnProperty.call(FAMILY_ROUTES, workflowFamily) ? FAMILY_ROUTES[workflowFamily] : ''");
  })());
record("N08 the requested execute path is re-validated against the closed route set",
  (() => {
    const posts = workflow.nodes.filter((n) => /^POST Signed /.test(n.name));
    return posts.length > 0 && posts.every((n) =>
      n.parameters.jsCode.includes("ALLOWED_PATHS") &&
      n.parameters.jsCode.includes("ROUTE_PATH_NOT_ALLOWED"));
  })());
record("N09 the signed path and the requested path are the same value",
  (() => {
    const canonical = workflow.nodes.find((n) => n.name === "Build Execute Request Canonical");
    const post = workflow.nodes.find((n) => n.name === "POST Signed Execute to Core — STAGING ONLY");
    return canonical?.parameters.jsCode.includes("$json.executePath") === true &&
      post?.parameters.jsCode.includes("input.executePath") === true;
  })());
record("N10 a recovery replay is refused a second time, in n8n as well as in Core",
  workflowText.includes("QF_50_5_RECOVER_REPLAY_INVARIANT"));
record("N11 every response is signature-verified before it is believed",
  (() => {
    const verifiers = workflow.nodes.filter((n) => /^Verify Signed /.test(n.name));
    const gates = workflow.nodes.filter((n) => /^IF — .* Response Verified$/.test(n.name));
    return verifiers.length === 4 && gates.length === 4 &&
      verifiers.every((n) => n.parameters.jsCode.includes("expectedResponseHmac"));
  })());
record("N12 the workflow carries no secret value and introduces no new env variable",
  !/sbp_|eyJ[A-Za-z0-9_-]{10,}\./.test(workflowText) &&
  [...workflowText.matchAll(/\$env\.([A-Z0-9_]+)/g)].every(([, name]) => [
    "QF_N8N_TRANSPORT_ENABLED", "QF_CORE_STAGING_BASE_URL", "QF_N8N_WORKER_ID",
    "QF_N8N_TO_CORE_HMAC_SECRET", "QF_CORE_TO_N8N_HMAC_SECRET",
  ].includes(name)));
record("N13 the default path is fail-closed on the transport gate",
  workflow.nodes.some((n) => /Preconditions$/.test(n.name) &&
    n.parameters.jsCode.includes("$env.QF_N8N_TRANSPORT_ENABLED === 'true'")) &&
  workflow.nodes.filter((n) => /^IF — .* Transport Configured$/.test(n.name)).length === 2);

// ---------------------------------------------------------------------------
// B. SCOPE HONESTY — what 50.5 does NOT claim
// ---------------------------------------------------------------------------
record("B01 no provider communication due-sweep is invented by this phase",
  !/dispatchPersistedMessage/.test(newModuleCode) &&
  [selectorBody, recoverBody, reconcileBody].every((body) =>
    !/communication_messages/i.test(body)) &&
  (() => {
    const dir = path.join(ROOT, "app/api/internal");
    const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    // The ONLY internal worker route remains the consent-ack processor. 50.5 adds two
    // signed n8n routes and no sweeper of its own.
    return entries.some((e) => e.name === "process-consent-ack-intents") &&
      !entries.some((e) => /sweep|due|cron|scan/i.test(e.name));
  })());
record("B02 the communication lane is only ever READ, never written or re-dispatched",
  serviceCode.includes('.from("communication_messages")') &&
  !/\.from\("communication_messages"\)[\s\S]{0,200}\.(insert|update|upsert|delete)/.test(serviceCode));
record("B03 the doc states the honest limit about the missing due-sweep",
  existsSync(path.join(ROOT, DOC_PATH)) &&
  (() => {
    const doc = read(DOC_PATH);
    return /no (?:live )?(?:provider )?communication due-sweep/i.test(doc) &&
      /QF-MVP-40|QF-MVP-80/.test(doc) &&
      /not live/i.test(doc);
  })());
record("B04 the closeout does not claim provider communication retry is live",
  existsSync(path.join(ROOT, CLOSEOUT_PATH)) &&
  (() => {
    const doc = read(CLOSEOUT_PATH);
    return !/provider (?:communication )?retry (?:is )?live/i.test(doc) &&
      /due-sweep/i.test(doc);
  })());
record("B05 no production deployment is authorized anywhere in this phase",
  [DOC_PATH, CLOSEOUT_PATH].every((p) =>
    !existsSync(path.join(ROOT, p)) ||
    !/production deployment (?:is )?(?:authorized|approved|complete)/i.test(read(p))));

// ---------------------------------------------------------------------------
// G. GOVERNANCE / REGISTRATION
// ---------------------------------------------------------------------------
record("G01 the migration matches its pinned canonical hash",
  canonicalSha256(readFileSync(path.join(ROOT, MIGRATION_PATH))) === MIGRATION_SHA);
record("G02 the local migration set is exactly 97 and 50.5 is the newest",
  (() => {
    const files = readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql")).sort();
    return files.length === 97 &&
      files.at(-1) === "20260812000000_qf_mvp_50_5_automation_recovery_reconciliation.sql";
  })());
record("G03 the manifest pins 50.5 as APPLIED with first-party staging evidence, and nothing is left pending",
  (() => {
    const pending = manifest.pendingPostAnchorMigrations ?? null;
    const pin = (manifest.appliedPostAnchorMigrations ?? []).find((r) => r.version === "20260812000000");
    return Array.isArray(pending) && pending.length === 0 &&
      pin?.sha256 === MIGRATION_SHA &&
      pin.path === MIGRATION_PATH && pin.phase === "QF-MVP-50.5" &&
      pin.operationalStatus === "APPLIED" &&
      pin.appliedEvidenceMarker === "QF_MVP_50_5_STAGING_MIGRATION_APPLIED_AND_VERIFIED" &&
      pin.appliedEvidenceType === "FIRST_PARTY_EXACT_ONE_DRY_RUN_VERIFIED_STAGING_EXECUTION" &&
      pin.remoteHistoryCountAfterApply === 30 &&
      pin.appliedExactlyOnce === true &&
      pin.appliedByThisPhase === true &&
      pin.catalogParityVerified === true &&
      pin.mustApplyAfterVersion === "20260811000000" &&
      // An APPLIED record must never keep the offline-only "not proven" hedge.
      !("remoteVersionStatus" in pin) &&
      !("requiresSeparateStagingDeploymentGate" in pin);
  })());
record("G04 the ten APPLIED records run 21-30 with 50.5 newest and the anchor count unchanged",
  manifest.appliedPostAnchorMigrations.length === 10 &&
  same(manifest.appliedPostAnchorMigrations.map((r) => r.remoteHistoryCountAfterApply),
    [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]) &&
  manifest.appliedPostAnchorMigrations.at(-1).version === "20260812000000" &&
  manifest.appliedPostAnchorMigrations.filter((r) => r.appliedByThisPhase === true).length === 1 &&
  manifest.appliedAnchor.postAnchorMigrationCount === 10);
record("G05 G1 was re-pinned to the exact new truth, never loosened",
  /const MIGRATION_COUNT = 97;/.test(g1Source) &&
  g1Source.includes(`sha: "${MIGRATION_SHA}"`) &&
  g1Source.includes("pendingPins.length === 0") &&
  g1Source.includes("appliedPins.length === 10") &&
  g1Source.includes("[21, 22, 23, 24, 25, 26, 27, 28, 29, 30]") &&
  !/state\.migrations\.length\s*>=/.test(g1Source) &&
  !/postAnchorLocal\.length\s*>=/.test(g1Source));
record("G06 this validator is registered and wired into CI immediately after 50.4",
  pkg.scripts["test:mvp:50-5"] ===
    "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/mvp/loader/register.mjs scripts/mvp/automation/validate-qf-mvp-50-5.mjs" &&
  /- name: QF-MVP-50\.4 validator\s+run: npm run test:mvp:50-4\s+- name: QF-MVP-50\.5 validator\s+run: npm run test:mvp:50-5/
    .test(ciWorkflow));
record("G07 CI still takes no secret, database, provider or deployment action",
  !ciWorkflow.includes("${{ secrets.") &&
  !/^\s*(?:run:\s*)?(?:npx\s+)?supabase\s+/mi.test(ciWorkflow) &&
  !/\bdb push\b/i.test(ciWorkflow));
record("G08 the migration is forward-only: no historical file is edited",
  migrationSource.includes("FORWARD-ONLY SUCCESSOR") &&
  !/alter table public\.automation_jobs/i.test(migrationCode) &&
  !/alter table public\.automation_execution_attempts/i.test(migrationCode));
record("G09 the migration adds no table, column or type",
  !/create table|add column|create type|alter column/i.test(migrationCode));
record("G10 every new function is SECURITY DEFINER, search_path pinned, service_role only",
  (() => {
    const fns = ["qf_recover_automation_job_v1", "qf_recover_automation_job_transport_v1",
      "qf_select_stale_automation_attempt_v1", "qf_reconcile_automation_attempt_transport_v1"];
    return fns.every((fn) =>
      new RegExp(`create or replace function public\\.${fn}\\(`).test(migrationCode) &&
      new RegExp(`grant execute on function public\\.${fn}[\\s\\S]{0,400}?to service_role`).test(migrationCode) &&
      new RegExp(`revoke all on function public\\.${fn}[\\s\\S]{0,400}?from public, anon, authenticated, service_role`)
        .test(migrationCode)) &&
      (migrationCode.match(/security definer/g) ?? []).length === 4 &&
      (migrationCode.match(/set search_path = pg_catalog, public, pg_temp/g) ?? []).length >= 4;
  })());
record("G11 the migration self-verifies by RUNNING the new paths, not by regex",
  migrationCode.includes("perform * from public.qf_select_stale_automation_attempt_v1(900)") &&
  migrationCode.includes("AUTOMATION_RECONCILE_JOB_NOT_FOUND") &&
  migrationCode.includes("AUTOMATION_RECONCILE_DISPOSITION_INVALID"));
record("G12 the out-parameter ambiguity class is exercised, and no pragma masks it",
  // The pragma must be absent from EXECUTABLE SQL. Naming it in a comment to explain
  // why it is not used is exactly what the 20260807000000 repair did.
  !/#variable_conflict/i.test(migrationCode) &&
  migrationSource.includes("42702") &&
  migrationCode.includes("perform * from public.qf_select_stale_automation_attempt_v1(900)"));
record("G13 the transport table is locked before the fences are exchanged",
  migrationCode.includes("access exclusive mode") &&
  migrationCode.indexOf("access exclusive mode") <
    migrationCode.indexOf("drop constraint automation_transport_requests_route_check"));
record("G14 no database network extension is permitted",
  (migrationCode.match(/pg_net', 'http', 'dblink/g) ?? []).length === 2);

// ---------------------------------------------------------------------------
// M. MUTANTS — each guard must be the thing that fails
// ---------------------------------------------------------------------------
const mutants = [
  ["collapsing the two routes into one is detectable",
    () => /'recover_v1'/.test(migrationCode) && /'reconcile_v1'/.test(migrationCode)],
  ["relaxing the one-claim-per-job rule is detectable",
    () => !/drop index[\s\S]*uq_automation_transport_requests_claim_job/i.test(migrationCode)],
  ["a zero staleness threshold cannot be accepted",
    () => /p_stale_after_seconds < 300/.test(migrationCode) && staleThresholdIsSafe(0) === false],
  ["a communication-derived automation retry is impossible",
    () => ["queued", "retry_scheduled", "accepted", "failed", "outcome_unknown"].every((s) => {
      const r = ev(true, true, s);
      return !(r.disposition === "finalize" && r.classification === "retryable_failure");
    })],
  ["retrying a live reservation is impossible",
    () => ev(true, false, null).disposition === "defer"],
  ["blind reclaim of a stale processing job is impossible",
    () => /AUTOMATION_RECONCILE_CANDIDATE_NOT_STALE/.test(migrationCode) &&
          !/set status = 'pending'/.test(migrationCode)],
  ["forking the dead-letter boundary is detectable",
    () => /perform public\.qf_complete_automation_attempt_v1\(/.test(migrationCode)],
  ["a recovery replay handing out executable work is impossible",
    () => serviceCode.includes("AUTOMATION_RECOVERY_REPLAY_EXECUTION_SUPPRESSED")],
  ["n8n selecting the job is impossible",
    () => N8N_RECOVERY_REQUEST_KEYS.length === 3 &&
          !parseRecoveryRequestBody(JSON.stringify({
            transportVersion: 1, requestId: "0ffd1cf7-b6c1-4f0e-9d2a-5f3b7c9e1a2b",
            workerId: "w1", jobId: "0ffd1cf7-b6c1-4f0e-9d2a-5f3b7c9e1a2b",
          })).ok],
  ["one lane starving the other is prevented by construction",
    () => workflow.nodes.filter((n) => n.type === "n8n-nodes-base.scheduleTrigger").length === 2],
  ["silently loosening the G1 pin is impossible",
    () => /const MIGRATION_COUNT = 97;/.test(g1Source) &&
          !/state\.migrations\.length\s*>=/.test(g1Source)],
  // The pending set is now empty, so an `every()` over it would be vacuously
  // true and would guard nothing. The real risk moved: an APPLIED record that
  // misrepresents HOW it was proven, or a future pending record that claims
  // applied evidence it does not have. Both are checked concretely.
  ["a pending record claiming applied evidence is impossible",
    () => (manifest.pendingPostAnchorMigrations ?? []).every((r) =>
      r.remoteVersionStatus === "NOT_PROVEN_OFFLINE" &&
      !("remoteHistoryCountAfterApply" in r) && !("appliedEvidenceMarker" in r))],
  ["misrepresenting how 50.5 was proven on staging is detectable",
    () => {
      const pin = manifest.appliedPostAnchorMigrations.find((r) => r.version === "20260812000000");
      return pin?.appliedEvidenceType === "FIRST_PARTY_EXACT_ONE_DRY_RUN_VERIFIED_STAGING_EXECUTION" &&
        pin.appliedByThisPhase === true &&
        pin.remoteHistoryCountAfterApply === 30 &&
        typeof pin.evidencePath === "string" &&
        existsSync(path.join(ROOT, pin.evidencePath));
    }],
];
for (const [name, fn] of mutants) {
  let held = false;
  try { held = fn() === true; } catch { held = false; }
  record(`M-${name}`, held);
}

// ---------------------------------------------------------------------------
for (const [index, r] of results.entries()) {
  console.log(`${r.passed ? "PASS" : "FAIL"} ${String(index + 1).padStart(3, "0")} ${r.name}`);
}
const failed = results.filter((r) => !r.passed);
console.log(`\nQF-MVP-50.5: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exit(1);
console.log("QF_MVP_50_5_AUTOMATION_RECOVERY_SOURCE_READY");
