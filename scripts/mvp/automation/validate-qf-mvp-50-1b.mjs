#!/usr/bin/env node
/**
 * QF-MVP-50.1B — durable automation persistence offline validator.
 *
 * No database, network, provider, n8n or environment access.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTOMATION_REQUEST_SOURCES,
  AUTOMATION_RESULT_CLASSIFICATIONS,
} from "../../../lib/automation/actionContract.ts";
import {
  AUTOMATION_ACTION_TYPES,
  canSourceRequestAction,
} from "../../../lib/automation/actionRegistry.ts";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const MIG =
  "supabase/migrations/20260801110000_qf_mvp_automation_action_persistence.sql";
const TYPES = "lib/automation/persistenceTypes.ts";
const SERVICE = "services/automationPersistenceService.ts";
const DOC = "docs/QF-MVP-50-1B-DURABLE-AUTOMATION-PERSISTENCE.md";

const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const sql = read(MIG);
const types = read(TYPES);
const service = read(SERVICE);
const doc = read(DOC);

const results = [];
const record = (name, ok, detail = "") =>
  results.push({ name, ok: Boolean(ok), detail });

function sliceFunction(name, nextMarker = "comment on function") {
  const start = sql.indexOf(`create or replace function public.${name}`);
  if (start < 0) return "";
  const end = sql.indexOf(nextMarker, start);
  return sql.slice(start, end < 0 ? sql.length : end);
}

function stripSqlComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n\r]*/g, "");
}

const execSql = stripSqlComments(sql);

// ---------------------------------------------------------------------------
// 1. Migration identity/current-state design
// ---------------------------------------------------------------------------
record(
  "01 migration is the reviewed post-reconciliation forward version",
  MIG.includes("20260801110000"),
);
record(
  "02 migration is transactional",
  /^\s*--[\s\S]*?\nbegin;/.test(sql) && /\ncommit;\s*$/.test(sql),
);
record(
  "03 current-state preflight aborts if any target table already exists",
  [
    "automation_action_requests",
    "automation_jobs",
    "automation_execution_attempts",
  ].every((name) => sql.includes(`'${name}'`)) &&
    sql.includes("target table public.% already exists"),
);
record(
  "04 migration refuses the historical workflow-kernel authority collision",
  [
    "workflow_instances",
    "workflow_tasks",
    "domain_events",
    "outbox_events",
    "workflow_failures",
    "idempotency_records",
    "workflow_transition_history",
  ].every((name) => sql.includes(`'${name}'`)) &&
    sql.includes("legacy workflow-kernel table"),
);
record(
  "05 no historical workflow-kernel table is created",
  !/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?public\.(workflow_instances|workflow_tasks|domain_events|outbox_events|workflow_failures|idempotency_records|workflow_transition_history)\b/i.test(
    execSql,
  ),
);
record(
  "06 exactly the three dedicated automation tables are created",
  (execSql.match(/\bcreate\s+table\s+public\./gi) ?? []).length === 3 &&
    [
      "automation_action_requests",
      "automation_jobs",
      "automation_execution_attempts",
    ].every((name) =>
      new RegExp(`create\\s+table\\s+public\\.${name}\\b`, "i").test(execSql),
    ),
);

// ---------------------------------------------------------------------------
// 2. 50.1A vocabulary is preserved in DB constraints
// ---------------------------------------------------------------------------
record(
  "07 all six request sources are present in persistence authority",
  AUTOMATION_REQUEST_SOURCES.every((source) =>
    sql.includes(`'${source}'`),
  ),
  AUTOMATION_REQUEST_SOURCES.join(","),
);
record(
  "08 all 14 registered action types are present in DB authority",
  AUTOMATION_ACTION_TYPES.length === 14 &&
    AUTOMATION_ACTION_TYPES.every((action) => sql.includes(`'${action}'`)),
);
record(
  "09 DB result classification matches the closed 50.1A vocabulary",
  AUTOMATION_RESULT_CLASSIFICATIONS.every((value) =>
    sql.includes(`'${value}'`),
  ),
);
record(
  "10 client AI requestability remains enabled",
  ["jarvis", "riya", "anisha"].every((source) =>
    canSourceRequestAction(source, "client.transactional_followup"),
  ) &&
    /client\.transactional_followup[\s\S]{0,800}source in \('core', 'admin', 'system', 'jarvis', 'riya', 'anisha'\)/.test(
      sql,
    ),
);
record(
  "11 Jarvis-only vendor reminder provision is preserved",
  canSourceRequestAction("jarvis", "vendor.response_reminder") &&
    !canSourceRequestAction("riya", "vendor.response_reminder") &&
    /vendor\.response_reminder[\s\S]{0,500}source in \('core', 'admin', 'system', 'jarvis'\)/.test(
      sql,
    ),
);
record(
  "12 AI cannot request campaign execution in DB constraint",
  ["jarvis", "riya", "anisha"].every(
    (source) => !canSourceRequestAction(source, "campaign.execute_batch"),
  ) &&
    /campaign\.execute_batch[\s\S]{0,500}source in \('core', 'admin', 'system'\)/.test(
      sql,
    ),
);
record(
  "13 source-to-request-actor pairing is DB-enforced",
  /source = 'core' and requested_by_type = 'core_service'/.test(sql) &&
    /source = 'admin' and requested_by_type = 'admin_user'/.test(sql) &&
    /source = 'system' and requested_by_type = 'system'/.test(sql) &&
    /source in \('jarvis', 'riya', 'anisha'\) and requested_by_type = 'jarvis_agent'/.test(
      sql,
    ),
);
record(
  "14 only Core/admin actor types may decide requests",
  /decision_actor_type in \('core_service', 'admin_user'\)/.test(sql),
);

