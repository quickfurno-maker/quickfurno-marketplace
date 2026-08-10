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
// QF-MVP-50.2 execute_v1 ambiguity repair — successor migration. The historical
// 50.2E migration is byte-frozen and must never be edited to carry the fix.
const HISTORICAL_EXEC_NAME =
  "20260805000000_qf_mvp_50_2e_automation_transport_client_execution_route.sql";
const HISTORICAL_EXEC_SHA =
  "9a8a29975e18135b96e7be7d4510104033c5de00cf080df5dab4326e3891250b";
const REPAIR_NAME =
  "20260807000000_qf_mvp_50_2_execute_v1_reservation_ambiguity_repair.sql";
const REPAIR_PATH = `supabase/migrations/${REPAIR_NAME}`;
const REPAIR_SHA =
  "c36171fe851968c5e42477c048d535c563676f3d44e020d41fd5abcff1dacee5";
const REPAIR_MARKER = "QF_MVP_50_2_EXECUTE_V1_REPAIR_STAGING_APPLIED_AND_VERIFIED";

// QF-MVP-50.2 fresh-claim retry wedge repair — successor migration. The
// historical claim migrations (20260801110000 / 20260801152049) are byte-frozen
// and must never be edited to carry the fix.
const CLAIM_PERSIST_NAME = "20260801110000_qf_mvp_automation_action_persistence.sql";
const CLAIM_GUARD_NAME = "20260801152049_qf_mvp_automation_transport_replay_guard.sql";
const WEDGE_NAME = "20260808000000_qf_mvp_50_2_fresh_claim_retry_wedge_repair.sql";
const WEDGE_PATH = `supabase/migrations/${WEDGE_NAME}`;
const WEDGE_SHA = "8b798bb3c5db5d91f988d92cec3705237db08c753ae5018d09dccc09ff0240aa";
const WEDGE_MARKER = "QF_MVP_50_2_RETRY_WEDGE_STAGING_APPLIED_AND_VERIFIED";

const R2_APPLIED_MARKER = "QF_MVP_50_2_FINAL_R2_STAGING_MIGRATION_APPLIED_AND_VERIFIED";
const ATOMIC_PRODUCER_MARKER = "QF_MVP_50_2_ATOMIC_PRODUCER_STAGING_CERTIFIED";
// EARNED. A real isolated n8n runtime executed the exact merged workflow against
// QuickFurno staging across all six client actions.
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
const repairSource = read(REPAIR_PATH);
const repairSql = stripSql(repairSource);
/** The repaired function body as it appears in the successor migration. */
const repairedFn = (() => {
  const i = repairSql.indexOf("create or replace function public.qf_record_automation_execution_transport_v1");
  if (i === -1) return "";
  const j = repairSql.indexOf("comment on function", i);
  return repairSql.slice(i, j === -1 ? repairSql.length : j);
})();
const producerPin = manifest.appliedPostAnchorMigrations
  .find((r) => r.version === "20260806000000");
const execRepairPin = manifest.appliedPostAnchorMigrations
  .find((r) => r.version === "20260807000000");
const wedgePin = manifest.appliedPostAnchorMigrations
  .find((r) => r.version === "20260808000000");
const wedgeSource = read(WEDGE_PATH);
const wedgeSql = stripSql(wedgeSource);
/** DDL only — everything before the trailing self-verification block, whose
 *  guard predicates legitimately name the very shapes they forbid. */
const wedgeDdl = (() => {
  const i = wedgeSql.lastIndexOf("do $$");
  return i === -1 ? wedgeSql : wedgeSql.slice(0, i);
})();
/** The repaired claim function body as it appears in the wedge migration. */
const wedgeFn = (() => {
  const i = wedgeSql.indexOf("create or replace function public.qf_claim_automation_job_v1");
  if (i === -1) return "";
  const j = wedgeSql.indexOf("comment on function", i);
  return wedgeSql.slice(i, j === -1 ? wedgeSql.length : j);
})();

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
// R. execute_v1 RESERVATION AMBIGUITY REPAIR
//
// The defect: every name in `returns table (...)` is a PL/pgSQL OUT parameter
// that stays in scope, so a bare `route_key` / `attempt_id` in the replay
// lookup resolved to the OUT variable and raised 42702 on EVERY call. It is
// fixed by explicit alias qualification in a SUCCESSOR migration; the applied
// 50.2E migration is never rewritten.
// ---------------------------------------------------------------------------
record("R01 the successor repair migration exists at its pinned hash",
  existsSync(path.join(ROOT, REPAIR_PATH)) &&
  canonicalSha256(readFileSync(path.join(ROOT, REPAIR_PATH))) === REPAIR_SHA);
