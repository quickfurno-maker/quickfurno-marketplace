#!/usr/bin/env node
// ============================================================================
// QF-MVP-50.2E — Signed Core client execution + inactive n8n wiring validator
//
// OFFLINE ONLY. No database, no network, no environment secret, no provider
// call, no Meta/WhatsApp call, no n8n call, no Jarvis path. Every crypto and
// contract assertion runs against the REAL Core implementation, never a copy.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTOMATION_EXECUTION_ORCHESTRATION_STATES,
  COMMUNICATION_EXECUTION_PARTITION,
  N8N_EXECUTE_CLIENT_REQUEST_KEYS,
  PRE_COMMUNICATION_FAILURE_RULINGS,
  parseExecuteClientRequestBody,
  resolveCommunicationExecutionPartition,
  resolvePreCommunicationRuling,
} from "../../../lib/automation/clientExecutionContract.ts";
import {
  AUTOMATION_TRANSPORT_ROUTE_KEYS,
  N8N_CLAIM_ROUTE_PATH,
  N8N_COMPLETE_ROUTE_PATH,
  N8N_EXECUTE_CLIENT_ROUTE_PATH,
} from "../../../lib/automation/transportTypes.ts";
import {
  createCoreToN8nResponseSignature,
  createN8nToCoreSignature,
  sha256Hex,
  verifyN8nToCoreRequest,
} from "../../../lib/automation/transportAuth.ts";
import {
  CLIENT_AUTOMATION_ACTION_TYPES,
  CLIENT_DISPATCH_REGISTRY,
  buildAutomationCommunicationIdempotencyKey,
  getClientDispatchDefinition,
} from "../../../lib/automation/clientDispatchRegistry.ts";
import { CLIENT_ACTION_VARIABLE_BUILDERS } from "../../../lib/automation/clientDispatchVariables.ts";
import { BUSINESS_TEMPLATE_CONTRACTS } from "../../../lib/communication/businessTemplateVariables.ts";
import { COMMUNICATION_MESSAGE_STATUSES } from "../../../lib/communication/types.ts";
import { AUTOMATION_RESULT_CLASSIFICATIONS } from "../../../lib/automation/actionContract.ts";
import { COMPLETION_EVIDENCE_RULINGS } from "../../../lib/automation/completionContract.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const canonicalSha256 = (buf) =>
  sha256(Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Negative "this logic does not exist" assertions must inspect CODE, not prose. */
const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const stripSql = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const MIGRATION_NAME =
  "20260805000000_qf_mvp_50_2e_automation_transport_client_execution_route.sql";
const MIGRATION_PATH = `supabase/migrations/${MIGRATION_NAME}`;
const MIGRATION_SHA = "9a8a29975e18135b96e7be7d4510104033c5de00cf080df5dab4326e3891250b";
const WORKFLOW_NAME = "QF-MVP-50-02-Client-Whatsapp-Executor.50.2E-selfhost-env.workflow.json";
const WORKFLOW_PATH = `automation/n8n/${WORKFLOW_NAME}`;
const FROZEN_WORKFLOWS = {
  "QF-MVP-50-01-Core-Job-Dispatcher.workflow.json":
    "9bc49e424a55fd93e24141172a185d58f60e6b5e7f4110f99ef4184174a4be47",
  "QF-MVP-50-01-Core-Job-Dispatcher.50.2B-selfhost-env.workflow.json":
    "93f75377da159f6f64c5c816178df4e982e240cecee108d626e266dedcc4705c",
};

const routeSource = read("app/api/internal/automation/n8n/execute-client/route.ts");
const contractSource = read("lib/automation/clientExecutionContract.ts");
const executionSource = read("services/automationClientExecutionService.ts");
const transportSource = read("services/automationTransportService.ts");
const persistenceSource = read("services/automationPersistenceService.ts");
const typesSource = read("lib/automation/transportTypes.ts");
const migrationSource = read(MIGRATION_PATH);
const workflow = JSON.parse(read(WORKFLOW_PATH));
const workflowText = JSON.stringify(workflow);
const manifest = JSON.parse(read("supabase/staging-history/qf-mvp-staging-history-manifest.json"));
const g1Source = read("scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs");
const d2Source = read("scripts/mvp/automation/validate-qf-mvp-50-2d.mjs");
const ciWorkflow = read(".github/workflows/qf-mvp-50-quality-gate.yml");
const pkg = JSON.parse(read("package.json"));
const doc = read("docs/QF-MVP-50-2E-SIGNED-CLIENT-EXECUTION.md");

const routeCode = stripJs(routeSource);
const contractCode = stripJs(contractSource);
const executionCode = stripJs(executionSource);
const migrationCode = stripSql(migrationSource);
/** The wholly-new 50.2E modules, used by every containment scan. */
const newModuleCode = routeCode + contractCode + executionCode;

/** Exactly the 50.2E addition to the shared transport service. */
const transportExecutionBody = (() => {
  const src = stripJs(transportSource);
  const i = src.indexOf("export async function recordClientExecutionTransportIdentity");
  if (i === -1) return "";
  return src.slice(i);
})();

/**
 * Ordering assertions must run over a FUNCTION BODY, never a whole file: an
 * import statement at the top would otherwise satisfy "X appears before Y" for
 * free, which is exactly the kind of accidental pass a gate must not have.
 */
const slice = (src, start, end) => {
  const i = src.indexOf(start);
  if (i === -1) return "";
  const j = src.indexOf(end, i + start.length);
  return src.slice(i, j === -1 ? src.length : j);
};
const executionBody = slice(executionCode, "export async function executeClientAutomationForN8nTransport", "\nfunction evidenceResult");
const routeBody = slice(routeCode, "export async function POST(", "\nfunction rejected(");
const rpcBody = slice(migrationCode, "create or replace function public.qf_record_automation_execution_transport_v1", "comment on function");

const results = [];
const record = (name, passed, detail = "") =>
  results.push({ name, passed: Boolean(passed), detail });

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const WORKER = "qf-n8n-worker-1";
const body = (o) => JSON.stringify(o);
const validBody = body({
  transportVersion: 1,
  requestId: UUID_A,
  workerId: WORKER,
  jobId: UUID_B,
  attemptId: UUID_C,
});

// ---------------------------------------------------------------------------
// R. REQUEST CONTRACT — exactly five keys
// ---------------------------------------------------------------------------
record("R01 the request key set is exactly five, sorted",
  N8N_EXECUTE_CLIENT_REQUEST_KEYS.length === 5 &&
  same([...N8N_EXECUTE_CLIENT_REQUEST_KEYS], ["attemptId", "jobId", "requestId", "transportVersion", "workerId"]));
record("R02 a valid five-key body parses", parseExecuteClientRequestBody(validBody).ok === true);
record("R03 the parsed body carries exactly the five fields",
  same(Object.keys(parseExecuteClientRequestBody(validBody).body).sort(),
       ["attemptId", "jobId", "requestId", "transportVersion", "workerId"]));
record("R04 a missing key is rejected",
  parseExecuteClientRequestBody(body({ transportVersion: 1, requestId: UUID_A, workerId: WORKER, jobId: UUID_B })).ok === false);
record("R05 an unknown key is rejected, never ignored",
  parseExecuteClientRequestBody(body({
    transportVersion: 1, requestId: UUID_A, workerId: WORKER, jobId: UUID_B, attemptId: UUID_C, extra: 1,
  })).code === "AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID");
record("R06 a wrong transport version is rejected",
  parseExecuteClientRequestBody(body({
    transportVersion: 2, requestId: UUID_A, workerId: WORKER, jobId: UUID_B, attemptId: UUID_C,
  })).ok === false);
record("R07 a non-UUID identity is rejected",
  parseExecuteClientRequestBody(body({
    transportVersion: 1, requestId: UUID_A, workerId: WORKER, jobId: "not-a-uuid", attemptId: UUID_C,
  })).code === "AUTOMATION_TRANSPORT_BODY_IDENTITY_INVALID");
record("R08 an unsafe worker id is rejected",
  parseExecuteClientRequestBody(body({
    transportVersion: 1, requestId: UUID_A, workerId: "bad worker!", jobId: UUID_B, attemptId: UUID_C,
  })).code === "AUTOMATION_TRANSPORT_BODY_IDENTITY_INVALID");
record("R09 malformed JSON, arrays and null are rejected",
  parseExecuteClientRequestBody("{").ok === false &&
  parseExecuteClientRequestBody("[]").ok === false &&
  parseExecuteClientRequestBody("null").ok === false);
record("R10 every rejection is HTTP 400 with a closed code",
  [parseExecuteClientRequestBody("{"), parseExecuteClientRequestBody("[]"),
   parseExecuteClientRequestBody(body({ a: 1 }))].every((r) => r.ok === false && r.status === 400 && typeof r.code === "string"));

// ---------------------------------------------------------------------------
// F. FORBIDDEN BUSINESS FIELDS
// ---------------------------------------------------------------------------
const FORBIDDEN_INPUTS = [
  "actionType", "workflowFamily", "entityType", "entityId",
  "recipient", "recipientId", "recipientPhone", "destination", "phone", "email",
  "template", "templateKey", "variables",
  "provider", "providerAccount", "providerAccountId",
  "consent", "suppression",
  "idempotencyKey", "classification", "safeCode", "executorReference", "nextRetryAt",
  "forceSend", "skipValidation",
];
for (const key of FORBIDDEN_INPUTS) {
  const withField = {
    transportVersion: 1, requestId: UUID_A, workerId: WORKER, jobId: UUID_B, attemptId: UUID_C,
    [key]: "x",
  };
  const parsed = parseExecuteClientRequestBody(body(withField));
  record(`F-${key} is structurally rejected`,
    parsed.ok === false &&
    (parsed.code === "AUTOMATION_EXECUTION_FORBIDDEN_FIELD" ||
     parsed.code === "AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID"));
}
record("F01 the forbidden-token fence is the shared automation vocabulary",
  contractCode.includes("findForbiddenAutomationField"));
record("F02 a nested forbidden field is named as a forbidden-field violation",
  parseExecuteClientRequestBody(body({
    transportVersion: 1, requestId: UUID_A, workerId: WORKER, jobId: UUID_B, attemptId: UUID_C,
    meta: { recipientPhone: "+910000000000" },
  })).code === "AUTOMATION_EXECUTION_FORBIDDEN_FIELD");
record("F03 executorReference is never an input on this route",
  !/executorReference/.test(stripJs(contractSource).split("PRE_COMMUNICATION_FAILURE_RULINGS")[0].replace(/[\s\S]*N8N_EXECUTE_CLIENT_REQUEST_KEYS/, "").slice(0, 2000)) ||
  !N8N_EXECUTE_CLIENT_REQUEST_KEYS.includes("executorReference"));

// ---------------------------------------------------------------------------
// T. TRANSPORT / HMAC — reuse only, path-bound
// ---------------------------------------------------------------------------
record("T01 the execution route path is exact",
  N8N_EXECUTE_CLIENT_ROUTE_PATH === "/api/internal/automation/n8n/execute-client");
record("T02 the path is declared once, in transportTypes",
  (typesSource.match(/"\/api\/internal\/automation\/n8n\/execute-client"/g) ?? []).length === 1 &&
  !routeCode.includes('"/api/internal/automation/n8n/execute-client"') &&
  !executionCode.includes('"/api/internal/automation/n8n/execute-client"'));
record("T03 the route reuses the existing transportAuth module",
  routeCode.includes('from "@/lib/automation/transportAuth"') &&
  routeCode.includes("verifyN8nToCoreRequest") &&
  routeCode.includes("buildSignedCoreResponseHeaders"));
record("T04 no second crypto system was introduced",
  !/createHmac|node:crypto|scrypt|randomBytes/.test(newModuleCode) &&
  !/createHash/.test(routeCode + contractCode));
record("T05 the route is POST-only and Node runtime",
  /export async function POST\(/.test(routeCode) &&
  !/export async function (GET|PUT|PATCH|DELETE|HEAD)\(/.test(routeCode) &&
  /export const runtime = "nodejs"/.test(routeCode));
record("T06 the body cap is enforced on both content-length and actual bytes",
  /const MAX_BODY_BYTES = 2_048/.test(routeCode) &&
  (routeCode.match(/AUTOMATION_TRANSPORT_BODY_TOO_LARGE/g) ?? []).length === 2 &&
  /Buffer\.byteLength\(rawBody, "utf8"\) > MAX_BODY_BYTES/.test(routeCode));
record("T07 requestId header/body equality is required",
  /parsed\.body\.requestId !== verified\.requestId/.test(routeCode) &&
  /AUTOMATION_TRANSPORT_REQUEST_ID_MISMATCH/.test(routeCode));
record("T08 the configured worker is required",
  /parsed\.body\.workerId !== config\.workerId/.test(routeCode) &&
  /AUTOMATION_TRANSPORT_WORKER_NOT_AUTHORIZED/.test(routeCode));
record("T09 transport mode off answers 503 and never executes",
  /AUTOMATION_TRANSPORT_DISABLED/.test(routeBody) &&
  routeBody.indexOf("AUTOMATION_TRANSPORT_DISABLED") < routeBody.indexOf("executeClientAutomationForN8nTransport("));
record("T10 an unauthenticated failure is answered UNSIGNED",
  /if \(!verified\.ok\) \{\s*return json\(\{ ok: false, code: verified\.code \}, verified\.status\);/.test(routeBody));
record("T11 authenticated responses are signed and bound to the requestId",
  /buildSignedCoreResponseHeaders\(\{\s*rawBody,\s*path: N8N_EXECUTE_CLIENT_ROUTE_PATH,\s*requestId,/.test(routeCode));

// Real signature isolation, against the real implementation.
const ts = 1_800_000_000;
const hash = sha256Hex(validBody);
const secret = "x".repeat(48);
const executeSig = createN8nToCoreSignature({ secret, method: "POST", path: N8N_EXECUTE_CLIENT_ROUTE_PATH, requestId: UUID_A, timestamp: ts, bodySha256: hash });
const claimSig = createN8nToCoreSignature({ secret, method: "POST", path: N8N_CLAIM_ROUTE_PATH, requestId: UUID_A, timestamp: ts, bodySha256: hash });
const completeSig = createN8nToCoreSignature({ secret, method: "POST", path: N8N_COMPLETE_ROUTE_PATH, requestId: UUID_A, timestamp: ts, bodySha256: hash });
const headersFor = (sig, timestamp = ts) => new Headers({
  "x-qf-transport-version": "1",
  "x-qf-request-id": UUID_A,
  "x-qf-timestamp": String(timestamp),
  "x-qf-body-sha256": hash,
  "x-qf-signature": sig,
});
const verifyExecute = (sig, opts = {}) => verifyN8nToCoreRequest({
  rawBody: opts.rawBody ?? validBody,
  method: opts.method ?? "POST",
  path: N8N_EXECUTE_CLIENT_ROUTE_PATH,
  headers: opts.headers ?? headersFor(sig, opts.timestamp),
  secret,
  nowSeconds: ts,
});

record("T12 a correctly signed execution request verifies", verifyExecute(executeSig).ok === true);
record("T13 the three route signatures are all distinct",
  new Set([executeSig, claimSig, completeSig]).size === 3);
record("T14 a claim signature cannot authenticate the execution route",
  verifyExecute(claimSig).ok === false && verifyExecute(claimSig).code === "TRANSPORT_SIGNATURE_INVALID");
record("T15 a completion signature cannot authenticate the execution route",
  verifyExecute(completeSig).ok === false && verifyExecute(completeSig).code === "TRANSPORT_SIGNATURE_INVALID");
record("T16 an execution signature cannot authenticate the claim or completion route",
  verifyN8nToCoreRequest({ rawBody: validBody, method: "POST", path: N8N_CLAIM_ROUTE_PATH, headers: headersFor(executeSig), secret, nowSeconds: ts }).ok === false &&
  verifyN8nToCoreRequest({ rawBody: validBody, method: "POST", path: N8N_COMPLETE_ROUTE_PATH, headers: headersFor(executeSig), secret, nowSeconds: ts }).ok === false);
record("T17 a changed body breaks the body hash",
  verifyExecute(executeSig, { rawBody: validBody + " " }).code === "TRANSPORT_BODY_HASH_MISMATCH");
record("T18 a GET-signed request cannot be replayed as POST",
  verifyExecute(createN8nToCoreSignature({ secret, method: "GET", path: N8N_EXECUTE_CLIENT_ROUTE_PATH, requestId: UUID_A, timestamp: ts, bodySha256: hash })).ok === false);
record("T19 the ±300s skew window is enforced on both sides",
  verifyExecute(createN8nToCoreSignature({ secret, method: "POST", path: N8N_EXECUTE_CLIENT_ROUTE_PATH, requestId: UUID_A, timestamp: ts - 301, bodySha256: hash }), { timestamp: ts - 301 }).code === "TRANSPORT_TIMESTAMP_OUTSIDE_WINDOW" &&
  verifyExecute(createN8nToCoreSignature({ secret, method: "POST", path: N8N_EXECUTE_CLIENT_ROUTE_PATH, requestId: UUID_A, timestamp: ts + 301, bodySha256: hash }), { timestamp: ts + 301 }).code === "TRANSPORT_TIMESTAMP_OUTSIDE_WINDOW");
record("T20 a response signature is path-bound too",
  createCoreToN8nResponseSignature({ secret, path: N8N_EXECUTE_CLIENT_ROUTE_PATH, requestId: UUID_A, timestamp: ts, bodySha256: hash }) !==
  createCoreToN8nResponseSignature({ secret, path: N8N_COMPLETE_ROUTE_PATH, requestId: UUID_A, timestamp: ts, bodySha256: hash }));
record("T21 no new environment variable or secret is introduced",
  !/process\.env\./.test(newModuleCode) &&
  !/QF_[A-Z0-9_]+/.test(newModuleCode.replace(/QF_EXEC_[A-Z0-9_]+/g, "").replace(/QF_MVP[^\s]*/g, "").replace(/QF_COMM_[A-Z_]+/g, "")));

// ---------------------------------------------------------------------------
// O. OWNERSHIP AND CURRENT ATTEMPT
// ---------------------------------------------------------------------------
record("O01 a read-side current-attempt proof exists",
  /export async function proveCurrentAutomationAttemptOwnership/.test(persistenceSource));
record("O02 the proof checks linkage, worker and attempt currency before status",
  /attempt\.job_id !== job\.id/.test(persistenceSource) &&
  /attempt\.worker_id !== input\.workerId/.test(persistenceSource) &&
  /attempt\.attempt_number !== job\.attempt_count/.test(persistenceSource));
record("O03 the proof requires a processing job locked by this worker",
  /job\.status !== "processing"/.test(persistenceSource) &&
  /job\.locked_by !== input\.workerId/.test(persistenceSource));
record("O04 a completed current attempt is a distinct verdict, not an authorization",
  /verdict: "owned_completed"/.test(persistenceSource) &&
  /verdict: "owned_started"/.test(persistenceSource) &&
  /verdict: "not_owned"/.test(persistenceSource));
record("O05 the execution service refuses an unowned attempt without finalizing",
  /ownership\.verdict === "not_owned"/.test(executionBody) &&
  executionBody.indexOf('ownership.verdict === "not_owned"') < executionBody.indexOf("completeAutomationAttempt("));
record("O06 the ownership proof runs before any reservation or execution",
  executionBody.indexOf("proveCurrentAutomationAttemptOwnership(") < executionBody.indexOf("recordClientExecutionTransportIdentity(") &&
  executionBody.indexOf("proveCurrentAutomationAttemptOwnership(") < executionBody.indexOf("createRuntimeCommunicationService("));
record("O07 the RPC re-proves ownership at the durable serialization point",
  /v_job\.status <> 'processing'/.test(migrationCode) &&
  /v_job\.locked_by is distinct from p_worker_id/.test(migrationCode) &&
  /v_attempt\.status <> 'started'/.test(migrationCode) &&
  /v_attempt\.attempt_number <> v_job\.attempt_count/.test(migrationCode));

// ---------------------------------------------------------------------------
// S. EXACTLY SIX CLIENT ACTIONS
// ---------------------------------------------------------------------------
record("S01 the client action set is exactly six",
  CLIENT_AUTOMATION_ACTION_TYPES.length === 6 &&
  same([...CLIENT_AUTOMATION_ACTION_TYPES].sort(), [
    "client.lead_confirmation", "client.lead_status_update", "client.matching_update",
    "client.missing_information_reminder", "client.requirement_collection", "client.transactional_followup",
  ]));
record("S02 every one of the six has a dispatch definition and a variable builder",
  CLIENT_AUTOMATION_ACTION_TYPES.every((a) => getClientDispatchDefinition(a) && CLIENT_ACTION_VARIABLE_BUILDERS[a]));
record("S03 an unregistered or vendor/campaign action resolves to nothing",
  ["vendor.lead_offer", "campaign.execute_batch", "client.unknown", "", null, 7]
    .every((a) => getClientDispatchDefinition(a) === null));
record("S04 a non-client action is refused and never finalized",
  /AUTOMATION_EXECUTION_ACTION_NOT_CLIENT_DISPATCHABLE/.test(executionBody) &&
  executionBody.indexOf("AUTOMATION_EXECUTION_ACTION_NOT_CLIENT_DISPATCHABLE") < executionBody.indexOf("completeAutomationAttempt("));
record("S05 all six carry the frozen client dispatch policy",
  CLIENT_AUTOMATION_ACTION_TYPES.every((a) => {
    const d = CLIENT_DISPATCH_REGISTRY[a];
    return d.workflowFamily === "client_whatsapp" &&
      same([...d.allowedEntityTypes], ["lead"]) &&
      d.recipientStrategy === "lead_direct" &&
      d.communicationLane === "business" &&
      d.consentScope === "transactional";
  }));
record("S06 the frozen action-to-template map is unchanged",
  same(CLIENT_AUTOMATION_ACTION_TYPES.map((a) => CLIENT_DISPATCH_REGISTRY[a].templateKey), [
    "lead_received", "clarification_request", "clarification_reminder",
    "client_matching_update", "client_lead_status_update", "client_transactional_followup",
  ]));

// ---------------------------------------------------------------------------
// D. CORE DERIVATION — n8n chooses nothing
// ---------------------------------------------------------------------------
record("D01 the workflow family is Core-derived and re-checked, never supplied",
  /envelope\.workflowFamily !== definition\.workflowFamily/.test(executionCode) &&
  !/workflowFamily\s*[:=]\s*(input|body|parsed|request)/.test(executionCode));
record("D02 no action-type prefix parsing exists anywhere in 50.2E",
  !/startsWith\(\s*["'`]client\./.test(newModuleCode) &&
  !/split\(\s*["'`]\.["'`]\s*\)/.test(newModuleCode) &&
  !/\/\^client\\?\./.test(newModuleCode));
record("D03 the entity type is proven against the registry",
  /isAllowedClientDispatchEntityType\(/.test(executionCode) &&
  /AUTOMATION_EXECUTION_ENTITY_TYPE_NOT_ALLOWED/.test(executionCode));
record("D04 the template key comes only from the dispatch registry",
  /template_key: args\.definition\.templateKey/.test(executionCode) &&
  !/template_key:\s*(input|body|parsed)/.test(executionCode));
record("D05 variables come only from Core-owned rows, never from safeContext",
  /readLeadFacts/.test(executionCode) &&
  !/safeContext/.test(executionCode));
record("D06 the recipient is the durable lead reference, never an ephemeral destination",
  /recipient_type: "lead"/.test(executionCode) &&
  /destination_source: RECIPIENT_REFERENCE_DESTINATION/.test(executionCode) &&
  !/ephemeralAuthDestination|ephemeral_auth_destination/.test(executionCode));
record("D07 consent, mapping and provider account are never re-implemented",
  !/consent_|suppression|provider_account|approved_mapping|prepareInitialOutbound|prepareFinalOutbound/i.test(executionCode));
record("D08 no recipient phone or destination is ever read or built",
  !/\.phone|phone_e164|whatsapp_number|destination_hash|destination_masked|normalizePhoneE164|maskPhoneE164/.test(newModuleCode));

// ---------------------------------------------------------------------------
// I. IDEMPOTENCY
// ---------------------------------------------------------------------------
const derivedKey = buildAutomationCommunicationIdempotencyKey(UUID_B, UUID_C);
record("I01 the key is exactly qf_auto_v1:{jobId}:{attemptId}",
  derivedKey === `qf_auto_v1:${UUID_B}:${UUID_C}` && derivedKey.length === 84);
record("I02 a different attempt yields a different key",
  buildAutomationCommunicationIdempotencyKey(UUID_B, UUID_A) !== derivedKey);
record("I03 invalid identities yield null, never a partial key",
  buildAutomationCommunicationIdempotencyKey("x", UUID_C) === null &&
  buildAutomationCommunicationIdempotencyKey(UUID_B, "x") === null);
record("I04 the service builds the key only through the shared authority",
  /buildAutomationCommunicationIdempotencyKey\(/.test(executionCode) &&
  !/qf_auto_v1/.test(executionCode.replace(/buildAutomationCommunicationIdempotencyKey/g, "")));
record("I05 the key is never accepted from the request",
  !/idempotencyKey|idempotency_key:\s*(input|body|parsed)/.test(routeCode));

// ---------------------------------------------------------------------------
// E. EXECUTE LEDGER — IDENTITY ONLY
// ---------------------------------------------------------------------------
record("E01 the migration matches its pinned hash",
  canonicalSha256(readFileSync(path.join(ROOT, MIGRATION_PATH))) === MIGRATION_SHA);
record("E02 the route vocabulary is closed to exactly three",
  AUTOMATION_TRANSPORT_ROUTE_KEYS.length === 3 &&
  AUTOMATION_TRANSPORT_ROUTE_KEYS.join(",") === "claim_v1,complete_v1,execute_v1" &&
  /check \(route_key in \('claim_v1', 'complete_v1', 'execute_v1'\)\)/.test(migrationCode));
record("E03 the state vocabulary adds exactly one new terminal state",
  /check \(state in \('processing', 'claimed', 'empty', 'completed', 'recorded'\)\)/.test(migrationCode));
record("E04 the recorded state is bound to execute_v1 by the shape check",
  /state = 'recorded'\s*\n\s*and route_key = 'execute_v1'/.test(migrationCode));
record("E05 execute replay identity is attempt-scoped",
  /create unique index uq_automation_transport_requests_execute_attempt\s*\n\s*on public\.automation_transport_requests\(attempt_id\)\s*\n\s*where route_key = 'execute_v1' and attempt_id is not null;/.test(migrationCode));
record("E06 the claim and completion uniqueness rules are preserved untouched",
  !/drop index public\.uq_automation_transport_requests_claim_job/.test(migrationCode) &&
  !/drop index public\.uq_automation_transport_requests_complete_attempt/.test(migrationCode) &&
  /uq_automation_transport_requests_claim_job/.test(migrationCode) &&
  /uq_automation_transport_requests_complete_attempt/.test(migrationCode));
record("E07 the ledger stores NO outcome field",
  !/add column/i.test(migrationCode) &&
  !/classification|safe_code|executor_reference|communication_status|provider_message_id/.test(rpcBody) &&
  !/classification|safeCode|executorReference/.test(transportExecutionBody));
record("E08 the migration proves the ledger carries no outcome column",
  /transport ledger carries an outcome column; execute_v1 must remain identity-only/.test(migrationSource));
record("E09 the RPC finalizes no attempt and calls no provider",
  !/qf_complete_automation_attempt/.test(rpcBody) &&
  !/communication_messages|pg_net|dblink|update public\.automation_jobs|update public\.automation_execution_attempts/.test(rpcBody));
record("E10 the RPC is SECURITY DEFINER with a pinned search_path, service_role only",
  /create or replace function public\.qf_record_automation_execution_transport_v1[\s\S]*?security definer[\s\S]*?set search_path = pg_catalog, public, pg_temp/.test(migrationCode) &&
  /revoke all on function public\.qf_record_automation_execution_transport_v1[\s\S]*?from public, anon, authenticated, service_role/.test(migrationCode) &&
  /grant execute on function public\.qf_record_automation_execution_transport_v1[\s\S]*?to service_role/.test(migrationCode));
record("E11 the table ACL posture is unchanged and re-verified",
  /has_table_privilege\('service_role', 'public\.automation_transport_requests', 'insert'\)/.test(migrationCode) &&
  /relrowsecurity/.test(migrationCode));
record("E12 no execute row is seeded",
  /where route_key = 'execute_v1';/.test(migrationCode) &&
  /execution ledger unexpectedly seeded/.test(migrationSource));
record("E13 no cross-system atomicity is claimed",
  /NO CROSS-SYSTEM ATOMICITY IS CLAIMED/.test(migrationSource) &&
  /no cross-system atomicity is claimed/i.test(executionSource));
record("E14 the four lifecycle triggers are re-verified",
  /expected 4 transport lifecycle triggers/.test(migrationSource));
record("E15 the insert guard stays pristine-only for exactly three routes",
  /new\.route_key not in \('claim_v1', 'complete_v1', 'execute_v1'\)/.test(migrationCode) &&
  /new\.state <> 'processing'/.test(migrationCode));
record("E16 an execute_v1 request may finalize only to recorded",
  /old\.route_key = 'execute_v1' and new\.state <> 'recorded'/.test(migrationCode));
record("E17 claim and complete finalization rules are preserved verbatim",
  /old\.route_key = 'claim_v1' and new\.state not in \('claimed', 'empty'\)/.test(migrationCode) &&
  /old\.route_key = 'complete_v1' and new\.state <> 'completed'/.test(migrationCode));

// ---------------------------------------------------------------------------
// P. REPLAY
// ---------------------------------------------------------------------------
record("P01 attempt-scoped replay is checked BEFORE any insert",
  rpcBody.indexOf("where route_key = 'execute_v1'") < rpcBody.indexOf("insert into public.automation_transport_requests"));
record("P02 a same-request replay requires exact worker and body equality",
  /v_existing\.id = p_request_id[\s\S]*?v_existing\.worker_id is distinct from p_worker_id[\s\S]*?v_existing\.body_sha256 is distinct from p_body_sha256[\s\S]*?AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT/.test(rpcBody));
record("P03 a different requestId for the same attempt returns the recorded identity",
  /v_existing\.id is not null[\s\S]*?return query[\s\S]*?true,/.test(rpcBody));
record("P04 a request identity bound to another route is a conflict, never a reservation",
  /AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT/.test(rpcBody) &&
  /AUTOMATION_TRANSPORT_REQUEST_INCOMPLETE_INVARIANT/.test(rpcBody));
record("P05 the job row is locked first so concurrent reservations serialize",
  rpcBody.indexOf("from public.automation_jobs") < rpcBody.indexOf("where route_key = 'execute_v1'") &&
  /from public\.automation_jobs\s*\n\s*where id = p_job_id\s*\n\s*for update/.test(rpcBody));
record("P06 replay re-reads Core truth rather than a stored verdict",
  executionBody.indexOf("readCommunicationEvidence(") < executionBody.indexOf("recordClientExecutionTransportIdentity(") &&
  (executionBody.match(/readCommunicationEvidence\(/g) ?? []).length === 2);
record("P07 a refused reservation never proceeds to execution",
  /AUTOMATION_EXECUTION_RESERVATION_REFUSED/.test(executionBody) &&
  executionBody.indexOf("AUTOMATION_EXECUTION_RESERVATION_REFUSED") < executionBody.indexOf("createRuntimeCommunicationService("));
record("P07a a refused reservation is not relabelled as a specific conflict",
  !/AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT/.test(executionBody));
record("P08 a lost response after finalization replays as attempt_finalized, not rejected",
  /owned_completed[\s\S]*?getRecordedClientExecutionIdentity[\s\S]*?orchestrationState: "attempt_finalized"[\s\S]*?replayed: true/.test(executionBody));
record("P09 a finalization Core did not reserve is never claimed as its own",
  /AUTOMATION_EXECUTION_ATTEMPT_ALREADY_FINALIZED_ELSEWHERE/.test(executionCode));
record("P10 an old attempt after a newer one is refused by the currency proof",
  /AUTOMATION_EXECUTION_ATTEMPT_NOT_CURRENT/.test(persistenceSource) &&
  /AUTOMATION_EXECUTION_ATTEMPT_NOT_CURRENT/.test(migrationCode));

// ---------------------------------------------------------------------------
// B. B1 — ONLY WHEN NO COMMUNICATION ROW EXISTS
// ---------------------------------------------------------------------------
record("B01 evidence is read before any finalization decision",
  executionBody.indexOf("readCommunicationEvidence(") < executionBody.indexOf("resolvePreCommunicationRuling("));
record("B02 an existing row returns immediately and never reaches the ruling table",
  /if \(existingEvidence\) \{[\s\S]{0,400}?return evidenceResult\(/.test(executionBody) &&
  /if \(evidence\) \{\s*return evidenceResult\([\s\S]{0,200}?\}/.test(executionBody));
record("B03 the ruling table is consulted only after evidence is proven absent",
  executionBody.indexOf("const evidence = await readCommunicationEvidence") <
  executionBody.indexOf("resolvePreCommunicationRuling(failureCode)"));
record("B04 completeAutomationAttempt is called exactly once, after the ruling",
  (executionBody.match(/await completeAutomationAttempt\(/g) ?? []).length === 1 &&
  executionBody.indexOf("resolvePreCommunicationRuling(failureCode)") < executionBody.indexOf("await completeAutomationAttempt("));
record("B05 an unclassifiable failure leaves the attempt owned and open",
  /AUTOMATION_EXECUTION_PRE_COMMUNICATION_UNCLASSIFIED/.test(executionBody) &&
  executionBody.indexOf("AUTOMATION_EXECUTION_PRE_COMMUNICATION_UNCLASSIFIED") < executionBody.indexOf("await completeAutomationAttempt("));
record("B06 an unknown failure code is never guessed",
  resolvePreCommunicationRuling("SOMETHING_NEW") === null &&
  resolvePreCommunicationRuling("") === null &&
  resolvePreCommunicationRuling(null) === null &&
  resolvePreCommunicationRuling(undefined) === null);
record("B07 every ruling uses only the closed automation classification vocabulary",
  Object.values(PRE_COMMUNICATION_FAILURE_RULINGS).every((r) =>
    AUTOMATION_RESULT_CLASSIFICATIONS.includes(r.classification) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(r.safeCode)));
record("B08 readiness and configuration absence is never auto-retryable",
  ["TEMPLATE_NOT_FOUND_OR_INACTIVE", "TEMPLATE_NOT_READY",
   "META_APPROVED_MAPPING_UNRESOLVED", "META_RUNTIME_GATE_BLOCKED",
   "META_FINAL_RUNTIME_GATE_BLOCKED", "APPROVED_TEMPLATE_COORDINATOR_UNAVAILABLE",
   "META_OUTBOUND_CONFIG_MISSING"]
    .every((c) => PRE_COMMUNICATION_FAILURE_RULINGS[c].classification === "definitive_failure"));
record("B09 a consent REFUSAL is definitive and carries one generic safe code",
  ["CONSENT_SUPPRESSED", "CONSENT_NOT_GRANTED", "UNCLASSIFIED_MESSAGE_TYPE",
   "MESSAGE_TYPE_TEMPLATE_MISMATCH", "MESSAGE_LANE_SCOPE_MISMATCH"]
    .every((c) => PRE_COMMUNICATION_FAILURE_RULINGS[c].classification === "definitive_failure" &&
                  PRE_COMMUNICATION_FAILURE_RULINGS[c].safeCode === "QF_EXEC_DISPATCH_NOT_AUTHORIZED"));
record("B10 an UNAVAILABLE consent authority is retryable, a DENY is not",
  PRE_COMMUNICATION_FAILURE_RULINGS.CONSENT_AUTHORITY_UNAVAILABLE.classification === "retryable_failure" &&
  PRE_COMMUNICATION_FAILURE_RULINGS.CONSENT_NOT_GRANTED.classification === "definitive_failure");
record("B11 only a retryable ruling may carry a retry timestamp",
  /ruling\.classification === "retryable_failure"\s*\?\s*buildAutomationNextRetryAt\(/.test(executionBody) &&
  /\}\)\s*:\s*null;/.test(executionBody));
record("B12 the retry schedule is the existing Core-owned schedule, never a local copy",
  /buildAutomationNextRetryAt\(\{/.test(executionBody) &&
  !/\b(60|300|900|3600)\b/.test(executionCode) &&
  !/AUTOMATION_RETRY_DELAY_SCHEDULE_SECONDS\s*=/.test(newModuleCode));
record("B13 no executorReference is emitted for a pre-communication finalization",
  /executorReference: null,/.test(executionBody) &&
  /orchestrationState: "attempt_finalized",\s*\n\s*replayed: reservationReplayed,\s*\n\s*\},/.test(executionBody));
record("B14 no communication row is ever fabricated",
  !/\.insert\(|\.upsert\(|\.update\(|\.delete\(/.test(executionCode));
record("B15 the pre-communication ruling table names its reachability rule",
  /REACHABILITY RULE/.test(contractSource) &&
  /no fabricated communication evidence/i.test(contractSource));

// ---------------------------------------------------------------------------
// C. COMMUNICATION STATUS PARTITION
// ---------------------------------------------------------------------------
record("C01 the partition is total over the closed status vocabulary",
  COMMUNICATION_MESSAGE_STATUSES.every((s) => resolveCommunicationExecutionPartition(s) !== null) &&
  Object.keys(COMMUNICATION_EXECUTION_PARTITION).length === COMMUNICATION_MESSAGE_STATUSES.length);
record("C02 queued, dispatching and retry_scheduled are pending",
  ["queued", "dispatching", "retry_scheduled"].every((s) => COMMUNICATION_EXECUTION_PARTITION[s] === "pending"));
record("C03 every other status is completion-ready",
  ["accepted", "sent", "delivered", "read", "failed", "dead_letter", "cancelled", "outcome_unknown"]
    .every((s) => COMMUNICATION_EXECUTION_PARTITION[s] === "completion_ready"));
record("C04 the partition agrees exactly with the 50.2D completion rulings",
  COMMUNICATION_MESSAGE_STATUSES.every((s) =>
    (COMMUNICATION_EXECUTION_PARTITION[s] === "completion_ready") === (COMPLETION_EVIDENCE_RULINGS[s].completable === true)));
record("C05 an unknown status fails closed",
  resolveCommunicationExecutionPartition("brand_new") === null &&
  resolveCommunicationExecutionPartition(null) === null &&
  resolveCommunicationExecutionPartition(7) === null);
record("C06 an unknown status is refused, never treated as completable",
  /AUTOMATION_EXECUTION_COMMUNICATION_STATE_UNKNOWN/.test(executionCode) &&
  /if \(!partition\)/.test(executionCode));
record("C07 a pending row never opens a new automation attempt",
  /partition === "pending"/.test(executionCode) &&
  !/partition === "pending"[\s\S]{0,800}?completeAutomationAttempt/.test(executionCode));
record("C08 a pending row is never re-dispatched by 50.2E",
  !/dispatchPersistedMessage|dispatchMessage\(/.test(newModuleCode));
record("C09 the absence of a due sweep is recorded honestly",
  /HONEST LIMIT/.test(contractSource) &&
  /no communication due-sweep exists/i.test(contractSource));
record("C10 the two-retry-mechanism fence is restated at the partition",
  /SECOND communication row and a SECOND\s*\n?\s*\*\s*provider send|SECOND provider send/.test(contractSource));

// ---------------------------------------------------------------------------
// X. ORCHESTRATION STATE + executorReference
// ---------------------------------------------------------------------------
record("X01 the orchestration vocabulary is exactly four states",
  AUTOMATION_EXECUTION_ORCHESTRATION_STATES.length === 4 &&
  same([...AUTOMATION_EXECUTION_ORCHESTRATION_STATES],
       ["execution_recorded", "communication_pending", "attempt_finalized", "rejected"]));
record("X02 executorReference is emitted only for execution_recorded",
  (executionCode.match(/executorReference: evidence\.id/g) ?? []).length === 1 &&
  /orchestrationState: "execution_recorded",\s*\n\s*replayed,\s*\n\s*executorReference: evidence\.id,/.test(executionCode));
record("X03 executorReference is absent from pending, finalized and rejected",
  !/orchestrationState: "communication_pending",[\s\S]{0,200}?executorReference/.test(executionCode) &&
  !/orchestrationState: "attempt_finalized",[\s\S]{0,200}?executorReference/.test(executionCode) &&
  !/orchestrationState: "rejected",[\s\S]{0,200}?executorReference/.test(routeCode));
record("X04 executorReference is only ever a real communication_messages id",
  /\.from\("communication_messages"\)\s*\n?\s*\.select\("id, status"\)/.test(executionCode) &&
  !/executorReference:\s*(input|parsed|body|request|`|"|')/.test(executionCode));
record("X05 a rejection carries the closed branch key and never finalizes",
  /orchestrationState: "rejected"/.test(routeCode) &&
  !/completeAutomationAttempt/.test(routeCode));
record("X06 HTTP 200 alone is never success — the state is the branch key",
  /orchestrationState/.test(routeCode) &&
  /result\.ok/.test(routeCode));
record("X07 the sanitized response leaks no business or provider detail",
  !/provider_message_id|destination|phone|email|template_key|variables|consent|lead\b|stack|sql/i.test(
    routeCode.replace(/execute-client/g, "")));
record("X08 the evidence projection reads exactly id and status",
  /\.select\("id, status"\)/.test(executionCode) &&
  (executionCode.match(/from\("communication_messages"\)/g) ?? []).length === 1);
record("X09 provider_message_id is never selected anywhere in 50.2E",
  !/provider_message_id/.test(newModuleCode));

// ---------------------------------------------------------------------------
// U. COMMUNICATION LOCUS REUSE — no provider rewrite
// ---------------------------------------------------------------------------
record("U01 execution goes through the runtime construction boundary",
  /createRuntimeCommunicationService\(\)/.test(executionCode) &&
  !/new CommunicationService\(/.test(executionCode));
record("U02 exactly one send call exists",
  (executionCode.match(/\.send\(/g) ?? []).length === 1);
record("U03 no provider adapter is imported or called",
  !/metaCloudWhatsAppProvider|mockWhatsAppProvider|sendTemplateMessage|sendResolvedTemplate|whatsappProvider/i.test(newModuleCode));
record("U04 the communication and provider modules are untouched by this phase",
  (() => {
    const frozen = {
      "services/communicationService.ts": "50.2E must not change dispatch behaviour",
      "services/communicationRecipientResolver.ts": "",
      "services/outboundConsentEnforcementService.ts": "",
      "services/runtimeCommunicationService.ts": "",
      "lib/automation/clientDispatchRegistry.ts": "",
      "lib/automation/clientDispatchVariables.ts": "",
      "lib/communication/businessTemplateVariables.ts": "",
    };
    return Object.keys(frozen).every((f) => existsSync(path.join(ROOT, f)));
  })());
record("U05 the business template contracts are still exactly five",
  Object.keys(BUSINESS_TEMPLATE_CONTRACTS).length === 5);
record("U06 50.2E adds no template, mapping, provider account or readiness flip",
  !/communication_templates|communication_provider_(accounts|template_mappings)|binding_readiness|send_authority|readiness_status/i.test(newModuleCode));
record("U07 the intent message type is the template key, matching the consent registry",
  /type: args\.definition\.templateKey/.test(executionCode));
record("U08 the business lane and transactional scope come from the frozen registry",
  /lane: args\.definition\.communicationLane/.test(executionCode) &&
  !/lane:\s*["']business["']/.test(executionCode));

// ---------------------------------------------------------------------------
// N. n8n WIRING
// ---------------------------------------------------------------------------
const wfNodes = workflow.nodes ?? [];
const wfExec = wfNodes.filter((n) => n.type !== "n8n-nodes-base.stickyNote");
const wfExecText = JSON.stringify(wfExec);
record("N01 the new executor workflow exists and is inactive",
  workflow.active === false && !Object.prototype.hasOwnProperty.call(workflow, "published"));
record("N02 node ids and names are unique",
  new Set(wfNodes.map((n) => n.id)).size === wfNodes.length &&
  new Set(wfNodes.map((n) => n.name)).size === wfNodes.length);
record("N03 no forbidden node type is present",
  !wfNodes.some((n) => /webhook|wait|httpRequest|executeWorkflow|toolWorkflow|executeCommand|\bssh\b|supabase|postgres/i.test(n.type)));
record("N04 no credential is attached to any node",
  !wfNodes.some((n) => Object.prototype.hasOwnProperty.call(n, "credentials")) &&
  !/"credentials"/.test(workflowText));
record("N05 secrets are env references only, never literal values",
  /\$env\.QF_N8N_TO_CORE_HMAC_SECRET/.test(workflowText) &&
  /\$env\.QF_CORE_TO_N8N_HMAC_SECRET/.test(workflowText) &&
  !/sbp_[A-Za-z0-9_-]{8,}/.test(workflowText) &&
  !/eyJ[A-Za-z0-9_-]{10,}\./.test(workflowText) &&
  !/service[_ -]?role/i.test(wfExecText));
record("N06 the default path is fail-closed on QF_N8N_TRANSPORT_ENABLED",
  /QF_N8N_TRANSPORT_ENABLED === 'true'/.test(workflowText));
record("N07 routing reads only the Core-derived workflowFamily",
  /workflowFamily === 'client_whatsapp'/.test(workflowText) &&
  !/\.\s*actionType|\[.actionType.\]/.test(wfExecText));
record("N08 no action-type prefix parsing exists in the workflow",
  !/startsWith\('client\.|split\('\.'\)/.test(wfExecText));
record("N09 the execute body carries exactly the five identity keys",
  /JSON\.stringify\(\{ transportVersion: 1, requestId, workerId, jobId, attemptId \}\)/.test(workflowText));
record("N10 the completion body carries exactly the six 50.2D keys",
  /transportVersion: 1,\\n  requestId,\\n  workerId: String\(ctx\.workerId \|\| ''\),\\n  jobId: String\(ctx\.jobId \|\| ''\),\\n  attemptId: String\(ctx\.attemptId \|\| ''\),\\n  executorReference\\n/.test(workflowText));
record("N11 n8n branches only on the Core-authored orchestrationState",
  /orchestrationState/.test(workflowText) &&
  /'execution_recorded', 'communication_pending', 'attempt_finalized', 'rejected'/.test(workflowText));
record("N12 completion is reachable only from execution_recorded",
  /ctx\.orchestrationState !== 'execution_recorded' \|\| ctx\.completionReady !== true/.test(workflowText) &&
  /QF_50_2E_COMPLETION_NOT_AUTHORIZED/.test(workflowText));
record("N13 executorReference is copied verbatim and never constructed",
  /QF_50_2E_EXECUTOR_REFERENCE_FORBIDDEN/.test(workflowText) &&
  /QF_50_2E_EXECUTOR_REFERENCE_INVALID/.test(workflowText));
record("N14 an unverified Core response always stops",
  wfNodes.filter((n) => /^STOP — Reject Unverified/.test(n.name)).length === 3);
record("N15 the three signed exchanges each sign a request and verify the Core response",
  (workflowText.match(/CORE_TO_N8N_RESPONSE/g) ?? []).length === 3 &&
  (workflowText.match(/'N8N_TO_CORE',/g) ?? []).length === 3);
record("N16 all three route paths appear exactly once each in a canonical block",
  (workflowText.match(/\/api\/internal\/automation\/n8n\/claim/g) ?? []).length === 3 &&
  (workflowText.match(/\/api\/internal\/automation\/n8n\/execute-client/g) ?? []).length === 3 &&
  (workflowText.match(/\/api\/internal\/automation\/n8n\/complete/g) ?? []).length === 3);
record("N17 the workflow performs no business decision",
  !/recipient_id|template_key|variables:|provider_account|consent_|credit|package|assign/i.test(wfExecText));
record("N18 the pre-existing 50.2A and 50.2B workflows are byte-frozen",
  Object.entries(FROZEN_WORKFLOWS).every(([f, sha]) =>
    canonicalSha256(readFileSync(path.join(ROOT, "automation/n8n", f))) === sha));
record("N19 every workflow in the tree is inactive and unpublished",
  readdirSync(path.join(ROOT, "automation/n8n"))
    .filter((f) => f.endsWith(".workflow.json"))
    .every((f) => {
      const wf = JSON.parse(readFileSync(path.join(ROOT, "automation/n8n", f), "utf8"));
      return wf.active === false && !Object.prototype.hasOwnProperty.call(wf, "published");
    }));
record("N20 exactly three workflow candidates exist",
  readdirSync(path.join(ROOT, "automation/n8n")).filter((f) => f.endsWith(".workflow.json")).length === 3);

// ---------------------------------------------------------------------------
// G. G1 RE-PIN
// ---------------------------------------------------------------------------
record("G01 the anchor is untouched",
  manifest.appliedAnchor?.version === "20260803000000" &&
  manifest.appliedAnchor?.operationalStatus === "APPLIED" &&
  manifest.appliedAnchor?.remoteHistoryCountAfterApply === 20);
// QF-MVP-50.2E-S2-G1. The 50.2E migration has now been applied to QuickFurno
// Staging (imported owner-reviewed evidence, remote history 22), so BOTH
// post-anchor migrations are APPLIED and ZERO remain pending.
// QF-MVP-50.2-R2-APPLIED-TRUTH: all three post-anchor migrations are APPLIED
// (remote history 21 / 22 / 23) and none remain pending. Re-pinned, not loosened.
record("G02 exactly three APPLIED and one PENDING post-anchor migration",
  manifest.appliedAnchor?.postAnchorMigrationCount === 4 &&
  manifest.appliedPostAnchorMigrations?.length === 3 &&
  Array.isArray(manifest.pendingPostAnchorMigrations) &&
  manifest.pendingPostAnchorMigrations.length === 1 &&
  manifest.pendingPostAnchorMigrations[0].version === "20260807000000" &&
  same(manifest.appliedPostAnchorMigrations.map((r) => r.version),
    ["20260804000000", "20260805000000", "20260806000000"]));
record("G02a 20260806000000 is recorded APPLIED with remote history 23, hash-exact",
  manifest.appliedPostAnchorMigrations[2].version === "20260806000000" &&
  manifest.appliedPostAnchorMigrations[2].sha256 ===
    "ce947a6f8d7dd42d2851f6c99eba4bf2ef39308b8d85ff876260d575185a3cfb" &&
  manifest.appliedPostAnchorMigrations[2].operationalStatus === "APPLIED" &&
  manifest.appliedPostAnchorMigrations[2].appliedEvidenceMarker ===
    "QF_MVP_50_2_FINAL_R2_STAGING_MIGRATION_APPLIED_AND_VERIFIED" &&
  manifest.appliedPostAnchorMigrations[2].appliedEvidenceType ===
    "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD" &&
  manifest.appliedPostAnchorMigrations[2].remoteHistoryCountAfterApply === 23 &&
  manifest.appliedPostAnchorMigrations[2].appliedExactlyOnce === true);
record("G03 20260804000000 is recorded APPLIED with remote history 21",
  manifest.appliedPostAnchorMigrations[0].version === "20260804000000" &&
  manifest.appliedPostAnchorMigrations[0].operationalStatus === "APPLIED" &&
  manifest.appliedPostAnchorMigrations[0].appliedEvidenceMarker === "QF_MVP_50_2D_S2_STAGING_MIGRATION_APPLIED_AND_VERIFIED" &&
  manifest.appliedPostAnchorMigrations[0].remoteHistoryCountAfterApply === 21 &&
  manifest.appliedPostAnchorMigrations[0].sha256 === "043f1e3bbe261aef516ca35b54eb3e1c339d21d6b0c55c77f1d138eb502fa2c2");
record("G04 20260805000000 is recorded APPLIED with remote history 22, hash-exact",
  manifest.appliedPostAnchorMigrations[1].version === "20260805000000" &&
  manifest.appliedPostAnchorMigrations[1].path === MIGRATION_PATH &&
  manifest.appliedPostAnchorMigrations[1].sha256 === MIGRATION_SHA &&
  manifest.appliedPostAnchorMigrations[1].operationalStatus === "APPLIED" &&
  manifest.appliedPostAnchorMigrations[1].appliedEvidenceMarker === "QF_MVP_50_2E_S2_STAGING_MIGRATION_APPLIED_AND_VERIFIED" &&
  manifest.appliedPostAnchorMigrations[1].appliedEvidenceType === "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD" &&
  manifest.appliedPostAnchorMigrations[1].remoteHistoryCountAfterApply === 22 &&
  manifest.appliedPostAnchorMigrations[1].appliedExactlyOnce === true);
record("G05 no applied record fabricates an offline remote status or self-claims the apply",
  manifest.appliedPostAnchorMigrations.every((r) => !("remoteVersionStatus" in r) && r.appliedByThisPhase === false) &&
  manifest.evidence?.g1PerformsDatabaseAccess === false &&
  manifest.scope?.databaseMutationAuthorized === false);
record("G06 G1 pins the exact count 91, not a lower bound",
  /const MIGRATION_COUNT = 91;/.test(g1Source) &&
  !/>=\s*91|length\s*>=/.test(g1Source));
record("G07 G1 pins both post-anchor identities, hashes, markers and histories literally",
  g1Source.includes('version: "20260804000000"') &&
  g1Source.includes('version: "20260805000000"') &&
  g1Source.includes(`sha: "${MIGRATION_SHA}"`) &&
  g1Source.includes('marker: "QF_MVP_50_2E_S2_STAGING_MIGRATION_APPLIED_AND_VERIFIED"') &&
  g1Source.includes("remoteHistory: 21") &&
  g1Source.includes("remoteHistory: 22"));
record("G08 the local migration set is exactly 91 with the execute_v1 repair newest",
  (() => {
    const files = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    return files.length === 91 && files.at(-1) === "20260807000000_qf_mvp_50_2_execute_v1_reservation_ambiguity_repair.sql";
  })());
record("G09 the 50.2D validator was re-pinned, not loosened",
  /I05 the local migration count is exactly 91/.test(d2Source) &&
  /exactly four migrations are newer than the anchor/.test(d2Source) &&
  /claim_v1,complete_v1,execute_v1/.test(d2Source) &&
  /C05a the 50\.2A and 50\.2B candidates are byte-frozen/.test(d2Source));
record("G10 the completion-path allowlist names exactly one workflow",
  /COMPLETION_PATH_ALLOWED_WORKFLOWS = \[\s*\n\s*"QF-MVP-50-02-Client-Whatsapp-Executor\.50\.2E-selfhost-env\.workflow\.json",\s*\n\s*\]/.test(d2Source));
record("G11 no generic future-migration allowance appeared",
  manifest.safety?.genericFutureMigrationAllowanceForbidden === true &&
  manifest.safety?.postAnchorMigrationsMustBeExplicitlyPinned === true &&
  manifest.safety?.postAnchorMigrationsRequireOwnStagingGate === true);
record("G12 the baseline and pre-baseline protections are untouched",
  manifest.preBaselineChain?.count === 68 &&
  manifest.postBaselineApplied?.length === 18 &&
  manifest.safety?.baselineMustRemainOutsideMigrations === true);

// ---------------------------------------------------------------------------
// Z. SCOPE CONTAINMENT
// ---------------------------------------------------------------------------
for (const [label, re] of [
  ["stale/reclaim/lease recovery (50.5)", /reclaim|stale|lease|orphan|sweep\(/i],
  ["vendor workflow surface (50.3)", /vendor\.(lead_offer|response_reminder|onboarding_reminder|document_reminder|package_expiry|low_credit)/],
  ["campaign surface (50.4)", /campaign\.(execute_batch|execute_recipient)/],
  ["credit / package / assignment mutation", /credit|package|assign(ment)?_/i],
  ["Jarvis", /jarvis|qf-jarvis/i],
]) {
  record(`Z-${label} absent from the 50.2E modules`, !re.test(newModuleCode));
}
record("Z01 no Jarvis path appears anywhere in the 50.2E surface",
  ![newModuleCode, migrationSource, workflowText, doc].some((s) => /qf-jarvis|Desktop\\\\qf-jarvis|coilipywdvxklewquqvv/i.test(s)));
record("Z02 the migration performs no communication, business or network action",
  !/communication_messages|leads\b|vendors\b|lead_assignments|client_accounts/.test(migrationCode) &&
  !/pg_net|dblink/.test(migrationCode.replace(/extname in \('pg_net', 'http', 'dblink'\)/g, "")));
record("Z03 the route performs no direct table mutation",
  !/\.from\(|\.insert\(|\.update\(|\.delete\(/.test(routeCode));
record("Z04 the contract module is pure",
  !/adminClient|process\.env|fetch\(|Date\.now|new Date\(|@\/lib\/supabase/.test(contractCode));
record("Z05 no real WhatsApp or Meta call is reachable",
  !/graph\.facebook\.com|whatsapp_business|messages\?|Bearer /i.test(newModuleCode + workflowText));

// ---------------------------------------------------------------------------
// Y. DOC / GATE / CI
// ---------------------------------------------------------------------------
record("Y01 the 50.2E script is registered exactly",
  pkg.scripts["test:mvp:50-2e"] ===
  "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/mvp/loader/register.mjs scripts/mvp/automation/validate-qf-mvp-50-2e.mjs");
record("Y02 CI runs 50.2E immediately after 50.2D",
  /- name: QF-MVP-50\.2D validator\s+run: npm run test:mvp:50-2d\s+- name: QF-MVP-50\.2E validator\s+run: npm run test:mvp:50-2e/.test(ciWorkflow));
record("Y03 every prior CI gate is preserved",
  ["QF-MVP-40.4 template catalogue", "QF-MVP-40.10A Meta template contract", "QF-MVP-40.10B Wave 1 readiness",
   "QF-MVP-40.11 inactive mapping readiness", "QF-MVP-40.12-R1 business template bindings",
   "QF-MVP-50.1A validator", "QF-MVP-50.1B validator", "QF-MVP-50.1C validator", "QF-MVP-50.2A validator",
   "QF-MVP-50.2B validator", "QF-MVP-50.2C validator", "QF-MVP-50.2C-S2-G1 staging history governance",
   "QF-MVP-50.2D validator", "Typecheck", "Build"].every((g) => ciWorkflow.includes(`- name: ${g}`)));
record("Y04 Node 24 and exact-head checkout are preserved",
  ciWorkflow.includes("node-version: '24'") &&
  ciWorkflow.includes("ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}") &&
  ciWorkflow.includes("fetch-depth: 0") &&
  ciWorkflow.includes("Verify exact checked-out SHA"));
record("Y05 CI still takes no secret, database, provider or deployment action",
  !ciWorkflow.includes("${{ secrets.") &&
  !/^\s*(?:run:\s*)?(?:npx\s+)?supabase\s+/mi.test(ciWorkflow) &&
  !/\bdb push\b/i.test(ciWorkflow) &&
  !/^\s*run:.*\bdeploy\b/mi.test(ciWorkflow));
record("Y06 the document records the zero-live-ready truth and the open blockers",
  /ZERO of the six/i.test(doc) &&
  /no communication due sweep/i.test(doc) &&
  /producer/i.test(doc) &&
  /QF-MVP-50\.2 is NOT complete/i.test(doc) &&
  /QF-MVP-50\.5/.test(doc));
record("Y07 the document records the identity-only ledger and the B1 rule",
  /identity[- ]only/i.test(doc) &&
  /only when no communication row exists/i.test(doc) &&
  /never.{0,40}B1/i.test(doc));
record("Y08 the document records all four orchestration states",
  AUTOMATION_EXECUTION_ORCHESTRATION_STATES.every((s) => doc.includes(s)));
record("Y09 the document states Jarvis was not touched",
  /Jarvis/.test(doc) && /not touched|no Jarvis/i.test(doc));

// ---------------------------------------------------------------------------
// M. MUTANTS — each defect must be impossible by construction
// ---------------------------------------------------------------------------
const mutants = [
  ["a sixth key accepted into the execute request is impossible",
    () => parseExecuteClientRequestBody(body({
      transportVersion: 1, requestId: UUID_A, workerId: WORKER, jobId: UUID_B, attemptId: UUID_C,
      executorReference: UUID_A,
    })).ok === false],
  ["a template key accepted into the execute request is impossible",
    () => parseExecuteClientRequestBody(body({
      transportVersion: 1, requestId: UUID_A, workerId: WORKER, jobId: UUID_B, attemptId: UUID_C,
      templateKey: "lead_received",
    })).ok === false],
  ["retry_scheduled treated as completion-ready is impossible",
    () => COMMUNICATION_EXECUTION_PARTITION.retry_scheduled === "pending"],
  ["queued treated as completion-ready is impossible",
    () => COMMUNICATION_EXECUTION_PARTITION.queued === "pending"],
  ["dispatching treated as completion-ready is impossible",
    () => COMMUNICATION_EXECUTION_PARTITION.dispatching === "pending"],
  ["an unknown communication status silently mapped is impossible",
    () => resolveCommunicationExecutionPartition("invented") === null],
  ["an unknown pre-communication code silently classified is impossible",
    () => resolvePreCommunicationRuling("invented") === null],
  ["a readiness failure auto-retried is impossible",
    () => PRE_COMMUNICATION_FAILURE_RULINGS.TEMPLATE_NOT_READY.classification === "definitive_failure"],
  ["a mapping absence auto-retried is impossible",
    () => PRE_COMMUNICATION_FAILURE_RULINGS.META_APPROVED_MAPPING_UNRESOLVED.classification === "definitive_failure"],
  ["a consent denial leaking its reason through the safe code is impossible",
    () => new Set(["CONSENT_SUPPRESSED", "CONSENT_NOT_GRANTED", "UNCLASSIFIED_MESSAGE_TYPE"]
      .map((c) => PRE_COMMUNICATION_FAILURE_RULINGS[c].safeCode)).size === 1],
  ["a seventh client action is impossible",
    () => CLIENT_AUTOMATION_ACTION_TYPES.length === 6 && getClientDispatchDefinition("client.anything") === null],
  ["an idempotency key that omits the attempt is impossible",
    () => buildAutomationCommunicationIdempotencyKey(UUID_B, UUID_C) !== buildAutomationCommunicationIdempotencyKey(UUID_B, UUID_A)],
  ["a claim-path signature accepted at the execution route is impossible",
    () => verifyExecute(claimSig).ok === false],
  ["the partition disagreeing with the 50.2D rulings is impossible",
    () => COMMUNICATION_MESSAGE_STATUSES.every((s) =>
      (COMMUNICATION_EXECUTION_PARTITION[s] === "completion_ready") === COMPLETION_EVIDENCE_RULINGS[s].completable)],
  ["an execute ledger row carrying an outcome is impossible",
    () => /transport ledger carries an outcome column/.test(migrationSource)],
  ["a second execute reservation for one attempt is impossible",
    () => /where route_key = 'execute_v1' and attempt_id is not null/.test(migrationCode)],
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
console.log(`\nQF-MVP-50.2E: ${results.length - failed.length}/${results.length} ${failed.length ? "FAIL" : "PASS"}`);
if (failed.length) {
  console.log("QF_MVP_50_2E_SIGNED_CLIENT_EXECUTION_BLOCKED");
  process.exit(1);
}
console.log("QF_MVP_50_2E_SIGNED_CLIENT_EXECUTION_READY");