// ---------------------------------------------------------------------------
// 3. Safe-context fences
// ---------------------------------------------------------------------------
record(
  "15 recursive DB safe-context helper exists",
  /create or replace function public\.qf_automation_context_has_forbidden_key/.test(
    sql,
  ) &&
    /public\.qf_automation_context_has_forbidden_key\(v_child\)/.test(sql),
);
for (const token of [
  "forcesend",
  "ignoreconsent",
  "bypasssuppression",
  "recipient",
  "phone",
  "template",
  "provideraccountid",
  "accesstoken",
  "secret",
  "creditdelta",
  "assignvendorids",
  "desiredstatus",
  "retryanyway",
  "skipvalidation",
]) {
  record(
    `16 safe-context DB fence rejects ${token}`,
    sql.includes(`'${token}'`),
  );
}
record(
  "17 safe_context must be an object and is capped at 16 KiB",
  /jsonb_typeof\(safe_context\) = 'object'/.test(sql) &&
    /octet_length\(safe_context::text\) <= 16384/.test(sql),
);

// ---------------------------------------------------------------------------
// 4. Request decision / idempotency
// ---------------------------------------------------------------------------
const createRequest = sliceFunction(
  "qf_create_automation_action_request_v1",
);
const decideRequest = sliceFunction(
  "qf_decide_automation_action_request_v1",
);
record(
  "18 request idempotency is insert-first",
  /on conflict \(idempotency_key\) do nothing/.test(createRequest),
);
record(
  "19 duplicate request compares immutable scope/evidence before replay",
  [
    "v_row.id is distinct from p_request_id",
    "v_row.action_type is distinct from p_action_type",
    "v_row.entity_type is distinct from p_entity_type",
    "v_row.entity_id is distinct from p_entity_id",
    "v_row.source is distinct from p_source",
    "v_row.requested_by_type is distinct from p_requested_by_type",
    "v_row.requested_by_id is distinct from p_requested_by_id",
    "v_row.requested_at is distinct from p_requested_at",
    "v_row.correlation_id is distinct from p_correlation_id",
    "v_row.safe_context is distinct from",
  ].every((needle) => createRequest.includes(needle)),
);
record(
  "20 changed duplicate request fails with explicit idempotency conflict",
  createRequest.includes(
    "AUTOMATION_ACTION_REQUEST_IDEMPOTENCY_CONFLICT",
  ),
);
record(
  "21 decision is locked before transition",
  /where id = p_request_id\s+for update/.test(decideRequest),
);
record(
  "22 only requested may transition to a decision",
  /if v_row\.decision_status = 'requested'/.test(decideRequest),
);
record(
  "23 exact decision replay is idempotent",
  /v_row\.decision_status = p_decision/.test(decideRequest) &&
    /v_row\.decision_id = p_decision_id/.test(decideRequest) &&
    /v_row\.decision_reason_code = p_reason_code/.test(decideRequest),
);
record(
  "24 conflicting second decision is terminally refused",
  decideRequest.includes("AUTOMATION_ACTION_REQUEST_DECISION_CONFLICT"),
);
record(
  "24b request insert guard universally requires pristine requested state",
  sliceFunction("qf_guard_automation_action_request_insert").includes(
    "every action request must be inserted undecided",
  ) &&
    sql.includes("trg_automation_action_request_insert_guard"),
);

