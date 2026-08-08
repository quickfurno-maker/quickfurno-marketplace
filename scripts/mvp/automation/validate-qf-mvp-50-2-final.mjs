#!/usr/bin/env node
// ============================================================================
// QF-MVP-50.2 FINAL CLOSURE — atomic client automation producer validator
//
// OFFLINE ONLY. No database, no network, no provider, no n8n, no Jarvis.
//
// This gate freezes the closure contract: a DB-native same-transaction producer,
// the six owner-approved trigger policies, the execution-time eligibility
// reproof, the QF-MVP-50.5 recovery boundary and the QF-MVP-40/80 live-provider
// boundary.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLIENT_AUTOMATION_ACTION_TYPES,
  CLIENT_DISPATCH_REGISTRY,
} from "../../../lib/automation/clientDispatchRegistry.ts";
import {
  COMMUNICATION_EXECUTION_PARTITION,
  PRE_COMMUNICATION_FAILURE_RULINGS,
  resolvePreCommunicationRuling,
} from "../../../lib/automation/clientExecutionContract.ts";
import { COMMUNICATION_MESSAGE_STATUSES } from "../../../lib/communication/types.ts";
import { AUTOMATION_RESULT_CLASSIFICATIONS } from "../../../lib/automation/actionContract.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const canonicalSha256 = (buf) =>
  sha256(Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stripSql = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const MIGRATION_NAME = "20260806000000_qf_mvp_50_2_atomic_client_automation_producer.sql";
const MIGRATION_PATH = `supabase/migrations/${MIGRATION_NAME}`;
const MIGRATION_SHA = "ce947a6f8d7dd42d2851f6c99eba4bf2ef39308b8d85ff876260d575185a3cfb";
const R2_APPLIED_MARKER = "QF_MVP_50_2_FINAL_R2_STAGING_MIGRATION_APPLIED_AND_VERIFIED";
const ATOMIC_PRODUCER_MARKER = "QF_MVP_50_2_ATOMIC_PRODUCER_STAGING_CERTIFIED";
// Not earned yet. Orchestration certification is a separate, later gate; these
// two markers must NOT appear in source until a real n8n runtime has executed
// the merged workflow against QuickFurno staging.
const N8N_CERTIFIED_MARKER = "QF_MVP_50_2_CLIENT_N8N_STAGING_CERTIFIED";
const STAGING_COMPLETE_MARKER = "QF_MVP_50_2_STAGING_CERTIFICATION_COMPLETE";

const migrationSource = read(MIGRATION_PATH);
const sql = stripSql(migrationSource);
const executionSource = read("services/automationClientExecutionService.ts");
const executionCode = stripJs(executionSource);
const contractSource = read("lib/automation/clientExecutionContract.ts");
const leadServiceCode = stripJs(read("services/leadService.ts"));
const adminServiceCode = stripJs(read("services/adminService.ts"));
const clarificationCode = stripJs(read("services/leadClarificationService.ts"));
const matchingCode = stripJs(read("services/leadMatchingEngine.ts"));
const manifestText = read("supabase/staging-history/qf-mvp-staging-history-manifest.json");
const manifest = JSON.parse(manifestText);
const ciWorkflow = read(".github/workflows/qf-mvp-50-quality-gate.yml");
const pkg = JSON.parse(read("package.json"));
const doc = read("docs/QF-MVP-50-2-FINAL-CLOSURE.md");
const g1Source = read("scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs");
const producerPin = manifest.appliedPostAnchorMigrations
  .find((r) => r.version === "20260806000000");

/** Only the `perform ... qf_enqueue_client_automation_v1(<action>` call sites — the
 *  action allowlist inside the primitive mentions every action and must not be counted. */
const enqueueCallsFor = (action) => {
  const pattern = "perform public\\.qf_enqueue_client_automation_v1\\(\\s*'"
    + action.replace(/\./g, "\\.") + "'";
  return (sql.match(new RegExp(pattern, "g")) ?? []).length;
};

/** Ordering must be judged inside a function body: a top-of-file import would
 *  otherwise satisfy "X appears before Y" for free. */
const bodySlice = (src, start, end) => {
  const i = src.indexOf(start);
  if (i === -1) return "";
  const j = src.indexOf(end, i + start.length);
  return src.slice(i, j === -1 ? src.length : j);
};
const executeBody = bodySlice(
  executionCode,
  "export async function executeClientAutomationForN8nTransport",
  "\nfunction evidenceResult",
);
const intentBody = bodySlice(
  executionCode,
  "async function buildClientCommunicationIntent",
  "\ninterface LeadFacts",
);

const results = [];
const record = (name, passed, detail = "") =>
  results.push({ name, passed: Boolean(passed), detail });

// ---------------------------------------------------------------------------
// P. THE ATOMIC PRODUCER EXISTS AND IS DB-NATIVE
// ---------------------------------------------------------------------------
record("P01 the producer migration exists at its pinned hash",
  existsSync(path.join(ROOT, MIGRATION_PATH)) &&
  canonicalSha256(readFileSync(path.join(ROOT, MIGRATION_PATH))) === MIGRATION_SHA);
record("P02 the atomic enqueue primitive is declared",
  /create or replace function public\.qf_enqueue_client_automation_v1\(/.test(sql));
record("P03 request, authorize and job all happen inside the one function body",
  /qf_create_automation_action_request_v1\(/.test(sql) &&
  /qf_decide_automation_action_request_v1\(/.test(sql) &&
  /qf_create_automation_job_v1\(/.test(sql));
record("P04 the primitive is SECURITY DEFINER with a pinned search_path",
  /create or replace function public\.qf_enqueue_client_automation_v1[\s\S]{0,400}?security definer[\s\S]{0,120}?set search_path = pg_catalog, public, pg_temp/.test(sql));
record("P05 execute is granted to service_role only",
  /revoke all on function public\.qf_enqueue_client_automation_v1[\s\S]{0,160}?from public, anon, authenticated, service_role/.test(sql) &&
  /grant execute on function public\.qf_enqueue_client_automation_v1[\s\S]{0,160}?to service_role/.test(sql) &&
  !/grant [^\n]*to (public|anon|authenticated)/i.test(sql));
record("P06 the producer adds NO table, column, type or index",
  !/create table/i.test(sql) && !/add column/i.test(sql) &&
  !/create (unique )?index/i.test(sql) && !/alter table/i.test(sql) &&
  !/create type/i.test(sql));
record("P07 the enqueue primitive accepts no business-authority input",
  (() => {
    const sig = sql.match(/qf_enqueue_client_automation_v1\(([\s\S]*?)\)\s*returns/);
    if (!sig) return false;
    const params = sig[1];
    return /p_action_type text/.test(params) && /p_lead_id uuid/.test(params) &&
      /p_source_event_key text/.test(params) && /p_available_at timestamptz/.test(params) &&
      !/recipient|phone|email|template|provider|consent|classification|safe_code|retry/i.test(params);
  })());
record("P08 the action allowlist inside the primitive is exactly the six",
  CLIENT_AUTOMATION_ACTION_TYPES.every((a) => sql.includes(`'${a}'`)) &&
  !/vendor\.|campaign\./.test(sql));
record("P09 entity is hard-coded to lead, never caller-supplied",
  /'lead',/.test(sql) && !/p_entity_type/.test(sql));
record("P10 dedupe uses the existing qf_action_v1 idempotency convention",
  /'qf_action_v1:'/.test(sql) && /idempotency_key = v_idempotency_key/.test(sql));
record("P11 a replay returns the existing job instead of creating a second",
  /if v_request\.id is not null then[\s\S]{0,400}?return v_job;/.test(sql));
record("P12 the source-event token is a bounded safe identifier",
  /p_source_event_key !~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{0,127\}\$'/.test(sql));

// ---------------------------------------------------------------------------
// T. THE SIX OWNER-APPROVED TRIGGERS
// ---------------------------------------------------------------------------
record("T01 lead confirmation fires on a real lead INSERT",
  /create trigger trg_qf_produce_client_lead_confirmation\s*\n\s*after insert on public\.leads/.test(sql) &&
  /'client\.lead_confirmation',\s*\n\s*new\.id/.test(sql));
record("T02 requirement collection fires on a prepared clarification request",
  /create trigger trg_qf_produce_client_clarification_actions\s*\n\s*after insert on public\.lead_clarification_requests/.test(sql) &&
  /new\.status is distinct from 'preview_prepared'/.test(sql));
record("T03 the reminder is scheduled at exactly +24 hours",
  /'client\.missing_information_reminder',[\s\S]{0,160}?now\(\) \+ interval '24 hours'/.test(sql));
record("T04 exactly ONE reminder per clarification request identity",
  enqueueCallsFor("client.missing_information_reminder") === 1 &&
  /'clarrem' \|\| replace\(new\.id::text/.test(sql));
record("T05 matching update fires only on a real transition INTO matched",
  /after update of run_status on public\.lead_matching_runs/.test(sql) &&
  /when \(old\.run_status is distinct from new\.run_status and new\.run_status = 'matched'\)/.test(sql));
record("T06 status update fires only on a real status transition",
  /after update of status on public\.leads/.test(sql) &&
  /when \(old\.status is distinct from new\.status\)/.test(sql));
record("T07 the follow-up fires only on entry to the exact status Quotation Sent",
  /if new\.status = 'Quotation Sent' then/.test(sql));
record("T08 the follow-up is scheduled at exactly +48 hours",
  /'client\.transactional_followup',[\s\S]{0,200}?now\(\) \+ interval '48 hours'/.test(sql));
record("T09 the per-transition evidence token disambiguates real transitions",
  /md5\(\s*\n?\s*new\.id::text \|\| ':' \|\|[\s\S]{0,200}?txid_current\(\)::text/.test(sql));
record("T10 exactly four producer triggers are created and self-verified",
  (sql.match(/create trigger trg_qf_produce_/g) ?? []).length === 4 &&
  /expected 4 producer triggers/.test(migrationSource));
record("T11 no trigger is attached to a vendor or campaign table",
  !/on public\.(vendors|lead_assignments|vendor_[a-z_]+|campaign[a-z_]*)/.test(sql));

// ---------------------------------------------------------------------------
// A. ATOMICITY AND THE ABSENCE OF A FIRE-AND-FORGET PRODUCER
// ---------------------------------------------------------------------------
record("A01 no TypeScript service calls the automation writers sequentially",
  !/createAutomationActionRequest\(/.test(leadServiceCode + adminServiceCode + clarificationCode + matchingCode) &&
  !/createAutomationJob\(/.test(leadServiceCode + adminServiceCode + clarificationCode + matchingCode));
record("A02 the execution service never produces work either",
  !/createAutomationActionRequest\(|createAutomationJob\(/.test(executionCode));
record("A03 the producer never reaches a provider, n8n or a communication path",
  !/communication_messages|http|pg_net|dblink|n8n|meta|whatsapp/i.test(
    sql.replace(/extname in \('pg_net', 'http', 'dblink'\)/g, "")));
record("A04 the old AOS kernel stays forbidden, not revived",
  /outbox_events/.test(migrationSource) &&
  /a second automation authority must not be bridged/.test(migrationSource) &&
  !/create table[^;]*outbox_events|create table[^;]*domain_events/i.test(sql));
record("A05 no second queue is introduced",
  !/create table/i.test(sql));
record("A06 the existing 50.1B uniqueness remains the dedupe authority",
  /uq_automation_action_requests_idempotency/.test(migrationSource) &&
  /uq_automation_jobs_action_request/.test(migrationSource));

// ---------------------------------------------------------------------------
// E. EXECUTION-TIME BUSINESS ELIGIBILITY REPROOF
// ---------------------------------------------------------------------------
record("E01 the reproof runs inside intent building, before any provider construction",
  // inside the intent builder: eligibility is proven before variables/intent exist
  intentBody.indexOf("proveExecutionTimeEligibility(") > -1 &&
  intentBody.indexOf("proveExecutionTimeEligibility(") < intentBody.indexOf("resolveVariableInput(") &&
  // and intent building itself precedes the runtime communication service in the orchestration
  executeBody.indexOf("buildClientCommunicationIntent(") > -1 &&
  executeBody.indexOf("buildClientCommunicationIntent(") < executeBody.indexOf("createRuntimeCommunicationService("));
record("E02 the reminder revalidates the live clarification requirement",
  /case "client\.missing_information_reminder":[\s\S]{0,900}?clarification_required[\s\S]{0,400}?clarification_status/.test(executionCode));
record("E03 the follow-up revalidates the live Quotation Sent status",
  /case "client\.transactional_followup":[\s\S]{0,300}?lead\.status !== "Quotation Sent"/.test(executionCode));
record("E04 an ineligible action is a bounded terminal non-send, not a provider failure",
  PRE_COMMUNICATION_FAILURE_RULINGS.QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE.classification === "definitive_failure" &&
  PRE_COMMUNICATION_FAILURE_RULINGS.QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE.safeCode === "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" &&
  AUTOMATION_RESULT_CLASSIFICATIONS.includes(
    PRE_COMMUNICATION_FAILURE_RULINGS.QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE.classification));
record("E05 an ineligible action creates no communication row",
  !/\.insert\(|\.upsert\(|\.update\(|\.delete\(/.test(executionCode));
record("E06 n8n never sees or decides business eligibility",
  !/orchestrationState[\s\S]{0,200}?eligib/i.test(executionCode) &&
  /QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE/.test(contractSource));

// ---------------------------------------------------------------------------
// B. FROZEN BOUNDARIES — 50.5 RECOVERY AND 40/80 LIVE PROVIDER
// ---------------------------------------------------------------------------
record("B01 queued, dispatching and retry_scheduled remain pending",
  ["queued", "dispatching", "retry_scheduled"].every((s) => COMMUNICATION_EXECUTION_PARTITION[s] === "pending"));
record("B02 the partition is still total over the closed status vocabulary",
  COMMUNICATION_MESSAGE_STATUSES.every((s) => COMMUNICATION_EXECUTION_PARTITION[s] !== undefined));
record("B03 50.2 introduces no redispatch, due sweep or recovery worker",
  !/dispatchPersistedMessage|dueSweep|due_sweep|reclaimStale|recoveryWorker/i.test(executionCode + sql));
record("B04 the 50.5 recovery boundary is documented",
  /QF-MVP-50\.5/.test(doc) && /recovery/i.test(doc));
record("B05 the 40/80 live-provider boundary is documented and separated",
  /QF-MVP-40/.test(doc) && /QF-MVP-80/.test(doc) &&
  /structural/i.test(doc) && /live/i.test(doc));
record("B06 no provider readiness is fabricated by this package",
  !/send_authority|binding_readiness|APPROVED_UNMAPPED|provider_template_mappings/i.test(sql + executionCode));
record("B07 zero-of-six live readiness truth is still stated",
  /zero of the six/i.test(doc) || /ZERO of six/i.test(doc));

// ---------------------------------------------------------------------------
// S. SIX-ACTION STRUCTURAL MATRIX
// ---------------------------------------------------------------------------
const TRIGGER_MATRIX = {
  "client.lead_confirmation": { template: "lead_received", token: "leadcreated" },
  "client.requirement_collection": { template: "clarification_request", token: "clar" },
  "client.missing_information_reminder": { template: "clarification_reminder", token: "clarrem" },
  "client.matching_update": { template: "client_matching_update", token: "match" },
  "client.lead_status_update": { template: "client_lead_status_update", token: "status" },
  "client.transactional_followup": { template: "client_transactional_followup", token: "qsfu" },
};
record("S01 the frozen action set is still exactly six",
  CLIENT_AUTOMATION_ACTION_TYPES.length === 6 &&
  same([...CLIENT_AUTOMATION_ACTION_TYPES].sort(), Object.keys(TRIGGER_MATRIX).sort()));
for (const [action, spec] of Object.entries(TRIGGER_MATRIX)) {
  record(`S-${action} has a producer trigger and its frozen template intent`,
    sql.includes(`'${action}'`) &&
    sql.includes(`'${spec.token}`) &&
    CLIENT_DISPATCH_REGISTRY[action].templateKey === spec.template &&
    CLIENT_DISPATCH_REGISTRY[action].workflowFamily === "client_whatsapp" &&
    CLIENT_DISPATCH_REGISTRY[action].communicationLane === "business" &&
    CLIENT_DISPATCH_REGISTRY[action].consentScope === "transactional");
}

// ---------------------------------------------------------------------------
// G. GOVERNANCE / SCOPE CONTAINMENT
// ---------------------------------------------------------------------------
// QF-MVP-50.2-R2-APPLIED-TRUTH — the producer migration was applied exactly once
// to QuickFurno staging (remote history 23) by an external owner-reviewed
// execution. This source phase imports that record and applies nothing itself.
// Zero post-anchor migrations remain pending.
record("G01 the producer migration is pinned APPLIED at remote history 23",
  manifest.appliedPostAnchorMigrations.length === 3 &&
  producerPin?.version === "20260806000000" &&
  producerPin?.sha256 === MIGRATION_SHA &&
  producerPin?.operationalStatus === "APPLIED" &&
  producerPin?.appliedEvidenceMarker === R2_APPLIED_MARKER &&
  producerPin?.appliedEvidenceType === "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD" &&
  producerPin?.remoteHistoryCountAfterApply === 23 &&
  producerPin?.appliedExactlyOnce === true &&
  producerPin?.appliedByThisPhase === false &&
  // an applied record must never also carry an un-proven offline remote status
  !("remoteVersionStatus" in (producerPin ?? {})));
record("G01a the pending post-anchor list exists and is exactly empty",
  Array.isArray(manifest.pendingPostAnchorMigrations) &&
  manifest.pendingPostAnchorMigrations.length === 0);
record("G02 the three applied records are 21 / 22 / 23 in exact ascending order",
  same(manifest.appliedPostAnchorMigrations.map((r) => r.remoteHistoryCountAfterApply), [21, 22, 23]) &&
  same(manifest.appliedPostAnchorMigrations.map((r) => r.version),
    ["20260804000000", "20260805000000", "20260806000000"]) &&
  new Set(manifest.appliedPostAnchorMigrations.map((r) => r.appliedEvidenceMarker)).size === 3);
record("G03 post-anchor count and local migration count agree at 3 / 90",
  manifest.appliedAnchor.postAnchorMigrationCount === 3 &&
  readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).length === 90);
record("G03a the G1 staging-history gate was re-pinned to the applied truth, not loosened",
  g1Source.includes(`marker: "${R2_APPLIED_MARKER}"`) &&
  g1Source.includes("remoteHistory: 23") &&
  g1Source.includes("manifest declares exactly three APPLIED post-anchor migrations") &&
  g1Source.includes("the PENDING post-anchor list exists and is exactly empty") &&
  // no `>=`, no wildcard: the count assertions stay exact
  g1Source.includes("appliedPins.length === 3") &&
  g1Source.includes("pendingPins.length === 0"));
record("G03b the atomic producer staging certification is recorded",
  doc.includes(ATOMIC_PRODUCER_MARKER) && doc.includes(R2_APPLIED_MARKER));
// An unearned marker may be NAMED in prose only to disclaim it. It must never
// appear as machine-readable evidence (manifest / G1 pin), and every prose
// sentence carrying it must negate it.
const unearnedIsDisclaimedInProse = (marker) =>
  doc.split(/(?<=\.)\s|\n/)
    .filter((line) => line.includes(marker))
    .every((line) => /\bnot\b|\bno\b|\bnever\b|\buntil\b|\bunearned\b|\bremains? (?:unproven|uncertified)\b/i.test(line));
record("G03c orchestration certification is NOT yet claimed anywhere in source",
  unearnedIsDisclaimedInProse(N8N_CERTIFIED_MARKER) &&
  unearnedIsDisclaimedInProse(STAGING_COMPLETE_MARKER) &&
  // never machine-readable evidence
  !manifestText.includes(N8N_CERTIFIED_MARKER) &&
  !manifestText.includes(STAGING_COMPLETE_MARKER) &&
  !g1Source.includes(N8N_CERTIFIED_MARKER) &&
  !g1Source.includes(STAGING_COMPLETE_MARKER) &&
  // and the doc must positively say they are not earned
  /\*\*Not earned\.\*\*/.test(doc));
record("G03d the closure doc still states orchestration is uncertified",
  /ORCHESTRATION UNCERTIFIED/i.test(doc) &&
  /NOT COMPLETE/i.test(doc));
record("G04 no vendor accept/reject concept is implemented anywhere in this package",
  // Plain string matching on purpose: the phrase contains a slash, and an
  // escaping slip in a regex here would silently weaken the guard.
  (() => {
    const PHRASES = ["accept/reject", "acceptlead", "rejectlead",
      "vendor_accept", "vendor_reject", "acceptance_rate", "rejection_rate"];
    const code = (sql + executionCode + contractSource).toLowerCase();
    if (PHRASES.some((p) => code.includes(p))) return false;
    // Prose may mention it ONLY to forbid it — never as a design or a plan.
    return (migrationSource + "\n" + doc)
      .toLowerCase()
      .split(/[.\n]/)
      .filter((line) => line.includes("accept/reject"))
      .every((line) => line.includes("no ") || line.includes("removed") || line.includes("must not"));
  })());
record("G05 no Jarvis reference appears anywhere in this package",
  !/qf-jarvis|coilipywdvxklewquqvv/i.test(sql + executionCode + contractSource + doc));
record("G06 no QF-MVP-50.3 vendor workflow surface is added",
  !/vendor\.(lead_offer|response_reminder|onboarding_reminder|document_reminder|package_expiry|low_credit)/.test(sql + executionCode));
record("G07 the closure doc does not claim QF-MVP-50.2 complete",
  /NOT COMPLETE/i.test(doc) &&
  !/QF-MVP-50\.2 is COMPLETE/i.test(doc) &&
  !/COMPLETE \/ TESTED \/ FROZEN/i.test(doc));
record("G07a no real Meta/WhatsApp send is claimed and readiness stays zero-of-six",
  // "live-provider-ready" may appear ONLY inside a sentence that negates it.
  doc.split(/[.\n]/)
    .filter((line) => /live[- ]provider[- ]ready/i.test(line))
    .every((line) => /\b(?:zero|no|not|never|remains? disabled|until)\b/i.test(line)) &&
  /no real send/i.test(doc));
record("G08 the validator is registered and wired after 50.2E in CI",
  pkg.scripts["test:mvp:50-2-final"] ===
    "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/mvp/loader/register.mjs scripts/mvp/automation/validate-qf-mvp-50-2-final.mjs" &&
  /- name: QF-MVP-50\.2E validator\s+run: npm run test:mvp:50-2e\s+- name: QF-MVP-50\.2 final closure validator\s+run: npm run test:mvp:50-2-final/.test(ciWorkflow));
record("G09 CI still takes no secret, database, provider or deployment action",
  !ciWorkflow.includes("${{ secrets.") &&
  !/^\s*(?:run:\s*)?(?:npx\s+)?supabase\s+/mi.test(ciWorkflow) &&
  !/\bdb push\b/i.test(ciWorkflow));

// ---------------------------------------------------------------------------
// M. MUTANTS — each defect must be impossible by construction
// ---------------------------------------------------------------------------
const mutants = [
  ["a reminder at 12h instead of 24h is impossible",
    () => !/'client\.missing_information_reminder',[\s\S]{0,160}?interval '(12|48|72) hours'/.test(sql)],
  ["more than one reminder per clarification request is impossible",
    () => enqueueCallsFor("client.missing_information_reminder") === 1 &&
          enqueueCallsFor("client.transactional_followup") === 1],
  ["a follow-up at 24h or 72h instead of 48h is impossible",
    () => !/'client\.transactional_followup',[\s\S]{0,200}?interval '(12|24|72) hours'/.test(sql)],
  ["a follow-up firing on an unchanged status is impossible",
    () => /when \(old\.status is distinct from new\.status\)/.test(sql)],
  ["a status update firing on an unchanged status is impossible",
    () => /when \(old\.status is distinct from new\.status\)/.test(sql)],
  ["a matching update on a non-matched run is impossible",
    () => /new\.run_status = 'matched'/.test(sql)],
  ["removing the execution-time revalidation is impossible",
    () => /proveExecutionTimeEligibility/.test(executionCode) &&
          /clarification_required/.test(executionCode) &&
          /"Quotation Sent"/.test(executionCode)],
  ["producing an action outside the frozen six is impossible",
    () => /not in \(\s*\n?\s*'client\.lead_confirmation'/.test(sql) &&
          /QF_PRODUCER_ACTION_NOT_CLIENT_DISPATCHABLE/.test(sql)],
  ["faking provider readiness from this package is impossible",
    () => !/send_authority|binding_readiness|provider_template_mappings/i.test(sql)],
  ["introducing a pending-state redispatch is impossible",
    () => !/dispatchPersistedMessage/.test(executionCode) &&
          ["queued", "dispatching", "retry_scheduled"].every((s) => COMMUNICATION_EXECUTION_PARTITION[s] === "pending")],
  ["reintroducing an outbox/domain_events table is impossible",
    () => !/create table[^;]*(outbox_events|domain_events)/i.test(sql) &&
          /legacy workflow-kernel table public\.% exists/.test(migrationSource)],
  ["a vendor accept/reject string or state is impossible",
    () => !/accept\/reject|acceptLead|rejectLead|vendor_accept|vendor_reject/i.test(sql + executionCode)],
  ["an unclassified pre-communication code being silently finalized is impossible",
    () => resolvePreCommunicationRuling("something_new") === null],
  ["a TypeScript fire-and-forget producer is impossible",
    () => !/createAutomationActionRequest\(|createAutomationJob\(/.test(
      leadServiceCode + adminServiceCode + clarificationCode + matchingCode + executionCode)],

  // --- QF-MVP-50.2-R2-APPLIED-TRUTH staging-truth mutants -------------------
  // Each lambda states the invariant that makes the named defect impossible.
  ["understating the applied producer as still PENDING is impossible",
    () => producerPin?.operationalStatus === "APPLIED" &&
          manifest.pendingPostAnchorMigrations.length === 0 &&
          !manifest.pendingPostAnchorMigrations.some((r) => r.version === "20260806000000")],
  ["recording remote history 22 for the producer is impossible",
    () => producerPin?.remoteHistoryCountAfterApply === 23],
  ["recording remote history 24 for the producer is impossible",
    () => producerPin?.remoteHistoryCountAfterApply === 23 &&
          manifest.appliedPostAnchorMigrations.every((r) => r.remoteHistoryCountAfterApply <= 23)],
  ["claiming the producer was applied more than once is impossible",
    () => producerPin?.appliedExactlyOnce === true],
  ["claiming this source phase applied the migration is impossible",
    () => producerPin?.appliedByThisPhase === false &&
          producerPin?.appliedEvidenceType === "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD"],
  ["forging the applied-evidence marker is impossible",
    () => producerPin?.appliedEvidenceMarker === R2_APPLIED_MARKER &&
          new Set(manifest.appliedPostAnchorMigrations.map((r) => r.appliedEvidenceMarker)).size === 3],
  ["claiming n8n orchestration certification before it is earned is impossible",
    () => unearnedIsDisclaimedInProse(N8N_CERTIFIED_MARKER) &&
          !manifestText.includes(N8N_CERTIFIED_MARKER) && !g1Source.includes(N8N_CERTIFIED_MARKER)],
  ["claiming overall staging certification before it is earned is impossible",
    () => unearnedIsDisclaimedInProse(STAGING_COMPLETE_MARKER) &&
          !manifestText.includes(STAGING_COMPLETE_MARKER) && !g1Source.includes(STAGING_COMPLETE_MARKER)],
  ["declaring QF-MVP-50.2 COMPLETE while orchestration is uncertified is impossible",
    () => /NOT COMPLETE/i.test(doc) && /ORCHESTRATION UNCERTIFIED/i.test(doc) &&
          !/COMPLETE \/ TESTED \/ FROZEN/i.test(doc)],
  ["silently loosening the G1 post-anchor pin is impossible",
    () => g1Source.includes("appliedPins.length === 3") &&
          g1Source.includes("pendingPins.length === 0") &&
          !/appliedPins\.length\s*>=/.test(g1Source) &&
          !/postAnchorLocal\.length\s*>=/.test(g1Source)],
];
for (const [name, fn] of mutants) {
  let held = false;
  try { held = fn() === true; } catch { held = false; }
  record(`M-${name}`, held);
}

// ---------------------------------------------------------------------------
for (const r of results) {
  console.log(`${r.passed ? "PASS" : "FAIL"} ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
}
const failed = results.filter((r) => !r.passed);
console.log(`\nQF-MVP-50.2-FINAL: ${results.length - failed.length}/${results.length} ${failed.length ? "FAIL" : "PASS"}`);
if (failed.length) {
  console.log("QF_MVP_50_2_FINAL_CLOSURE_BLOCKED");
  process.exit(1);
}
console.log("QF_MVP_50_2_FINAL_CLOSURE_READY");
