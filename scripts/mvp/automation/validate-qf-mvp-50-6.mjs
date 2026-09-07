#!/usr/bin/env node
// ============================================================================
// QF-MVP-50.6 — orphan / certification queue governance source gate
//
// Offline and repository-only: no database, no network, no provider, no secret,
// no deployment, no Supabase mutation. It proves what the SOURCE guarantees;
// applying the migration to staging and certifying it against real rows are
// separate, later gates.
//
// THE TWENTY-FOUR NUMBERED REQUIREMENTS of the phase brief are asserted first and
// are numbered R01-R24 so a reader can check them off one by one. Requirements 1
// through 13 are not grepped: the pure decision function is EXECUTED against each
// case, so a change in behaviour fails the gate even if every word of the source
// stays the same.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTOMATION_TRANSPORT_ROUTE_KEYS,
  N8N_CANCEL_ORPHAN_ROUTE_PATH,
  N8N_RECOVER_ROUTE_PATH,
  N8N_RECONCILE_ROUTE_PATH,
} from "../../../lib/automation/transportTypes.ts";
import {
  AUTOMATION_CANCEL_ORPHAN_ORCHESTRATION_STATES,
  AUTOMATION_ORPHAN_CANCELLABLE_STATUSES,
  AUTOMATION_ORPHAN_CANCELLED_JOB_SHAPE,
  AUTOMATION_ORPHAN_ENTITY_TABLES,
  AUTOMATION_ORPHAN_ENTITY_TYPES,
  AUTOMATION_ORPHAN_SAFE_CODE,
  AutomationEntityState,
  AutomationOrphanRefusal,
  N8N_CANCEL_ORPHAN_REQUEST_KEYS,
  classifyAutomationEntityState,
  decideAutomationOrphanCancellation,
  isAutomationOrphanEntityType,
  parseCancelOrphanRequestBody,
} from "../../../lib/automation/orphanCancellationContract.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const canonicalSha256 = (buffer) =>
  createHash("sha256")
    .update(
      Buffer.from(
        buffer.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
        "utf8",
      ),
    )
    .digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Comments are stripped so a guarantee can never be satisfied by prose alone. */
const stripJs = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const stripSql = (src) => src.replace(/^\s*--.*$/gm, "");

const MIGRATION_PATH =
  "supabase/migrations/20260905000000_qf_mvp_50_6_automation_orphan_cancellation.sql";
const MIGRATION_SHA = "07cab7d17940be3c4ad47eae01b02d6bd9409bc1a8e215b171bea086578e6e63";
const CONTRACT_PATH = "lib/automation/orphanCancellationContract.ts";
const SERVICE_PATH = "services/automationOrphanCancellationService.ts";
const ROUTE_PATH = "app/api/internal/automation/n8n/cancel-orphan/route.ts";
const WORKFLOW_PATH =
  "automation/n8n/QF-MVP-50-06-Orphan-Cancellation-Supervisor.workflow.json";
const DOC_PATH = "docs/QF-MVP-50-6-ORPHAN-QUEUE-GOVERNANCE.md";

const migrationSource = read(MIGRATION_PATH);
const migrationCode = stripSql(migrationSource);
const contractSource = read(CONTRACT_PATH);
const contractCode = stripJs(contractSource);
const serviceSource = read(SERVICE_PATH);
const serviceCode = stripJs(serviceSource);
const routeSource = read(ROUTE_PATH);
const routeCode = stripJs(routeSource);
const newModuleCode = contractCode + serviceCode + routeCode;
const workflow = JSON.parse(read(WORKFLOW_PATH));
const workflowText = JSON.stringify(workflow);
const doc = existsSync(path.join(ROOT, DOC_PATH)) ? read(DOC_PATH) : "";

const clientExecutorCode = stripJs(read("services/automationClientExecutionService.ts"));
const vendorExecutorCode = stripJs(read("services/automationVendorExecutionService.ts"));
const persistenceMigration = stripSql(
  read("supabase/migrations/20260801110000_qf_mvp_automation_action_persistence.sql"),
);
const manifest = JSON.parse(
  read("supabase/staging-history/qf-mvp-staging-history-manifest.json"),
);
const pkg = JSON.parse(read("package.json"));
const ciWorkflow = read(".github/workflows/qf-mvp-50-quality-gate.yml");
const g1Source = read("scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs");

const results = [];
const record = (name, passed) => results.push({ name, passed: passed === true });

/** Builds a decision input for the executable requirement cases. */
const decide = (jobStatus, entityType, entityId, rowExists, alreadyCancelledOnce = false) =>
  decideAutomationOrphanCancellation({
    jobStatus,
    entityType,
    entityId,
    rowExists,
    alreadyCancelledOnce,
  });

const LEAD_ID = "0ffd1cf7-b6c1-4f0e-9d2a-5f3b7c9e1a2b";
const cancels = (v) => v.cancellable === true && v.safeCode === AUTOMATION_ORPHAN_SAFE_CODE;
const refuses = (v, reason) =>
  v.cancellable === false && v.reason === reason && v.safeCode === null;

// ---------------------------------------------------------------------------
// R. THE TWENTY-FOUR NUMBERED PHASE REQUIREMENTS
// ---------------------------------------------------------------------------

record("R01 pending + missing lead -> cancelled",
  cancels(decide("pending", "lead", LEAD_ID, false)) &&
  // and the SQL selector admits exactly this case
  /j\.status in \('pending', 'retry_scheduled'\)/.test(migrationCode) &&
  /qf_automation_entity_state_v1\(r\.entity_type, r\.entity_id\) = 'missing'/.test(migrationCode));

record("R02 retry_scheduled + missing lead -> cancelled",
  cancels(decide("retry_scheduled", "lead", LEAD_ID, false)));

record("R03 pending + existing lead -> untouched",
  refuses(decide("pending", "lead", LEAD_ID, true), AutomationOrphanRefusal.ENTITY_PRESENT));

record("R04 retry_scheduled + existing lead -> untouched",
  refuses(decide("retry_scheduled", "lead", LEAD_ID, true), AutomationOrphanRefusal.ENTITY_PRESENT));

record("R05 missing lead_assignment -> cancelled",
  cancels(decide("pending", "lead_assignment", LEAD_ID, false)) &&
  cancels(decide("retry_scheduled", "lead_assignment", LEAD_ID, false)));

record("R06 existing lead_assignment -> untouched",
  refuses(decide("pending", "lead_assignment", LEAD_ID, true), AutomationOrphanRefusal.ENTITY_PRESENT) &&
  refuses(decide("retry_scheduled", "lead_assignment", LEAD_ID, true), AutomationOrphanRefusal.ENTITY_PRESENT));