// ---------------------------------------------------------------------------
// 5. Job authorization / idempotency
// ---------------------------------------------------------------------------
const createJob = sliceFunction("qf_create_automation_job_v1");
const jobInsertGuard = sliceFunction("qf_guard_automation_job_insert");
record(
  "25 job insert trigger universally requires authorized request",
  jobInsertGuard.includes("v_status <> 'authorized'") &&
    sql.includes("trg_automation_job_insert_guard"),
);
record(
  "26 job RPC independently requires authorized request",
  createJob.includes("v_request.decision_status <> 'authorized'") &&
    createJob.includes("AUTOMATION_CORE_AUTHORIZATION_REQUIRED"),
);
record(
  "27 exactly one job per action request is indexed",
  /create unique index uq_automation_jobs_action_request[\s\S]{0,100}action_request_id/.test(
    sql,
  ),
);
record(
  "28 job creation uses action-request conflict idempotency",
  /on conflict \(action_request_id\) do nothing/.test(createJob),
);
record(
  "29 replay cannot silently widen max-attempt budget",
  /v_job\.max_attempts <> p_max_attempts/.test(createJob) &&
    createJob.includes("AUTOMATION_JOB_IDEMPOTENCY_CONFLICT"),
);
record(
  "30 retry budget is bounded 1..10",
  /max_attempts between 1 and 10/.test(sql),
);

// ---------------------------------------------------------------------------
// 6. Claim semantics
// ---------------------------------------------------------------------------
const claim = sliceFunction("qf_claim_automation_job_v1");
record(
  "31 claim uses FOR UPDATE SKIP LOCKED",
  /for update skip locked/.test(claim),
);
record(
  "32 claim can take pending due jobs",
  /j\.status = 'pending' and j\.available_at <= now\(\)/.test(claim),
);
record(
  "33 claim can take retry-scheduled due jobs",
  /j\.status = 'retry_scheduled'[\s\S]{0,160}j\.next_retry_at <= now\(\)/.test(
    claim,
  ),
);
record(
  "34 processing is not an eligible claim status",
  !/j\.status\s*=\s*'processing'/.test(claim),
  "stale processing may not be blindly reclaimed",
);
record(
  "35 claim never mentions stale-lock recovery",
  !/stale_lock_after|now\(\)\s*-\s*p_/i.test(claim),
);
record(
  "36 claim refuses exhausted retry budgets",
  /j\.attempt_count < j\.max_attempts/.test(claim),
);
record(
  "37 claim increments attempt_count exactly once",
  /attempt_count = attempt_count \+ 1/.test(claim),
);
record(
  "38 claim inserts the attempt in the same RPC",
  /insert into public\.automation_execution_attempts/.test(claim),
);
record(
  "39 claim returns attempt number and max attempts",
  /attempt_number integer,\s+max_attempts integer/.test(claim) &&
    /v_job\.max_attempts/.test(claim),
);
record(
  "40 attempt insert guard binds attempt to current processing owner",
  /v_job\.status <> 'processing'/.test(
    sliceFunction("qf_guard_automation_attempt_insert"),
  ) &&
    /v_job\.attempt_count <> new\.attempt_number/.test(
      sliceFunction("qf_guard_automation_attempt_insert"),
    ) &&
    /v_job\.locked_by is distinct from new\.worker_id/.test(
      sliceFunction("qf_guard_automation_attempt_insert"),
    ),
);