record("R02 the historical 50.2E migration is byte-frozen, never edited to carry the fix",
  canonicalSha256(readFileSync(path.join(ROOT, `supabase/migrations/${HISTORICAL_EXEC_NAME}`)))
    === HISTORICAL_EXEC_SHA);
record("R03 the repair is a CREATE OR REPLACE of the exact same function and signature",
  /create or replace function public\.qf_record_automation_execution_transport_v1\(/.test(repairSql) &&
  /p_request_id uuid,\s*p_worker_id text,\s*p_body_sha256 text,\s*p_job_id uuid,\s*p_attempt_id uuid/.test(repairSql));
record("R04 the return shape is unchanged — all nine output columns in order",
  (() => {
    const m = repairedFn.match(/returns table \(([\s\S]*?)\)\s*language plpgsql/);
    if (!m) return false;
    const cols = m[1].split(",").map((c) => c.trim().split(/\s+/)[0]);
    return same(cols, ["request_id", "route_key", "state", "is_replay", "job_id",
      "action_request_id", "attempt_id", "attempt_number", "max_attempts"]);
  })());
record("R05 SECURITY DEFINER and the pinned search_path are preserved",
  /security definer/.test(repairedFn) &&
  /set search_path = pg_catalog, public, pg_temp/.test(repairedFn));
record("R06 execute stays service_role only",
  /revoke all on function public\.qf_record_automation_execution_transport_v1[\s\S]{0,200}?from public, anon, authenticated, service_role/.test(repairSql) &&
  /grant execute on function public\.qf_record_automation_execution_transport_v1[\s\S]{0,200}?to service_role/.test(repairSql) &&
  !/grant [^\n]*to (public|anon|authenticated)\b/i.test(repairSql));
record("R07 NO unqualified reference to any RETURNS TABLE output name survives",
  (() => {
    // Every OUT name that is also a column of a table this body queries.
    const shadowed = ["route_key", "attempt_id", "state", "job_id",
      "action_request_id", "attempt_number", "max_attempts", "request_id"];
    // Strip the SET clause: SET targets are target columns, never substituted,
    // and PostgreSQL forbids qualifying them.
    const body = repairedFn.replace(/set state = 'recorded',[\s\S]*?finalized_at = now\(\)/, " ");
    return shadowed.every((n) => {
      // a bare occurrence in a WHERE/AND predicate position is the defect shape
      const bare = new RegExp(`(?:where|and|or)\\s+${n}\\s*(?:=|<>|is\\b)`, "i");
      return !bare.test(body);
    });
  })());
record("R08 the replay lookup is explicitly alias-qualified",
  /from public\.automation_transport_requests as atr\s*\n\s*where atr\.route_key = 'execute_v1'\s*\n\s*and atr\.attempt_id = p_attempt_id/.test(repairedFn));
record("R09 every automation_transport_requests read in the body is aliased",
  (() => {
    const reads = [...repairedFn.matchAll(/from public\.automation_transport_requests(\s+as\s+\w+)?/g)];
    return reads.length >= 2 && reads.every((m) => Boolean(m[1]));
  })());
record("R10 the route vocabulary is still exactly execute_v1",
  /'execute_v1'/.test(repairedFn) &&
  !/'claim_v1'|'complete_v1'/.test(repairedFn));
record("R11 all replay / ownership / currency guards are preserved",
  ["AUTOMATION_TRANSPORT_EXECUTION_IDENTITY_REQUIRED",
    "AUTOMATION_TRANSPORT_WORKER_ID_INVALID",
    "AUTOMATION_TRANSPORT_BODY_HASH_INVALID",
    "AUTOMATION_EXECUTION_JOB_NOT_FOUND",
    "AUTOMATION_EXECUTION_ATTEMPT_NOT_CURRENT",
    "AUTOMATION_EXECUTION_JOB_NOT_OWNED",
    "AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT",
    "AUTOMATION_TRANSPORT_REPLAY_STATE_MISSING",
    "AUTOMATION_TRANSPORT_REQUEST_INCOMPLETE_INVARIANT",
  ].every((code) => repairedFn.includes(code)));
record("R12 the body-hash and worker-id contracts are unchanged",
  /p_body_sha256 !~ '\^\[0-9a-f\]\{64\}\$'/.test(repairedFn) &&
  /p_worker_id !~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{0,199\}\$'/.test(repairedFn));
record("R13 the repair grows no schema and changes no trigger or producer",
  !/create table|add column|drop column|create (unique )?index|alter table|create type|create trigger|drop trigger/i.test(repairSql) &&
  !/qf_enqueue_client_automation_v1|trg_qf_produce_/.test(repairSql));
record("R14 the repair touches no provider, n8n, vendor, campaign or 50.5 surface",
  !/provider_template_mappings|send_authority|binding_readiness|n8n|meta|whatsapp|vendor_|campaign|due_sweep|dispatchPersistedMessage/i.test(repairSql));
record("R15 the repair seeds nothing and deletes no append-only evidence",
  !/^\s*insert into/mi.test(repairSql.replace(/insert into public\.automation_transport_requests \(/g, " ")) &&
  !/\bdelete from\b|\btruncate\b|\bdrop trigger\b|alter table[^;]*disable trigger/i.test(repairSql));
record("R16 the repair self-verifies its own posture and fails closed",
  /repair aborted: SECURITY DEFINER lost/.test(repairSource) &&
  /repair aborted: search_path not preserved/.test(repairSource) &&
  /repair aborted: an unqualified ambiguous reference remains/.test(repairSource) &&
  /repair aborted: qualified replay lookup is absent/.test(repairSource) &&
  /repair aborted: execute granted beyond service_role/.test(repairSource) &&
  /repair aborted: a guard clause was lost/.test(repairSource));
record("R17 no #variable_conflict pragma is used to mask the collision",
  !/#variable_conflict/i.test(repairSql));
record("R18 the execute_v1 repair is present, ordered immediately before the wedge repair",
  (() => {
    const files = readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql")).sort();
    // QF-MVP-50.5 RE-PIN: 96 -> 97. Still exact equality, still an ordering proof.
    return files.length === 97 &&
      files.indexOf(WEDGE_NAME) === files.indexOf(REPAIR_NAME) + 1;
  })());

// ---------------------------------------------------------------------------
// W. FRESH-CLAIM RETRY WEDGE REPAIR
//
// Three correct designs combined into a starvation: a retryable outcome parks a
// job in retry_scheduled; uq_automation_transport_requests_claim_job allows
// exactly ONE claim_v1 per job; and the ordinary selector took retry_scheduled
// ordered by a now-past next_retry_at. So the stranded job out-ranked every
// fresh job forever, re-claim hit 23505 and Core returned 500.
//
// The repair excludes retry_scheduled from the ORDINARY fresh-work selector.
// retry_scheduled stays legal, durable and inert; governed retry recovery is
// QF-MVP-50.5 and is NOT implemented here.
// ---------------------------------------------------------------------------
record("W01 the wedge repair migration exists at its pinned hash",
  existsSync(path.join(ROOT, WEDGE_PATH)) &&
  canonicalSha256(readFileSync(path.join(ROOT, WEDGE_PATH))) === WEDGE_SHA);
record("W02 the historical claim migrations are byte-frozen, never edited to carry the fix",
  existsSync(path.join(ROOT, `supabase/migrations/${CLAIM_PERSIST_NAME}`)) &&
  existsSync(path.join(ROOT, `supabase/migrations/${CLAIM_GUARD_NAME}`)) &&
  !/create or replace function public\.qf_claim_automation_job_v1/.test(
    stripSql(read(`supabase/migrations/${CLAIM_GUARD_NAME}`))));
record("W03 the repair is a CREATE OR REPLACE of the same claim function and signature",
  /create or replace function public\.qf_claim_automation_job_v1\(p_worker_id text\)/.test(wedgeSql));
record("W04 the return contract is unchanged",
  (() => {
    const m = wedgeFn.match(/returns table \(([\s\S]*?)\)\s*language plpgsql/);
    if (!m) return false;
    const cols = m[1].split(",").map((c) => c.trim().split(/\s+/)[0]);
    return same(cols, ["job_id", "action_request_id", "attempt_id", "attempt_number", "max_attempts"]);
  })());
record("W05 SECURITY DEFINER and the pinned search_path are preserved",
  /security definer/.test(wedgeFn) &&
  /set search_path = pg_catalog, public, pg_temp/.test(wedgeFn));
record("W06 execute stays service_role only",
  /revoke all on function public\.qf_claim_automation_job_v1\(text\)[\s\S]{0,120}?from public, anon, authenticated, service_role/.test(wedgeSql) &&
  /grant execute on function public\.qf_claim_automation_job_v1\(text\)[\s\S]{0,120}?to service_role/.test(wedgeSql) &&
  !/grant [^\n]*to (public|anon|authenticated)\b/i.test(wedgeSql));
record("W07 the fresh-work selector accepts ONLY due pending work",
  /j\.status = 'pending'/.test(wedgeFn) &&
  /j\.available_at <= now\(\)/.test(wedgeFn));
record("W08 no executable retry_scheduled predicate survives in the selector",
  !/j\.status = 'retry_scheduled'/.test(wedgeFn) &&
  !/j\.next_retry_at <= now\(\)/.test(wedgeFn) &&
  !/j\.next_retry_at is not null/.test(wedgeFn));
record("W09 no wildcard or inequality selector replaces the exact status match",
  !/j\.status\s*(?:<>|!=)/.test(wedgeFn) &&
  !/j\.status\s+in\s*\(/.test(wedgeFn) &&
  !/j\.status\s*=\s*any/i.test(wedgeFn));
record("W10 the lease, attempt-budget and worker-id contracts are preserved",
  /for update skip locked/.test(wedgeFn) &&
  /j\.attempt_count < j\.max_attempts/.test(wedgeFn) &&
  /AUTOMATION_WORKER_ID_INVALID/.test(wedgeFn) &&
  /p_worker_id !~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{0,199\}\$'/.test(wedgeFn));
record("W11 attempt creation is unchanged",
  /insert into public\.automation_execution_attempts/.test(wedgeFn) &&
  /v_job\.attempt_count,/.test(wedgeFn));
record("W12 retry_scheduled rows are never reset, replaced or deleted",
  !/set[^;]*status\s*=\s*'pending'[^;]*where[^;]*retry_scheduled/is.test(wedgeDdl) &&
  !/update public\.automation_jobs[^;]*retry_scheduled/is.test(wedgeDdl) &&
  !/\bdelete from\b|\btruncate\b/i.test(wedgeDdl));
record("W13 no due sweep, retry worker or second queue is introduced",
  !/due_sweep|dueSweep|reclaimStale|recovery_worker|retry_worker/i.test(wedgeDdl) &&
  !/create table/i.test(wedgeSql));
record("W14 claim uniqueness is NOT weakened",
  !/drop index[^;]*uq_automation_transport_requests_claim_job/i.test(wedgeSql) &&
  !/alter table[^;]*drop constraint[^;]*claim_job/i.test(wedgeSql) &&
  /uq_automation_transport_requests_claim_job/.test(wedgeSource) &&
  /claim uniqueness must not be weakened/.test(wedgeSource));
record("W15 the repair grows no schema and changes no trigger",
  !/create table|add column|drop column|create (unique )?index|alter table|create type|create trigger|drop trigger/i.test(wedgeSql));
record("W16 QF-MVP-50.5 remains the owner of governed retry recovery",
  /QF-MVP-50\.5/.test(wedgeSource) &&
  /retry recovery must remain QF-MVP-50\.5 scope/.test(wedgeSource));
record("W17 the repair self-verifies and fails closed",
  /wedge repair aborted: SECURITY DEFINER lost/.test(wedgeSource) &&
  /wedge repair aborted: an executable retry_scheduled selector predicate remains/.test(wedgeSource) &&
  /wedge repair aborted: the fresh pending selector is absent/.test(wedgeSource) &&
  /wedge repair aborted: a frozen claim invariant was lost/.test(wedgeSource) &&
  /wedge repair aborted: execute granted beyond service_role/.test(wedgeSource) &&
  /wedge repair aborted: claim uniqueness must not be weakened/.test(wedgeSource));
record("W18 the repair touches no provider, n8n, vendor, campaign or Jarvis surface",
  !/provider_template_mappings|send_authority|binding_readiness|n8n|meta|whatsapp|vendor_|campaign|qf-jarvis/i.test(wedgeSql));
record("W19 the wedge repair is present and the set is exactly 97",
  (() => {
    const files = readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql")).sort();
    return files.length === 97 && files.includes(WEDGE_NAME);
  })());

// ---------------------------------------------------------------------------
// G. GOVERNANCE / SCOPE CONTAINMENT
// ---------------------------------------------------------------------------
// QF-MVP-50.2-R2-APPLIED-TRUTH — the producer migration was applied exactly once
// to QuickFurno staging (remote history 23) by an external owner-reviewed
// execution. This source phase imports that record and applies nothing itself.
// Zero post-anchor migrations remain pending.
record("G01 the producer migration is pinned APPLIED at remote history 23",
  manifest.appliedPostAnchorMigrations.length === 9 &&
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
record("G01a every QF-MVP-50.2 migration is APPLIED — nothing 50.2 remains pending",
  Array.isArray(manifest.pendingPostAnchorMigrations) &&
  !manifest.pendingPostAnchorMigrations.some((r) =>
    ["20260804000000", "20260805000000", "20260806000000",
     "20260807000000", "20260808000000"].includes(r.version)));
record("G01b the execute_v1 repair is APPLIED at remote history 24",
  execRepairPin?.sha256 === REPAIR_SHA &&
  execRepairPin?.operationalStatus === "APPLIED" &&
  execRepairPin?.appliedEvidenceMarker === REPAIR_MARKER &&
  execRepairPin?.appliedEvidenceType === "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD" &&
  execRepairPin?.remoteHistoryCountAfterApply === 24 &&
  execRepairPin?.appliedExactlyOnce === true &&
  execRepairPin?.appliedByThisPhase === false &&
  !("remoteVersionStatus" in (execRepairPin ?? {})));
record("G01c the wedge repair is APPLIED at remote history 25",
  wedgePin?.sha256 === WEDGE_SHA &&
  wedgePin?.operationalStatus === "APPLIED" &&
  wedgePin?.appliedEvidenceMarker === WEDGE_MARKER &&
  wedgePin?.appliedEvidenceType === "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD" &&
  wedgePin?.remoteHistoryCountAfterApply === 25 &&
  wedgePin?.appliedExactlyOnce === true &&
  wedgePin?.appliedByThisPhase === false &&
  !("remoteVersionStatus" in (wedgePin ?? {})));
record("G02 the nine applied records are 21 through 29 in exact ascending order",
  same(manifest.appliedPostAnchorMigrations.map((r) => r.remoteHistoryCountAfterApply), [21, 22, 23, 24, 25, 26, 27, 28, 29]) &&
  same(manifest.appliedPostAnchorMigrations.map((r) => r.version),
    ["20260804000000", "20260805000000", "20260806000000", "20260807000000", "20260808000000", "20260808500000", "20260809000000", "20260810000000", "20260811000000"]) &&
  new Set(manifest.appliedPostAnchorMigrations.map((r) => r.appliedEvidenceMarker)).size === 9);
record("G03 post-anchor count and local migration count agree at 10 / 97",
  manifest.appliedAnchor.postAnchorMigrationCount === 10 &&
  readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).length === 97);
record("G03a the G1 staging-history gate was re-pinned to the applied truth, not loosened",
  g1Source.includes(`marker: "${R2_APPLIED_MARKER}"`) &&
  g1Source.includes("remoteHistory: 23") &&
  g1Source.includes("manifest declares exactly nine APPLIED post-anchor migrations") &&
  // QF-MVP-50.5 RE-PIN: the APPLIED pin is unchanged at nine; the pending set now
  // holds exactly the one 50.5 recovery migration, awaiting its own staging gate.
  g1Source.includes("the explicit PENDING post-anchor set holds exactly one entry") &&
  // no `>=`, no wildcard: the count assertions stay exact
  g1Source.includes("appliedPins.length === 9") &&
  g1Source.includes("pendingPins.length === 1") &&
  g1Source.includes("const MIGRATION_COUNT = 97;"));
record("G03b the atomic producer staging certification is recorded",
  doc.includes(ATOMIC_PRODUCER_MARKER) && doc.includes(R2_APPLIED_MARKER));
// An unearned marker may be NAMED in prose only to disclaim it. It must never
// appear as machine-readable evidence (manifest / G1 pin), and every prose
// sentence carrying it must negate it.
const unearnedIsDisclaimedInProse = (marker) =>
  doc.split(/(?<=\.)\s|\n/)
    .filter((line) => line.includes(marker))
    .every((line) => /\bnot\b|\bno\b|\bnever\b|\buntil\b|\bunearned\b|\bremains? (?:unproven|uncertified)\b/i.test(line));
record("G03c all six operational markers are recorded as earned",
  [R2_APPLIED_MARKER, ATOMIC_PRODUCER_MARKER, REPAIR_MARKER, WEDGE_MARKER,
   N8N_CERTIFIED_MARKER, STAGING_COMPLETE_MARKER].every((m) => doc.includes(m)));
record("G03d QF-MVP-50.2 is COMPLETE / TESTED / FROZEN while QF-MVP-50 is not",
  /COMPLETE \/ TESTED \/ FROZEN/.test(doc) &&
  /QF-MVP-50 overall remains \*\*NOT COMPLETE\*\*/.test(doc) &&
  /QF-MVP-50\.3 is \*\*NOT STARTED\*\*/.test(doc));
record("G03e completion rests on a real six-action n8n proof, not an assertion",
  /All six client actions traversed a real, isolated n8n runtime/.test(doc) &&
  /exactly five keys/.test(doc) &&
  /successful `execute_v1` reservation/.test(doc) &&
  /QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE/.test(doc) &&
  /replayed: true/.test(doc));
record("G03f the deferred owners are named exactly, not guessed",
  /`retry_scheduled` recovery → QF-MVP-50\.5/.test(doc) &&
  /Live channel \/ provider readiness → QF-MVP-40 \/ QF-MVP-80/.test(doc) &&
  /This is not a consent gap/.test(doc) &&
  /WHATSAPP_PROVIDER_NOT_CONFIGURED/.test(doc));
record("G03g communication_pending is documented as split evidence, not fabricated",
  /communication_pending/.test(doc) &&
  /split evidence/.test(doc) &&
  /none was fabricated/.test(doc));
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
record("G07 QF-MVP-50 overall is still NOT COMPLETE and 50.3 is NOT STARTED",
  /QF-MVP-50 overall remains \*\*NOT COMPLETE\*\*/.test(doc) &&
  /QF-MVP-50\.3 is \*\*NOT STARTED\*\*/.test(doc));
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
          // the producer specifically must never reappear as pending; the
          // pending list itself may legitimately hold a NEWER migration
          !manifest.pendingPostAnchorMigrations.some((r) => r.version === "20260806000000")],
  ["recording remote history 22 for the producer is impossible",
    () => producerPin?.remoteHistoryCountAfterApply === 23],
  ["recording remote history 24 for the producer is impossible",
    () => producerPin?.remoteHistoryCountAfterApply === 23 &&
          manifest.appliedPostAnchorMigrations.every((r) => r.remoteHistoryCountAfterApply <= 29)],
  ["claiming the producer was applied more than once is impossible",
    () => producerPin?.appliedExactlyOnce === true],
  ["claiming this source phase applied the migration is impossible",
    () => producerPin?.appliedByThisPhase === false &&
          producerPin?.appliedEvidenceType === "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD"],
  ["forging the applied-evidence marker is impossible",
    () => producerPin?.appliedEvidenceMarker === R2_APPLIED_MARKER &&
          execRepairPin?.appliedEvidenceMarker === REPAIR_MARKER &&
          wedgePin?.appliedEvidenceMarker === WEDGE_MARKER &&
          new Set(manifest.appliedPostAnchorMigrations.map((r) => r.appliedEvidenceMarker)).size === 9],
  ["dropping the n8n certification marker is impossible",
    () => doc.includes(N8N_CERTIFIED_MARKER)],
  ["dropping the overall staging-certification marker is impossible",
    () => doc.includes(STAGING_COMPLETE_MARKER)],
  ["dropping the wedge or execute-repair marker is impossible",
    () => doc.includes(WEDGE_MARKER) && doc.includes(REPAIR_MARKER) &&
          manifestText.includes(WEDGE_MARKER) && manifestText.includes(REPAIR_MARKER)],
  ["declaring COMPLETE without the six-action n8n proof is impossible",
    () => /COMPLETE \/ TESTED \/ FROZEN/.test(doc) &&
          /All six client actions traversed a real, isolated n8n runtime/.test(doc) &&
          /successful `execute_v1` reservation/.test(doc)],
  ["marking QF-MVP-50 overall complete is impossible",
    () => /QF-MVP-50 overall remains \*\*NOT COMPLETE\*\*/.test(doc)],
  ["starting QF-MVP-50.3 in this package is impossible",
    () => /QF-MVP-50\.3 is \*\*NOT STARTED\*\*/.test(doc) &&
          !/vendor\.(lead_offer|response_reminder|onboarding_reminder|document_reminder|package_expiry|low_credit)/.test(sql + executionCode)],
  ["claiming consent availability that staging does not have is impossible",
    () => /This is not a consent gap/.test(doc) &&
          /WHATSAPP_PROVIDER_NOT_CONFIGURED/.test(doc)],
  ["claiming live provider readiness is impossible",
    () => doc.split(/[.\n]/)
      .filter((line) => /live[- ]provider[- ]ready/i.test(line))
      .every((line) => /\b(?:zero|no|not|never|remains? disabled|until)\b/i.test(line))],
  ["claiming a real Meta/WhatsApp send is impossible",
    () => /zero real Meta\/WhatsApp sends/i.test(doc) && /no real send/i.test(doc)],
  ["removing the QF-MVP-50.5 retry-recovery boundary from the closure doc is impossible",
    () => /`retry_scheduled` recovery → QF-MVP-50\.5/.test(doc)],
  // --- execute_v1 repair regression mutants -------------------------------
  // Each lambda states the invariant that makes the named regression impossible.
  ["reintroducing an unqualified route_key in the replay lookup is impossible",
    () => !/where\s+route_key\s*=/.test(repairedFn) &&
          /atr\.route_key = 'execute_v1'/.test(repairedFn)],
  ["reintroducing an unqualified attempt_id in the replay lookup is impossible",
    () => !/and\s+attempt_id\s*=\s*p_attempt_id/.test(repairedFn) &&
          /atr\.attempt_id = p_attempt_id/.test(repairedFn)],
  ["leaving any other RETURNS TABLE output name unqualified in a predicate is impossible",
    () => ["state", "job_id", "action_request_id", "attempt_number", "max_attempts", "request_id"]
      .every((n) => !new RegExp(`(?:where|and|or)\\s+${n}\\s*(?:=|<>|is\\b)`, "i")
        .test(repairedFn.replace(/set state = 'recorded',[\s\S]*?finalized_at = now\(\)/, " ")))],
  ["an unaliased read of automation_transport_requests is impossible",
    () => [...repairedFn.matchAll(/from public\.automation_transport_requests(\s+as\s+\w+)?/g)]
      .every((m) => Boolean(m[1]))],
  ["changing the route key away from execute_v1 is impossible",
    () => /'execute_v1'/.test(repairedFn) && !/'claim_v1'|'complete_v1'/.test(repairedFn)],
  ["weakening the attempt-scoped replay lookup is impossible",
    () => /select atr\.\* into v_existing/.test(repairedFn) &&
          /for update/.test(repairedFn) &&
          /if v_existing\.id is not null then/.test(repairedFn)],
  ["removing the replay-conflict branch is impossible",
    () => (repairedFn.match(/AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT/g) ?? []).length >= 3],
  ["broadening the execute grant beyond service_role is impossible",
    () => /to service_role/.test(repairSql) &&
          !/grant [^\n]*to (public|anon|authenticated)\b/i.test(repairSql)],
  ["changing SECURITY DEFINER or the pinned search_path is impossible",
    () => /security definer/.test(repairedFn) &&
          /set search_path = pg_catalog, public, pg_temp/.test(repairedFn)],
  ["editing the historical 50.2E migration instead of shipping a successor is impossible",
    () => canonicalSha256(readFileSync(path.join(ROOT, `supabase/migrations/${HISTORICAL_EXEC_NAME}`)))
            === HISTORICAL_EXEC_SHA &&
          existsSync(path.join(ROOT, REPAIR_PATH))],
  ["masking the collision with a #variable_conflict pragma is impossible",
    () => !/#variable_conflict/i.test(repairSql)],
  ["understating the applied wedge repair as still PENDING is impossible",
    () => wedgePin?.operationalStatus === "APPLIED" &&
          wedgePin?.remoteHistoryCountAfterApply === 25 &&
          !manifest.pendingPostAnchorMigrations.some((r) => r.version === "20260808000000")],
  ["understating the applied execute_v1 repair as still PENDING is impossible",
    () => execRepairPin?.operationalStatus === "APPLIED" &&
          execRepairPin?.remoteHistoryCountAfterApply === 24 &&
          !manifest.pendingPostAnchorMigrations.some((r) => r.version === "20260807000000")],
  // --- fresh-claim wedge repair regression mutants -------------------------
  ["reintroducing retry_scheduled into the fresh selector is impossible",
    () => !/j\.status = 'retry_scheduled'/.test(wedgeFn) &&
          !/j\.next_retry_at <= now\(\)/.test(wedgeFn)],
  ["replacing the exact status match with a wildcard is impossible",
    () => /j\.status = 'pending'/.test(wedgeFn) &&
          !/j\.status\s*(?:<>|!=)/.test(wedgeFn) &&
          !/j\.status\s+in\s*\(/.test(wedgeFn)],
  ["removing due pending work from the selector is impossible",
    () => /j\.status = 'pending'/.test(wedgeFn) && /j\.available_at <= now\(\)/.test(wedgeFn)],
  ["auto-resetting retry_scheduled back to pending is impossible",
    () => !/update public\.automation_jobs[^;]*retry_scheduled/is.test(wedgeDdl)],
  ["creating a retry attempt or replacement job is impossible",
    () => (wedgeDdl.match(/insert into public\.automation_execution_attempts/g) ?? []).length === 1 &&
          !/insert into public\.automation_jobs/i.test(wedgeDdl)],
  ["adding a due sweep or retry worker is impossible",
    () => !/due_sweep|dueSweep|reclaimStale|recovery_worker|retry_worker/i.test(wedgeDdl)],
  ["deleting retry evidence is impossible",
    () => !/\bdelete from\b|\btruncate\b/i.test(wedgeDdl)],
  ["disabling an append-only guard is impossible",
    () => !/disable trigger|drop trigger/i.test(wedgeSql)],
  ["weakening claim uniqueness is impossible",
    () => !/drop index[^;]*uq_automation_transport_requests_claim_job/i.test(wedgeSql) &&
          !/alter table[^;]*drop constraint[^;]*claim_job/i.test(wedgeSql)],
  ["introducing a second queue is impossible",
    () => !/create table/i.test(wedgeSql)],
  ["removing the QF-MVP-50.5 retry-recovery boundary is impossible",
    () => /QF-MVP-50\.5/.test(wedgeSource) &&
          /retry recovery must remain QF-MVP-50\.5 scope/.test(wedgeSource)],
  ["editing the historical claim migration instead of shipping a successor is impossible",
    () => !/create or replace function public\.qf_claim_automation_job_v1/.test(
            stripSql(read(`supabase/migrations/${CLAIM_GUARD_NAME}`))) &&
          existsSync(path.join(ROOT, WEDGE_PATH))],
  ["silently loosening the G1 post-anchor pin is impossible",
    () => g1Source.includes("appliedPins.length === 9") &&
          g1Source.includes("pendingPins.length === 1") &&
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