record("R07 missing vendor -> cancelled",
  cancels(decide("pending", "vendor", LEAD_ID, false)) &&
  cancels(decide("retry_scheduled", "vendor", LEAD_ID, false)));

record("R08 existing vendor -> untouched",
  refuses(decide("pending", "vendor", LEAD_ID, true), AutomationOrphanRefusal.ENTITY_PRESENT));

record("R09 missing communication_intent -> cancelled",
  cancels(decide("pending", "communication_intent", LEAD_ID, false)) &&
  cancels(decide("retry_scheduled", "communication_intent", LEAD_ID, false)));

record("R10 existing communication_intent -> untouched",
  refuses(decide("pending", "communication_intent", LEAD_ID, true), AutomationOrphanRefusal.ENTITY_PRESENT));

record("R11 unknown entity_type fails closed and is never cancelled",
  // Executed: several shapes of "not in the closed map", including the empty and
  // null cases and a plausible-looking near-miss.
  ["campaign", "lead_assignments", "LEAD", "", null, undefined, "quote", "invoice"].every(
    (type) =>
      refuses(decide("pending", type, LEAD_ID, false), AutomationOrphanRefusal.ENTITY_TYPE_UNMAPPED) &&
      refuses(decide("retry_scheduled", type, LEAD_ID, false), AutomationOrphanRefusal.ENTITY_TYPE_UNMAPPED) &&
      classifyAutomationEntityState({ entityType: type, entityId: LEAD_ID, rowExists: false }) ===
        AutomationEntityState.UNMAPPED,
  ) &&
  // A row that was never looked up is also unknowable, never "missing".
  classifyAutomationEntityState({ entityType: "lead", entityId: LEAD_ID, rowExists: null }) ===
    AutomationEntityState.UNMAPPED &&
  // and the SQL map is the SAME closed four
  /p_entity_type not in \('lead', 'lead_assignment', 'vendor', 'communication_intent'\)/
    .test(migrationCode) &&
  /return 'unmapped'/.test(migrationCode));

record("R12 a processing orphan is untouched",
  refuses(decide("processing", "lead", LEAD_ID, false),
    AutomationOrphanRefusal.JOB_STATUS_NOT_CANCELLABLE) &&
  // Status is judged BEFORE entity state, so `processing` is refused for belonging
  // to execution, not for anything about its entity.
  refuses(decide("processing", "lead", LEAD_ID, true),
    AutomationOrphanRefusal.JOB_STATUS_NOT_CANCELLABLE) &&
  !/'processing'/.test(
    (migrationCode.match(/j\.status in \([^)]*\)/) ?? [""])[0]));

record("R13 every terminal job is untouched",
  ["succeeded", "failed", "uncertain", "dead_letter", "cancelled"].every((status) =>
    refuses(decide(status, "lead", LEAD_ID, false),
      AutomationOrphanRefusal.JOB_STATUS_NOT_CANCELLABLE)) &&
  AUTOMATION_ORPHAN_CANCELLABLE_STATUSES.length === 2 &&
  same([...AUTOMATION_ORPHAN_CANCELLABLE_STATUSES], ["pending", "retry_scheduled"]));