// ---------------------------------------------------------------------------
// 7. Completion / uncertainty / retry
// ---------------------------------------------------------------------------
const complete = sliceFunction("qf_complete_automation_attempt_v1");
record(
  "41 completion locks the job",
  /where id = p_job_id\s+for update/.test(complete),
);
record(
  "42 completion proves worker ownership",
  /v_job\.status <> 'processing'/.test(complete) &&
    /v_job\.locked_by is distinct from p_worker_id/.test(complete),
);
record(
  "43 completion locks and proves current attempt",
  /where id = p_attempt_id\s+for update/.test(complete) &&
    /v_attempt\.attempt_number <> v_job\.attempt_count/.test(complete),
);
record(
  "44 success maps to succeeded",
  /when 'success' then 'succeeded'/.test(complete),
);
record(
  "45 definitive failure maps to failed",
  /when 'definitive_failure' then 'failed'/.test(complete),
);
record(
  "46 uncertain maps to uncertain",
  /when 'uncertain' then 'uncertain'/.test(complete),
);
record(
  "47 only retryable_failure enters retry branch",
  /if p_classification = 'retryable_failure' then/.test(complete),
);
record(
  "48 retry exhaustion maps to dead_letter",
  /v_job\.attempt_count >= v_job\.max_attempts[\s\S]{0,400}v_next_status := 'dead_letter'/.test(
    complete,
  ),
);
record(
  "49 retry requires a future next_retry_at when attempts remain",
  /p_next_retry_at is null or p_next_retry_at <= now\(\)/.test(complete) &&
    complete.includes("AUTOMATION_NEXT_RETRY_AT_INVALID"),
);
record(
  "50 terminal classifications refuse next_retry_at",
  complete.includes("AUTOMATION_TERMINAL_RESULT_NEXT_RETRY_FORBIDDEN"),
);
record(
  "51 uncertain has no route to retry_scheduled",
  !/when 'uncertain' then 'retry_scheduled'/.test(complete),
);
record(
  "52 current attempt is completed before job leaves processing",
  complete.indexOf("update public.automation_execution_attempts") <
    complete.indexOf("update public.automation_jobs"),
);
record(
  "53 job update trigger independently requires matching completed attempt",
  /v_attempt_status is distinct from 'completed'/.test(
    sliceFunction("qf_guard_automation_job_update"),
  ) &&
    /v_attempt_classification is distinct from new\.last_result_classification/.test(
      sliceFunction("qf_guard_automation_job_update"),
    ),
);

// ---------------------------------------------------------------------------
// 8. History protection
// ---------------------------------------------------------------------------
record(
  "54 request identity/provenance update guard exists",
  /action-request identity\/provenance is immutable/.test(sql),
);
record(
  "55 terminal jobs are immutable",
  /terminal automation jobs are immutable/.test(sql),
);
record(
  "56 attempt may complete only once",
  /execution attempt may transition only started -> completed once/.test(sql),
);
record(
  "57 all three tables have DELETE and TRUNCATE blockers",
  [
    "trg_automation_action_requests_no_delete",
    "trg_automation_action_requests_no_truncate",
    "trg_automation_jobs_no_delete",
    "trg_automation_jobs_no_truncate",
    "trg_automation_attempts_no_delete",
    "trg_automation_attempts_no_truncate",
  ].every((name) => sql.includes(name)),
);
record(
  "58 migration self-verifies exactly 12 lifecycle/history triggers",
  /if v_count <> 12 then/.test(sql) &&
    /expected 12 automation lifecycle\/history triggers/.test(sql),
);

// ---------------------------------------------------------------------------
// 9. ACL / RLS
// ---------------------------------------------------------------------------
for (const table of [
  "automation_action_requests",
  "automation_jobs",
  "automation_execution_attempts",
]) {
  record(
    `59 RLS enabled on ${table}`,
    sql.includes(`alter table public.${table} enable row level security`),
  );
  record(
    `60 service_role gets SELECT only on ${table}`,
    sql.includes(`grant select on table public.${table} to service_role`) &&
      !new RegExp(
        `grant\\s+(?:insert|update|delete|truncate|all)[\\s\\S]{0,80}public\\.${table}[\\s\\S]{0,50}service_role`,
        "i",
      ).test(execSql),
  );
}
record(
  "61 default ACLs are reset including service_role",
  [
    "automation_action_requests",
    "automation_jobs",
    "automation_execution_attempts",
  ].every((table) =>
    new RegExp(
      `revoke all on table public\\.${table}[\\s\\S]{0,80}service_role`,
      "i",
    ).test(sql),
  ),
);

const rpcNames = [
  "qf_create_automation_action_request_v1",
  "qf_decide_automation_action_request_v1",
  "qf_create_automation_job_v1",
  "qf_claim_automation_job_v1",
  "qf_complete_automation_attempt_v1",
];
for (const name of rpcNames) {
  const body = sliceFunction(name);
  record(
    `62 ${name} is SECURITY DEFINER`,
    /\bsecurity definer\b/i.test(body),
  );
  record(
    `63 ${name} has fixed search_path`,
    /set search_path = pg_catalog, public, pg_temp/.test(body),
  );
  record(
    `64 ${name} is granted to service_role`,
    new RegExp(
      `grant execute on function public\\.${name}[\\s\\S]{0,700}to service_role`,
      "i",
    ).test(sql),
  );
}
record(
  "65 no application table write grant is given directly to service_role",
  !/grant\s+(insert|update|delete|truncate|all)\s+on\s+table\s+public\.automation_/i.test(
    execSql,
  ),
);

