#!/usr/bin/env node
// ============================================================================
// QF-MVP-50.2D — Signed attempt-completion callback validator
//
// OFFLINE ONLY. No database, no network, no environment secret, no provider
// call, no n8n call. Every crypto assertion runs against the REAL Core
// transport implementation, never a copy.
// ============================================================================

import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPLETION_EVIDENCE_RULINGS,
  N8N_COMPLETE_REQUEST_KEYS,
  parseCompletionRequestBody,
  resolveCompletionEvidenceRuling,
} from "../../../lib/automation/completionContract.ts";
import {
  AUTOMATION_RETRY_DELAY_SCHEDULE_SECONDS,
  AUTOMATION_RETRY_MAX_DELAY_SECONDS,
  automationRetryDelaySeconds,
  buildAutomationNextRetryAt,
} from "../../../lib/automation/retryPolicy.ts";
import {
  AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS,
  buildSignedCoreResponseHeaders,
  createCoreToN8nResponseSignature,
  createN8nToCoreSignature,
  sha256Hex,
  verifyN8nToCoreRequest,
} from "../../../lib/automation/transportAuth.ts";
import {
  AUTOMATION_TRANSPORT_ROUTE_KEYS,
  N8N_CLAIM_ROUTE_PATH,
  N8N_COMPLETE_ROUTE_PATH,
} from "../../../lib/automation/transportTypes.ts";
import { buildAutomationCommunicationIdempotencyKey } from "../../../lib/automation/clientDispatchRegistry.ts";
import { AUTOMATION_RESULT_CLASSIFICATIONS } from "../../../lib/automation/actionContract.ts";
import { COMMUNICATION_MESSAGE_STATUSES } from "../../../lib/communication/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const canonicalSha256 = (buf) =>
  sha256(Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8"));

/** Negative "this logic does not exist" assertions must inspect CODE, not prose. */
const stripJs = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const stripSql = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const MIGRATION_NAME = "20260804000000_qf_mvp_50_2d_automation_transport_completion_route.sql";
const MIGRATION_PATH = `supabase/migrations/${MIGRATION_NAME}`;
const ANCHOR_NAME = "20260803000000_qf_mvp_50_2c_lead_communication_recipient.sql";
const ANCHOR_SHA = "77d2bb1162e0522b061f36df787d94c2dad4f0ceeff3e4a07c8946cd4e1d56ca";
const POST_ANCHOR_SHA = "043f1e3bbe261aef516ca35b54eb3e1c339d21d6b0c55c77f1d138eb502fa2c2";
// QF-MVP-50.2E-R1 — the single pinned post-anchor successor. Named here so every
// "exactly N" assertion below stays an exact identity check rather than a count.
const EXECUTION_MIGRATION_NAME =
  "20260805000000_qf_mvp_50_2e_automation_transport_client_execution_route.sql";
const EXECUTION_MIGRATION_SHA =
  "9a8a29975e18135b96e7be7d4510104033c5de00cf080df5dab4326e3891250b";
const PRODUCER_MIGRATION_NAME =
  "20260806000000_qf_mvp_50_2_atomic_client_automation_producer.sql";
// QF-MVP-50.2-EXECUTE-V1-REPAIR successor. Re-pinned, never loosened.
const REPAIR_MIGRATION_NAME =
  "20260807000000_qf_mvp_50_2_execute_v1_reservation_ambiguity_repair.sql";
// QF-MVP-50.2-FRESH-CLAIM-WEDGE-REPAIR successor. Re-pinned, never loosened.
const WEDGE_MIGRATION_NAME =
  "20260808000000_qf_mvp_50_2_fresh_claim_retry_wedge_repair.sql";
const CLAIM_MIGRATION_NAME = "20260801152049_qf_mvp_automation_transport_replay_guard.sql";
const PERSISTENCE_MIGRATION_NAME = "20260801110000_qf_mvp_automation_action_persistence.sql";

const routeSource = read("app/api/internal/automation/n8n/complete/route.ts");
const claimRouteSource = read("app/api/internal/automation/n8n/claim/route.ts");
const serviceSource = read("services/automationTransportService.ts");
const contractSource = read("lib/automation/completionContract.ts");
const retrySource = read("lib/automation/retryPolicy.ts");
const typesSource = read("lib/automation/transportTypes.ts");
const migrationSource = read(MIGRATION_PATH);
const claimMigrationSource = read(`supabase/migrations/${CLAIM_MIGRATION_NAME}`);
const persistenceMigrationSource = read(`supabase/migrations/${PERSISTENCE_MIGRATION_NAME}`);
const workflow = read(".github/workflows/qf-mvp-50-quality-gate.yml");
const pkg = JSON.parse(read("package.json"));
const g1Source = read("scripts/mvp/staging/validate-qf-mvp-50-2c-s2-g1.mjs");
const manifest = JSON.parse(read("supabase/staging-history/qf-mvp-staging-history-manifest.json"));

const routeCode = stripJs(routeSource);
const contractCode = stripJs(contractSource);
const retryCode = stripJs(retrySource);
const migrationCode = stripSql(migrationSource);

/** The exact completion service body, so a neighbouring claim function cannot satisfy its rules. */
const serviceCode = stripJs(serviceSource);
// QF-MVP-50.2E-R1 RE-PIN. The slice must end at whichever boundary comes FIRST, so a
// later phase appending its own functions to this service can never be absorbed into the
// 50.2D body and silently satisfy — or silently break — a 50.2D containment assertion.
const completionBody = (() => {
  const i = serviceCode.indexOf("export async function completeAutomationAttemptForN8nTransport");
  if (i === -1) return "";
  // Boundaries must be CODE, not comments: `serviceCode` is comment-stripped, so a
  // banner would not survive. The next top-level `export` is where the 50.2D function
  // provably ends.
  const ends = [
    serviceCode.indexOf("\nexport ", i + 1),
    serviceCode.indexOf("function requireFreshClaimEvidence", i),
  ].filter((n) => n !== -1);
  return serviceCode.slice(i, ends.length ? Math.min(...ends) : serviceCode.length);
})();
/** The wholly-new 50.2D modules, used by every containment scan. */
const newModuleCode = contractCode + retryCode + routeCode + completionBody;

const results = [];
const record = (name, ok) => results.push({ name, ok: Boolean(ok) });

const SECRET_IN = "0123456789abcdef0123456789abcdef";
const SECRET_OUT = "fedcba9876543210fedcba9876543210";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
const EXEC_REF = "44444444-4444-4444-8444-444444444444";
const WORKER = "qf-staging-n8n-01";
const TS = 1785561600;

const validBody = JSON.stringify({
  transportVersion: 1,
  requestId: REQUEST_ID,
  workerId: WORKER,
  jobId: JOB_ID,
  attemptId: ATTEMPT_ID,
  executorReference: EXEC_REF,
});

function signedHeaders({ body = validBody, path: p = N8N_COMPLETE_ROUTE_PATH, method = "POST", requestId = REQUEST_ID, timestamp = TS, secret = SECRET_IN, bodyHash } = {}) {
  const hash = bodyHash ?? sha256Hex(body);
  return new Headers({
    "x-qf-transport-version": "1",
    "x-qf-request-id": requestId,
    "x-qf-timestamp": String(timestamp),
    "x-qf-body-sha256": hash,
    "x-qf-signature": createN8nToCoreSignature({ secret, method, path: p, requestId, timestamp, bodySha256: hash }),
  });
}
const verifyAt = (opts = {}) =>
  verifyN8nToCoreRequest({
    rawBody: opts.rawBody ?? validBody,
    method: "POST",
    path: opts.verifyPath ?? N8N_COMPLETE_ROUTE_PATH,
    headers: opts.headers ?? signedHeaders(opts),
    secret: SECRET_IN,
    nowSeconds: opts.nowSeconds ?? TS,
  });

// ---------------------------------------------------------------------------
// T. SIGNED TRANSPORT
// ---------------------------------------------------------------------------
record("T01 request schema accepts exactly the canonical six-key body",
  parseCompletionRequestBody(validBody).ok === true &&
  N8N_COMPLETE_REQUEST_KEYS.length === 6);
record("T02 unknown keys are rejected, never ignored",
  ["classification", "safeCode", "nextRetryAt", "recipient", "templateKey", "providerAccountId", "extra"].every((k) => {
    const body = { ...JSON.parse(validBody), [k]: "x" };
    const r = parseCompletionRequestBody(JSON.stringify(body));
    return r.ok === false && r.code === "AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID";
  }));
record("T03 a missing key is rejected",
  N8N_COMPLETE_REQUEST_KEYS.every((k) => {
    const body = JSON.parse(validBody);
    delete body[k];
    return parseCompletionRequestBody(JSON.stringify(body)).ok === false;
  }));
record("T04 malformed identities fail closed",
  parseCompletionRequestBody(JSON.stringify({ ...JSON.parse(validBody), jobId: "not-a-uuid" })).ok === false &&
  parseCompletionRequestBody(JSON.stringify({ ...JSON.parse(validBody), attemptId: "" })).ok === false &&
  parseCompletionRequestBody(JSON.stringify({ ...JSON.parse(validBody), executorReference: "../../etc" })).ok === false &&
  parseCompletionRequestBody(JSON.stringify({ ...JSON.parse(validBody), workerId: "bad worker id" })).ok === false &&
  parseCompletionRequestBody(JSON.stringify({ ...JSON.parse(validBody), transportVersion: 2 })).ok === false);
record("T05 non-object and non-JSON bodies fail closed",
  parseCompletionRequestBody("[]").ok === false &&
  parseCompletionRequestBody("null").ok === false &&
  parseCompletionRequestBody("{").ok === false);
record("T06 the completion route has its own exact path",
  N8N_COMPLETE_ROUTE_PATH === "/api/internal/automation/n8n/complete" &&
  N8N_COMPLETE_ROUTE_PATH !== N8N_CLAIM_ROUTE_PATH &&
  routeCode.includes("path: N8N_COMPLETE_ROUTE_PATH") &&
  !routeCode.includes("N8N_CLAIM_ROUTE_PATH"));
record("T07 a valid completion request verifies at the completion path", verifyAt().ok === true);
record("T08 a signature minted for the claim path is refused here",
  (() => {
    const r = verifyAt({ headers: signedHeaders({ path: N8N_CLAIM_ROUTE_PATH }) });
    return r.ok === false && r.code === "TRANSPORT_SIGNATURE_INVALID";
  })());
record("T09 a completion signature is refused at the claim path",
  (() => {
    const r = verifyAt({ verifyPath: N8N_CLAIM_ROUTE_PATH });
    return r.ok === false && r.code === "TRANSPORT_SIGNATURE_INVALID";
  })());
record("T10 a GET-signed request is refused for POST",
  (() => {
    const r = verifyAt({ headers: signedHeaders({ method: "GET" }) });
    return r.ok === false && r.code === "TRANSPORT_SIGNATURE_INVALID";
  })());
record("T11 body hash mismatch is refused",
  (() => {
    const r = verifyAt({ rawBody: validBody.replace(WORKER, "qf-other-worker") });
    return r.ok === false && r.code === "TRANSPORT_BODY_HASH_MISMATCH";
  })());
record("T12 a forged body hash header does not authenticate a different body",
  (() => {
    const other = JSON.stringify({ ...JSON.parse(validBody), jobId: EXEC_REF });
    const r = verifyAt({ headers: signedHeaders({ body: other }), rawBody: validBody });
    return r.ok === false && r.code === "TRANSPORT_BODY_HASH_MISMATCH";
  })());
record("T13 timestamp skew is bounded on both sides",
  verifyAt({ nowSeconds: TS + AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS }).ok === true &&
  verifyAt({ nowSeconds: TS + AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS + 1 }).code === "TRANSPORT_TIMESTAMP_OUTSIDE_WINDOW" &&
  verifyAt({ nowSeconds: TS - AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS - 1 }).code === "TRANSPORT_TIMESTAMP_OUTSIDE_WINDOW");
record("T14 the 2 KiB body cap is enforced before parsing, as on the claim route",
  routeCode.includes("const MAX_BODY_BYTES = 2_048;") &&
  (routeCode.match(/AUTOMATION_TRANSPORT_BODY_TOO_LARGE/g) ?? []).length === 2 &&
  routeCode.includes('Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES') &&
  routeCode.indexOf("MAX_BODY_BYTES") < routeCode.indexOf("parseCompletionRequestBody(rawBody)"));
record("T15 the body requestId must equal the signed requestId",
  routeCode.includes("parsed.body.requestId !== verified.requestId") &&
  routeCode.includes("AUTOMATION_TRANSPORT_REQUEST_ID_MISMATCH"));
record("T16 the worker must be the configured Core-side worker",
  routeCode.includes("parsed.body.workerId !== config.workerId") &&
  routeCode.includes("AUTOMATION_TRANSPORT_WORKER_NOT_AUTHORIZED"));
record("T17 the response is signed and bound to the original requestId",
  (() => {
    const body = JSON.stringify({ ok: true, requestId: REQUEST_ID });
    const headers = buildSignedCoreResponseHeaders({ rawBody: body, path: N8N_COMPLETE_ROUTE_PATH, requestId: REQUEST_ID, secret: SECRET_OUT, timestamp: TS });
    const expected = createCoreToN8nResponseSignature({ secret: SECRET_OUT, path: N8N_COMPLETE_ROUTE_PATH, requestId: REQUEST_ID, timestamp: TS, bodySha256: sha256Hex(body) });
    const independent = `v1=${createHmac("sha256", SECRET_OUT).update(["QF-AUTOMATION-TRANSPORT-V1", "CORE_TO_N8N_RESPONSE", N8N_COMPLETE_ROUTE_PATH, REQUEST_ID, String(TS), sha256Hex(body)].join("\n"), "utf8").digest("hex")}`;
    return headers["x-qf-response-signature"] === expected && expected === independent &&
      headers["x-qf-response-request-id"] === REQUEST_ID;
  })());
record("T18 a completion response signature is not valid for the claim path",
  createCoreToN8nResponseSignature({ secret: SECRET_OUT, path: N8N_COMPLETE_ROUTE_PATH, requestId: REQUEST_ID, timestamp: TS, bodySha256: sha256Hex("{}") }) !==
  createCoreToN8nResponseSignature({ secret: SECRET_OUT, path: N8N_CLAIM_ROUTE_PATH, requestId: REQUEST_ID, timestamp: TS, bodySha256: sha256Hex("{}") }));
record("T19 an unverified caller never receives a signed body (no signing oracle)",
  routeCode.includes("if (!verified.ok) {") &&
  routeCode.indexOf("if (!verified.ok) {") < routeCode.indexOf("parseCompletionRequestBody(rawBody)") &&
  /if \(!verified\.ok\) \{\s*return json\(/.test(routeCode) &&
  routeCode.indexOf("signedJson") > routeCode.indexOf("if (!verified.ok)"));
record("T20 every pre-verification refusal is unsigned",
  ["runtimeConfig.code", "AUTOMATION_TRANSPORT_DISABLED", "AUTOMATION_TRANSPORT_BODY_TOO_LARGE", "AUTOMATION_TRANSPORT_BODY_UNREADABLE"].every((code) =>
    new RegExp(`return json\\(\\{ ok: false, code: ${code.startsWith("runtime") ? "runtimeConfig\\.code" : `"${code}"` } \\}`).test(routeCode)));
record("T21 no second crypto system was introduced",
  !/createHmac|createHash|node:crypto|scrypt|randomBytes/.test(routeCode + completionBody + contractCode + retryCode) &&
  routeCode.includes('from "@/lib/automation/transportAuth"'));
// QF-MVP-50.2E-R1 RE-PIN. The vocabulary was closed to exactly two routes; it is now
// closed to exactly three, still by exact ordered equality — never a length lower bound
// and never a membership test. THIS MIGRATION's own text is unchanged and must still
// declare exactly the two routes it introduced: `execute_v1` is added by 20260805000000,
// so a `50.2D` migration that mentions it would mean the historical file had been edited.
record("T22 the transport route vocabulary is closed to exactly three routes",
  AUTOMATION_TRANSPORT_ROUTE_KEYS.length === 3 &&
  AUTOMATION_TRANSPORT_ROUTE_KEYS.join(",") === "claim_v1,complete_v1,execute_v1" &&
  /check \(route_key in \('claim_v1', 'complete_v1'\)\)/.test(migrationCode) &&
  !/execute_v1/.test(migrationCode));

// ---------------------------------------------------------------------------
// L. LEDGER / REPLAY MODEL
// ---------------------------------------------------------------------------
record("L01 completion replay identity is attempt-scoped, not job-scoped",
  /create unique index uq_automation_transport_requests_complete_attempt\s*\n\s*on public\.automation_transport_requests\(attempt_id\)\s*\n\s*where route_key = 'complete_v1' and attempt_id is not null;/.test(migrationCode));
record("L02 the claim one-row-per-job rule is preserved verbatim, not relaxed",
  /create unique index uq_automation_transport_requests_claim_job\s*\n\s*on public\.automation_transport_requests\(job_id\)\s*\n\s*where route_key = 'claim_v1' and job_id is not null;/.test(migrationCode) &&
  /drop index public\.uq_automation_transport_requests_job;/.test(migrationCode));
record("L03 the superseded global job uniqueness is proven gone",
  /uq_automation_transport_requests_job'\) is not null then/.test(migrationCode) &&
  /superseded global job uniqueness still present/.test(migrationSource));
record("L04 a duplicate request id returns a replay instead of completing twice",
  /on conflict \(id\) do nothing/.test(migrationCode) &&
  /v_inserted := v_request\.id is not null/.test(migrationCode) &&
  /if not v_inserted then/.test(migrationCode) &&
  /true,\s*\n\s*v_request\.job_id/.test(migrationCode));
record("L05 a replay with a different body is a conflict",
  /v_request\.body_sha256 is distinct from p_body_sha256/.test(migrationCode) &&
  /AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT/.test(migrationCode));
record("L06 a request identity is bound to one route; a claim id cannot complete",
  /v_request\.route_key <> 'complete_v1'/.test(migrationCode));
record("L07 a replay must also match the same job and attempt",
  /v_request\.job_id is distinct from p_job_id/.test(migrationCode) &&
  /v_request\.attempt_id is distinct from p_attempt_id/.test(migrationCode));
record("L08 replay evidence is re-read from the durable attempt/job rows",
  /from public\.automation_jobs where id = v_request\.job_id/.test(migrationCode) &&
  /where id = v_request\.attempt_id/.test(migrationCode) &&
  /v_attempt\.classification,\s*\n\s*v_attempt\.safe_code/.test(migrationCode));
record("L09 rows are still inserted pristine and finalized exactly once",
  /new\.state <> 'processing'\s*\n\s*or new\.job_id is not null/.test(migrationCode) &&
  /old\.state <> 'processing' then/.test(migrationCode) &&
  /finalized transport request history is immutable/.test(migrationSource));
record("L10 finalization is route-bound in the update guard",
  /old\.route_key = 'claim_v1' and new\.state not in \('claimed', 'empty'\)/.test(migrationCode) &&
  /old\.route_key = 'complete_v1' and new\.state <> 'completed'/.test(migrationCode));
record("L11 identity/evidence columns remain immutable after insert",
  /new\.route_key is distinct from old\.route_key/.test(migrationCode) &&
  /new\.body_sha256 is distinct from old\.body_sha256/.test(migrationCode) &&
  /new\.worker_id is distinct from old\.worker_id/.test(migrationCode));
record("L12 the state vocabulary stays closed and adds only `completed`",
  /check \(state in \('processing', 'claimed', 'empty', 'completed'\)\)/.test(migrationCode));
record("L13 every terminal state is bound to exactly one route by the shape check",
  /state = 'empty'\s*\n\s*and route_key = 'claim_v1'/.test(migrationCode) &&
  /state = 'claimed'\s*\n\s*and route_key = 'claim_v1'/.test(migrationCode) &&
  /state = 'completed'\s*\n\s*and route_key = 'complete_v1'/.test(migrationCode));
record("L14 a completed row must carry full attempt evidence",
  /state = 'completed'[\s\S]{0,400}?and job_id is not null[\s\S]{0,200}?and attempt_id is not null[\s\S]{0,200}?and finalized_at is not null/.test(migrationCode));
record("L15 replaced fences are proven present before being replaced",
  /expected constraint % is absent; reconcile drift instead of masking it/.test(migrationSource) &&
  migrationCode.indexOf("foreach v_name in array array[") < migrationCode.indexOf("drop constraint automation_transport_requests_route_check"));
record("L16 the ledger is locked before its fences are exchanged",
  migrationCode.indexOf("lock table public.automation_transport_requests in access exclusive mode") <
  migrationCode.indexOf("drop constraint automation_transport_requests_route_check"));
record("L17 no fence is merely dropped without a replacement",
  ["route_check", "state_check", "shape_check"].every((c) =>
    (migrationCode.match(new RegExp(`drop constraint automation_transport_requests_${c}`, "g")) ?? []).length === 1 &&
    (migrationCode.match(new RegExp(`add constraint automation_transport_requests_${c}`, "g")) ?? []).length === 1));
record("L18 the migration is transactional and forward-only",
  /^begin;/m.test(migrationCode) && /^commit;/m.test(migrationCode) &&
  !/drop table|drop function|drop trigger/i.test(migrationCode));
// The only DML the migration may contain is the ledger's own pristine insert and
// its single finalizing update, both inside the transport RPC.
record("L19 no data write, backfill or seed",
  !/(insert\s+into\s+public\.(?!automation_transport_requests)|update\s+public\.(?!automation_transport_requests)|delete\s+from\s+public\.|truncate\s+(table\s+)?public\.|copy\s+public\.)/i.test(migrationCode) &&
  (migrationCode.match(/insert\s+into\s+public\./gi) ?? []).length === 1 &&
  (migrationCode.match(/update\s+public\./gi) ?? []).length === 1);
record("L20 the four lifecycle triggers are re-verified after the change",
  /expected 4 transport lifecycle triggers, found/.test(migrationSource));

// ---------------------------------------------------------------------------
// A. AUTHORITY / CORE EVIDENCE
// ---------------------------------------------------------------------------
record("A01 the request carries no classification field at all",
  !N8N_COMPLETE_REQUEST_KEYS.includes("classification") &&
  !/classification/.test(JSON.stringify(N8N_COMPLETE_REQUEST_KEYS)) &&
  !/\bclassification\b/.test(routeCode));
record("A02 the request carries no safeCode field at all",
  !N8N_COMPLETE_REQUEST_KEYS.includes("safeCode") &&
  !/\bsafeCode\b/.test(routeCode));
record("A03 the request carries no next_retry_at field at all",
  !N8N_COMPLETE_REQUEST_KEYS.some((k) => /retry/i.test(k)) &&
  !/nextRetryAt|next_retry_at/.test(routeCode) &&
  !/nextRetryAt|next_retry_at/.test(contractCode));
record("A04 a body offering classification/safeCode/nextRetryAt is rejected outright",
  ["classification", "safeCode", "nextRetryAt", "next_retry_at"].every((k) =>
    parseCompletionRequestBody(JSON.stringify({ ...JSON.parse(validBody), [k]: "success" })).ok === false));
record("A05 Core derives the communication key from job+attempt only",
  completionBody.includes("buildAutomationCommunicationIdempotencyKey(") &&
  /buildAutomationCommunicationIdempotencyKey\(\s*input\.jobId,\s*input\.attemptId,\s*\)/.test(completionBody));
record("A06 the derived key is the exact 50.2C identity",
  buildAutomationCommunicationIdempotencyKey(JOB_ID, ATTEMPT_ID) === `qf_auto_v1:${JOB_ID}:${ATTEMPT_ID}`);
record("A07 the evidence row is selected by that Core-derived key, never by n8n input",
  /\.from\("communication_messages"\)[\s\S]{0,160}\.eq\("idempotency_key", idempotencyKey\)/.test(completionBody) &&
  !/\.eq\("id", input\.executorReference\)/.test(completionBody));
record("A08 executorReference is checked for equality, never followed",
  /message\.id !== input\.executorReference/.test(completionBody) &&
  /AUTOMATION_COMPLETION_EXECUTOR_REFERENCE_MISMATCH/.test(completionBody) &&
  completionBody.indexOf("idempotency_key") < completionBody.indexOf("message.id !== input.executorReference"));
record("A09 provider_message_id is never selected and never returned",
  !/provider_message_id/.test(newModuleCode) &&
  /\.select\("id, status"\)/.test(completionBody));
record("A10 the evidence projection reads exactly id and status",
  (completionBody.match(/\.select\(/g) ?? []).length === 1);
record("A11 missing evidence fails closed without finalizing",
  /AUTOMATION_COMPLETION_EVIDENCE_NOT_FOUND/.test(completionBody) &&
  completionBody.indexOf("AUTOMATION_COMPLETION_EVIDENCE_NOT_FOUND") <
  completionBody.indexOf("qf_complete_automation_attempt_transport_v1"));
record("A12 no evidence is invented to make the route usable before 50.2E",
  !/insert|upsert/.test(completionBody) &&
  !/communication_messages"\)[\s\S]{0,200}\.(insert|update|upsert)/.test(completionBody));
record("A13 every ownership rule is delegated to the RPC, not duplicated",
  !/status !== "processing"|locked_by/.test(completionBody) &&
  /qf_complete_automation_attempt_v1/.test(migrationCode) &&
  /Every ownership rule/.test(migrationSource));
record("A14 the RPC still proves job processing + worker lock",
  /v_job\.status <> 'processing'\s*\n\s*or v_job\.locked_by is distinct from p_worker_id/.test(stripSql(persistenceMigrationSource)));
record("A15 the RPC still proves attempt linkage, current attempt, worker and started",
  /v_attempt\.job_id <> v_job\.id[\s\S]{0,200}v_attempt\.attempt_number <> v_job\.attempt_count[\s\S]{0,200}v_attempt\.worker_id is distinct from p_worker_id[\s\S]{0,200}v_attempt\.status <> 'started'/.test(stripSql(persistenceMigrationSource)));
record("A16 the completion transport RPC delegates to qf_complete_automation_attempt_v1",
  /select \* into v_job\s*\n\s*from public\.qf_complete_automation_attempt_v1\(/.test(migrationCode));
record("A17 the service re-verifies the RPC evidence it got back",
  /row\.request_id !== input\.requestId/.test(completionBody) &&
  /row\.route_key !== "complete_v1"/.test(completionBody) &&
  /row\.job_id !== input\.jobId/.test(completionBody) &&
  /row\.attempt_id !== input\.attemptId/.test(completionBody));

// ---------------------------------------------------------------------------
// E. COMMUNICATION EVIDENCE MAPPING
// ---------------------------------------------------------------------------
const RULING = (s) => COMPLETION_EVIDENCE_RULINGS[s];
record("E01 the ruling table is total over the canonical status vocabulary",
  COMMUNICATION_MESSAGE_STATUSES.length === 11 &&
  COMMUNICATION_MESSAGE_STATUSES.every((s) => RULING(s) !== undefined) &&
  Object.keys(COMPLETION_EVIDENCE_RULINGS).length === COMMUNICATION_MESSAGE_STATUSES.length);
record("E02 the ruling table is frozen", Object.isFrozen(COMPLETION_EVIDENCE_RULINGS));
record("E03 every emitted classification is one of the closed four",
  Object.values(COMPLETION_EVIDENCE_RULINGS).every((r) =>
    !r.completable || AUTOMATION_RESULT_CLASSIFICATIONS.includes(r.classification)) &&
  AUTOMATION_RESULT_CLASSIFICATIONS.length === 4);
record("E04 accepted/sent/delivered/read are the ONLY success states",
  ["accepted", "sent", "delivered", "read"].every((s) => RULING(s).completable && RULING(s).classification === "success") &&
  COMMUNICATION_MESSAGE_STATUSES.filter((s) => RULING(s).completable && RULING(s).classification === "success").length === 4);
record("E05 accepted is proven provider acceptance, not internal queueing",
  (() => {
    const svc = stripJs(read("services/communicationService.ts"));
    return /effectiveOutcomeCertainty\(result\) === "accepted"\s*\n?\s*\? await this\.recordDispatchSuccess/.test(svc) &&
      /const target: CommunicationMessageStatus = result\.normalizedStatus === "sent" \? "sent" : "accepted"/.test(svc);
  })());
// --- the duplicate-retry fence (QF-MVP-50.2D-R1 review finding) -------------
// `retry_scheduled` means the COMMUNICATION lane owns a pending provider retry
// for that exact row. An automation retryable_failure opens a NEW attempt, a new
// idempotency key and therefore a SECOND message. Mapping it would run two retry
// mechanisms over one logical send.
record("E06 retry_scheduled is NOT completable — the communication lane owns that retry",
  RULING("retry_scheduled").completable === false &&
  RULING("retry_scheduled").code === "AUTOMATION_COMPLETION_COMMUNICATION_RETRY_PENDING");
record("E06a no communication status maps to retryable_failure",
  COMMUNICATION_MESSAGE_STATUSES.filter((s) => RULING(s).completable && RULING(s).classification === "retryable_failure").length === 0);
record("E06b the communication lane's re-dispatch entry point still owns exactly queued+retry_scheduled",
  (() => {
    const svc = stripJs(read("services/communicationService.ts"));
    return /message\.status !== "queued" && message\.status !== "retry_scheduled"/.test(svc) &&
      /finalStatus = "retry_scheduled"/.test(svc) &&
      /updates\.next_retry_at = new Date\(/.test(svc);
  })());
record("E06c a terminal communication state carries no pending communication retry",
  (() => {
    const svc = stripJs(read("services/communicationService.ts"));
    // dead_letter and cancelled are absorbing states in ALLOWED_TRANSITIONS, and
    // outcome_unknown is explicitly parked with next_retry_at = null.
    return /dead_letter: \[\],/.test(svc) && /cancelled: \[\],/.test(svc) &&
      /outcome_unknown: \["sent", "delivered", "read", "failed"\],/.test(svc);
  })());
record("E07 failed/dead_letter/cancelled are definitive failures",
  ["failed", "dead_letter", "cancelled"].every((s) => RULING(s).classification === "definitive_failure"));
record("E08 dead_letter never becomes a fresh automation retry",
  RULING("dead_letter").classification !== "retryable_failure" &&
  // The justification is a wrapped JSDoc line, so unwrap continuations first.
  /amplifying a send the communication lane already gave up on/.test(
    contractSource.replace(/\s*\n\s*(\*|\/\/)\s*/g, " ")));
record("E09 outcome_unknown is the only uncertain state",
  RULING("outcome_unknown").classification === "uncertain" &&
  COMMUNICATION_MESSAGE_STATUSES.filter((s) => RULING(s).completable && RULING(s).classification === "uncertain").length === 1);
record("E10 queued and dispatching are NOT completable",
  RULING("queued").completable === false && RULING("dispatching").completable === false &&
  RULING("queued").code === "AUTOMATION_COMPLETION_EVIDENCE_UNRESOLVED" &&
  RULING("dispatching").code === "AUTOMATION_COMPLETION_EVIDENCE_UNRESOLVED");
record("E10a exactly three statuses are refused as unresolved",
  COMMUNICATION_MESSAGE_STATUSES.filter((s) => !RULING(s).completable).sort().join(",") ===
  "dispatching,queued,retry_scheduled");
record("E11 routing/claim/HTTP-200 is never a success input",
  !/statusCode|httpStatus|routing|workflowFinished|n8nCompleted/i.test(contractCode) &&
  Object.keys(COMPLETION_EVIDENCE_RULINGS).every((s) => COMMUNICATION_MESSAGE_STATUSES.includes(s)));
record("E12 an unknown/ambiguous status fails closed rather than inheriting a neighbour",
  resolveCompletionEvidenceRuling("some_future_state").completable === false &&
  resolveCompletionEvidenceRuling("some_future_state").code === "AUTOMATION_COMPLETION_EVIDENCE_UNKNOWN_STATE" &&
  resolveCompletionEvidenceRuling(null).completable === false &&
  resolveCompletionEvidenceRuling(undefined).completable === false &&
  resolveCompletionEvidenceRuling({ status: "sent" }).completable === false);
record("E13 a non-completable ruling short-circuits before the RPC",
  completionBody.indexOf("if (!ruling.completable)") < completionBody.indexOf("qf_complete_automation_attempt_transport_v1"));
record("E14 every safe code is Core-derived and grammar-legal",
  Object.values(COMPLETION_EVIDENCE_RULINGS).every((r) =>
    !r.completable || (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(r.safeCode) && r.safeCode.startsWith("QF_COMM_"))));
record("E15 the safe code is derived from status alone, never from provider failure text",
  !/failure_code|failure_reason|errorCode|errorMessage/.test(contractCode + completionBody));

// ---------------------------------------------------------------------------
// R. RETRY OWNERSHIP
// ---------------------------------------------------------------------------
const NOW = new Date("2026-08-04T00:00:00.000Z");
record("R01 attempt 1 waits 60 seconds", automationRetryDelaySeconds(1) === 60);
record("R02 attempt 2 waits 300 seconds", automationRetryDelaySeconds(2) === 300);
record("R03 attempt 3 waits 900 seconds", automationRetryDelaySeconds(3) === 900);
record("R04 attempt 4 and beyond are capped at 3600 seconds",
  automationRetryDelaySeconds(4) === 3600 && automationRetryDelaySeconds(9) === 3600 &&
  automationRetryDelaySeconds(50) === 3600 && AUTOMATION_RETRY_MAX_DELAY_SECONDS === 3600);
record("R05 the schedule is exactly the locked three steps plus the cap",
  AUTOMATION_RETRY_DELAY_SCHEDULE_SECONDS.join(",") === "60,300,900" &&
  Object.isFrozen(AUTOMATION_RETRY_DELAY_SCHEDULE_SECONDS));
record("R06 no delay ever exceeds the cap",
  Array.from({ length: 20 }, (_, i) => automationRetryDelaySeconds(i + 1))
    .every((d) => d <= AUTOMATION_RETRY_MAX_DELAY_SECONDS));
record("R07 an illegal attempt number throws rather than defaulting",
  [0, -1, 1.5, NaN].every((n) => { try { automationRetryDelaySeconds(n); return false; } catch { return true; } }));
record("R08 the delay function is pure — it reads no clock",
  !/Date\.now|new Date\(\)|performance\.now/.test(retryCode.slice(0, retryCode.indexOf("buildAutomationNextRetryAt"))));
record("R09 the caller must supply the canonical clock",
  /readonly now: Date;/.test(retrySource) &&
  !/now\s*[:=]\s*new Date\(\)/.test(retryCode) &&
  /now: input\.now \?\? new Date\(\)/.test(completionBody));
record("R10 no environment, random, provider or n8n influence on timing",
  !/process\.env|Math\.random|jitter|\$env|provider|n8n/i.test(retryCode));
record("R11 next_retry_at is produced only below the max-attempt boundary",
  buildAutomationNextRetryAt({ attemptCount: 1, maxAttempts: 5, now: NOW }) === "2026-08-04T00:01:00.000Z" &&
  buildAutomationNextRetryAt({ attemptCount: 2, maxAttempts: 5, now: NOW }) === "2026-08-04T00:05:00.000Z" &&
  buildAutomationNextRetryAt({ attemptCount: 3, maxAttempts: 5, now: NOW }) === "2026-08-04T00:15:00.000Z" &&
  buildAutomationNextRetryAt({ attemptCount: 4, maxAttempts: 5, now: NOW }) === "2026-08-04T01:00:00.000Z");
record("R12 the final attempt passes NO next_retry_at so the RPC may dead-letter",
  buildAutomationNextRetryAt({ attemptCount: 5, maxAttempts: 5, now: NOW }) === null &&
  buildAutomationNextRetryAt({ attemptCount: 6, maxAttempts: 5, now: NOW }) === null);
record("R13 the boundary is exactly the RPC's (attempt_count >= max_attempts), not AOS's",
  buildAutomationNextRetryAt({ attemptCount: 4, maxAttempts: 5, now: NOW }) !== null &&
  /v_job\.attempt_count >= v_job\.max_attempts/.test(stripSql(persistenceMigrationSource)));
record("R14 no AOS retry decision is imported or reused anywhere in the automation lane",
  !/aos\/workflow\/retryPolicy|calculateRetryDecision|DEFAULT_WORKFLOW_RETRY_POLICY|shouldRetry|shouldDeadLetter/.test(
    retryCode + completionBody + routeCode + contractCode) &&
  !/from "@\/lib\/aos|from "\.\.\/aos/.test(retrySource + serviceSource + routeSource));
record("R15 only a retryable failure may carry a retry timestamp",
  /ruling\.classification === "retryable_failure"\s*\n?\s*\? buildAutomationNextRetryAt\(/.test(completionBody) &&
  /: null;/.test(completionBody));
record("R16 uncertain never schedules a retry",
  RULING("outcome_unknown").classification === "uncertain" &&
  /UNCERTAIN is explicitly never converted into a retry/.test(persistenceMigrationSource));
record("R17 the RPC rejects a retry timestamp on any terminal classification",
  /AUTOMATION_TERMINAL_RESULT_NEXT_RETRY_FORBIDDEN/.test(persistenceMigrationSource));
record("R18 an invalid budget or clock throws rather than guessing",
  [{ attemptCount: 1, maxAttempts: 0, now: NOW }, { attemptCount: 0, maxAttempts: 5, now: NOW }, { attemptCount: 1, maxAttempts: 5, now: new Date("nope") }]
    .every((i) => { try { buildAutomationNextRetryAt(i); return false; } catch { return true; } }));

// ---------------------------------------------------------------------------
// C. CONTAINMENT
// ---------------------------------------------------------------------------
const BANNED = {
  "recipient/destination override": /destinationOverride|overrideDestination|recipientOverride|\bdestination\b|recipientPhone/i,
  "phone/email": /phoneNumber|\be164\b|emailAddress/i,
  "template override": /templateKey|templateOverride|overrideTemplate/i,
  "provider account override": /providerAccountId|providerAccountOverride|provider_account/i,
  "consent/suppression bypass": /bypass[_ ]?consent|ignore[_ ]?consent|skip[_ ]?consent|bypass[_ ]?suppression|force[_ ]?send/i,
  "raw provider payload": /rawProviderBody|providerResponse|graph\.facebook|metaResponse/i,
  "raw provider error": /errorMessage|error\.stack|\.stack\b|sqlMessage/i,
  "credit/package mutation": /credit[_ ]?delta|deduct|restoreCredit|package[_ ]?update/i,
  "assignment mutation": /assignVendor|assignment[_ ]?update|assignVendorIds/i,
  "Jarvis/Riya/Anisha": /jarvis|riya|anisha/i,
  "provider send": /sendTemplateMessage|sendAuthenticationMessage|dispatchMessage|communicationService/i,
  "provider network call": /fetch\(|axios|https?:\/\//i,
  "Meta/WhatsApp": /whatsapp|META_ACCESS_TOKEN|phone_number_id|waba/i,
  "secret material": /access[_ ]?token|apiKey|bearer|service[_ ]?role|SUPABASE_/i,
  "stale lease / reclaim": /reclaim|staleProcessing|stale[_ ]?lease|releaseLock|unlockStale/i,
  "QF-MVP-50.5 scope": /50[._ ]?5|recovery[_ ]?sweep|orphan[_ ]?sweep/i,
};
for (const [label, re] of Object.entries(BANNED)) {
  record(`C-${label} absent from the 50.2D modules`, !re.test(newModuleCode));
}
record("C01 the migration introduces no stale/reclaim or lease-recovery logic",
  !/reclaim|stale|lease|orphan/i.test(migrationCode));
record("C02 the migration touches no business, credit, assignment or consent table",
  !/\b(leads|vendors|client_accounts|vendor_credits|lead_assignments|communication_suppressions|communication_preferences)\b/i.test(migrationCode));
record("C03 the migration touches no communication table",
  !/alter table public\.communication_/i.test(migrationCode));
record("C04 no 50.2D module reaches into the n8n workflow tree",
  !/automation\/n8n|workflow\.json|n8n-nodes-base/.test(newModuleCode));
// QF-MVP-50.2E-R1 RE-PIN, NEVER LOOSEN.
//
// The rule was "NO workflow may reference the completion path", which was exactly right
// while no executor existed. QF-MVP-50.2E adds the client executor, which legitimately
// calls the completion route. The class is therefore NOT opened: it is narrowed to an
// exact allowlist of ONE named file, and the two pre-existing candidates are additionally
// required to stay completion-path-free. Every workflow, without exception, must still be
// inactive and unpublished.
const COMPLETION_PATH_ALLOWED_WORKFLOWS = [
  "QF-MVP-50-02-Client-Whatsapp-Executor.50.2E-selfhost-env.workflow.json",
];
record("C05 the n8n workflow candidates remain inactive and unpublished",
  (() => {
    const dir = path.join(ROOT, "automation/n8n");
    if (!existsSync(dir)) return false;
    const flows = readdirSync(dir).filter((f) => f.endsWith(".workflow.json"));
    if (flows.length === 0) return false;
    return flows.every((f) => {
      const wf = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      if (wf.active !== false) return false;
      if (Object.prototype.hasOwnProperty.call(wf, "published")) return false;
      // Only the exact named executor may reference the completion path.
      if (COMPLETION_PATH_ALLOWED_WORKFLOWS.includes(f)) return true;
      return !JSON.stringify(wf).includes(N8N_COMPLETE_ROUTE_PATH);
    });
  })());
record("C05a the 50.2A and 50.2B candidates are byte-frozen and completion-path-free",
  (() => {
    const frozen = {
      "QF-MVP-50-01-Core-Job-Dispatcher.workflow.json":
        "9bc49e424a55fd93e24141172a185d58f60e6b5e7f4110f99ef4184174a4be47",
      "QF-MVP-50-01-Core-Job-Dispatcher.50.2B-selfhost-env.workflow.json":
        "93f75377da159f6f64c5c816178df4e982e240cecee108d626e266dedcc4705c",
    };
    return Object.entries(frozen).every(([file, expected]) => {
      const full = path.join(ROOT, "automation/n8n", file);
      if (!existsSync(full)) return false;
      const bytes = readFileSync(full);
      if (JSON.stringify(JSON.parse(bytes.toString("utf8"))).includes(N8N_COMPLETE_ROUTE_PATH)) return false;
      return canonicalSha256(bytes) === expected;
    });
  })());
record("C06 the completion route path is declared once, in transportTypes",
  (typesSource.match(/"\/api\/internal\/automation\/n8n\/complete"/g) ?? []).length === 1 &&
  !routeCode.includes('"/api/internal/automation/n8n/complete"') &&
  !completionBody.includes('"/api/internal/automation/n8n/complete"'));
record("C07 no provider execution path is reachable from the completion route",
  !/provider|adapter|send/i.test(routeCode.replace(/responseSecret|inboundSecret/g, "")));
record("C08 the route performs no direct table mutation",
  !/\.from\(|\.insert\(|\.update\(|\.delete\(/.test(routeCode));
record("C09 the completion service performs no direct table mutation",
  !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(completionBody));

// ---------------------------------------------------------------------------
// I. HISTORICAL MIGRATION IMMUTABILITY
// ---------------------------------------------------------------------------
const migrationFiles = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
record("I01 the 50.2C anchor is byte-identical to its pinned hash",
  canonicalSha256(readFileSync(path.join(ROOT, "supabase/migrations", ANCHOR_NAME))) === ANCHOR_SHA);
record("I02 the 50.2D migration matches its pinned hash",
  canonicalSha256(readFileSync(path.join(ROOT, MIGRATION_PATH))) === POST_ANCHOR_SHA);
// QF-MVP-50.2E-R1 RE-PIN. "Exactly one newer migration" was correct while 50.2D was the
// only post-anchor candidate. It is re-pinned to exactly TWO, named in exact order — not
// relaxed to a count floor and not relaxed to "anything newer".
record("I03 exactly five migrations are newer than the anchor",
  migrationFiles.filter((f) => f.slice(0, 14) > "20260803000000").length === 5);
record("I04 they are exactly the 50.2D completion route, the 50.2E execution route, the 50.2 producer, the execute_v1 repair, then the fresh-claim wedge repair",
  same(migrationFiles.filter((f) => f.slice(0, 14) > "20260803000000"),
       [MIGRATION_NAME, EXECUTION_MIGRATION_NAME, PRODUCER_MIGRATION_NAME, REPAIR_MIGRATION_NAME, WEDGE_MIGRATION_NAME]));
record("I05 the local migration count is exactly 92", migrationFiles.length === 92);
record("I05a the 50.2E execution migration matches its pinned hash",
  canonicalSha256(readFileSync(path.join(ROOT, "supabase/migrations", EXECUTION_MIGRATION_NAME))) === EXECUTION_MIGRATION_SHA);
record("I05b the 50.2D migration text is untouched by 50.2E",
  canonicalSha256(readFileSync(path.join(ROOT, MIGRATION_PATH))) === POST_ANCHOR_SHA);
record("I06 the 50.1C claim migration is unmodified in its claim semantics",
  claimMigrationSource.includes("check (route_key = 'claim_v1')") &&
  claimMigrationSource.includes("check (state in ('processing', 'claimed', 'empty'))") &&
  claimMigrationSource.includes("create unique index uq_automation_transport_requests_job"));
record("I07 the claim route source is untouched by 50.2D",
  claimRouteSource.includes("path: N8N_CLAIM_ROUTE_PATH") &&
  !claimRouteSource.includes("complete") &&
  claimRouteSource.includes("claimAutomationJobForN8nTransport"));
record("I08 the claim transport RPC is neither replaced nor redefined here",
  !/create or replace function public\.qf_claim_automation_job_transport_v1/.test(migrationCode) &&
  /qf_claim_automation_job_transport_v1\(uuid,text,text\)'\) is null/.test(migrationCode));
record("I09 the 50.1B completion RPC is neither replaced nor redefined here",
  !/create or replace function public\.qf_complete_automation_attempt_v1/.test(migrationCode));

// ---------------------------------------------------------------------------
// G. G1 RE-PIN
// ---------------------------------------------------------------------------
record("G01 the anchor is recorded APPLIED with imported D2-R1 evidence",
  manifest.appliedAnchor?.operationalStatus === "APPLIED" &&
  manifest.appliedAnchor?.appliedEvidenceMarker === "QF_MVP_50_2C_S2_D2_R1_STAGING_MIGRATION_APPLIED_AND_VERIFIED" &&
  manifest.appliedAnchor?.remoteHistoryCountAfterApply === 20 &&
  manifest.appliedAnchor?.sha256 === ANCHOR_SHA);
record("G02 the superseded pendingTarget block is gone", manifest.pendingTarget === undefined);
// QF-MVP-50.2E-R1 RE-PIN. 20260804000000 is now APPLIED on QuickFurno Staging under
// imported owner-reviewed evidence (remote history 21), and 20260805000000 is the single
// PENDING candidate. Every assertion below is an exact identity check.
// QF-MVP-50.2E-S2-G1 RE-PIN. 20260805000000 has now been applied to QuickFurno
// Staging (imported owner-reviewed evidence, remote history 22), so BOTH
// post-anchor migrations are APPLIED and ZERO remain pending. Still exact counts,
// exact order and exact per-migration identity — never a floor or a wildcard.
// QF-MVP-50.2-R2-APPLIED-TRUTH: the third post-anchor migration is now APPLIED
// too (remote history 23), so zero remain pending. Re-pinned, never loosened —
// the counts stay exact and the pending list must still exist and be empty.
record("G03 exactly five APPLIED and zero PENDING post-anchor migrations are declared",
  Array.isArray(manifest.appliedPostAnchorMigrations) && manifest.appliedPostAnchorMigrations.length === 5 &&
  Array.isArray(manifest.pendingPostAnchorMigrations) && manifest.pendingPostAnchorMigrations.length === 0 &&
  manifest.appliedAnchor?.postAnchorMigrationCount === 5 &&
  same(manifest.appliedPostAnchorMigrations.map((r) => r.version),
    ["20260804000000", "20260805000000", "20260806000000", "20260807000000", "20260808000000"]));
record("G04a the applied entry is the exact 50.2D migration by version, name, path and hash",
  manifest.appliedPostAnchorMigrations[0].version === "20260804000000" &&
  manifest.appliedPostAnchorMigrations[0].name === "qf_mvp_50_2d_automation_transport_completion_route" &&
  manifest.appliedPostAnchorMigrations[0].path === MIGRATION_PATH &&
  manifest.appliedPostAnchorMigrations[0].sha256 === POST_ANCHOR_SHA);
record("G04b the applied entry carries imported owner-reviewed 50.2D-S2 staging evidence",
  manifest.appliedPostAnchorMigrations[0].operationalStatus === "APPLIED" &&
  manifest.appliedPostAnchorMigrations[0].appliedEvidenceMarker === "QF_MVP_50_2D_S2_STAGING_MIGRATION_APPLIED_AND_VERIFIED" &&
  manifest.appliedPostAnchorMigrations[0].appliedEvidenceType === "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD" &&
  manifest.appliedPostAnchorMigrations[0].remoteHistoryCountAfterApply === 21 &&
  manifest.appliedPostAnchorMigrations[0].appliedExactlyOnce === true &&
  manifest.appliedPostAnchorMigrations[0].appliedByThisPhase === false);
record("G04c the applied 50.2E entry is exact by version, name, path and hash",
  manifest.appliedPostAnchorMigrations[1].version === "20260805000000" &&
  manifest.appliedPostAnchorMigrations[1].name === "qf_mvp_50_2e_automation_transport_client_execution_route" &&
  manifest.appliedPostAnchorMigrations[1].path === `supabase/migrations/${EXECUTION_MIGRATION_NAME}` &&
  manifest.appliedPostAnchorMigrations[1].sha256 === EXECUTION_MIGRATION_SHA);
record("G05 the 50.2E entry carries imported owner-reviewed 50.2E-S2 staging evidence",
  manifest.appliedPostAnchorMigrations[1].operationalStatus === "APPLIED" &&
  manifest.appliedPostAnchorMigrations[1].appliedEvidenceMarker === "QF_MVP_50_2E_S2_STAGING_MIGRATION_APPLIED_AND_VERIFIED" &&
  manifest.appliedPostAnchorMigrations[1].appliedEvidenceType === "IMPORTED_OWNER_REVIEWED_EXTERNAL_EXECUTION_RECORD" &&
  manifest.appliedPostAnchorMigrations[1].remoteHistoryCountAfterApply === 22 &&
  manifest.appliedPostAnchorMigrations[1].appliedExactlyOnce === true &&
  manifest.appliedPostAnchorMigrations[1].appliedByThisPhase === false);
record("G06 no applied record fabricates an offline remote status",
  manifest.appliedPostAnchorMigrations.every((r) => !("remoteVersionStatus" in r)) &&
  manifest.evidence?.g1PerformsDatabaseAccess === false &&
  manifest.scope?.databaseMutationAuthorized === false);
record("G07 no generic future-migration allowance was granted",
  manifest.safety?.genericFutureMigrationAllowanceForbidden === true &&
  manifest.safety?.postAnchorMigrationsMustBeExplicitlyPinned === true &&
  !/version\s*>\s*TARGET_VERSION\s*\)\.length\s*>=|>=\s*90/.test(g1Source));
record("G08 G1 asserts the exact migration count, not a lower bound",
  /const MIGRATION_COUNT = 92;/.test(g1Source) &&
  /state\.migrations\.length === MIGRATION_COUNT/.test(g1Source));
record("G09 G1 pins both post-anchor identities and hashes literally",
  g1Source.includes(`version: "20260804000000"`) &&
  g1Source.includes(`sha: "${POST_ANCHOR_SHA}"`) &&
  g1Source.includes(`version: "20260805000000"`) &&
  g1Source.includes(`sha: "${EXECUTION_MIGRATION_SHA}"`) &&
  g1Source.includes(`marker: "QF_MVP_50_2D_S2_STAGING_MIGRATION_APPLIED_AND_VERIFIED"`) &&
  g1Source.includes(`marker: "QF_MVP_50_2E_S2_STAGING_MIGRATION_APPLIED_AND_VERIFIED"`) &&
  g1Source.includes("remoteHistory: 21") &&
  g1Source.includes("remoteHistory: 22"));
record("G09a G1 rejects a demoted, forged or mis-counted applied post-anchor record",
  /50\.2D demoted back to PENDING/.test(g1Source) &&
  /50\.2D marker forged/.test(g1Source) &&
  /50\.2D remote history changed from 21/.test(g1Source) &&
  /50\.2E marker forged/.test(g1Source) &&
  /50\.2E remote history 21 instead of 22/.test(g1Source) &&
  /50\.2E remote history 23/.test(g1Source) &&
  /an applied post-anchor also listed as pending/.test(g1Source) &&
  /post-anchor order swapped/.test(g1Source) &&
  /post-anchor count understated/.test(g1Source));
record("G10 G1 still rejects an arbitrary newer or drifted migration",
  /a sixth post-anchor migration on disk/.test(g1Source) &&
  /a sixth applied post-anchor migration/.test(g1Source) &&
  /50\.2E migration renamed/.test(g1Source) &&
  /50\.2E on-disk SHA drift/.test(g1Source) &&
  /50\.2E manifest SHA drift/.test(g1Source) &&
  /50\.2E migration missing from disk/.test(g1Source) &&
  /R2 migration renamed/.test(g1Source) &&
  /R2 on-disk SHA drift/.test(g1Source) &&
  /R2 manifest SHA drift/.test(g1Source) &&
  /R2 migration missing from disk/.test(g1Source) &&
  /070 execute repair left PENDING/.test(g1Source) &&
  /070 remote history 23 instead of 24/.test(g1Source) &&
  /070 remote history 25 instead of 24/.test(g1Source) &&
  /070 marker forged/.test(g1Source) &&
  /080 wedge repair left PENDING/.test(g1Source) &&
  /080 remote history 24 instead of 25/.test(g1Source) &&
  /080 remote history 26 instead of 25/.test(g1Source) &&
  /080 marker forged/.test(g1Source) &&
  /a new pending entry silently added/.test(g1Source) &&
  /the pending list key deleted entirely instead of emptied/.test(g1Source));
record("G11 G1 rejects a regressed or fabricated post-anchor status",
  /50\.2E left PENDING/.test(g1Source) &&
  /50\.2E applied but marker missing/.test(g1Source) &&
  /50\.2E appliedExactlyOnce false/.test(g1Source) &&
  /50\.2E evidence type changed/.test(g1Source) &&
  /50\.2E claimed applied by this source phase/.test(g1Source) &&
  /50\.2E fabricated offline remote status field/.test(g1Source) &&
  // the newly imported R2 applied record is guarded to the same strength
  /R2 producer left PENDING/.test(g1Source) &&
  /R2 producer demoted to PENDING in place/.test(g1Source) &&
  /R2 remote history 22 instead of 23/.test(g1Source) &&
  /R2 remote history 24 instead of 23/.test(g1Source) &&
  /R2 marker missing/.test(g1Source) &&
  /R2 marker forged/.test(g1Source) &&
  /R2 appliedExactlyOnce false/.test(g1Source) &&
  /R2 evidence type self-asserted/.test(g1Source) &&
  /R2 claimed applied by this source phase/.test(g1Source) &&
  /R2 fabricated offline remote status field/.test(g1Source));
record("G12 the historical baseline and pre-baseline protections are untouched",
  manifest.preBaselineChain?.count === 68 &&
  manifest.preBaselineChain?.mustReplayOnStaging === false &&
  manifest.preBaselineChain?.mustRepairAsApplied === false &&
  manifest.safety?.baselineMustRemainOutsideMigrations === true &&
  manifest.postBaselineApplied.length === 18);
record("G13 no staging-history repair semantics were introduced",
  !/repairAsApplied\s*:\s*true|mustRepair\w*\s*:\s*true|--include-all/.test(JSON.stringify(manifest)));

// ---------------------------------------------------------------------------
// X. GATE / CI
// ---------------------------------------------------------------------------
record("X01 the 50.2D script is registered exactly",
  pkg.scripts["test:mvp:50-2d"] ===
  "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/mvp/loader/register.mjs scripts/mvp/automation/validate-qf-mvp-50-2d.mjs");
record("X02 the CI gate runs 50.2D after the re-pinned G1 step",
  /- name: QF-MVP-50\.2C-S2-G1 staging history governance\s+run: npm run test:mvp:50-2c-s2-g1\s+- name: QF-MVP-50\.2D validator\s+run: npm run test:mvp:50-2d/.test(workflow));
record("X03 every prior gate is preserved",
  ["QF-MVP-40.4 template catalogue", "QF-MVP-40.10A Meta template contract", "QF-MVP-40.10B Wave 1 readiness",
   "QF-MVP-40.11 inactive mapping readiness", "QF-MVP-40.12-R1 business template bindings",
   "QF-MVP-50.1A validator", "QF-MVP-50.1B validator", "QF-MVP-50.1C validator", "QF-MVP-50.2A validator",
   "QF-MVP-50.2B validator", "QF-MVP-50.2C validator", "QF-MVP-50.2C-S2-G1 staging history governance",
   "Typecheck", "Build"].every((g) => workflow.includes(`- name: ${g}`)));
record("X04 Node 24 and exact-head checkout are preserved",
  workflow.includes("node-version: '24'") &&
  workflow.includes("ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}") &&
  workflow.includes("fetch-depth: 0") &&
  workflow.includes("Verify exact checked-out SHA"));
record("X05 CI still takes no secret, database, provider or deployment action",
  !workflow.includes("${{ secrets.") &&
  !/^\s*(?:run:\s*)?(?:npx\s+)?supabase\s+/mi.test(workflow) &&
  !/\bdb push\b/i.test(workflow) &&
  !/^\s*run:.*\bdeploy\b/mi.test(workflow));
record("X06 the runner cannot reach Supabase or services modules",
  !/from "@\/lib\/supabase"|adminClient/.test(contractCode + retryCode));

// ---------------------------------------------------------------------------
// M. MUTATION SELF-TESTS — each mutant must be caught by a rule above
// ---------------------------------------------------------------------------
const SQL_RULES = {
  routeVocabularyClosed: (s) => /check \(route_key in \('claim_v1', 'complete_v1'\)\)/.test(s),
  stateVocabularyClosed: (s) => /check \(state in \('processing', 'claimed', 'empty', 'completed'\)\)/.test(s),
  completeAttemptUnique: (s) => /uq_automation_transport_requests_complete_attempt[\s\S]{0,200}where route_key = 'complete_v1' and attempt_id is not null/.test(s),
  claimJobUniquePreserved: (s) => /uq_automation_transport_requests_claim_job[\s\S]{0,200}where route_key = 'claim_v1' and job_id is not null/.test(s),
  replayBodyBound: (s) => /v_request\.body_sha256 is distinct from p_body_sha256/.test(s),
  replayRouteBound: (s) => /v_request\.route_key <> 'complete_v1'/.test(s),
  replayAttemptBound: (s) => /v_request\.attempt_id is distinct from p_attempt_id/.test(s),
  delegatesOwnership: (s) => /from public\.qf_complete_automation_attempt_v1\(/.test(s),
  shapeRouteBound: (s) => /state = 'completed'\s*\n\s*and route_key = 'complete_v1'/.test(s),
  routeBoundFinalization: (s) => /old\.route_key = 'complete_v1' and new\.state <> 'completed'/.test(s),
  pristineInsertOnly: (s) => /new\.state <> 'processing'\s*\n\s*or new\.job_id is not null/.test(s),
  historyImmutable: (s) => /old\.state <> 'processing' then/.test(s),
  fencePreflight: (s) => /expected constraint % is absent/.test(s),
  lockedBeforeExchange: (s) => s.includes("access exclusive mode") && s.indexOf("access exclusive mode") < s.indexOf("drop constraint automation_transport_requests_route_check"),
  noSwallowingHandler: (s) => !/\bexception\s+when\b/i.test(s),
  securityDefinerPinned: (s) => /security definer\s*\n\s*set search_path = pg_catalog, public, pg_temp/.test(s),
  serviceRoleOnly: (s) => /revoke all on function public\.qf_complete_automation_attempt_transport_v1[\s\S]{0,200}from public, anon, authenticated, service_role/.test(s),
};
for (const [key, fn] of Object.entries(SQL_RULES)) {
  record(`M-RULE ${key}`, fn(migrationSource));
}
const SQL_MUTANTS = [
  ["route vocabulary opened up", (s) => s.replace("check (route_key in ('claim_v1', 'complete_v1'))", "check (route_key is not null)")],
  ["completion uniqueness widened to the job", (s) => s.replace("on public.automation_transport_requests(attempt_id)\n  where route_key = 'complete_v1' and attempt_id is not null;", "on public.automation_transport_requests(job_id)\n  where route_key = 'complete_v1' and job_id is not null;")],
  ["claim job uniqueness silently dropped", (s) => s.replace(/create unique index uq_automation_transport_requests_claim_job[\s\S]*?is not null;/, "")],
  ["replay stopped binding the body hash", (s) => s.replace("or v_request.body_sha256 is distinct from p_body_sha256", "")],
  ["replay stopped binding the route", (s) => s.replace("or v_request.route_key <> 'complete_v1'", "")],
  ["replay stopped binding the attempt", (s) => s.replace("or v_request.attempt_id is distinct from p_attempt_id", "")],
  ["ownership re-implemented instead of delegated", (s) => s.replace("from public.qf_complete_automation_attempt_v1(", "from public.some_local_shortcut(")],
  ["terminal state unbound from its route", (s) => s.replace("state = 'completed'\n      and route_key = 'complete_v1'", "state = 'completed'\n      and route_key is not null")],
  ["update guard allows a claim row to complete", (s) => s.replace("if old.route_key = 'complete_v1' and new.state <> 'completed' then", "if false then")],
  ["insert guard allows pre-filled evidence", (s) => s.replace("or new.job_id is not null", "")],
  ["finalized history made mutable", (s) => s.replace("if old.state <> 'processing' then", "if false then")],
  ["fence preflight removed", (s) => s.replace(/foreach v_name in array array\[[\s\S]*?end loop;/, "")],
  ["lock moved after the fence exchange", (s) => s.replace("lock table public.automation_transport_requests in access exclusive mode;", "")],
  ["swallowing exception handler added", (s) => s.replace("end;\n$$;", "exception when others then\n  null;\nend;\n$$;")],
  ["search_path unpinned on the new RPC", (s) => s.replace("security definer\nset search_path = pg_catalog, public, pg_temp\nas $$\ndeclare\n  v_request public.automation_transport_requests%rowtype;", "security definer\nas $$\ndeclare\n  v_request public.automation_transport_requests%rowtype;")],
  ["RPC granted beyond service_role", (s) => s.replace(/revoke all on function public\.qf_complete_automation_attempt_transport_v1\([\s\S]*?\) from public, anon, authenticated, service_role;/, "")],
];
for (const [label, mutate] of SQL_MUTANTS) {
  const mutant = mutate(migrationSource);
  const changed = mutant !== migrationSource;
  const caught = Object.values(SQL_RULES).some((fn) => !fn(mutant));
  record(`M-SQL ${label}`, changed && caught);
}

const TS_MUTANTS = [
  ["a classification key accepted into the request", () =>
    parseCompletionRequestBody(JSON.stringify({ ...JSON.parse(validBody), classification: "success" })).ok === false],
  ["an unknown status silently mapped to success", () =>
    resolveCompletionEvidenceRuling("totally_new").completable === false],
  ["dispatching treated as completable", () => COMPLETION_EVIDENCE_RULINGS.dispatching.completable === false],
  ["queued treated as completable", () => COMPLETION_EVIDENCE_RULINGS.queued.completable === false],
  ["retry_scheduled completed into a second, duplicate send", () =>
    COMPLETION_EVIDENCE_RULINGS.retry_scheduled.completable === false],
  ["the retry cap exceeded", () => automationRetryDelaySeconds(99) === 3600],
  ["a retry scheduled past the budget", () => buildAutomationNextRetryAt({ attemptCount: 5, maxAttempts: 5, now: NOW }) === null],
  ["a claim-path signature accepted at the completion route", () =>
    verifyAt({ headers: signedHeaders({ path: N8N_CLAIM_ROUTE_PATH }) }).ok === false],
];
for (const [label, assertion] of TS_MUTANTS) {
  record(`M-TS ${label} is impossible`, assertion());
}

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}`);
console.log("");
console.log(`QF-MVP-50.2D: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  process.exitCode = 1;
} else {
  console.log("QF_MVP_50_2D_SIGNED_ATTEMPT_COMPLETION_READY");
}