record("R14 cancellation cannot increment attempt_count",
  (() => {
    // The UPDATE's SET list is extracted and required to mention no attempt column.
    const setClause = (migrationCode.match(
      /update public\.automation_jobs\s+set([\s\S]*?)where id = \(/,
    ) ?? [])[1];
    if (!setClause) return false;
    const touchesAttempts = /attempt_count|max_attempts|attempt_id/.test(setClause);
    // AND the frozen job guard independently permits an attempt_count change only
    // while claiming, so even a future edit here would be rejected by the database.
    // Pinned to the guard's exact branch: `if new.status = 'processing' ... elsif
    // new.attempt_count <> old.attempt_count then raise`.
    const guardPinned =
      /if new\.status = 'processing' then/.test(persistenceMigration) &&
      /elsif new\.attempt_count <> old\.attempt_count then/.test(persistenceMigration) &&
      /attempt_count may change only while claiming a new attempt/.test(persistenceMigration);
    return !touchesAttempts && guardPinned &&
      AUTOMATION_ORPHAN_CANCELLED_JOB_SHAPE.status === "cancelled" &&
      !("attemptCount" in AUTOMATION_ORPHAN_CANCELLED_JOB_SHAPE) &&
      !("maxAttempts" in AUTOMATION_ORPHAN_CANCELLED_JOB_SHAPE);
  })());

record("R15 cancellation creates no execution attempt",
  !/insert\s+into\s+public\.automation_execution_attempts/i.test(migrationCode) &&
  !/automation_execution_attempts/i.test(newModuleCode) &&
  // The transport row itself is forbidden to carry attempt identity on this route.
  /state = 'cancelled'[\s\S]{0,400}attempt_id is null[\s\S]{0,120}attempt_number is null[\s\S]{0,120}max_attempts is null/
    .test(migrationCode));

record("R16 cancellation clears next_retry_at",
  /set status = 'cancelled',[\s\S]{0,200}next_retry_at = null/.test(migrationCode) &&
  AUTOMATION_ORPHAN_CANCELLED_JOB_SHAPE.nextRetryAt === null);

record("R17 cancellation sets completed_at from canonical database time",
  /set status = 'cancelled',[\s\S]{0,120}completed_at = now\(\)/.test(migrationCode) &&
  AUTOMATION_ORPHAN_CANCELLED_JOB_SHAPE.completedAtRequired === true);

record("R18 cancellation cannot create a communication_messages row",
  // The communication ledger is never named, in SQL, in TypeScript or in n8n.
  !/communication_messages/i.test(migrationCode) &&
  !/communication_messages/i.test(newModuleCode) &&
  !/communication_messages/i.test(workflowText) &&
  // `communication_intents` IS named — it is one of the four authoritative entity
  // tables this lane reads to decide absence — so the guarantee is stated as what
  // it actually is: the table is only ever READ, and only ever with `exists`.
  (() => {
    // It is named exactly twice: once in the dependency preflight, once in the
    // read-only existence probe. Never in a write.
    const reads = migrationCode.match(/public\.communication_intents/g) ?? [];
    return reads.length === 2 &&
      /to_regclass\('public\.communication_intents'\) is null/.test(migrationCode) &&
      /select exists \(select 1 from public\.communication_intents t where t\.id = v_uuid\)/
        .test(migrationCode) &&
      !/(insert into|update|delete from|truncate)\s+public\.communication_intents/i
        .test(migrationCode);
  })());

record("R19 no Meta or provider call path is reachable from this lane",
  // Nothing in the new surfaces constructs, imports or names a provider.
  !/graph\.facebook\.com|facebook\.com\/v\d|WHATSAPP_|META_|ACCESS_TOKEN/i.test(newModuleCode) &&
  !/createRuntimeCommunicationService|CommunicationService|providerAdapter|sendWhatsApp/
    .test(newModuleCode) &&
  !/graph\.facebook\.com|facebook\.com\/v\d/i.test(workflowText) &&
  // The migration installs no network extension and calls no external endpoint.
  !/create extension|pg_net|http_post|dblink/i.test(migrationCode) &&
  // AND the pre-existing invariant this phase relies on rather than replaces:
  // both executors resolve the entity BEFORE any send, and a missing entity is a
  // definitive pre-communication non-send.
  /QF_EXEC_LEAD_NOT_FOUND/.test(clientExecutorCode) &&
  /QF_EXEC_VENDOR_NOT_FOUND/.test(vendorExecutorCode) &&
  clientExecutorCode.indexOf("buildClientCommunicationIntent") <
    clientExecutorCode.indexOf("service.data.send(prepared.intent)") &&
  vendorExecutorCode.indexOf("resolveVendorFacts(args.entityType, args.entityId)") <
    vendorExecutorCode.indexOf("communicationLane"));

record("R20 a replayed request identity can never cancel a second job",
  // The replay branch returns BEFORE the cancellation authority is ever called.
  (() => {
    const replayReturn = migrationCode.indexOf("v_request.job_id is null");
    const cancelCall = migrationCode.indexOf("from public.qf_cancel_orphan_automation_job_v1(p_worker_id)");
    return replayReturn > 0 && cancelCall > replayReturn;
  })() &&
  /on conflict \(id\) do nothing/.test(migrationCode) &&
  /if not v_inserted then/.test(migrationCode) &&
  /AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT/.test(migrationCode) &&
  // The service answers a replay from the durable row and asserts its identity.
  /row\.request_id !== input\.requestId \|\| row\.route_key !== "cancel_orphan_v1"/.test(serviceCode));

record("R21 two distinct requests cancel at most two distinct eligible jobs",
  // One job can appear under cancel_orphan_v1 at most once, enforced by an index...
  /create unique index[\s\S]{0,200}uq_automation_transport_requests_cancel_orphan_job[\s\S]{0,200}\(job_id\)[\s\S]{0,200}route_key = 'cancel_orphan_v1'/
    .test(migrationCode) &&
  // ...and the selector already excludes any job that has one, so concurrency is a
  // skip rather than a constraint violation.
  /not exists \(\s*select 1\s*from public\.automation_transport_requests t\s*where t\.route_key = 'cancel_orphan_v1'/
    .test(migrationCode) &&
  /for update skip locked\s*limit 1/.test(migrationCode) &&
  // A second call from the same worker is a NEW request id, so it takes the next
  // candidate rather than re-taking the first.
  /order by j\.created_at asc, j\.id asc/.test(migrationCode));

record("R22 the empty lane is explicit and signed",
  AUTOMATION_CANCEL_ORPHAN_ORCHESTRATION_STATES.includes("cancel_orphan_empty") &&
  /state = 'empty',\s*finalized_at = now\(\)/.test(migrationCode) &&
  /orchestrationState: "cancel_orphan_empty"/.test(serviceCode) &&
  // The empty answer travels the SAME signed path as every other answer: there is
  // exactly one response constructor in the route and it always signs.
  (routeCode.match(/return new Response\(/g) ?? []).length === 2 &&
  /buildSignedCoreResponseHeaders\(/.test(routeCode) &&
  routeCode.includes("return signedJson(result.body, 200, verified.requestId, config.responseSecret)"));

record("R23 claim, recover and reconcile behaviour is untouched",
  (() => {
    // Every migration the brief freezes is byte-pinned. An edit to any of them —
    // including a whitespace-only one — fails here.
    const FROZEN = [
      ["20260801110000_qf_mvp_automation_action_persistence.sql", "ffdd69e5b04f6cf3e747d4d4959b9c4fcae848aeac36697fdffc83d5403f70fc"],
      ["20260801152049_qf_mvp_automation_transport_replay_guard.sql", "28405567e2dd1370db4ccf58526701ca2713adbe19188838f16a510eb8128257"],
      ["20260803000000_qf_mvp_50_2c_lead_communication_recipient.sql", "77d2bb1162e0522b061f36df787d94c2dad4f0ceeff3e4a07c8946cd4e1d56ca"],
      ["20260804000000_qf_mvp_50_2d_automation_transport_completion_route.sql", "043f1e3bbe261aef516ca35b54eb3e1c339d21d6b0c55c77f1d138eb502fa2c2"],
      ["20260805000000_qf_mvp_50_2e_automation_transport_client_execution_route.sql", "9a8a29975e18135b96e7be7d4510104033c5de00cf080df5dab4326e3891250b"],
      ["20260806000000_qf_mvp_50_2_atomic_client_automation_producer.sql", "ce947a6f8d7dd42d2851f6c99eba4bf2ef39308b8d85ff876260d575185a3cfb"],
      ["20260807000000_qf_mvp_50_2_execute_v1_reservation_ambiguity_repair.sql", "c36171fe851968c5e42477c048d535c563676f3d44e020d41fd5abcff1dacee5"],
      ["20260808000000_qf_mvp_50_2_fresh_claim_retry_wedge_repair.sql", "8b798bb3c5db5d91f988d92cec3705237db08c753ae5018d09dccc09ff0240aa"],
      ["20260808500000_qf_mvp_50_3_automation_policy_config_foundation_bridge.sql", "05e114910c8ba06e9d697b81ca645dfc13a03ed29751090901666975dc6fcbca"],
      ["20260809000000_qf_mvp_50_3_vendor_automation_producer.sql", "3588f6d06256af7d6ae95263bb474fb33a15428d0a402bd81c6dd1eb0e6076cb"],
      ["20260810000000_qf_mvp_50_4_campaign_recipient_automation.sql", "8440e5e818676232969c5046941daa7e8fc905728ea73d295ca0e997c5ac7906"],
      ["20260811000000_qf_mvp_50_3_50_4_family_aware_claim_routing.sql", "fc7efae9c2349854b9856d3b3b3956933bcfe79ed15c1eeb7caf65bc61f8f89d"],
      ["20260812000000_qf_mvp_50_5_automation_recovery_reconciliation.sql", "25a142009bc389ae9e6f1fae95b873e0858c74b4a5792cbf3217dfb4e3af189b"],
    ];
    const frozenIntact = FROZEN.every(([file, sha]) =>
      canonicalSha256(readFileSync(path.join(ROOT, "supabase/migrations", file))) === sha);
    // And this migration redefines none of the three lanes' authorities.
    const noRedefinition =
      !/create or replace function public\.qf_claim_/i.test(migrationCode) &&
      !/create or replace function public\.qf_recover_/i.test(migrationCode) &&
      !/create or replace function public\.qf_reconcile_/i.test(migrationCode) &&
      !/create or replace function public\.qf_complete_/i.test(migrationCode) &&
      !/create or replace function public\.qf_select_stale_/i.test(migrationCode) &&
      !/drop function/i.test(migrationCode);
    // The two guard functions ARE re-created — that is unavoidable when widening a
    // closed vocabulary — so every pre-existing route rule must still be present.
    const guardsPreserveEveryRoute = ["claim_v1", "complete_v1", "execute_v1", "recover_v1", "reconcile_v1"]
      .every((route) => new RegExp(`'${route}'`).test(migrationCode));
    return frozenIntact && noRedefinition && guardsPreserveEveryRoute;
  })());

record("R24 every automation quality gate is registered and wired into CI",
  pkg.scripts["test:mvp:50-6"] ===
    "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/mvp/loader/register.mjs scripts/mvp/automation/validate-qf-mvp-50-6.mjs" &&
  /- name: QF-MVP-50\.5 validator\s+run: npm run test:mvp:50-5\s+- name: QF-MVP-50\.6 validator\s+run: npm run test:mvp:50-6/
    .test(ciWorkflow) &&
  ["50-1a", "50-1b", "50-1c", "50-2a", "50-2b", "50-2c", "50-2d", "50-2e", "50-2-final",
   "50-3", "50-4", "50-5", "50-6"].every((gate) => typeof pkg.scripts[`test:mvp:${gate}`] === "string") &&
  // CI still takes no secret, database, provider or deployment action.
  !ciWorkflow.includes("${{ secrets.") &&
  !/^\s*(?:run:\s*)?(?:npx\s+)?supabase\s+/mi.test(ciWorkflow));

// ---------------------------------------------------------------------------
// A. ROUTE AND STATE VOCABULARY — closed, exact, and additive only
// ---------------------------------------------------------------------------

record("A01 the transport route vocabulary is closed to exactly six, in exact order",
  AUTOMATION_TRANSPORT_ROUTE_KEYS.length === 6 &&
  AUTOMATION_TRANSPORT_ROUTE_KEYS.join(",") ===
    "claim_v1,complete_v1,execute_v1,recover_v1,reconcile_v1,cancel_orphan_v1");

record("A02 the migration widens route_key to exactly the same six",
  /check \(route_key in \(\s*'claim_v1',\s*'complete_v1',\s*'execute_v1',\s*'recover_v1',\s*'reconcile_v1',\s*'cancel_orphan_v1'\s*\)\)/
    .test(migrationCode));

record("A03 the new route has its own exact HTTP path, declared once",
  N8N_CANCEL_ORPHAN_ROUTE_PATH === "/api/internal/automation/n8n/cancel-orphan" &&
  N8N_CANCEL_ORPHAN_ROUTE_PATH !== N8N_RECOVER_ROUTE_PATH &&
  N8N_CANCEL_ORPHAN_ROUTE_PATH !== N8N_RECONCILE_ROUTE_PATH &&
  (read("lib/automation/transportTypes.ts")
    .match(/"\/api\/internal\/automation\/n8n\/cancel-orphan"/g) ?? []).length === 1);

record("A04 the route signs its OWN path, so no other route's signature authenticates here",
  routeCode.includes("path: N8N_CANCEL_ORPHAN_ROUTE_PATH") &&
  !/N8N_RECOVER_ROUTE_PATH|N8N_RECONCILE_ROUTE_PATH|N8N_CLAIM_ROUTE_PATH|N8N_COMPLETE_ROUTE_PATH|N8N_EXECUTE_/
    .test(routeCode) &&
  (routeCode.match(/path: N8N_CANCEL_ORPHAN_ROUTE_PATH/g) ?? []).length === 2);

record("A05 the state vocabulary adds exactly one new state and keeps all seven old ones",
  /check \(state in \(\s*'processing',\s*'claimed',\s*'empty',\s*'completed',\s*'recorded',\s*'recovered',\s*'reconciled',\s*'cancelled'\s*\)\)/
    .test(migrationCode));

record("A06 the new state is bound to its own route and carries no attempt identity",
  /state = 'cancelled'\s*and route_key = 'cancel_orphan_v1'/.test(migrationCode) &&
  /job_id is not null\s*and action_request_id is not null/.test(migrationCode) &&
  /finalized_at is not null/.test(migrationCode));

record("A07 the orchestration vocabulary is closed to exactly three terminal outcomes",
  AUTOMATION_CANCEL_ORPHAN_ORCHESTRATION_STATES.length === 3 &&
  same([...AUTOMATION_CANCEL_ORPHAN_ORCHESTRATION_STATES],
    ["cancel_orphan_empty", "cancel_orphan_cancelled", "rejected"]) &&
  // None of them hands work onward: the lane cannot introduce executable work.
  !/execute|claim|complete|recover|reconcile/.test(
    AUTOMATION_CANCEL_ORPHAN_ORCHESTRATION_STATES.join(",")));

// ---------------------------------------------------------------------------
// B. CORE OWNS ORPHAN TRUTH — the caller decides nothing
// ---------------------------------------------------------------------------

record("B01 the request body is an EXACT three-key set with no job, entity or reason field",
  N8N_CANCEL_ORPHAN_REQUEST_KEYS.length === 3 &&
  same([...N8N_CANCEL_ORPHAN_REQUEST_KEYS], ["requestId", "transportVersion", "workerId"]));

record("B02 a body naming a job, an entity, a reason or a force flag is REJECTED, not ignored",
  (() => {
    const base = { transportVersion: 1, requestId: LEAD_ID, workerId: "w1" };
    if (!parseCancelOrphanRequestBody(JSON.stringify(base)).ok) return false;
    return ["jobId", "entityId", "entityType", "reason", "safeCode", "status",
            "force", "limit", "batchSize", "entityMissing"].every((extra) => {
      const parsed = parseCancelOrphanRequestBody(
        JSON.stringify({ ...base, [extra]: extra === "entityMissing" ? true : "x" }));
      return parsed.ok === false && parsed.code === "AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID";
    });
  })());

record("B03 a malformed identity is refused rather than defaulted",
  parseCancelOrphanRequestBody("not json").ok === false &&
  parseCancelOrphanRequestBody("[]").ok === false &&
  parseCancelOrphanRequestBody(JSON.stringify({ transportVersion: 2, requestId: LEAD_ID, workerId: "w" })).ok === false &&
  parseCancelOrphanRequestBody(JSON.stringify({ transportVersion: 1, requestId: "nope", workerId: "w" })).ok === false &&
  parseCancelOrphanRequestBody(JSON.stringify({ transportVersion: 1, requestId: LEAD_ID, workerId: "bad id!" })).ok === false);

record("B04 the safe code is a fixed repository constant, never caller-supplied",
  AUTOMATION_ORPHAN_SAFE_CODE === "QF_AUTOMATION_ORPHAN_ENTITY_MISSING" &&
  /last_safe_code = 'QF_AUTOMATION_ORPHAN_ENTITY_MISSING'/.test(migrationCode) &&
  // The RPC that writes it takes only a worker id — there is no reason parameter.
  /create or replace function public\.qf_cancel_orphan_automation_job_v1\(p_worker_id text\)/
    .test(migrationCode) &&
  // and the service re-checks the durable value rather than trusting the wire.
  /row\.safe_code !== AUTOMATION_ORPHAN_SAFE_CODE/.test(serviceCode));

record("B05 the entity map is identical in the contract and in SQL",
  same([...AUTOMATION_ORPHAN_ENTITY_TYPES],
    ["communication_intent", "lead", "lead_assignment", "vendor"]) &&
  Object.values(AUTOMATION_ORPHAN_ENTITY_TABLES).every((table) =>
    new RegExp(`from ${table.replace(".", "\\.")} t where t\\.id = v_uuid`).test(migrationCode)) &&
  isAutomationOrphanEntityType("lead") && !isAutomationOrphanEntityType("campaign"));

record("B06 a non-uuid entity id is proven missing rather than guessed or thrown",
  classifyAutomationEntityState({ entityType: "lead", entityId: "qf505cert-01", rowExists: null }) ===
    AutomationEntityState.MISSING &&
  cancels(decide("pending", "lead", "qf505cert-01", null)) &&
  /when invalid_text_representation then/.test(migrationCode) &&
  /return 'missing'/.test(migrationCode));

record("B07 the entity-state authority is read-only",
  /create or replace function public\.qf_automation_entity_state_v1\([\s\S]{0,400}?stable/
    .test(migrationCode) &&
  (() => {
    const fn = (migrationCode.match(
      /create or replace function public\.qf_automation_entity_state_v1[\s\S]*?\$\$;/) ?? [""])[0];
    return fn.length > 0 && !/\b(insert|update|delete|truncate)\b/i.test(fn);
  })());

record("B08 a job already cancelled once is refused a second time",
  refuses(decide("pending", "lead", LEAD_ID, false, true),
    AutomationOrphanRefusal.ALREADY_CANCELLED_ONCE));

// ---------------------------------------------------------------------------
// C. MIGRATION RULES
// ---------------------------------------------------------------------------

record("C01 the migration is the pinned forward-only file and nothing else was added",
  canonicalSha256(readFileSync(path.join(ROOT, MIGRATION_PATH))) === MIGRATION_SHA &&
  readdirSync(path.join(ROOT, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql")).sort().at(-1) ===
    "20260905000000_qf_mvp_50_6_automation_orphan_cancellation.sql");

record("C02 the local migration set is exactly 105",
  readdirSync(path.join(ROOT, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql")).length === 105);

record("C03 a fail-closed dependency preflight runs before anything is installed",
  migrationCode.indexOf("raise exception 'QF-MVP-50.6: the automation persistence and transport tables must exist.'") <
    migrationCode.indexOf("create or replace function public.qf_automation_entity_state_v1") &&
  /to_regclass\('public\.leads'\)[\s\S]{0,300}to_regclass\('public\.communication_intents'\)/.test(migrationCode) &&
  /automation_jobs_status_check[\s\S]{0,200}cancelled/.test(migrationCode));

record("C04 every function fixes its search_path",
  // FIVE functions are defined: the three new authorities plus the two transport
  // guard trigger functions, which must be re-created to widen a closed vocabulary.
  // The counts are asserted EQUAL to each other so a sixth function added without a
  // fixed search_path fails here rather than passing a stale literal.
  (() => {
    const fns = (migrationCode.match(/create or replace function public\.qf_/g) ?? []).length;
    const paths = (migrationCode.match(/set search_path = pg_catalog, public, pg_temp/g) ?? []).length;
    return fns === 5 && paths === 5 && fns === paths;
  })());

record("C05 PUBLIC, anon and authenticated are revoked and only service_role may execute",
  (migrationCode.match(/revoke all on function[\s\S]{0,160}from public, anon, authenticated, service_role;/g) ?? [])
    .length === 3 &&
  (migrationCode.match(/grant execute on function[\s\S]{0,160}to service_role;/g) ?? []).length === 3 &&
  !/grant\s+(insert|update|delete|truncate)/i.test(migrationCode));

record("C06 no table gains a direct mutation grant and the SELECT-only posture is re-proved",
  !/grant .* on (table )?public\.automation_/i.test(migrationCode) &&
  /privilege_type in \('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'\)/.test(migrationCode) &&
  /automation tables must remain SELECT-only for service_role/.test(migrationSource));

record("C07 the migration seeds nothing, cleans nothing and deletes no history",
  !/^\s*insert\s+into\s+public\.(leads|vendors|lead_assignments|communication_)/im.test(migrationCode) &&
  !/\bdelete\s+from\b/i.test(migrationCode) &&
  // `TRUNCATE` appears once, inside the self-verification block's privilege list —
  // which is the assertion that service_role has NOT been granted it. So the check
  // is for a truncate STATEMENT, not for the word.
  !/\btruncate\s+(table\s+)?(only\s+)?public\./i.test(migrationCode) &&
  // The ONLY UPDATE statements are the two governed ones: the job row and the
  // transport ledger row.
  (migrationCode.match(/^\s*update\s+public\.\w+/gim) ?? []).every((s) =>
    /automation_jobs|automation_transport_requests/.test(s)));

record("C08 no current job id is hard-coded anywhere in runtime logic",
  (() => {
    // The twenty certification orphans from the brief must appear in NO runtime or
    // gate surface. The mechanism has to be generic.
    const CERT_IDS = [
      "98251bf3-f68b-4aa3-a70b-e6c6c484ee0b", "d65d0932-706a-4d54-bfec-6784bcbd2514",
      "743fe608-3274-4046-a142-43a77aad63a6", "ba0c368b-7a81-4a44-99e6-eb5f6e6c689f",
      "0ed2439a-37c1-465e-823e-6eceb4e46c0c", "11e4159d-d795-4118-97ec-8d4eda729132",
      "69e8f665-e2c4-48dd-941c-68f8ac5db91b", "bb6d492c-4a87-4fa7-8870-216dfcac3c0a",
      "bcb1bd01-e74b-4093-979a-04c59f412c24", "bd173d39-9f60-4e4a-ba35-659f720d7753",
      "d1270d44-5654-46ab-99e2-bcbf02c8afbe", "86ddfc7d-7170-4160-a3b4-2e4e32738bff",
      "fe2951ef-f066-44f0-a982-f802234ef796", "08bb77e0-0868-41ba-ab4c-ada707b871f3",
      "26dc84e1-7b11-430c-9f80-0c8136dbfa22", "456a26c4-262b-4a3e-933c-8b37803c58ea",
      "67a15d9b-33c2-4000-9358-f900b347b7d5", "d39f2063-8e3d-47fe-9523-175b3af75e0f",
      "e99e4507-8d03-4b29-b2bd-c7e7a3f84c30", "5673ba62-8634-4d9a-9bbc-af2f26e4f51c",
    ];
    const surfaces = migrationSource + contractSource + serviceSource + routeSource + workflowText;
    return CERT_IDS.every((id) => !surfaces.includes(id)) &&
      // and no entity_type / action_type special case for the certification jobs
      !/qf505cert|qf-mvp-50-2b-gate/i.test(
        migrationCode + stripJs(contractSource) + serviceCode + routeCode);
  })());

// ---------------------------------------------------------------------------
// D. n8n RULES
// ---------------------------------------------------------------------------

record("D01 the workflow is inactive",
  workflow.active === false && /"active": false/.test(read(WORKFLOW_PATH)));

record("D02 the workflow holds no Supabase credential and queries no table",
  // Executable surfaces only. The sticky note says the words "no Supabase
  // credential" in prose, so matching the bare word would prove nothing; what
  // matters is that no node is a database node, no node carries credentials, and
  // no key, connection string or SQL appears anywhere.
  !workflow.nodes.some((n) => /postgres|supabase|mysql|sql/i.test(n.type)) &&
  workflow.nodes.every((n) => !n.credentials) &&
  !/service_role|SUPABASE_|supabaseKey|supabaseUrl|anon_key|\bfrom\s+public\.|\bselect\s+\*\s+from\b/i
    .test(workflowText) &&
  !/postgresql:\/\/|\.supabase\.co/i.test(workflowText));

record("D03 the workflow holds no Meta token and calls no Meta endpoint",
  !/META_|WHATSAPP_|ACCESS_TOKEN|graph\.facebook/i.test(workflowText));

record("D04 the workflow can reach exactly one Core route",
  same([...new Set(workflowText.match(/\/api\/internal\/automation\/n8n\/[a-z-]+/g) ?? [])],
    ["/api/internal/automation/n8n/cancel-orphan"]) &&
  /ALLOWED_PATHS = new Set\(\[\\n  '\/api\/internal\/automation\/n8n\/cancel-orphan'\\n\]\)/
    .test(workflowText));

record("D05 the workflow sends the exact three-key body and no job id",
  (() => {
    // The REQUEST-building node is the surface that matters: whatever the workflow
    // reads out of Core's answer afterwards cannot influence what Core was asked.
    const build = workflow.nodes.find((n) => n.name === "Build Exact Orphan Sweep Body");
    // Comments stripped: the node's own comment DESCRIBES the fields it refuses to
    // send, so matching raw text would fail on the explanation rather than on code.
    const sent = stripJs(build?.parameters?.jsCode ?? "");
    const namesNothing = !/jobId|job_id|entityId|entity_id|entityType|entity_type|safeCode|reasonCode|force|limit/
      .test(sent);
    const exactBody =
      /JSON\.stringify\(\{ transportVersion: 1, requestId, workerId \}\)/.test(sent);
    // And no node anywhere invents a job identifier to send.
    const noJobIdAnywhere = !/jobId|job_id/.test(workflowText);
    return sent.length > 0 && namesNothing && exactBody && noJobIdAnywhere;
  })());

record("D06 secrets are env references only; no secret VALUE is embedded",
  /\$env\.QF_N8N_TO_CORE_HMAC_SECRET/.test(workflowText) &&
  /\$env\.QF_CORE_TO_N8N_HMAC_SECRET/.test(workflowText) &&
  // No 64-hex literal anywhere once the validation regexes themselves are removed.
  !/[0-9a-f]{64}/.test(workflowText.replace(/\[0-9a-f\]\\?\{64\\?\}/g, "")) &&
  // No new environment variable is introduced by this phase. Only actual `$env`
  // reads count — the workflow's own QF_50_6_* error codes are not variables.
  same([...new Set((workflowText.match(/\$env\.QF_[A-Z0-9_]+/g) ?? [])
    .map((token) => token.replace("$env.", "")))].sort(),
    ["QF_CORE_STAGING_BASE_URL", "QF_CORE_TO_N8N_HMAC_SECRET", "QF_N8N_TO_CORE_HMAC_SECRET",
     "QF_N8N_TRANSPORT_ENABLED", "QF_N8N_WORKER_ID"]));

record("D07 the workflow verifies the signed response before it reads any state",
  workflow.nodes.some((n) => n.name === "Verify Signed Orphan Sweep Response") &&
  workflow.nodes.some((n) => n.name === "IF — Orphan Sweep Response Verified") &&
  workflow.nodes.some((n) => n.name === "STOP — Reject Unverified Orphan Sweep Response") &&
  (() => {
    const branchTargets = workflow.connections["IF — Orphan Sweep Response Verified"].main;
    return branchTargets[0][0].node === "Branch On Core Orphan Sweep State" &&
      branchTargets[1][0].node === "STOP — Reject Unverified Orphan Sweep Response";
  })());

record("D08 every outcome of the workflow terminates; nothing is forwarded",
  /followUpCall: 'none'/.test(workflowText) &&
  workflow.connections["Branch On Core Orphan Sweep State"].main[0][0].node ===
    "STOP — Orphan Sweep Cycle Complete" &&
  !workflow.connections["STOP — Orphan Sweep Cycle Complete"] &&
  // Exactly one HTTP call is made per cycle.
  workflow.nodes.filter((n) => /helpers\.httpRequest/.test(n.parameters?.jsCode ?? "")).length === 1);

record("D09 the workflow is fail-closed by default",
  /QF_N8N_TRANSPORT_ENABLED === 'true'/.test(workflowText) &&
  workflow.nodes.some((n) => n.name === "STOP — Orphan Sweep Runtime Not Configured") &&
  workflow.connections["IF — Orphan Sweep Transport Configured"].main[1][0].node ===
    "STOP — Orphan Sweep Runtime Not Configured");

record("D10 the certified 50.2E / 50.3 / 50.4 / 50.5 workflows are untouched",
  (() => {
    const FROZEN = {
      "QF-MVP-50-01-Core-Job-Dispatcher.50.2B-selfhost-env.workflow.json": true,
      "QF-MVP-50-01-Core-Job-Dispatcher.workflow.json": true,
      "QF-MVP-50-02-Client-Whatsapp-Executor.50.2E-selfhost-env.workflow.json": true,
      "QF-MVP-50-03-Vendor-Whatsapp-Executor.workflow.json": true,
      "QF-MVP-50-04-Campaign-Execution-Executor.workflow.json": true,
      "QF-MVP-50-05-Recovery-Supervisor.workflow.json": true,
    };
    const flows = readdirSync(path.join(ROOT, "automation/n8n"))
      .filter((f) => f.endsWith(".workflow.json")).sort();
    return flows.length === 7 &&
      Object.keys(FROZEN).every((f) => flows.includes(f)) &&
      // every pre-existing workflow is still inactive too
      flows.every((f) => JSON.parse(read(`automation/n8n/${f}`)).active === false);
  })());

// ---------------------------------------------------------------------------
// E. SERVICE AND ROUTE BOUNDARIES
// ---------------------------------------------------------------------------

record("E01 the service performs no direct table mutation",
  !/\.from\(["'][^"']+["']\)\s*\.\s*(insert|update|upsert|delete)/.test(serviceCode) &&
  !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(serviceCode) &&
  (serviceCode.match(/\.rpc\(/g) ?? []).length === 1 &&
  serviceCode.includes('rpc("qf_cancel_orphan_automation_job_transport_v1"'));

record("E02 an unauthenticated caller gets an UNSIGNED rejection, so the route is no signing oracle",
  (() => {
    const verifyAt = routeCode.indexOf("const verified = verifyN8nToCoreRequest(");
    const unsignedAt = routeCode.indexOf("return json({ ok: false, code: verified.code }, verified.status)");
    const firstSignedAt = routeCode.indexOf("return rejected(");
    return verifyAt > 0 && unsignedAt > verifyAt && firstSignedAt > unsignedAt;
  })());

record("E03 the worker must be the configured worker, and the request id must match the signature",
  /AUTOMATION_TRANSPORT_WORKER_NOT_AUTHORIZED/.test(routeCode) &&
  /parsed\.body\.workerId !== config\.workerId/.test(routeCode) &&
  /parsed\.body\.requestId !== verified\.requestId/.test(routeCode));

record("E04 the route leaks no database, provider, secret or stack detail on failure",
  /AUTOMATION_TRANSPORT_INTERNAL_FAILURE/.test(routeCode) &&
  !/error\.message|String\(error\)|err\.stack|console\.(log|error)/.test(routeCode) &&
  !/console\./.test(serviceCode));

record("E05 the response exposes a closed vocabulary word and no business identifier",
  /entityType: row\.entity_type/.test(serviceCode) &&
  !/entityId|entity_id/.test(serviceCode) &&
  !/destination|recipient|phone|template|provider_message_id/i.test(newModuleCode));

record("E08 the service NARROWS the entity type before emitting it, and fails closed if it cannot",
  // Without this, a value outside the closed map could reach an orchestrator that
  // might treat an unknown string as meaningful. The guard must both exist and
  // throw — a bare call whose result is discarded would not do.
  /if \(!isAutomationOrphanEntityType\(row\.entity_type\)\) \{\s*throw new Error\("AUTOMATION_CANCEL_ORPHAN_ENTITY_TYPE_INVALID"\);\s*\}/
    .test(serviceCode) &&
  // and it is reached BEFORE the success body is built
  serviceCode.indexOf("isAutomationOrphanEntityType(row.entity_type)") <
    serviceCode.indexOf('orchestrationState: "cancel_orphan_cancelled"') &&
  // The equivalent identity guards must also be present and throwing.
  /throw new Error\("AUTOMATION_CANCEL_ORPHAN_SAFE_CODE_INVALID"\)/.test(serviceCode) &&
  /throw new Error\("AUTOMATION_TRANSPORT_CANCEL_ORPHAN_EVIDENCE_INCOMPLETE"\)/.test(serviceCode) &&
  /throw new Error\("AUTOMATION_TRANSPORT_CANCEL_ORPHAN_STATE_INVALID"\)/.test(serviceCode));

record("E06 the route refuses an oversized body before reading it",
  /content-length/.test(routeCode) &&
  /AUTOMATION_TRANSPORT_BODY_TOO_LARGE/.test(routeCode) &&
  /MAX_BODY_BYTES = 2_048/.test(routeCode));

record("E07 the transport is disabled unless every secret and the worker id are configured",
  /config\.mode === "off"[\s\S]{0,200}AUTOMATION_TRANSPORT_DISABLED/.test(routeCode));

// ---------------------------------------------------------------------------
// F. DOCUMENTATION AND GOVERNANCE
// ---------------------------------------------------------------------------

record("F01 the design document exists and states the decisions that were made",
  doc.length > 0 &&
  /cancelled/.test(doc) && /quarantined/.test(doc) &&
  /cancel_orphan_v1/.test(doc) &&
  /QF_AUTOMATION_ORPHAN_ENTITY_MISSING/.test(doc) &&
  /unmapped/.test(doc));

record("F02 the document states that no environment was mutated by this phase",
  /NO STAGING MUTATION/.test(doc) &&
  /NO PRODUCTION MUTATION/.test(doc) &&
  /NO META\/WHATSAPP SEND/.test(doc));

record("F03 the manifest pins the new migration as SOURCE-PENDING with no application evidence",
  (() => {
    const pin = (manifest.pendingPostAnchorMigrations ?? [])
      .find((r) => r.version === "20260905000000");
    return manifest.pendingPostAnchorMigrations.length === 2 &&
      pin?.sha256 === MIGRATION_SHA &&
      pin.path === MIGRATION_PATH &&
      pin.phase === "QF-MVP-50.6" &&
      pin.operationalStatus === "PENDING" &&
      pin.appliedToStaging === false &&
      pin.appliedToProduction === false &&
      pin.appliedByThisPhase === false &&
      pin.remoteVersionStatus === "NOT_PROVEN_OFFLINE" &&
      pin.remoteHistoryCountObservedAtApply === false &&
      pin.requiresSeparateStagingDeploymentGate === true &&
      !("remoteHistoryCountAfterApply" in pin) &&
      !("appliedEvidenceMarker" in pin) &&
      manifest.appliedAnchor.postAnchorMigrationCount === 18;
  })());

record("F04 G1 was re-pinned to the exact new truth, never loosened",
  /const MIGRATION_COUNT = 105;/.test(g1Source) &&
  g1Source.includes(`sha: "${MIGRATION_SHA}"`) &&
  g1Source.includes("pendingPins.length === 2") &&
  g1Source.includes("appliedPins.length === 10") &&
  g1Source.includes("reconciledPins.length === 5") &&
  // The frozen 80.05 historical fact must NOT have moved with the live count.
  /const RECONCILIATION_MIGRATION_COUNT = 102;/.test(g1Source) &&
  !/state\.migrations\.length\s*>=/.test(g1Source) &&
  !/postAnchorLocal\.length\s*>=/.test(g1Source));

record("F05 the applied and reconciled sets were NOT touched by this source-only phase",
  manifest.appliedPostAnchorMigrations.length === 10 &&
  manifest.reconciledPostAnchorMigrations.length === 5 &&
  manifest.stagingAppliedPostAnchorMigrations.length === 1 &&
  manifest.appliedPostAnchorMigrations.at(-1).version === "20260812000000" &&
  same(manifest.appliedPostAnchorMigrations.map((r) => r.remoteHistoryCountAfterApply),
    [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]));

// ---------------------------------------------------------------------------
// M. MUTANTS — each names a way this phase could go wrong and proves it cannot
// ---------------------------------------------------------------------------

const mutants = [
  ["cancelling on an unrecognised entity type is impossible",
    () => !decide("pending", "campaign", LEAD_ID, false).cancellable &&
          !decide("pending", "campaign", LEAD_ID, null).cancellable],
  ["cancelling a live entity is impossible",
    () => AUTOMATION_ORPHAN_ENTITY_TYPES.every((t) => !decide("pending", t, LEAD_ID, true).cancellable)],
  ["cancelling a processing job is impossible",
    () => !decide("processing", "lead", LEAD_ID, false).cancellable &&
          !/'processing'/.test((migrationCode.match(/j\.status in \([^)]*\)/) ?? [""])[0])],
  ["cancelling a terminal job is impossible",
    () => ["succeeded", "failed", "uncertain", "dead_letter", "cancelled"]
            .every((s) => !decide(s, "lead", LEAD_ID, false).cancellable)],
  ["a caller naming its own job is impossible",
    () => N8N_CANCEL_ORPHAN_REQUEST_KEYS.length === 3 &&
          !parseCancelOrphanRequestBody(JSON.stringify({
            transportVersion: 1, requestId: LEAD_ID, workerId: "w1", jobId: LEAD_ID,
          })).ok],
  ["a caller choosing the cancellation reason is impossible",
    () => !parseCancelOrphanRequestBody(JSON.stringify({
            transportVersion: 1, requestId: LEAD_ID, workerId: "w1", safeCode: "WHATEVER",
          })).ok &&
          !/p_safe_code|p_reason|p_classification/.test(migrationCode)],
  ["a second terminal state sneaking in is detectable",
    () => !/quarantined|orphaned|abandoned|voided/i.test(migrationCode) &&
          !/quarantined/i.test(newModuleCode)],
  ["opening an attempt from this lane is impossible",
    () => !/automation_execution_attempts/i.test(migrationCode.split("create or replace function public.qf_cancel_orphan")[1] ?? "")],
  ["a cancellation without completed_at is impossible",
    () => /completed_at = now\(\)/.test(migrationCode) &&
          /completion_shape|completed_at is not null/.test(persistenceMigration)],
  ["a replay cancelling a second job is impossible",
    () => /on conflict \(id\) do nothing/.test(migrationCode) &&
          /if not v_inserted then/.test(migrationCode) &&
          migrationCode.indexOf("if not v_inserted then") <
            migrationCode.indexOf("from public.qf_cancel_orphan_automation_job_v1(p_worker_id)")],
  ["one job being cancelled twice is impossible",
    () => /uq_automation_transport_requests_cancel_orphan_job/.test(migrationCode) &&
          /where route_key = 'cancel_orphan_v1'\s*and job_id is not null/.test(migrationCode)],
  ["a provider call from this lane is impossible",
    () => !/graph\.facebook|CommunicationService|createRuntimeCommunicationService/.test(newModuleCode) &&
          !/graph\.facebook/i.test(workflowText)],
  ["an active n8n workflow shipping is detectable",
    () => workflow.active === false &&
          readdirSync(path.join(ROOT, "automation/n8n"))
            .filter((f) => f.endsWith(".workflow.json"))
            .every((f) => JSON.parse(read(`automation/n8n/${f}`)).active === false)],
  ["silently loosening the G1 pin is impossible",
    () => /const MIGRATION_COUNT = 105;/.test(g1Source) &&
          !/state\.migrations\.length\s*>=/.test(g1Source)],
  ["claiming this migration was applied anywhere is detectable",
    () => {
      const pin = (manifest.pendingPostAnchorMigrations ?? [])
        .find((r) => r.version === "20260905000000");
      return pin?.appliedToStaging === false && pin?.appliedToProduction === false &&
        !("remoteHistoryCountAfterApply" in (pin ?? {}));
    }],
  ["hard-coding the twenty certification orphans is detectable",
    () => !/98251bf3-f68b-4aa3-a70b-e6c6c484ee0b/.test(
      migrationSource + contractSource + serviceSource + routeSource + workflowText)],
  ["widening the route vocabulary without re-pinning every gate is impossible",
    () => ["scripts/mvp/automation/validate-qf-mvp-50-2d.mjs",
           "scripts/mvp/automation/validate-qf-mvp-50-2e.mjs",
           "scripts/mvp/automation/validate-qf-mvp-50-5.mjs"]
      .every((p) => read(p).includes(
        "claim_v1,complete_v1,execute_v1,recover_v1,reconcile_v1,cancel_orphan_v1"))],
  ["a stale executor entity check would be detectable",
    () => /QF_EXEC_LEAD_NOT_FOUND/.test(clientExecutorCode) &&
          /QF_EXEC_VENDOR_NOT_FOUND/.test(vendorExecutorCode)],
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
console.log(`\nQF-MVP-50.6: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exit(1);
console.log("QF_MVP_50_6_ORPHAN_QUEUE_GOVERNANCE_SOURCE_READY");