// ---------------------------------------------------------------------------
// 10. No transport/provider/business side effects
// ---------------------------------------------------------------------------
record(
  "66 migration creates no network extension",
  !/\bcreate\s+extension\b[\s\S]{0,80}(pg_net|http|dblink)/i.test(execSql),
);
record(
  "67 migration performs no communication-message write",
  !/\b(insert\s+into|update|delete\s+from)\s+public\.communication_messages\b/i.test(
    execSql,
  ),
);
record(
  "68 migration performs no assignment write",
  !/\b(insert\s+into|update|delete\s+from)\s+public\.lead_assignments\b/i.test(
    execSql,
  ),
);
record(
  "69 migration performs no credit write",
  !/\b(insert\s+into|update|delete\s+from)\s+public\.vendor_credit_logs\b/i.test(
    execSql,
  ),
);
record(
  "70 migration self-verifies no DB network extension",
  /extname in \('pg_net', 'http', 'dblink'\)/.test(sql),
);

// ---------------------------------------------------------------------------
// 11. TypeScript persistence boundary
// ---------------------------------------------------------------------------
record(
  "71 persistence types contain the closed job lifecycle",
  [
    '"pending"',
    '"processing"',
    '"retry_scheduled"',
    '"succeeded"',
    '"failed"',
    '"uncertain"',
    '"dead_letter"',
    '"cancelled"',
  ].every((value) => types.includes(value)),
);
record(
  "72 claim type carries max_attempts for final-attempt classification",
  /max_attempts: number/.test(types),
);
record(
  "73 service validates the pure 50.1A request envelope before persistence",
  service.includes("validateCoreActionRequestEnvelope(request)"),
);
record(
  "74 service validates action registration",
  service.includes("isAutomationActionType(request.actionType)"),
);
record(
  "75 service validates source/action requestability",
  service.includes(
    "canSourceRequestAction(request.source, request.actionType)",
  ),
);
for (const rpc of rpcNames) {
  record(
    `76 service calls ${rpc}`,
    service.includes(`.rpc("${rpc}"`),
  );
}
record(
  "77 service performs no direct insert/update/delete table mutation",
  !/\.(insert|update|delete)\s*\(/.test(service),
);
record(
  "78 service performs no fetch/network call",
  !/\bfetch\s*\(/.test(service) &&
    !/axios|https?:\/\//i.test(service),
);
record(
  "79 service imports no Meta/provider adapter",
  !/metaCloud|metaWhatsApp|providerAdapter|communicationService/i.test(service),
);
record(
  "80 service reconstructs authorized 50.1A evidence from DB",
  service.includes("toCoreAuthorizedAction") &&
    service.includes("decision_status !== \"authorized\""),
);
record(
  "81 service exposes executor envelope only for exact claimed processing evidence",
  service.includes("getClaimedAutomationJobEnvelope") &&
    service.includes("job.status !== \"processing\"") &&
    service.includes("job.locked_by !== workerId") &&
    service.includes("job.attempt_count !== claim.attempt_number") &&
    service.includes("buildAutomationJobEnvelope(toCoreAuthorizedAction(request), job.id)"),
);
record(
  "82 service refuses retry timestamps for non-retryable classification",
  /!isAutomaticRetryAllowed\(input\.classification\)[\s\S]{0,100}input\.nextRetryAt != null/.test(
    service,
  ),
);

// ---------------------------------------------------------------------------
// 12. Documentation/non-action lock
// ---------------------------------------------------------------------------
record(
  "83 documentation explicitly keeps Jarvis request-only",
  doc.includes("Jarvis does not:") &&
    doc.includes("create jobs") &&
    doc.includes("call n8n") &&
    doc.includes("call Meta"),
);
record(
  "84 documentation preserves old preview/workflow non-activation boundary",
  doc.includes("n8n activation:") &&
    doc.includes("NONE"),
);
record(
  "85 documentation records no blind stale-processing reclaim",
  doc.includes("no stale-processing reclaim") ||
    doc.includes("no `processing` eligibility"),
);
record(
  "86 documentation requires staging before production",
  doc.includes("staging controlled preflight") &&
    doc.includes("Production application requires its own explicit reviewed cutover"),
);

const failed = results.filter((r) => !r.ok);
for (const result of results) {
  console.log(
    `${result.ok ? "PASS" : "FAIL"} ${result.name}${
      result.detail ? ` — ${result.detail}` : ""
    }`,
  );
}
console.log("");
console.log(
  `QF-MVP-50.1B: ${results.length - failed.length}/${results.length} PASS`,
);

if (failed.length) {
  process.exitCode = 1;
} else {
  console.log("QF_MVP_50_1B_DURABLE_AUTOMATION_PERSISTENCE_READY");
}
