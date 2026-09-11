#!/usr/bin/env node
// ============================================================================
// QF-MVP-50.7 — governed stale-business job terminalization source gate
//
// Offline and repository-only: no database, no network, no provider, no secret,
// no deployment, no Supabase mutation. It proves what the SOURCE guarantees;
// applying the migration and certifying it against the real staging rows are
// separate, later gates.
//
// THE CENTRAL THING THIS GATE PROVES is that there is exactly ONE DEFINITION of
// "is this vendor action still business-eligible?" — the pure module the executor
// consumes directly — plus a transaction-bound SQL MIRROR of the four maintenance
// predicates, with each rule pinned on both sides so they cannot drift silently.
// It does NOT claim a single executable predicate in both places; the mirror is a
// second implementation by necessity (the re-proof must run inside the mutating
// transaction). Sections A-E EXECUTE the pure module over a case matrix rather
// than grepping it, so a behaviour change fails here even if the wording is
// identical. Section T pins the RATIONALE itself, after an earlier draft of this
// phase justified it with a retry loop that does not exist.
// ============================================================================

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTOMATION_TRANSPORT_ROUTE_KEYS,
  N8N_CANCEL_STALE_ROUTE_PATH,
  N8N_CANCEL_ORPHAN_ROUTE_PATH,
} from "../../../lib/automation/transportTypes.ts";
import {
  EXECUTOR_BUSINESS_REFUSAL_CODE,
  STALE_BUSINESS_ACTIONS,
  STALE_BUSINESS_CANCELLED_JOB_SHAPE,
  STALE_BUSINESS_ENTITY_PAIRING,
  STALE_BUSINESS_SAFE_CODE,
  VENDOR_ELIGIBILITY_ACTIONS,
  VendorBusinessState,
  decideVendorBusinessState,
  isStaleBusinessAction,
  INT4_MAX,
  INT4_MIN,
  isStaleBusinessTerminalizable,
  resolveBoundExpiryStamp,
  resolveResponseReminderWindow,
} from "../../../lib/automation/vendorBusinessEligibility.ts";
import {
  AUTOMATION_CANCEL_STALE_ORCHESTRATION_STATES,
  N8N_CANCEL_STALE_FORBIDDEN_BODY_KEYS,
  N8N_CANCEL_STALE_REQUEST_KEYS,
  STALE_BUSINESS_STATE_CHANGED,
  parseCancelStaleRequestBody,
} from "../../../lib/automation/staleBusinessContract.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const canonicalSha256 = (buffer) =>
  createHash("sha256")
    .update(Buffer.from(buffer.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8"))
    .digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const stripSql = (src) => src.replace(/^\s*--.*$/gm, "");

const MIGRATION_PATH =
  "supabase/migrations/20260906000000_qf_mvp_50_7_automation_stale_business_cancellation.sql";
const MIGRATION_SHA = "e71e8739a5d776c75edcb0ae10470d7d9589eb7949326411ea26540de1baa809";
const ORPHAN_MIGRATION_PATH =
  "supabase/migrations/20260905000000_qf_mvp_50_6_automation_orphan_cancellation.sql";
const ORPHAN_MIGRATION_SHA = "07cab7d17940be3c4ad47eae01b02d6bd9409bc1a8e215b171bea086578e6e63";
const PREDICATE_PATH = "lib/automation/vendorBusinessEligibility.ts";
const CONTRACT_PATH = "lib/automation/staleBusinessContract.ts";
const SERVICE_PATH = "services/automationStaleBusinessCancellationService.ts";
const ROUTE_PATH = "app/api/internal/automation/n8n/cancel-stale/route.ts";
const VENDOR_EXECUTOR_PATH = "services/automationVendorExecutionService.ts";
const WORKFLOW_PATH = "automation/n8n/QF-MVP-50-07-Stale-Business-Supervisor.workflow.json";
const DOC_PATH = "docs/QF-MVP-50-7-STALE-BUSINESS-JOB-GOVERNANCE.md";

const migrationSource = read(MIGRATION_PATH);
const migrationCode = stripSql(migrationSource);
const predicateCode = stripJs(read(PREDICATE_PATH));
const contractCode = stripJs(read(CONTRACT_PATH));
const serviceCode = stripJs(read(SERVICE_PATH));
const routeCode = stripJs(read(ROUTE_PATH));
const vendorExecutorSource = read(VENDOR_EXECUTOR_PATH);
const vendorExecutorCode = stripJs(vendorExecutorSource);
const newModuleCode = predicateCode + contractCode + serviceCode + routeCode;
const workflow = JSON.parse(read(WORKFLOW_PATH));
const workflowText = JSON.stringify(workflow);
const doc = existsSync(path.join(ROOT, DOC_PATH)) ? read(DOC_PATH) : "";
const manifest = JSON.parse(read("supabase/staging-history/qf-mvp-staging-history-manifest.json"));
const pkg = JSON.parse(read("package.json"));
const ciWorkflow = read(".github/workflows/qf-mvp-50-quality-gate.yml");
const g1Source = read("scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs");

const results = [];
const record = (name, passed) => results.push({ name, passed: passed === true });

/** The body of the mutating terminalization authority, for order assertions. */
const staleAuthorityFn = () =>
  (migrationCode.match(
    /create or replace function public\.qf_cancel_stale_automation_job_v1[\s\S]*?\$\$;/) ?? [""])[0];

const VENDOR = "0ffd1cf7-b6c1-4f0e-9d2a-5f3b7c9e1a2b";
const S = VendorBusinessState;
const decide = (f) => decideVendorBusinessState(f);

// ---------------------------------------------------------------------------
// A. CLOSED VOCABULARY — executed, not grepped
// ---------------------------------------------------------------------------
record("A01 the executor-decidable action set is exactly five, in exact order",
  VENDOR_ELIGIBILITY_ACTIONS.length === 5 &&
  same([...VENDOR_ELIGIBILITY_ACTIONS], [
    "vendor.lead_offer", "vendor.low_credit_warning", "vendor.onboarding_reminder",
    "vendor.package_expiry_warning", "vendor.response_reminder"]));

record("A02 the v1 STALE vocabulary is exactly four and excludes vendor.lead_offer",
  STALE_BUSINESS_ACTIONS.length === 4 &&
  same([...STALE_BUSINESS_ACTIONS], [
    "vendor.low_credit_warning", "vendor.onboarding_reminder",
    "vendor.package_expiry_warning", "vendor.response_reminder"]) &&
  !isStaleBusinessAction("vendor.lead_offer"));

record("A03 no client or campaign action can enter the stale vocabulary",
  ["client.lead_confirmation", "client.requirement_collection", "client.matching_update",
   "client.lead_status_update", "client.missing_information_reminder",
   "client.transactional_followup", "campaign.execute_recipient"]
    .every((a) => !isStaleBusinessAction(a)));

record("A04 an unsupported action is UNMAPPED, never stale",
  ["campaign.execute_recipient", "client.lead_confirmation", "vendor.unknown", "", null, undefined, 42]
    .every((a) => decide({ actionType: a, entityType: "vendor" }) === S.UNMAPPED));

record("A05 the action -> entity pairing is closed and wrong pairings are UNMAPPED",
  same(STALE_BUSINESS_ENTITY_PAIRING, {
    "vendor.response_reminder": "lead_assignment",
    "vendor.onboarding_reminder": "vendor",
    "vendor.package_expiry_warning": "vendor",
    "vendor.low_credit_warning": "vendor",
  }) &&
  decide({ actionType: "vendor.response_reminder", entityType: "vendor" }) === S.UNMAPPED &&
  decide({ actionType: "vendor.onboarding_reminder", entityType: "lead_assignment" }) === S.UNMAPPED &&
  decide({ actionType: "vendor.package_expiry_warning", entityType: "lead" }) === S.UNMAPPED &&
  decide({ actionType: "vendor.low_credit_warning", entityType: "lead_assignment" }) === S.UNMAPPED);

// ---------------------------------------------------------------------------
// B. RESPONSE REMINDER
// ---------------------------------------------------------------------------
const rr = (over) => decide({
  actionType: "vendor.response_reminder", entityType: "lead_assignment",
  sourceEventKey: "vendor:abc:resp2h", assignmentExists: true,
  assignmentVendorId: VENDOR, resolvedVendorId: VENDOR, assignmentVendorStatus: "New", ...over,
});
record("B01 New + resp2h is ELIGIBLE", rr({}) === S.ELIGIBLE);
record("B02 New + resp24h is ELIGIBLE", rr({ sourceEventKey: "vendor:abc:resp24h" }) === S.ELIGIBLE);
record("B03 Contacted is STALE", rr({ assignmentVendorStatus: "Contacted" }) === S.STALE);
record("B04 every progressed status is STALE",
  ["Contacted", "Quoted", "Won", "Lost", "Closed", "", null].every((s) => rr({ assignmentVendorStatus: s }) === S.STALE));
record("B05 a source identity with no known window is STALE, matching the executor",
  [null, undefined, "", "vendor:abc", "vendor:abc:resp3h", "resp2h-suffixless"]
    .every((k) => rr({ sourceEventKey: k }) === S.STALE) &&
  resolveResponseReminderWindow("x:resp2h") === "resp2h" &&
  resolveResponseReminderWindow("x:resp24h") === "resp24h" &&
  resolveResponseReminderWindow("x:resp3h") === null);
record("B06 a vanished assignment or an owner change is STALE (and the caller's entity gate keeps it out of 50.7)",
  rr({ assignmentExists: false }) === S.STALE &&
  rr({ assignmentVendorId: "11111111-1111-4111-8111-111111111111" }) === S.STALE &&
  rr({ assignmentVendorId: null }) === S.STALE);

// ---------------------------------------------------------------------------
// C. ONBOARDING REMINDER
// ---------------------------------------------------------------------------
const ob = (over) => decide({
  actionType: "vendor.onboarding_reminder", entityType: "vendor",
  crmProfileExists: true, onboardingStage: "new", ...over,
});
record("C01 stage new is ELIGIBLE", ob({}) === S.ELIGIBLE);
record("C02 contacted / churned / any other stage is STALE",
  ["contacted", "churned", "qualified", "New", "", null].every((s) => ob({ onboardingStage: s }) === S.STALE));
record("C03 a missing CRM profile is STALE, exactly as the executor rules",
  ob({ crmProfileExists: false }) === S.STALE);

// ---------------------------------------------------------------------------
// D. PACKAGE EXPIRY WARNING
// ---------------------------------------------------------------------------
const pk = (over) => decide({
  actionType: "vendor.package_expiry_warning", entityType: "vendor",
  sourceEventKey: "vendor:pkg.20260901120000", packageStatus: "active",
  packageExpiresAtStamp: "20260901120000", ...over,
});
record("D01 active + exact stamp is ELIGIBLE", pk({}) === S.ELIGIBLE);
record("D02 a cancelled or non-active package is STALE",
  ["cancelled", "expired", "paused", "", null].every((s) => pk({ packageStatus: s }) === S.STALE));
record("D03 a null expiry is STALE", pk({ packageExpiresAtStamp: null }) === S.STALE);
record("D04 a renewed / moved expiry is STALE",
  pk({ packageExpiresAtStamp: "20270101000000" }) === S.STALE);
record("D05 a malformed source stamp is STALE, matching the executor",
  [null, undefined, "", "vendor:pkg", "vendor:pkg.2026090112000", "vendor:pkg.notastamp"]
    .every((k) => pk({ sourceEventKey: k }) === S.STALE) &&
  resolveBoundExpiryStamp("vendor:pkg.20260901120000") === "20260901120000" &&
  resolveBoundExpiryStamp("vendor:pkg.123") === null);

// ---------------------------------------------------------------------------
// E. LOW CREDIT WARNING
// ---------------------------------------------------------------------------
const lc = (over) => decide({
  actionType: "vendor.low_credit_warning", entityType: "vendor",
  lowCreditThreshold: 3, remainingCredits: 2, ...over,
});
record("E01 balance below the threshold is ELIGIBLE", lc({}) === S.ELIGIBLE);
record("E02 balance EXACTLY AT the threshold is ELIGIBLE (the rule is strictly greater-than)",
  lc({ remainingCredits: 3 }) === S.ELIGIBLE);
record("E03 balance above the threshold is STALE", lc({ remainingCredits: 4 }) === S.STALE);
record("E04 an UNCONFIGURED threshold is STALE, with no numeric fallback",
  [null, undefined, "3", 3.5, NaN].every((t) => lc({ lowCreditThreshold: t }) === S.STALE));
record("E05 null / missing credits are STALE",
  [null, undefined].every((c) => lc({ remainingCredits: c }) === S.STALE));
record("E06 the migration reads the EXACT repository policy key, not an invented one",
  /'vendor_low_credit_warning_threshold'/.test(migrationCode) &&
  !/vendor\.low_credit_threshold/.test(migrationCode) &&
  read("lib/automation/vendorDispatchRegistry.ts").includes('"vendor_low_credit_warning_threshold"'));

// ---------------------------------------------------------------------------
// F. JOB STATUS + G. ORPHAN SEPARATION — the terminalization gate
// ---------------------------------------------------------------------------
const staleFacts = { actionType: "vendor.onboarding_reminder", entityType: "vendor", crmProfileExists: true, onboardingStage: "churned" };
const term = (over) => isStaleBusinessTerminalizable({ facts: staleFacts, entityState: "present", jobStatus: "pending", ...over });
record("F01 a pending stale job is terminalizable", term({}) === true);
record("F02 a retry_scheduled stale job is terminalizable", term({ jobStatus: "retry_scheduled" }) === true);
record("F03 a processing job is NEVER terminalizable", term({ jobStatus: "processing" }) === false);
record("F04 every terminal job is NEVER terminalizable",
  ["succeeded", "failed", "uncertain", "dead_letter", "cancelled", null, undefined]
    .every((s) => term({ jobStatus: s }) === false));
record("F05 a business-ELIGIBLE job is never terminalizable",
  isStaleBusinessTerminalizable({
    facts: { ...staleFacts, onboardingStage: "new" }, entityState: "present", jobStatus: "pending" }) === false);

record("G01 an entity that is MISSING is never a 50.7 candidate — that is 50.6's lane",
  term({ entityState: "missing" }) === false);
record("G02 an entity that is UNMAPPED is never a candidate",
  term({ entityState: "unmapped" }) === false &&
  term({ entityState: null }) === false && term({ entityState: "" }) === false);
record("G03 the SQL selector requires entity_state = 'present', the exact inverse of the orphan lane",
  /qf_automation_entity_state_v1\(r\.entity_type, r\.entity_id\) = 'present'/.test(migrationCode) &&
  /qf_automation_entity_state_v1\(r\.entity_type, r\.entity_id\) = 'missing'/
    .test(stripSql(read(ORPHAN_MIGRATION_PATH))) &&
  // and 50.7 never calls the orphan authority to do its work
  !/qf_cancel_orphan_automation_job_v1\(p_worker_id\)/.test(migrationCode));

// ---------------------------------------------------------------------------
// H. CALLER CONTROL
// ---------------------------------------------------------------------------
record("H01 the request body is an EXACT three-key set",
  N8N_CANCEL_STALE_REQUEST_KEYS.length === 3 &&
  same([...N8N_CANCEL_STALE_REQUEST_KEYS], ["requestId", "transportVersion", "workerId"]));
record("H02 EVERY forbidden field is REJECTED, not ignored",
  (() => {
    const base = { transportVersion: 1, requestId: VENDOR, workerId: "w1" };
    if (!parseCancelStaleRequestBody(JSON.stringify(base)).ok) return false;
    return N8N_CANCEL_STALE_FORBIDDEN_BODY_KEYS.length === 17 &&
      N8N_CANCEL_STALE_FORBIDDEN_BODY_KEYS.every((extra) => {
        const p = parseCancelStaleRequestBody(JSON.stringify({ ...base, [extra]: "x" }));
        return p.ok === false && p.code === "AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID";
      });
  })());
record("H03 the forbidden list covers every field the brief names",
  ["jobId", "actionRequestId", "entityId", "entityType", "actionType", "workflowFamily", "stale",
   "eligible", "businessState", "reason", "safeCode", "status", "force", "limit", "batchSize",
   "sourceEventKey", "expectedState"].every((k) => N8N_CANCEL_STALE_FORBIDDEN_BODY_KEYS.includes(k)));
record("H04 a malformed identity is refused rather than defaulted",
  parseCancelStaleRequestBody("nope").ok === false &&
  parseCancelStaleRequestBody("[]").ok === false &&
  parseCancelStaleRequestBody(JSON.stringify({ transportVersion: 2, requestId: VENDOR, workerId: "w" })).ok === false &&
  parseCancelStaleRequestBody(JSON.stringify({ transportVersion: 1, requestId: "nope", workerId: "w" })).ok === false &&
  parseCancelStaleRequestBody(JSON.stringify({ transportVersion: 1, requestId: VENDOR, workerId: "bad id!" })).ok === false);
record("H05 the terminalization RPC takes ONLY a worker id — there is no job or reason parameter",
  (() => {
    // Scoped to the MUTATING function. The read-only authority legitimately takes
    // p_action_type / p_entity_id, because that is how a caller asks it about a
    // row it already holds — it decides nothing about WHICH row is swept.
    const fn = (migrationCode.match(
      /create or replace function public\.qf_cancel_stale_automation_job_v1[\s\S]*?\$\$;/) ?? [""])[0];
    return /create or replace function public\.qf_cancel_stale_automation_job_v1\(p_worker_id text\)/
        .test(migrationCode) &&
      fn.length > 0 &&
      !/p_job_id|p_safe_code|p_reason|p_action_type|p_entity_id|p_force|p_limit/.test(fn) &&
      // and the transport wrapper takes only the three signed transport fields
      /qf_cancel_stale_automation_job_transport_v1\(\s*p_request_id uuid,\s*p_worker_id text,\s*p_body_sha256 text\s*\)/
        .test(migrationCode);
  })());

// ---------------------------------------------------------------------------
// I. REPLAY  +  J. CONCURRENCY
// ---------------------------------------------------------------------------
record("I01 the replay branch returns BEFORE the terminalization authority is called",
  (() => {
    const replay = migrationCode.indexOf("if not v_inserted then");
    const call = migrationCode.indexOf("from public.qf_cancel_stale_automation_job_v1(p_worker_id)");
    return replay > 0 && call > replay;
  })() &&
  /on conflict \(id\) do nothing/.test(migrationCode));
record("I02 a conflicting worker / body / route on the same request id is REJECTED",
  /AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT/.test(migrationCode) &&
  /v_request\.route_key <> 'cancel_stale_v1'/.test(migrationCode) &&
  /v_request\.worker_id is distinct from p_worker_id/.test(migrationCode) &&
  /v_request\.body_sha256 is distinct from p_body_sha256/.test(migrationCode));
record("I03 a replay of an EMPTY request answers empty again, not a fresh selection",
  /case when v_request\.job_id is null[\s\S]{0,120}then null::text/.test(migrationCode));
record("J01 exactly one candidate per call, under skip-locked",
  // QF-MVP-50.7-C2: the candidate is now selected (not selected-and-updated), so
  // the lock names the job alias explicitly and locks ONLY the job row.
  /for update of j skip locked\s*\n\s*limit 1;/.test(migrationCode) &&
  /order by j\.created_at asc, j\.id asc/.test(migrationCode));
record("J02 one terminalization per job is structural, and route-scoped so it cannot collide with 50.6",
  /create unique index if not exists uq_automation_transport_requests_cancel_stale_job[\s\S]{0,200}\(job_id\)[\s\S]{0,200}route_key = 'cancel_stale_v1'/
    .test(migrationCode) &&
  /not exists \(\s*select 1\s*from public\.automation_transport_requests t\s*where t\.route_key = 'cancel_stale_v1'/
    .test(migrationCode));

// ---------------------------------------------------------------------------
// K. JOB SHAPE  +  TOCTOU
// ---------------------------------------------------------------------------
record("K01 the written shape is exactly the pinned one",
  same(STALE_BUSINESS_CANCELLED_JOB_SHAPE, {
    status: "cancelled", completedAtRequired: true, lockedAt: null, lockedBy: null,
    nextRetryAt: null, lastResultClassification: null, lastSafeCode: STALE_BUSINESS_SAFE_CODE }) &&
  STALE_BUSINESS_SAFE_CODE === "QF_AUTOMATION_BUSINESS_STATE_NO_LONGER_ELIGIBLE");
record("K02 the SQL writes exactly that shape",
  /set status = 'cancelled',[\s\S]{0,120}completed_at = now\(\)/.test(migrationCode) &&
  /next_retry_at = null/.test(migrationCode) && /locked_at = null/.test(migrationCode) &&
  /locked_by = null/.test(migrationCode) &&
  /last_result_classification = null/.test(migrationCode) &&
  /last_safe_code = 'QF_AUTOMATION_BUSINESS_STATE_NO_LONGER_ELIGIBLE'/.test(migrationCode));
record("K03 attempt_count and the attempt ledger cannot change",
  (() => {
    const setClause = (migrationCode.match(/update public\.automation_jobs\s+set([\s\S]*?)where id = v_job_id/) ?? [])[1];
    if (!setClause) return false;
    const persistence = stripSql(read("supabase/migrations/20260801110000_qf_mvp_automation_action_persistence.sql"));
    return !/attempt_count|max_attempts|attempt_id/.test(setClause) &&
      !/insert\s+into\s+public\.automation_execution_attempts/i.test(migrationCode) &&
      /elsif new\.attempt_count <> old\.attempt_count then/.test(persistence) &&
      /attempt_count may change only while claiming a new attempt/.test(persistence);
  })());
record("K04 no definitive_failure classification is fabricated for a job that never ran",
  !/last_result_classification = 'definitive_failure'/.test(migrationCode) &&
  STALE_BUSINESS_CANCELLED_JOB_SHAPE.lastResultClassification === null);
record("K05 TOCTOU: the stale proof happens BEFORE the write, under held locks, and disagreement rolls back",
  (() => {
    // QF-MVP-50.7-C2 INVERTED THIS ASSERTION ON PURPOSE.
    //
    // The previous revision proved "re-proof AFTER the write", which is exactly
    // the defect: a post-write SELECT holds no lock, so a concurrent writer could
    // restore eligibility after it and before COMMIT. The order that is actually
    // safe is lock -> prove -> write, and that is what is pinned now.
    const fn = staleAuthorityFn();
    if (!fn) return false;
    const firstLock = fn.indexOf("for update");
    const proof = fn.indexOf("v_state := public.qf_automation_vendor_business_state_v1");
    const entityProof = fn.indexOf("v_entity := public.qf_automation_entity_state_v1");
    const write = fn.indexOf("update public.automation_jobs");
    return firstLock > 0 && entityProof > firstLock && proof > firstLock &&
      write > proof && write > entityProof &&
      /v_entity is distinct from 'present' or v_state is distinct from 'stale'/.test(fn) &&
      STALE_BUSINESS_STATE_CHANGED === "AUTOMATION_STALE_BUSINESS_STATE_CHANGED";
  })());

record("K06 the state-race error is never caught or reinterpreted as a successful cancellation",
  (() => {
    // QF-MVP-50.7-C2 NARROWED THIS. The authority now contains exactly ONE
    // exception handler — `when invalid_text_representation`, which converts a
    // non-uuid entity id into the state-change refusal. That handler SWALLOWS
    // NOTHING: its body raises. What must never exist is a `when others`, or any
    // handler that catches AUTOMATION_STALE_BUSINESS_STATE_CHANGED and continues.
    const fn = staleAuthorityFn();
    if (!fn) return false;
    const handlers = fn.match(/\bexception\s+when\s+([a-z_]+)/gi) ?? [];
    const onlyUuidHandler =
      handlers.length === 1 && /invalid_text_representation/i.test(handlers[0]);
    const handlerRaises =
      /when invalid_text_representation then\s*\n\s*raise exception 'AUTOMATION_STALE_BUSINESS_STATE_CHANGED'/.test(fn);
    const noCatchAll = !/when others then/i.test(migrationCode);
    // and the wrapper still swallows nothing at all
    const wrapper = (migrationCode.match(
      /create or replace function public\.qf_cancel_stale_automation_job_transport_v1[\s\S]*?\$\$;/) ?? [""])[0];
    return onlyUuidHandler && handlerRaises && noCatchAll &&
      !/\bexception\s+when\b/i.test(wrapper);
  })());

// ---------------------------------------------------------------------------
// L. NO SEND
// ---------------------------------------------------------------------------
record("L01 no provider, communication or Meta path exists in the new surfaces",
  !/communication_messages/i.test(newModuleCode) && !/communication_messages/i.test(migrationCode) &&
  !/createRuntimeCommunicationService|CommunicationService|\.send\(/.test(newModuleCode) &&
  !/graph\.facebook\.com|facebook\.com\/v\d|WHATSAPP_|META_|ACCESS_TOKEN/i.test(newModuleCode) &&
  !/\/messages/.test(newModuleCode) &&
  !/create extension|pg_net|http_post|dblink/i.test(migrationCode));
record("L02 no execution attempt is created anywhere in this lane",
  !/automation_execution_attempts/i.test(newModuleCode) &&
  !/insert into public\.automation_execution_attempts/i.test(migrationCode));
record("L03 the transport shape forbids attempt identity on this route",
  /state = 'cancelled'\s*and route_key = 'cancel_stale_v1'[\s\S]{0,300}attempt_id is null[\s\S]{0,120}attempt_number is null[\s\S]{0,120}max_attempts is null/
    .test(migrationCode));
record("L04 the response leaks no business identifier",
  !/entityId|entity_id|vendorId|vendor_id|leadId|assignment/i.test(serviceCode.replace(/action_request_id|job_id/g, "")) &&
  !/destination|recipient|phone|template|provider_message_id/i.test(newModuleCode) &&
  /actionType: row\.action_type/.test(serviceCode));

// ---------------------------------------------------------------------------
// M. ONE PREDICATE — the anti-drift proof
// ---------------------------------------------------------------------------
record("M01 the vendor executor no longer restates any business rule",
  // Every rule literal that used to live in the executor must now be absent from it.
  !/vendor_status !== "New"|onboarding_stage !== "new"|package_status !== "active"|remaining_credits > threshold/
    .test(vendorExecutorCode) &&
  !/endsWith\(":resp2h"\)|endsWith\(":resp24h"\)/.test(vendorExecutorCode) &&
  !/\/\^\\d\{14\}\$\//.test(vendorExecutorCode));
record("M02 the vendor executor DELEGATES to the shared authority",
  /decideVendorBusinessState\(/.test(vendorExecutorCode) &&
  /from "@\/lib\/automation\/vendorBusinessEligibility"/.test(vendorExecutorSource) &&
  /VendorBusinessState\.ELIGIBLE/.test(vendorExecutorCode));
record("M03 the executor still returns its EXACT pre-existing refusal code",
  EXECUTOR_BUSINESS_REFUSAL_CODE === "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE" &&
  /return \{ ok: false, code: EXECUTOR_BUSINESS_REFUSAL_CODE \}/.test(vendorExecutorCode));
record("M04 every DIRECT BUSINESS-ROW PostgREST error in gatherVendorBusinessFacts returns QF_EXEC_LEAD_LOOKUP_FAILED",
  (() => {
    // Scoped and EXHAUSTIVE: every `if (error)` branch in the fact gatherer must
    // return the infrastructure code. A count threshold was not enough — with
    // several occurrences in the file, converting ONE branch into a fabricated
    // "not found" fact slipped through until this was tightened.
    //
    // NOTE THE DELIBERATE NARROWING OF THE CLAIM. This says "direct business-row
    // error", not "every failed read anywhere". The policy-config read inside
    // readLowCreditThreshold is a separate, PRE-EXISTING behaviour pinned by
    // M04a below, and this phase does not change it.
    const gather = (vendorExecutorCode.match(
      /async function gatherVendorBusinessFacts\([\s\S]*?\n\}/) ?? [""])[0];
    if (!gather) return false;
    const errorBranches = (gather.match(/if \(error\)/g) ?? []).length;
    const guarded = (gather.match(
      /if \(error\) return \{ ok: false, code: "QF_EXEC_LEAD_LOOKUP_FAILED" \};/g) ?? []).length;
    return errorBranches === 4 && guarded === 4 && errorBranches === guarded &&
      // no error branch may fabricate a fact instead
      !/if \(error\) return \{ ok: true/.test(gather) &&
      // and the pure decider is never handed an error state at all
      !/lookupFailed|queryError|errorState/.test(predicateCode);
  })());

record("M04a the PRE-EXISTING low-credit policy-read behaviour is preserved byte-for-byte, not changed by this phase",
  (() => {
    // readLowCreditThreshold has ALWAYS collapsed a policy-config read error to
    // null, and the predicate has ALWAYS treated a null threshold as a refusal.
    // That is baseline behaviour: changing it here would be a behaviour change
    // smuggled into a refactor, so the gate pins it as-is.
    const helper = (vendorExecutorCode.match(
      /async function readLowCreditThreshold\([\s\S]*?\n\}/) ?? [""])[0];
    if (!helper) return false;
    return /if \(error \|\| !data\) return null;/.test(helper) &&
      // no numeric fallback anywhere on either side
      !/thresholdCredits\s*(\?\?|\|\|)\s*\d/.test(vendorExecutorCode) &&
      !/lowCreditThreshold\s*(\?\?|\|\|)\s*\d/.test(predicateCode) &&
      // and a null threshold is a refusal in the pure predicate — executed
      decide({ actionType: "vendor.low_credit_warning", entityType: "vendor",
        lowCreditThreshold: null, remainingCredits: 1 }) === S.STALE &&
      decide({ actionType: "vendor.low_credit_warning", entityType: "vendor",
        lowCreditThreshold: undefined, remainingCredits: 1 }) === S.STALE;
  })());

record("M04b the SQL maintenance authority is MORE conservative: a query error aborts, never terminalizes",
  // The mutating function has no exception handler at all, so any SQL error
  // propagates and rolls the transaction back rather than being read as staleness.
  (() => {
    const fn = staleAuthorityFn();
    // A genuine query error has no handler to catch it — the sole handler is the
    // non-uuid conversion, which itself raises — so it propagates and rolls back.
    return !!fn && !/when others then/i.test(fn) &&
      (fn.match(/\bexception\s+when\s+([a-z_]+)/gi) ?? []).length === 1 &&
      /when invalid_text_representation/i.test(fn) &&
      /genuine SQL query error inside this authority ABORTS/i.test(migrationSource);
  })());
record("M05 the executor collapses stale AND unmapped to one code; only the maintenance lane separates them",
  /const state = decideVendorBusinessState\(gathered\.facts\)/.test(vendorExecutorCode) &&
  /if \(state === VendorBusinessState\.ELIGIBLE\) return \{ ok: true \}/.test(vendorExecutorCode));
record("M06 the SQL authority encodes the SAME predicates as the pure module",
  // Each rule appears on both sides. Changing one alone fails this assertion.
  /v_vendor_status is distinct from 'New'/.test(migrationCode) &&
  /v_stage is distinct from 'new'/.test(migrationCode) &&
  /v_package_status is distinct from 'active'/.test(migrationCode) &&
  /v_credits > v_threshold/.test(migrationCode) &&
  /like '%:resp2h' or p_source_event_key like '%:resp24h'/.test(migrationCode) &&
  /'\^\\d\{14\}\$'/.test(migrationCode) &&
  /to_char\(v_expires at time zone 'UTC', 'YYYYMMDDHH24MISS'\)/.test(migrationCode) &&
  predicateCode.includes('!== "New"') && predicateCode.includes('!== "new"') &&
  predicateCode.includes('!== "active"') && predicateCode.includes("> facts.lowCreditThreshold"));
record("M07 the SQL authority is closed to the same four actions and the same pairings",
  /p_action_type = 'vendor\.response_reminder'[\s\S]{0,200}p_entity_type <> 'lead_assignment'/.test(migrationCode) &&
  /'vendor\.onboarding_reminder', 'vendor\.package_expiry_warning', 'vendor\.low_credit_warning'[\s\S]{0,120}p_entity_type <> 'vendor'/
    .test(migrationCode) &&
  /return 'unmapped'/.test(migrationCode) &&
  !/vendor\.lead_offer/.test(migrationCode));

// ---------------------------------------------------------------------------
// N. TRANSPORT / ROUTE
// ---------------------------------------------------------------------------
record("N01 the route vocabulary is closed to exactly seven, in exact order",
  AUTOMATION_TRANSPORT_ROUTE_KEYS.length === 7 &&
  AUTOMATION_TRANSPORT_ROUTE_KEYS.join(",") ===
    "claim_v1,complete_v1,execute_v1,recover_v1,reconcile_v1,cancel_orphan_v1,cancel_stale_v1");
record("N02 the migration widens route_key to exactly the same seven",
  /check \(route_key in \(\s*'claim_v1',\s*'complete_v1',\s*'execute_v1',\s*'recover_v1',\s*'reconcile_v1',\s*'cancel_orphan_v1',\s*'cancel_stale_v1'\s*\)\)/
    .test(migrationCode));
record("N03 the new route has its own exact path, declared once, distinct from cancel-orphan",
  N8N_CANCEL_STALE_ROUTE_PATH === "/api/internal/automation/n8n/cancel-stale" &&
  N8N_CANCEL_STALE_ROUTE_PATH !== N8N_CANCEL_ORPHAN_ROUTE_PATH &&
  (read("lib/automation/transportTypes.ts").match(/"\/api\/internal\/automation\/n8n\/cancel-stale"/g) ?? []).length === 1);
record("N04 the route signs its OWN path only",
  routeCode.includes("path: N8N_CANCEL_STALE_ROUTE_PATH") &&
  !/N8N_CANCEL_ORPHAN_ROUTE_PATH|N8N_RECOVER_ROUTE_PATH|N8N_RECONCILE_ROUTE_PATH|N8N_CLAIM_ROUTE_PATH|N8N_COMPLETE_ROUTE_PATH|N8N_EXECUTE_/
    .test(routeCode) &&
  (routeCode.match(/path: N8N_CANCEL_STALE_ROUTE_PATH/g) ?? []).length === 2);
record("N05 the orchestration vocabulary is closed to three terminal outcomes",
  AUTOMATION_CANCEL_STALE_ORCHESTRATION_STATES.length === 3 &&
  same([...AUTOMATION_CANCEL_STALE_ORCHESTRATION_STATES],
    ["cancel_stale_empty", "cancel_stale_cancelled", "rejected"]));
record("N06 an unauthenticated caller gets an UNSIGNED rejection",
  (() => {
    const v = routeCode.indexOf("const verified = verifyN8nToCoreRequest(");
    const u = routeCode.indexOf("return json({ ok: false, code: verified.code }, verified.status)");
    const s = routeCode.indexOf("return rejected(");
    return v > 0 && u > v && s > u;
  })());
record("N07 the service narrows the action type and fails closed if it cannot",
  /if \(!isStaleBusinessAction\(row\.action_type\)\) \{\s*throw new Error\("AUTOMATION_CANCEL_STALE_ACTION_TYPE_INVALID"\);\s*\}/
    .test(serviceCode) &&
  /row\.safe_code !== STALE_BUSINESS_SAFE_CODE/.test(serviceCode) &&
  (serviceCode.match(/\.rpc\(/g) ?? []).length === 1 &&
  !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(serviceCode));

// ---------------------------------------------------------------------------
// O. n8n
// ---------------------------------------------------------------------------
record("O01 the workflow is inactive", workflow.active === false && /"active": false/.test(read(WORKFLOW_PATH)));
record("O02 it holds no database or provider credential",
  !workflow.nodes.some((n) => /postgres|supabase|mysql|sql/i.test(n.type)) &&
  workflow.nodes.every((n) => !n.credentials) &&
  !/service_role|SUPABASE_|supabaseKey|anon_key|\bfrom\s+public\.|postgresql:\/\/|\.supabase\.co/i.test(workflowText) &&
  !/META_|WHATSAPP_|ACCESS_TOKEN|graph\.facebook/i.test(workflowText));
record("O03 it can reach exactly ONE Core route",
  same([...new Set(workflowText.match(/\/api\/internal\/automation\/n8n\/[a-z-]+/g) ?? [])],
    ["/api/internal/automation/n8n/cancel-stale"]));
record("O04 it sends the exact three-key body and nominates nothing",
  (() => {
    const build = workflow.nodes.find((n) => n.name === "Build Exact Stale Sweep Body");
    const sent = stripJs(build?.parameters?.jsCode ?? "");
    return sent.length > 0 &&
      /JSON\.stringify\(\{ transportVersion: 1, requestId, workerId \}\)/.test(sent) &&
      !/jobId|job_id|entityId|entity_id|entityType|actionType|safeCode|reason|force|limit|stale/.test(sent) &&
      !/jobId|job_id/.test(workflowText);
  })());
record("O05 exactly one HTTP call per cycle and every outcome is a STOP",
  workflow.nodes.filter((n) => /helpers\.httpRequest/.test(n.parameters?.jsCode ?? "")).length === 1 &&
  /followUpCall: 'none'/.test(workflowText) &&
  !workflow.connections["STOP — Stale Sweep Cycle Complete"] &&
  workflow.connections["Branch On Core Stale Sweep State"].main[0][0].node === "STOP — Stale Sweep Cycle Complete");
record("O06 it verifies the signed response before reading any state, and is fail-closed by default",
  workflow.connections["IF — Stale Sweep Response Verified"].main[1][0].node ===
    "STOP — Reject Unverified Stale Sweep Response" &&
  /QF_N8N_TRANSPORT_ENABLED === 'true'/.test(workflowText) &&
  workflow.connections["IF — Stale Sweep Transport Configured"].main[1][0].node ===
    "STOP — Stale Sweep Runtime Not Configured");
record("O07 every workflow in the repository is still inactive, and the set is exactly eight",
  (() => {
    const flows = readdirSync(path.join(ROOT, "automation/n8n")).filter((f) => f.endsWith(".workflow.json")).sort();
    return flows.length === 8 &&
      flows.includes("QF-MVP-50-07-Stale-Business-Supervisor.workflow.json") &&
      flows.every((f) => JSON.parse(read(`automation/n8n/${f}`)).active === false);
  })());

// ---------------------------------------------------------------------------
// P. QF-MVP-50.6 MUST REMAIN FROZEN
// ---------------------------------------------------------------------------
record("P01 the QF-MVP-50.6 migration is byte-identical",
  canonicalSha256(readFileSync(path.join(ROOT, ORPHAN_MIGRATION_PATH))) === ORPHAN_MIGRATION_SHA);
record("P02 every earlier automation migration is byte-identical",
  [["20260801110000_qf_mvp_automation_action_persistence.sql", "ffdd69e5b04f6cf3e747d4d4959b9c4fcae848aeac36697fdffc83d5403f70fc"],
   ["20260804000000_qf_mvp_50_2d_automation_transport_completion_route.sql", "043f1e3bbe261aef516ca35b54eb3e1c339d21d6b0c55c77f1d138eb502fa2c2"],
   ["20260805000000_qf_mvp_50_2e_automation_transport_client_execution_route.sql", "9a8a29975e18135b96e7be7d4510104033c5de00cf080df5dab4326e3891250b"],
   ["20260808000000_qf_mvp_50_2_fresh_claim_retry_wedge_repair.sql", "8b798bb3c5db5d91f988d92cec3705237db08c753ae5018d09dccc09ff0240aa"],
   ["20260811000000_qf_mvp_50_3_50_4_family_aware_claim_routing.sql", "fc7efae9c2349854b9856d3b3b3956933bcfe79ed15c1eeb7caf65bc61f8f89d"],
   ["20260812000000_qf_mvp_50_5_automation_recovery_reconciliation.sql", "25a142009bc389ae9e6f1fae95b873e0858c74b4a5792cbf3217dfb4e3af189b"]]
    .every(([f, sha]) => canonicalSha256(readFileSync(path.join(ROOT, "supabase/migrations", f))) === sha));
record("P03 the orphan contract, service and route are untouched by this phase",
  existsSync(path.join(ROOT, "lib/automation/orphanCancellationContract.ts")) &&
  existsSync(path.join(ROOT, "services/automationOrphanCancellationService.ts")) &&
  existsSync(path.join(ROOT, "app/api/internal/automation/n8n/cancel-orphan/route.ts")) &&
  read("lib/automation/orphanCancellationContract.ts").includes("QF_AUTOMATION_ORPHAN_ENTITY_MISSING"));
record("P04 this migration redefines no claim/recover/reconcile/execute/complete authority and drops nothing",
  !/create or replace function public\.qf_claim_|create or replace function public\.qf_recover_|create or replace function public\.qf_reconcile_|create or replace function public\.qf_complete_|create or replace function public\.qf_select_stale_|create or replace function public\.qf_cancel_orphan_/i
    .test(migrationCode) &&
  !/drop function/i.test(migrationCode));
record("P05 the re-created guards preserve EVERY pre-existing route rule",
  ["claim_v1", "complete_v1", "execute_v1", "recover_v1", "reconcile_v1", "cancel_orphan_v1"]
    .every((r) => new RegExp(`old\\.route_key = '${r}'`).test(migrationCode)) &&
  // and stay non-security-definer trigger functions, exactly as before
  !/qf_guard_automation_transport_request_insert\(\)\s*returns trigger\s*language plpgsql\s*security definer/.test(migrationCode) &&
  !/qf_guard_automation_transport_request_update\(\)\s*returns trigger\s*language plpgsql\s*security definer/.test(migrationCode));
record("P06 the 50.6 uniqueness index and shape clause survive intact",
  /route_key = 'cancel_orphan_v1'\s*and job_id is not null/.test(migrationCode) &&
  /uq_automation_transport_requests_cancel_orphan_job/.test(migrationCode) &&
  /state = 'cancelled'\s*and route_key = 'cancel_orphan_v1'/.test(migrationCode));
record("P07 no pre-existing shape clause was weakened",
  // The processing and reconciled clauses keep their full null / not-null requirements.
  /state = 'processing'\s*and job_id is null\s*and action_request_id is null\s*and attempt_id is null\s*and attempt_number is null\s*and max_attempts is null\s*and finalized_at is null/
    .test(migrationCode) &&
  /state = 'reconciled'\s*and route_key = 'reconcile_v1'\s*and job_id is not null\s*and action_request_id is not null\s*and attempt_id is not null\s*and attempt_number is not null\s*and max_attempts is not null\s*and finalized_at is not null/
    .test(migrationCode));

// ---------------------------------------------------------------------------
// Q. MIGRATION / GOVERNANCE
// ---------------------------------------------------------------------------
record("Q01 the migration is the pinned forward-only file and is the newest 50.x authority",
  canonicalSha256(readFileSync(path.join(ROOT, MIGRATION_PATH))) === MIGRATION_SHA &&
  readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort().at(-4) ===
    "20260906000000_qf_mvp_50_7_automation_stale_business_cancellation.sql");
record("Q02 the local migration set is exactly 109",
  readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).length === 109);
record("Q03 a fail-closed dependency preflight runs before anything is installed",
  migrationCode.indexOf("QF-MVP-50.7: the automation persistence and transport tables must exist.") <
    migrationCode.indexOf("create or replace function public.qf_automation_vendor_business_state_v1") &&
  /to_regprocedure\('public\.qf_automation_entity_state_v1\(text,text\)'\) is null/.test(migrationCode) &&
  /to_regclass\('public\.vendor_crm_profiles'\) is null/.test(migrationCode));
record("Q04 every function fixes its search_path",
  (() => {
    const fns = (migrationCode.match(/create or replace function public\.qf_/g) ?? []).length;
    const paths = (migrationCode.match(/set search_path = pg_catalog, public, pg_temp/g) ?? []).length;
    // QF-MVP-50.7-C2: six now — the low-credit threshold reader was extracted so
    // SQL and TypeScript accept exactly the same JSON shapes.
    return fns === 6 && paths === 6 && fns === paths;
  })());
record("Q05 PUBLIC/anon/authenticated are revoked and only service_role may execute",
  (migrationCode.match(/revoke all on function[\s\S]{0,200}from public, anon, authenticated, service_role;/g) ?? []).length === 4 &&
  (migrationCode.match(/grant execute on function[\s\S]{0,200}to service_role;/g) ?? []).length === 4 &&
  !/grant\s+(insert|update|delete|truncate)/i.test(migrationCode));
record("Q06 no table gains direct mutation and the SELECT-only posture is re-proved",
  !/grant .* on (table )?public\.automation_/i.test(migrationCode) &&
  /privilege_type in \('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'\)/.test(migrationCode));
record("Q07 the migration seeds nothing, deletes nothing and truncates nothing",
  !/^\s*insert\s+into\s+public\.(leads|vendors|lead_assignments|communication_|automation_policy)/im.test(migrationCode) &&
  !/\bdelete\s+from\b/i.test(migrationCode) &&
  !/\btruncate\s+(table\s+)?(only\s+)?public\./i.test(migrationCode) &&
  (migrationCode.match(/^\s*update\s+public\.\w+/gim) ?? [])
    .every((s) => /automation_jobs|automation_transport_requests/.test(s)));
record("Q08 no staging evidence id is hard-coded anywhere",
  (() => {
    const EVIDENCE = ["5c26f321-e6e3-4bb5-a998-95218fb8fde3", "eed762b8-1c13-4429-bd27-88021e46e6ff",
      "1e8e82ee-387f-4a9d-9edf-9a802c0eeeda", "6bcf9d90-ff2d-43be-b992-0af8768c3fae",
      "2e1f8999-6b33-4bc9-b8b2-f34cc7d25b09", "48c10e01-613a-459c-8efc-d963d6088df5",
      "f41348f4-2c77-4f1a-bacb-14505be91459", "11c3f572-d08c-4e0e-a99f-b279a3ab374c",
      "b04f135f-6985-4b8d-a0f4-bcc803896e74", "06ac0afa-cc67-4b83-aef8-730283ab3c04",
      "5ac40d60-356f-4a42-b97f-b295af238955"];
    const surfaces = migrationSource + read(PREDICATE_PATH) + read(CONTRACT_PATH) +
      read(SERVICE_PATH) + read(ROUTE_PATH) + workflowText + vendorExecutorSource;
    return EVIDENCE.every((id) => !surfaces.includes(id));
  })());
record("Q09 the manifest pins the migration as SOURCE-PENDING with no application evidence",
  (() => {
    const pin = (manifest.pendingPostAnchorMigrations ?? []).find((r) => r.version === "20260906000000");
    return manifest.pendingPostAnchorMigrations.length === 5 &&
      pin?.sha256 === MIGRATION_SHA && pin.path === MIGRATION_PATH && pin.phase === "QF-MVP-50.7" &&
      pin.operationalStatus === "PENDING" && pin.appliedToStaging === false &&
      pin.appliedToProduction === false && pin.appliedByThisPhase === false &&
      pin.remoteVersionStatus === "NOT_PROVEN_OFFLINE" &&
      pin.remoteHistoryCountObservedAtApply === false &&
      pin.requiresSeparateStagingDeploymentGate === true &&
      !("remoteHistoryCountAfterApply" in pin) && !("appliedEvidenceMarker" in pin) &&
      manifest.appliedAnchor.postAnchorMigrationCount === 22;
  })());
record("Q10 G1 was re-pinned to the exact new truth, never loosened",
  /const MIGRATION_COUNT = 109;/.test(g1Source) &&
  g1Source.includes(`sha: "${MIGRATION_SHA}"`) &&
  g1Source.includes("pendingPins.length === 5") &&
  g1Source.includes("appliedPins.length === 10") &&
  g1Source.includes("reconciledPins.length === 5") &&
  /const RECONCILIATION_MIGRATION_COUNT = 102;/.test(g1Source) &&
  !/state\.migrations\.length\s*>=/.test(g1Source) && !/postAnchorLocal\.length\s*>=/.test(g1Source));
record("Q11 the applied / reconciled / staging-applied sets are untouched by this source-only phase",
  manifest.appliedPostAnchorMigrations.length === 10 &&
  manifest.reconciledPostAnchorMigrations.length === 5 &&
  manifest.stagingAppliedPostAnchorMigrations.length === 2 &&
  manifest.appliedPostAnchorMigrations.at(-1).version === "20260812000000");
record("Q12 the gate is registered and wired into CI immediately after 50.6",
  pkg.scripts["test:mvp:50-7"] ===
    "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/mvp/loader/register.mjs scripts/mvp/automation/validate-qf-mvp-50-7.mjs" &&
  /- name: QF-MVP-50\.6 validator\s+run: npm run test:mvp:50-6\s+- name: QF-MVP-50\.7 validator\s+run: npm run test:mvp:50-7/
    .test(ciWorkflow) &&
  !ciWorkflow.includes("${{ secrets.") &&
  !/^\s*(?:run:\s*)?(?:npx\s+)?supabase\s+/mi.test(ciWorkflow));
record("Q13 the design document records the decisions and the out-of-scope boundaries",
  doc.length > 0 && /entity orphan/i.test(doc) && /cancel_stale_v1/.test(doc) &&
  /QF_AUTOMATION_BUSINESS_STATE_NO_LONGER_ELIGIBLE/.test(doc) &&
  /TOCTOU/i.test(doc) && /predicate drift/i.test(doc) &&
  /NO STAGING MUTATION/.test(doc) && /NO PRODUCTION MUTATION/.test(doc) &&
  /NO META\/WHATSAPP SEND/.test(doc) &&
  /50\.8|destination normalization/i.test(doc));

// ---------------------------------------------------------------------------
// L2. BUSINESS-TRUTH LOCKING  (QF-MVP-50.7-C2)
//
// The C1 revision claimed NO TOCTOU on the strength of a post-write re-read. That
// was not enough: the re-read held no lock, so a concurrent transaction could
// restore business eligibility after it and before COMMIT, leaving a cancelled
// job whose truth had recovered. These assertions pin the corrected order —
// lock the business rows, prove under the locks, then write — and pin each
// action's specific lock.
// ---------------------------------------------------------------------------
record("L2-01 the authority locks the queue candidate with skip-locked, oldest-first",
  (() => {
    const fn = staleAuthorityFn();
    return !!fn && /for update of j skip locked\s*\n\s*limit 1;/.test(fn) &&
      /order by j\.created_at asc, j\.id asc/.test(fn);
  })());

record("L2-02 response_reminder locks the EXACT lead_assignments row before proving",
  (() => {
    const fn = staleAuthorityFn();
    if (!fn) return false;
    const lock = fn.indexOf("from public.lead_assignments la");
    const proof = fn.indexOf("v_state := public.qf_automation_vendor_business_state_v1");
    return lock > 0 && proof > lock &&
      /from public\.lead_assignments la\s*\n\s*where la\.id = v_entity_uuid\s*\n\s*for update;/.test(fn);
  })());

record("L2-03 the vendor-entity actions lock the EXACT vendors row before proving",
  (() => {
    const fn = staleAuthorityFn();
    if (!fn) return false;
    const lock = fn.indexOf("from public.vendors v");
    const proof = fn.indexOf("v_state := public.qf_automation_vendor_business_state_v1");
    return lock > 0 && proof > lock &&
      /from public\.vendors v\s*\n\s*where v\.id = v_entity_uuid\s*\n\s*for update;/.test(fn);
  })());

record("L2-04 onboarding locks the CRM row when present, and the PARENT lock closes the missing-CRM phantom",
  (() => {
    const fn = staleAuthorityFn();
    if (!fn) return false;
    // The CRM row is locked when it exists...
    const crmLock =
      /from public\.vendor_crm_profiles p\s*\n\s*where p\.vendor_id = v_entity_uuid\s*\n\s*for update;/.test(fn);
    // ...and the parent lock must be FOR UPDATE specifically, because that is the
    // only row-lock mode conflicting with the FOR KEY SHARE an FK insert takes.
    const parentIsForUpdate = /from public\.vendors v\s*\n\s*where v\.id = v_entity_uuid\s*\n\s*for update;/.test(fn) &&
      !/for no key update/i.test(fn);
    // and the FK that makes that work must still exist upstream
    const fkIntact =
      /constraint vcp_vendor_fk foreign key \(vendor_id\)\s*\n\s*references public\.vendors \(id\)/
        .test(read("supabase/migrations/20260723001100_qf_mvp_vendor_crm_foundation.sql")) &&
      /constraint vcp_pkey primary key \(vendor_id\)/
        .test(read("supabase/migrations/20260723001100_qf_mvp_vendor_crm_foundation.sql"));
    // and the reasoning is recorded in source, not just here
    const documented = /FOR KEY SHARE/.test(migrationSource) && /vcp_vendor_fk/.test(migrationSource);
    return crmLock && parentIsForUpdate && fkIntact && documented;
  })());

record("L2-05 low_credit locks the active policy pointer AND excludes the absent-pointer phantom",
  (() => {
    const fn = staleAuthorityFn();
    if (!fn) return false;
    const pointerLock =
      /from public\.automation_policy_active_configs a\s*\n\s*where a\.policy_key = 'vendor_low_credit_warning_threshold'\s*\n\s*for update;/.test(fn);
    // An ABSENT pointer has no row to lock, so it is excluded from SELECTION.
    const absentExcluded =
      /r\.action_type <> 'vendor\.low_credit_warning'\s*\n\s*or public\.qf_automation_low_credit_threshold_v1\(\) is not null/.test(fn);
    // and a pointer that disappears between selection and lock is a state change.
    const recheck = /v_threshold := public\.qf_automation_low_credit_threshold_v1\(\);[\s\S]{0,200}AUTOMATION_STALE_BUSINESS_STATE_CHANGED/.test(fn);
    return pointerLock && absentExcluded && recheck;
  })());

record("L2-06 the TypeScript maintenance guard carries the SAME absent-threshold exclusion",
  // Executed on both sides of the boundary: stale for the executor, NOT
  // terminalizable for the maintenance lane.
  decide({ actionType: "vendor.low_credit_warning", entityType: "vendor",
    lowCreditThreshold: null, remainingCredits: 9 }) === S.STALE &&
  isStaleBusinessTerminalizable({
    facts: { actionType: "vendor.low_credit_warning", entityType: "vendor",
      lowCreditThreshold: null, remainingCredits: 9 },
    entityState: "present", jobStatus: "pending" }) === false &&
  isStaleBusinessTerminalizable({
    facts: { actionType: "vendor.low_credit_warning", entityType: "vendor",
      lowCreditThreshold: undefined, remainingCredits: 9 },
    entityState: "present", jobStatus: "pending" }) === false &&
  // but a CONFIGURED threshold with a recovered balance is still terminalizable
  isStaleBusinessTerminalizable({
    facts: { actionType: "vendor.low_credit_warning", entityType: "vendor",
      lowCreditThreshold: 3, remainingCredits: 9 },
    entityState: "present", jobStatus: "pending" }) === true);

record("L2-07 the job UPDATE happens ONLY after every lock and the final proof",
  (() => {
    const fn = staleAuthorityFn();
    if (!fn) return false;
    const write = fn.indexOf("update public.automation_jobs");
    const proof = fn.indexOf("v_state := public.qf_automation_vendor_business_state_v1");
    // every lock site must precede the write
    const lockPositions = [...fn.matchAll(/for update/g)].map((m) => m.index);
    return write > 0 && proof > 0 && proof < write &&
      lockPositions.length >= 5 && lockPositions.every((i) => i < write);
  })());

record("L2-08 locks are transaction-scoped: nothing commits, releases or unlocks mid-function",
  (() => {
    const fn = staleAuthorityFn();
    return !!fn &&
      !/\bcommit\b|\brollback\b|\bsavepoint\b|pg_advisory_unlock|\bunlock\b/i.test(fn) &&
      // no advisory locks at all: they would only work if every competing writer
      // opted into the same protocol, and none does.
      !/pg_advisory/i.test(migrationCode) &&
      /transaction-scoped/i.test(migrationSource);
  })());

record("L2-09 the maintenance lane MUTATES no business row",
  (() => {
    const fn = staleAuthorityFn();
    if (!fn) return false;
    const writes = fn.match(/^\s*(update|insert into|delete from)\s+public\.\w+/gim) ?? [];
    // the ONLY write in the whole authority is the automation_jobs row
    return writes.length === 1 && /update\s+public\.automation_jobs/i.test(writes[0]) &&
      !/update\s+public\.(vendors|lead_assignments|vendor_crm_profiles|automation_policy)/i.test(migrationCode);
  })());

record("L2-10 the documented lock order is stated and no advisory-lock shortcut is used",
  /LOCK ORDER/i.test(migrationSource) &&
  /automation_jobs -> primary business entity/i.test(migrationSource) &&
  !/pg_advisory/i.test(migrationSource));

// ---------------------------------------------------------------------------
// L3. LOW-CREDIT SQL / TYPESCRIPT TYPE PARITY  (QF-MVP-50.7-C2)
// ---------------------------------------------------------------------------
record("L3-01 the SQL threshold reader requires an integer-valued JSON NUMBER inside int4",
  // QF-MVP-50.7-C3 NARROWED THIS TITLE. The reader is deliberately NOT exact
  // TypeScript parity any more: it is bounded to int4, because ::integer raises
  // outside that domain. L4-06 pins the guard order, L4-10 pins the disclosure.
  /jsonb_typeof\(c\.config_json -> 'thresholdCredits'\) <> 'number' then null/.test(migrationCode) &&
  /not between -2147483648 and 2147483647/.test(migrationCode) &&
  // BOTH unsafe earlier forms are gone: the bare cast, and the unbounded
  // regex-guarded cast that still raised on 2147483648.
  !/select \(c\.config_json ->> 'thresholdCredits'\)::integer\s*\n\s*into v_threshold/.test(migrationCode) &&
  !/~ '\^-\?\[0-9\]\+\$'\s*\n\s*then \(c\.config_json ->> 'thresholdCredits'\)::integer/.test(migrationCode));

record("L3-02 TypeScript accepts exactly the same shapes — executed across the malformed matrix",
  (() => {
    const lc = (t) => decide({ actionType: "vendor.low_credit_warning", entityType: "vendor",
      lowCreditThreshold: t, remainingCredits: 9 });
    return lc(3) === S.STALE &&            // numeric 3, credits above -> stale
      lc("3") === S.STALE &&               // JSON string "3" -> unusable -> refusal
      lc(null) === S.STALE &&              // null -> refusal
      lc(undefined) === S.STALE &&         // missing -> refusal
      lc(3.5) === S.STALE &&               // fractional -> refusal
      lc(NaN) === S.STALE &&               // unusable -> refusal
      // and with a usable threshold the eligible side still works
      decide({ actionType: "vendor.low_credit_warning", entityType: "vendor",
        lowCreditThreshold: 3, remainingCredits: 3 }) === S.ELIGIBLE;
  })());

record("L3-03 a malformed threshold can never TERMINALIZE, on either side",
  ["3", null, undefined, 3.5, NaN].every((t) => isStaleBusinessTerminalizable({
    facts: { actionType: "vendor.low_credit_warning", entityType: "vendor",
      lowCreditThreshold: t, remainingCredits: 9 },
    entityState: "present", jobStatus: "pending" }) === false));

record("L3-04 the executor's own helper is unchanged and still the single reader",
  /if \(error \|\| !data\) return null;/.test(vendorExecutorCode) &&
  /readLowCreditThreshold/.test(vendorExecutorCode) &&
  /VENDOR_LOW_CREDIT_THRESHOLD_POLICY_KEY/.test(vendorExecutorCode));

// ---------------------------------------------------------------------------
// T. TRUTHFULNESS OF THE RATIONALE  (QF-MVP-50.7-C1)
//
// An earlier draft justified this phase with "the retry policy requeues them
// forever". That was FALSE, and a false rationale in canonical source is a defect
// in its own right: it would mislead the next reader into believing a loop exists
// that does not. These assertions pin the REAL executor outcome and forbid the
// false wording from coming back.
// ---------------------------------------------------------------------------
const clientExecutionContract = read("lib/automation/clientExecutionContract.ts");
const persistenceMigrationSql = stripSql(
  read("supabase/migrations/20260801110000_qf_mvp_automation_action_persistence.sql"));

record("T01 QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE is ruled definitive_failure",
  /QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE: \{\s*classification: "definitive_failure",\s*safeCode: "QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE",\s*\}/
    .test(clientExecutionContract));

record("T02 qf_complete_automation_attempt_v1 maps definitive_failure to the terminal job status `failed`",
  /when 'definitive_failure' then 'failed'/.test(persistenceMigrationSql));

record("T03 a definitive failure can carry NO retry timestamp",
  // Two independent guarantees: passing one is rejected outright, and the job
  // update writes next_retry_at only for retry_scheduled.
  /AUTOMATION_TERMINAL_RESULT_NEXT_RETRY_FORBIDDEN/.test(persistenceMigrationSql) &&
  /next_retry_at = case\s*when v_next_status = 'retry_scheduled' then p_next_retry_at\s*else null\s*end/
    .test(persistenceMigrationSql));

record("T04 NO new 50.7 source surface claims stale work requeues or cycles forever",
  (() => {
    const FALSE_CLAIMS =
      /requeue|requeues|straight back on the queue|cycles? forever|retry forever|retries forever|loops? forever/i;
    const surfaces = [migrationSource, read(PREDICATE_PATH), read(CONTRACT_PATH),
      read(SERVICE_PATH), read(ROUTE_PATH), workflowText];
    // The doc may say the words ONLY to disclaim them, so it is checked separately.
    return surfaces.every((s) => !FALSE_CLAIMS.test(s));
  })());

record("T05 the migration and service state the TRUE pre-execution-hygiene rationale",
  // The real outcome chain must be named on both surfaces, and the phase's value
  // must be stated as hygiene rather than as fixing a loop that does not exist.
  /definitive_failure/.test(migrationSource) &&
  /never rescheduled/i.test(migrationSource) &&
  /qf_complete_automation_attempt_v1/.test(migrationSource) &&
  /PRE-EXECUTION QUEUE HYGIENE|pre-execution queue hygiene/i.test(migrationSource) &&
  /never rescheduled/i.test(read(SERVICE_PATH)) &&
  /pre-execution queue hygiene/i.test(read(SERVICE_PATH)) &&
  /qf_complete_automation_attempt_v1/.test(read(SERVICE_PATH)) &&
  // and the document opens by correcting the earlier false claim explicitly
  /That is false/i.test(doc) && /pre-execution queue hygiene/i.test(doc));

record("T06 no 50.7 surface claims staging holds 11 stale rows",
  [migrationSource, read(PREDICATE_PATH), read(CONTRACT_PATH), read(SERVICE_PATH),
   read(ROUTE_PATH), workflowText]
    .every((s) => !/11 such rows|holds 11|identifies 11|11 stale/i.test(s)));

record("T07 the certification plan pins exactly EIGHT stale evidence rows and protects the THREE eligible low-credit rows",
  (() => {
    const STALE_8 = [
      "2e1f8999-6b33-4bc9-b8b2-f34cc7d25b09", "6bcf9d90-ff2d-43be-b992-0af8768c3fae",
      "11c3f572-d08c-4e0e-a99f-b279a3ab374c", "48c10e01-613a-459c-8efc-d963d6088df5",
      "b04f135f-6985-4b8d-a0f4-bcc803896e74", "f41348f4-2c77-4f1a-bacb-14505be91459",
      "06ac0afa-cc67-4b83-aef8-730283ab3c04", "5ac40d60-356f-4a42-b97f-b295af238955"];
    const ELIGIBLE_3 = [
      "1e8e82ee-387f-4a9d-9edf-9a802c0eeeda", "5c26f321-e6e3-4bb5-a998-95218fb8fde3",
      "eed762b8-1c13-4429-bd27-88021e46e6ff"];
    return STALE_8.every((id) => doc.includes(id)) &&
      ELIGIBLE_3.every((id) => doc.includes(id)) &&
      /MUST NOT be terminalized/i.test(doc) &&
      /true stale set is \*\*8\*\*/i.test(doc) &&
      // and the evidence ids stay OUT of every runtime surface
      [...STALE_8, ...ELIGIBLE_3].every((id) =>
        !(migrationSource + read(PREDICATE_PATH) + read(CONTRACT_PATH) +
          read(SERVICE_PATH) + read(ROUTE_PATH) + workflowText).includes(id));
  })());

record("T08 the parity claim is narrowed: one rule DEFINITION plus a transaction-bound SQL mirror",
  /mirror/i.test(read(PREDICATE_PATH)) &&
  /not one executable predicate|are not one executable predicate/i.test(migrationSource + read(PREDICATE_PATH)) &&
  /transaction-bound mirror/i.test(doc) &&
  // and the honest statement that the SQL is a second implementation
  /second implementation/i.test(migrationSource + read(PREDICATE_PATH)));

// ---------------------------------------------------------------------------
// L4. SOURCE TRUTH AFTER C2, AND THE BOUNDED THRESHOLD CAST  (QF-MVP-50.7-C3)
//
// C2 changed the implementation to lock -> prove -> write but left several
// canonical comments describing the OLD write-then-reprove design, and claimed the
// threshold reader could never raise. Both are pinned here: current-tense claims
// must match the current code, and the reader must be provably non-throwing.
// ---------------------------------------------------------------------------
record("L4-01 NO current-tense source claims proof-after-write",
  (() => {
    // The phrases may appear ONLY inside an explicitly historical passage. The
    // migration header keeps one, clearly labelled; nothing else may.
    const FALSE_NOW = /re-?proves? business truth after the write|post-write (business )?re-?proof|after the write the business state is re-derived/i;
    const surfaces = [read(SERVICE_PATH), read(PREDICATE_PATH), read(CONTRACT_PATH), read(ROUTE_PATH)];
    if (surfaces.some((x) => FALSE_NOW.test(x))) return false;
    // the migration may only contain such wording under a HISTORICAL NOTE
    const mig = migrationSource;
    if (FALSE_NOW.test(mig)) return false;
    return true;
  })());

record("L4-02 the migration header states the CURRENT lock -> prove -> write order",
  /LOCK, THEN PROVE, THEN WRITE/i.test(migrationSource) &&
  /acquire the ACTION-SPECIFIC business-row locks/i.test(migrationSource) &&
  /re-prove entity-present AND business-stale WHILE those locks are held/i.test(migrationSource) &&
  /only then UPDATE the job to cancelled/i.test(migrationSource) &&
  /retained until COMMIT/i.test(migrationSource));

record("L4-03 the C2 history is kept but marked explicitly historical, not current",
  /HISTORICAL NOTE/i.test(migrationSource) &&
  /EARLIER, DEFECTIVE revision/i.test(migrationSource) &&
  /it is not what the function below does/i.test(migrationSource));

record("L4-04 COMMENT ON FUNCTION describes the locked pre-write proof",
  (() => {
    const c = (migrationSource.match(
      /comment on function public\.qf_cancel_stale_automation_job_v1\(text\) is[\s\S]*?;/) ?? [""])[0];
    return /UNDER THE ACTION-SPECIFIC ROW LOCKS BEFORE writing/i.test(c) &&
      /holding those locks until commit/i.test(c) &&
      !/after the write/i.test(c);
  })());

record("L4-05 the service comment describes the locked pre-write proof",
  (() => {
    const svc = read(SERVICE_PATH);
    return /the stale\s*\n \* re-proof taken UNDER those locks/i.test(svc) &&
      /every lock is held until commit/i.test(svc) &&
      !/post-write/i.test(svc);
  })());

record("L4-06 the threshold reader can NEVER reach ::integer with an out-of-range value",
  (() => {
    const fn = (migrationCode.match(
      /create or replace function public\.qf_automation_low_credit_threshold_v1\(\)[\s\S]*?\$\$;/) ?? [""])[0];
    if (!fn) return false;
    return (
      // nested CASE, so guard order is guaranteed (a flat AND chain is not)
      /when jsonb_typeof\(c\.config_json -> 'thresholdCredits'\) <> 'number' then null/.test(fn) &&
      /else case/.test(fn) &&
      // integer-valued check, on arbitrary-precision numeric
      /<> trunc\(\(c\.config_json -> 'thresholdCredits'\)::text::numeric\)/.test(fn) &&
      // explicit int4 bound BEFORE the integer cast
      /not between -2147483648 and 2147483647/.test(fn) &&
      fn.indexOf("not between -2147483648 and 2147483647") <
        fn.lastIndexOf("::text::numeric::integer") &&
      // and the old unbounded forms are gone
      !/~ '\^-\?\[0-9\]\+\$'\s*\n\s*then \(c\.config_json ->> 'thresholdCredits'\)::integer/.test(fn)
    );
  })());

record("L4-07 the int4 bounds are stated once and shared with the TypeScript maintenance guard",
  INT4_MIN === -2147483648 && INT4_MAX === 2147483647 &&
  /INT4_MIN/.test(predicateCode) && /INT4_MAX/.test(predicateCode) &&
  new RegExp(String(INT4_MAX)).test(migrationCode) &&
  new RegExp(String(INT4_MIN)).test(migrationCode));

record("L4-08 the TypeScript maintenance guard refuses a threshold outside int4, matching the SQL reader",
  (() => {
    // remainingCredits must EXCEED every threshold under test, otherwise the job
    // is business-ELIGIBLE and the int4 guard is never reached at all.
    const term = (t) => isStaleBusinessTerminalizable({
      facts: { actionType: "vendor.low_credit_warning", entityType: "vendor",
        lowCreditThreshold: t, remainingCredits: Number.MAX_SAFE_INTEGER },
      entityState: "present", jobStatus: "pending" });
    return term(3) === true && term(INT4_MAX) === true && term(INT4_MIN) === true &&
      term(INT4_MAX + 1) === false && term(INT4_MIN - 1) === false &&
      term(1e30) === false && term(null) === false && term("3") === false &&
      term(3.5) === false && term(NaN) === false;
  })());

record("L4-09 the executor's own decision keeps plain JS integer semantics — unchanged by C3",
  // decideVendorBusinessState must NOT have gained the int4 narrowing: that would
  // be a behaviour change to the executor smuggled into a maintenance fix.
  decide({ actionType: "vendor.low_credit_warning", entityType: "vendor",
    lowCreditThreshold: INT4_MAX + 1, remainingCredits: 5 }) === S.ELIGIBLE &&
  decide({ actionType: "vendor.low_credit_warning", entityType: "vendor",
    lowCreditThreshold: INT4_MAX + 1, remainingCredits: 1e12 }) === S.STALE &&
  !/INT4_M(IN|AX)/.test(
    (predicateCode.match(/export function decideVendorBusinessState[\s\S]*?\n\}/) ?? [""])[0]));

record("L4-10 the divergence at the int4 boundary is DOCUMENTED, not claimed as exact parity",
  /deliberately narrower than TypeScript at the int4 boundary/i.test(doc) &&
  /one-directional/i.test(doc) &&
  /never cause an over-cancellation/i.test(doc) &&
  /DELIBERATE, DOCUMENTED DIVERGENCE/i.test(migrationSource) &&
  // the over-strong claims are gone from canonical source
  !/matching readLowCreditThreshold in the TypeScript executor exactly/i.test(migrationSource) &&
  !/No cast can raise\./.test(migrationSource) &&
  !/exactly as the TypeScript does, and can never\s*\n\s*raise/i.test(doc));

record("L4-11 the local concurrency harness covers the int4 boundary matrix against a real Postgres",
  (() => {
    const h = read("scripts/mvp/automation/local-toctou-qf-mvp-50-7.mjs");
    // Pinned as EXACT matrix entries, not bare numbers: `2147483648` also occurs
    // as a substring of `-2147483648`, so a loose test let the decisive
    // out-of-range case be deleted while still appearing to pass.
    const ENTRIES = [
      '["3", "3"]', '[\'"3"\', ""]', '["null", ""]', '["3.5", ""]', '["-3", "-3"]',
      '["2147483647", "2147483647"]', '["2147483648", ""]',
      '["-2147483648", "-2147483648"]', '["-2147483649", ""]',
      '["999999999999999999999999999999", ""]',
    ];
    return ENTRIES.every((e) => h.includes(e)) &&
      /NOTHING raises/i.test(h) &&
      /missing thresholdCredits key returns NULL without raising/i.test(h) &&
      typeof pkg.scripts["test:mvp:50-7-toctou"] === "string";
  })());

// ---------------------------------------------------------------------------
// R. MUTANTS — each names a real defect this phase must not be able to ship
// ---------------------------------------------------------------------------
const mutants = [
  ["accepting an unknown action as stale is impossible",
    () => decide({ actionType: "vendor.something_new", entityType: "vendor" }) === S.UNMAPPED &&
          !isStaleBusinessTerminalizable({ facts: { actionType: "vendor.something_new", entityType: "vendor" }, entityState: "present", jobStatus: "pending" })],
  ["terminalizing an entity-missing job in the stale route is impossible",
    () => !term({ entityState: "missing" }) && /= 'present'/.test(migrationCode)],
  ["terminalizing a processing job is impossible",
    () => !term({ jobStatus: "processing" }) &&
          !/'processing'/.test((migrationCode.match(/j\.status in \([^)]*\)/) ?? [""])[0])],
  ["removing the locked stale re-proof is detectable",
    // QF-MVP-50.7-C2: the proof must come BEFORE the write, not after it.
    () => {
      const fn = staleAuthorityFn();
      if (!fn) return false;
      const proof = fn.indexOf("v_state := public.qf_automation_vendor_business_state_v1");
      const write = fn.indexOf("update public.automation_jobs");
      const lock = fn.indexOf("for update;");
      return /AUTOMATION_STALE_BUSINESS_STATE_CHANGED/.test(fn) &&
        proof > 0 && write > proof && lock > 0 && proof > lock;
    }],
  ["turning a lookup failure into stale is impossible",
    () => /QF_EXEC_LEAD_LOOKUP_FAILED/.test(vendorExecutorCode) && !/lookupFailed/.test(predicateCode)],
  ["assuming a low-credit threshold of 3 is impossible",
    () => lc({ lowCreditThreshold: null }) === S.STALE && !/thresholdCredits.*\?\?\s*3|= 3;/.test(predicateCode)],
  ["treating onboarding 'contacted' as eligible is impossible",
    () => ob({ onboardingStage: "contacted" }) === S.STALE],
  ["ignoring the package expiry source stamp is impossible",
    () => pk({ sourceEventKey: "vendor:pkg" }) === S.STALE && pk({ packageExpiresAtStamp: "20270101000000" }) === S.STALE],
  ["ignoring the response-reminder source window is impossible",
    () => rr({ sourceEventKey: "vendor:abc" }) === S.STALE],
  ["a caller naming its own job is impossible",
    () => !parseCancelStaleRequestBody(JSON.stringify({ transportVersion: 1, requestId: VENDOR, workerId: "w", jobId: VENDOR })).ok],
  ["a caller choosing the reason is impossible",
    () => !parseCancelStaleRequestBody(JSON.stringify({ transportVersion: 1, requestId: VENDOR, workerId: "w", safeCode: "X" })).ok &&
          !/p_safe_code|p_reason/.test(migrationCode)],
  ["a replay selecting a new job is impossible",
    () => migrationCode.indexOf("if not v_inserted then") <
            migrationCode.indexOf("from public.qf_cancel_stale_automation_job_v1(p_worker_id)")],
  ["opening an execution attempt on terminalization is impossible",
    () => !/automation_execution_attempts/i.test(migrationCode.split("create or replace function public.qf_cancel_stale")[1] ?? "")],
  ["writing definitive_failure on a job that never ran is impossible",
    () => /last_result_classification = null/.test(migrationCode) &&
          !/last_result_classification = 'definitive_failure'/.test(migrationCode)],
  ["creating communication evidence is impossible",
    () => !/communication_messages/i.test(migrationCode + newModuleCode + workflowText)],
  ["widening the n8n workflow to another Core path is detectable",
    () => same([...new Set(workflowText.match(/\/api\/internal\/automation\/n8n\/[a-z-]+/g) ?? [])],
      ["/api/internal/automation/n8n/cancel-stale"])],
  ["shipping an active workflow is detectable",
    () => readdirSync(path.join(ROOT, "automation/n8n")).filter((f) => f.endsWith(".workflow.json"))
      .every((f) => JSON.parse(read(`automation/n8n/${f}`)).active === false)],
  ["letting a client or campaign action enter the stale authority is impossible",
    () => ["client.lead_confirmation", "campaign.execute_recipient"].every((a) =>
      !isStaleBusinessAction(a) && decide({ actionType: a, entityType: "vendor" }) === S.UNMAPPED) &&
      !/client\.|campaign\./.test(migrationCode)],
  ["breaking the 50.6 orphan route is detectable",
    () => canonicalSha256(readFileSync(path.join(ROOT, ORPHAN_MIGRATION_PATH))) === ORPHAN_MIGRATION_SHA &&
          AUTOMATION_TRANSPORT_ROUTE_KEYS.includes("cancel_orphan_v1")],
  ["reintroducing an unbounded ::integer cast is detectable",
    () => {
      const fn = (migrationCode.match(
        /create or replace function public\.qf_automation_low_credit_threshold_v1\(\)[\s\S]*?\$\$;/) ?? [""])[0];
      return /not between -2147483648 and 2147483647/.test(fn);
    }],
  ["a current-tense proof-after-write claim reappearing is detectable",
    () => !/re-?proves? business truth after the write|post-write (business )?re-?proof/i
      .test(read(SERVICE_PATH) + read(PREDICATE_PATH) + migrationSource)],
  ["altering vendor executor semantics during the refactor is detectable",
    () => /QF_EXEC_BUSINESS_NO_LONGER_ELIGIBLE/.test(vendorExecutorCode) &&
          (vendorExecutorCode.match(/QF_EXEC_LEAD_LOOKUP_FAILED/g) ?? []).length >= 4 &&
          /QF_EXEC_VENDOR_NOT_FOUND/.test(vendorExecutorCode) &&
          /QF_EXEC_VARIABLES_UNRESOLVED/.test(vendorExecutorCode) &&
          // the eligibility reproof still runs BEFORE any communication is built
          vendorExecutorCode.indexOf("proveVendorExecutionEligibility") <
            vendorExecutorCode.indexOf("BUSINESS_VARIABLE_BUILDERS[args.definition.templateKey]")],
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
console.log(`\nQF-MVP-50.7: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exit(1);
console.log("QF_MVP_50_7_STALE_BUSINESS_GOVERNANCE_SOURCE_READY");
