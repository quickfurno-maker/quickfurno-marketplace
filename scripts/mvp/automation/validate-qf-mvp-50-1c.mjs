#!/usr/bin/env node
/**
 * QF-MVP-50.1C secure Core <-> n8n transport offline validator.
 *
 * No database, network, n8n, provider, credential or environment access.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS,
  AUTOMATION_TRANSPORT_VERSION,
  CORE_TO_N8N_RESPONSE_HEADERS,
  N8N_TO_CORE_TRANSPORT_HEADERS,
  buildSignedCoreResponseHeaders,
  createN8nToCoreSignature,
  sha256Hex,
  verifyCoreToN8nResponse,
  verifyN8nToCoreRequest,
} from "../../../lib/automation/transportAuth.ts";
import {
  N8N_CLAIM_ROUTE_PATH,
} from "../../../lib/automation/transportTypes.ts";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const files = {
  migration:
    "supabase/migrations/20260801152049_qf_mvp_automation_transport_replay_guard.sql",
  auth: "lib/automation/transportAuth.ts",
  types: "lib/automation/transportTypes.ts",
  service: "services/automationTransportService.ts",
  route: "app/api/internal/automation/n8n/claim/route.ts",
  doc: "docs/QF-MVP-50-1C-SECURE-N8N-TRANSPORT.md",
};

const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const sql = read(files.migration);
const authSource = read(files.auth);
const typesSource = read(files.types);
const service = read(files.service);
const route = read(files.route);
const doc = read(files.doc);

const results = [];
const record = (name, ok, detail = "") =>
  results.push({ name, ok: Boolean(ok), detail });

function stripSqlComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n\r]*/g, "");
}

function stripTypeScriptComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n\r]*/g, "");
}

const execSql = stripSqlComments(sql);
const execRoute = stripTypeScriptComments(route);

function buildRequestFixture({
  rawBody,
  secret,
  requestId = "11111111-1111-4111-8111-111111111111",
  timestamp = 1_800_000_000,
  method = "POST",
  pathValue = N8N_CLAIM_ROUTE_PATH,
} = {}) {
  const body =
    rawBody ??
    JSON.stringify({
      transportVersion: 1,
      requestId,
      workerId: "qf_n8n_dispatcher_v1",
    });
  const bodySha256 = sha256Hex(body);
  const signature = createN8nToCoreSignature({
    secret,
    method,
    path: pathValue,
    requestId,
    timestamp,
    bodySha256,
  });

  return {
    rawBody: body,
    headers: new Headers({
      [N8N_TO_CORE_TRANSPORT_HEADERS.version]: "1",
      [N8N_TO_CORE_TRANSPORT_HEADERS.requestId]: requestId,
      [N8N_TO_CORE_TRANSPORT_HEADERS.timestamp]: String(timestamp),
      [N8N_TO_CORE_TRANSPORT_HEADERS.bodySha256]: bodySha256,
      [N8N_TO_CORE_TRANSPORT_HEADERS.signature]: signature,
    }),
  };
}

// ---------------------------------------------------------------------------
// 1. Pure cryptographic contract
// ---------------------------------------------------------------------------
record(
  "01 transport version is exactly 1",
  AUTOMATION_TRANSPORT_VERSION === 1,
);
record(
  "02 clock window is exactly 300 seconds",
  AUTOMATION_TRANSPORT_MAX_CLOCK_SKEW_SECONDS === 300,
);
record(
  "03 claim path is exact internal path",
  N8N_CLAIM_ROUTE_PATH === "/api/internal/automation/n8n/claim",
);
record(
  "04 inbound and response header namespaces are distinct",
  N8N_TO_CORE_TRANSPORT_HEADERS.signature !==
    CORE_TO_N8N_RESPONSE_HEADERS.signature,
);

const inboundSecret = "A".repeat(48);
const responseSecret = "B".repeat(48);
const valid = buildRequestFixture({ secret: inboundSecret });
const validResult = verifyN8nToCoreRequest({
  rawBody: valid.rawBody,
  method: "POST",
  path: N8N_CLAIM_ROUTE_PATH,
  headers: valid.headers,
  secret: inboundSecret,
  nowSeconds: 1_800_000_000,
});
record("05 valid signed n8n request verifies", validResult.ok);

record(
  "06 body hash is deterministic lowercase sha256",
  sha256Hex("abc") ===
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
);

const tamperedBody = verifyN8nToCoreRequest({
  rawBody: valid.rawBody + " ",
  method: "POST",
  path: N8N_CLAIM_ROUTE_PATH,
  headers: valid.headers,
  secret: inboundSecret,
  nowSeconds: 1_800_000_000,
});
record(
  "07 tampered body is rejected",
  !tamperedBody.ok &&
    tamperedBody.code === "TRANSPORT_BODY_HASH_MISMATCH",
);

const wrongMethod = verifyN8nToCoreRequest({
  rawBody: valid.rawBody,
  method: "GET",
  path: N8N_CLAIM_ROUTE_PATH,
  headers: valid.headers,
  secret: inboundSecret,
  nowSeconds: 1_800_000_000,
});
record(
  "08 signature is bound to HTTP method",
  !wrongMethod.ok &&
    wrongMethod.code === "TRANSPORT_SIGNATURE_INVALID",
);

const wrongPath = verifyN8nToCoreRequest({
  rawBody: valid.rawBody,
  method: "POST",
  path: "/api/internal/automation/n8n/other",
  headers: valid.headers,
  secret: inboundSecret,
  nowSeconds: 1_800_000_000,
});
record(
  "09 signature is bound to exact route path",
  !wrongPath.ok &&
    wrongPath.code === "TRANSPORT_SIGNATURE_INVALID",
);

const stale = verifyN8nToCoreRequest({
  rawBody: valid.rawBody,
  method: "POST",
  path: N8N_CLAIM_ROUTE_PATH,
  headers: valid.headers,
  secret: inboundSecret,
  nowSeconds: 1_800_000_301,
});
record(
  "10 stale timestamp outside 300 seconds is rejected",
  !stale.ok &&
    stale.code === "TRANSPORT_TIMESTAMP_OUTSIDE_WINDOW",
);

const futureFixture = buildRequestFixture({
  secret: inboundSecret,
  timestamp: 1_800_000_301,
});
const future = verifyN8nToCoreRequest({
  rawBody: futureFixture.rawBody,
  method: "POST",
  path: N8N_CLAIM_ROUTE_PATH,
  headers: futureFixture.headers,
  secret: inboundSecret,
  nowSeconds: 1_800_000_000,
});
record(
  "11 future timestamp outside 300 seconds is rejected",
  !future.ok &&
    future.code === "TRANSPORT_TIMESTAMP_OUTSIDE_WINDOW",
);

const wrongSecret = verifyN8nToCoreRequest({
  rawBody: valid.rawBody,
  method: "POST",
  path: N8N_CLAIM_ROUTE_PATH,
  headers: valid.headers,
  secret: "C".repeat(48),
  nowSeconds: 1_800_000_000,
});
record(
  "12 wrong inbound secret is rejected",
  !wrongSecret.ok &&
    wrongSecret.code === "TRANSPORT_SIGNATURE_INVALID",
);

const shortSecret = verifyN8nToCoreRequest({
  rawBody: valid.rawBody,
  method: "POST",
  path: N8N_CLAIM_ROUTE_PATH,
  headers: valid.headers,
  secret: "too-short",
  nowSeconds: 1_800_000_000,
});
record(
  "13 short secret fails closed",
  !shortSecret.ok &&
    shortSecret.code === "TRANSPORT_SECRET_INVALID",
);

const malformedSigHeaders = new Headers(valid.headers);
malformedSigHeaders.set(
  N8N_TO_CORE_TRANSPORT_HEADERS.signature,
  "v1=nothex",
);
const malformedSig = verifyN8nToCoreRequest({
  rawBody: valid.rawBody,
  method: "POST",
  path: N8N_CLAIM_ROUTE_PATH,
  headers: malformedSigHeaders,
  secret: inboundSecret,
  nowSeconds: 1_800_000_000,
});
record(
  "14 malformed signature is rejected",
  !malformedSig.ok &&
    malformedSig.code === "TRANSPORT_SIGNATURE_INVALID",
);

// ---------------------------------------------------------------------------
// 2. Signed Core response
// ---------------------------------------------------------------------------
const responseRaw = JSON.stringify({
  ok: true,
  transportVersion: 1,
  requestId: "11111111-1111-4111-8111-111111111111",
  state: "empty",
  replayed: false,
  executable: false,
});
const responseHeadersObject = buildSignedCoreResponseHeaders({
  rawBody: responseRaw,
  path: N8N_CLAIM_ROUTE_PATH,
  requestId: "11111111-1111-4111-8111-111111111111",
  secret: responseSecret,
  timestamp: 1_800_000_000,
});
const responseHeaders = new Headers(responseHeadersObject);
const responseVerification = verifyCoreToN8nResponse({
  rawBody: responseRaw,
  path: N8N_CLAIM_ROUTE_PATH,
  headers: responseHeaders,
  secret: responseSecret,
  nowSeconds: 1_800_000_000,
});
record("15 signed Core response verifies", responseVerification.ok);

const tamperedResponse = verifyCoreToN8nResponse({
  rawBody: responseRaw.replace('"empty"', '"claimed"'),
  path: N8N_CLAIM_ROUTE_PATH,
  headers: responseHeaders,
  secret: responseSecret,
  nowSeconds: 1_800_000_000,
});
record(
  "16 tampered Core response is rejected",
  !tamperedResponse.ok &&
    tamperedResponse.code === "TRANSPORT_BODY_HASH_MISMATCH",
);

const wrongResponseSecret = verifyCoreToN8nResponse({
  rawBody: responseRaw,
  path: N8N_CLAIM_ROUTE_PATH,
  headers: responseHeaders,
  secret: inboundSecret,
  nowSeconds: 1_800_000_000,
});
record(
  "17 response uses independent directional secret",
  !wrongResponseSecret.ok &&
    wrongResponseSecret.code === "TRANSPORT_SIGNATURE_INVALID",
);

record(
  "18 response signature includes no raw secret",
  !Object.values(responseHeadersObject).some((value) =>
    value.includes(responseSecret),
  ),
);

// ---------------------------------------------------------------------------
// 3. Migration dependency / narrow scope
// ---------------------------------------------------------------------------
record(
  "19 migration is transactional",
  /\nbegin;\s/.test(sql) && /\ncommit;\s*$/.test(sql),
);
record(
  "20 migration requires all three 50.1B tables",
  [
    "automation_action_requests",
    "automation_jobs",
    "automation_execution_attempts",
  ].every((name) =>
    sql.includes(`to_regclass('public.${name}')`),
  ),
);
record(
  "21 migration requires existing base claim RPC",
  sql.includes(
    "to_regprocedure('public.qf_claim_automation_job_v1(text)')",
  ),
);
record(
  "22 migration fails if target transport table already exists",
  sql.includes(
    "to_regclass('public.automation_transport_requests') is not null",
  ),
);
record(
  "23 exactly one new table is created",
  (execSql.match(/\bcreate\s+table\s+public\./gi) ?? []).length === 1 &&
    /create table public\.automation_transport_requests\b/i.test(execSql),
);
record(
  "24 no legacy workflow-kernel table is created",
  !/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?public\.(workflow_instances|workflow_tasks|domain_events|outbox_events)\b/i.test(
    execSql,
  ),
);
record(
  "25 no database network extension is created",
  !/\bcreate\s+extension\b[\s\S]{0,80}(pg_net|http|dblink)/i.test(
    execSql,
  ),
);

// ---------------------------------------------------------------------------
// 4. Replay ledger shape
// ---------------------------------------------------------------------------
record(
  "26 replay ledger UUID is primary key",
  /id uuid primary key/.test(sql),
);
record(
  "27 transport version is structurally fixed to 1",
  /check \(transport_version = 1\)/.test(sql),
);
record(
  "28 transport direction is structurally n8n_to_core only",
  /check \(direction = 'n8n_to_core'\)/.test(sql),
);
record(
  "29 route key is structurally claim_v1 only",
  /check \(route_key = 'claim_v1'\)/.test(sql),
);
record(
  "30 body hash is exactly lowercase sha256",
  /body_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/.test(sql),
);
record(
  "31 replay ledger state vocabulary is closed",
  /state in \('processing', 'claimed', 'empty'\)/.test(sql),
);
record(
  "32 claimed state requires full durable claim identity",
  /state = 'claimed'[\s\S]{0,500}job_id is not null[\s\S]{0,500}attempt_id is not null[\s\S]{0,500}max_attempts is not null/.test(
    sql,
  ),
);
record(
  "33 job may appear in only one transport request",
  /create unique index uq_automation_transport_requests_job[\s\S]{0,120}job_id/.test(
    sql,
  ),
);

// ---------------------------------------------------------------------------
// 5. Universal history guards
// ---------------------------------------------------------------------------
record(
  "34 insert guard requires pristine processing row",
  /transport requests must be inserted as pristine/.test(sql),
);
record(
  "35 update guard allows processing to finalize only once",
  /if old\.state <> 'processing'/.test(sql) &&
    /new\.state not in \('claimed', 'empty'\)/.test(sql),
);
record(
  "36 transport identity/evidence is immutable",
  /transport request identity\/evidence is immutable/.test(sql),
);
record(
  "37 DELETE blocker exists",
  sql.includes("trg_automation_transport_requests_no_delete"),
);
record(
  "38 TRUNCATE blocker exists",
  sql.includes("trg_automation_transport_requests_no_truncate"),
);
record(
  "39 self-verification requires exactly four triggers",
  /if v_count <> 4 then/.test(sql),
);

// ---------------------------------------------------------------------------
// 6. One-shot transport claim RPC
// ---------------------------------------------------------------------------
record(
  "40 exactly one application transport RPC is introduced",
  (
    execSql.match(
      /create\s+or\s+replace\s+function\s+public\.qf_claim_automation_job_transport_v1/gi,
    ) ?? []
  ).length === 1,
);
record(
  "41 transport claim RPC is SECURITY DEFINER",
  /qf_claim_automation_job_transport_v1[\s\S]{0,600}security definer/.test(
    sql,
  ),
);
record(
  "42 transport claim RPC has fixed search_path",
  /qf_claim_automation_job_transport_v1[\s\S]{0,700}set search_path = pg_catalog, public, pg_temp/.test(
    sql,
  ),
);
record(
  "43 first request uses INSERT ON CONFLICT DO NOTHING",
  /insert into public\.automation_transport_requests[\s\S]{0,500}on conflict \(id\) do nothing/.test(
    sql,
  ),
);
record(
  "44 replay locks the existing request row",
  /from public\.automation_transport_requests[\s\S]{0,120}where id = p_request_id[\s\S]{0,80}for update/.test(
    sql,
  ),
);
record(
  "45 changed replay evidence is rejected",
  sql.includes("AUTOMATION_TRANSPORT_REQUEST_REPLAY_CONFLICT"),
);
record(
  "46 replay is explicitly returned as is_replay=true",
  /v_request\.state,\s+true,\s+v_request\.job_id/.test(sql),
);
record(
  "47 fresh request delegates to canonical 50.1B claim RPC",
  /from public\.qf_claim_automation_job_v1\(p_worker_id\)/.test(sql),
);
record(
  "48 no-job fresh request finalizes empty",
  /set state = 'empty'/.test(sql),
);
record(
  "49 successful fresh request stores exact durable claim evidence",
  /set state = 'claimed'[\s\S]{0,400}job_id = v_claim\.job_id[\s\S]{0,400}attempt_id = v_claim\.attempt_id/.test(
    sql,
  ),
);
record(
  "50 fresh claim is returned with is_replay=false",
  /v_request\.state,\s+false,\s+v_request\.job_id/.test(sql),
);

// ---------------------------------------------------------------------------
// 7. ACL / RLS
// ---------------------------------------------------------------------------
record(
  "51 RLS is enabled on transport ledger",
  sql.includes(
    "alter table public.automation_transport_requests enable row level security",
  ),
);
record(
  "52 service_role table ACL is reset before grant",
  /revoke all on table public\.automation_transport_requests[\s\S]{0,100}service_role/.test(
    sql,
  ),
);
record(
  "53 service_role gets SELECT only",
  sql.includes(
    "grant select on table public.automation_transport_requests to service_role",
  ) &&
    !/grant\s+(insert|update|delete|truncate|all)\s+on\s+table\s+public\.automation_transport_requests/i.test(
      execSql,
    ),
);
record(
  "54 transport RPC executable only by service_role",
  /revoke all on function public\.qf_claim_automation_job_transport_v1\(uuid, text, text\)[\s\S]{0,120}public, anon, authenticated, service_role/.test(
    sql,
  ) &&
    /grant execute on function public\.qf_claim_automation_job_transport_v1\(uuid, text, text\)[\s\S]{0,80}to service_role/.test(
      sql,
    ),
);

// ---------------------------------------------------------------------------
// 8. Runtime configuration
// ---------------------------------------------------------------------------
record(
  "55 runtime defaults transport mode to off",
  service.includes('?? "off"'),
);
record(
  "56 only off/staging/production modes exist",
  service.includes('modeRaw !== "staging" && modeRaw !== "production"'),
);
record(
  "57 enabled mode requires exact runtime environment match",
  service.includes("runtimeEnvironment !== modeRaw"),
);
record(
  "58 inbound secret env is explicit",
  service.includes("QF_N8N_TO_CORE_HMAC_SECRET"),
);
record(
  "59 Core response secret env is explicit",
  service.includes("QF_CORE_TO_N8N_HMAC_SECRET"),
);
record(
  "60 fixed worker identity env is explicit",
  service.includes("QF_N8N_WORKER_ID"),
);
record(
  "61 secrets must be directionally distinct",
  service.includes("inboundSecret === responseSecret"),
);
record(
  "62 service does not contain a Supabase key env name",
  !service.includes("SUPABASE_SERVICE_ROLE_KEY"),
);

// ---------------------------------------------------------------------------
// 9. Service replay behavior
// ---------------------------------------------------------------------------
record(
  "63 service uses only transport claim RPC for claim mutation",
  service.includes('.rpc("qf_claim_automation_job_transport_v1"'),
);
record(
  "64 service performs no direct insert/update/delete",
  !/\.(insert|update|delete)\s*\(/.test(service),
);
record(
  "65 replayed claimed request is non-executable",
  /row\.is_replay[\s\S]{0,900}CLAIM_REPLAY_EXECUTION_SUPPRESSED/.test(
    service,
  ) &&
    /executable: false/.test(service),
);
record(
  "66 only fresh complete claim evidence reaches envelope reconstruction",
  service.includes("requireFreshClaimEvidence(row)") &&
    service.includes("getClaimedAutomationJobEnvelope"),
);
record(
  "67 service has no fetch/network call",
  !/\bfetch\s*\(/.test(service),
);
record(
  "68 service imports no Meta/provider adapter",
  !/metaCloud|metaWhatsApp|providerAdapter|communicationService/i.test(
    service,
  ),
);

// ---------------------------------------------------------------------------
// 10. Core route security
// ---------------------------------------------------------------------------
record(
  "69 route is Node runtime and dynamic",
  route.includes('export const runtime = "nodejs"') &&
    route.includes('export const dynamic = "force-dynamic"'),
);
record(
  "70 route caps body at 2048 bytes",
  route.includes("const MAX_BODY_BYTES = 2_048"),
);
record(
  "71 route checks runtime config before reading/claiming",
  route.indexOf("getAutomationTransportRuntimeConfig()") <
    route.indexOf("await request.text()"),
);
record(
  "72 route verifies HMAC before JSON parse",
  route.indexOf("verifyN8nToCoreRequest") <
    route.indexOf("parseClaimBody(rawBody)"),
);
record(
  "73 route verifies exact signed claim path",
  route.includes("path: N8N_CLAIM_ROUTE_PATH"),
);
record(
  "74 route requires body request ID to match signed header",
  route.includes("parsed.body.requestId !== verified.requestId"),
);
record(
  "75 route requires exact configured worker",
  route.includes("parsed.body.workerId !== config.workerId"),
);
record(
  // QF-MVP-50.3/50.4 re-pin, NOT a relaxation. The claim body now has EXACTLY
  // TWO accepted shapes: the byte-compatible legacy three-field body (which SQL
  // now fences to client_whatsapp) and a four-field family-aware body that adds
  // ONLY `workflowFamily`. Both key sets are pinned exactly, any other key set
  // is refused, and the family value is validated against the closed
  // vocabulary — so this is strictly stronger than the previous single-shape
  // assertion.
  "76 route allows exactly the legacy three-field body or the four-field family body",
  route.includes("keys.length === 3") &&
    route.includes("keys.length === 4") &&
    route.includes('keys[0] === "requestId"') &&
    route.includes('keys[1] === "transportVersion"') &&
    route.includes('keys[2] === "workerId"') &&
    route.includes('keys[3] === "workflowFamily"') &&
    route.includes("!isLegacyShape && !isFamilyShape") &&
    route.includes("AUTOMATION_TRANSPORT_BODY_FIELDS_INVALID") &&
    route.includes("isClaimableWorkflowFamily(value.workflowFamily)"),
);
record(
  "77 route sends verified body hash to durable replay RPC service",
  route.includes("bodySha256: verified.bodySha256"),
);
record(
  "78 authenticated responses are Core-signed",
  route.includes("buildSignedCoreResponseHeaders"),
);
record(
  "79 route returns no cache",
  route.includes('"cache-control": "no-store"'),
);
record(
  "80 route catches internal failures without exposing error object",
  route.includes('"AUTOMATION_TRANSPORT_INTERNAL_FAILURE"') &&
    !route.includes("error.message") &&
    !route.includes("console."),
);
record(
  "81 route never imports old AOS preview modules",
  !/lib\/aos|safeAgentEventPipeline|n8nTool/.test(route),
);
record(
  "82 route never imports Supabase directly",
  !/lib\/supabase/.test(route),
);
record(
  "83 route contains no provider or Meta call",
  !/meta|provider|whatsapp/i.test(
    execRoute
      .replace(/AUTOMATION_TRANSPORT_INTERNAL_FAILURE/g, "")
      .replace(/automation\/n8n/g, ""),
  ),
);
record(
  "84 route contains no outbound fetch",
  !/\bfetch\s*\(/.test(route),
);

// ---------------------------------------------------------------------------
// 11. Source contract / documentation boundaries
// ---------------------------------------------------------------------------
record(
  "85 type contract marks replayed claimed response executable false",
  /state: "claimed";[\s\S]{0,120}replayed: true;[\s\S]{0,120}executable: false/.test(
    typesSource,
  ),
);
record(
  "86 fresh claimed response alone has executable true",
  /replayed: false;[\s\S]{0,120}executable: true/.test(typesSource),
);
record(
  "87 auth canonical includes direction label",
  authSource.includes('"N8N_TO_CORE"') &&
    authSource.includes('"CORE_TO_N8N_RESPONSE"'),
);
record(
  "88 auth uses Node timingSafeEqual",
  authSource.includes("timingSafeEqual"),
);
record(
  "89 auth signs body hash rather than raw secret-bearing headers",
  authSource.includes("bodySha256") &&
    !authSource.includes("authorization"),
);
record(
  "90 documentation keeps historical preview router inactive",
  doc.includes("historical AOS preview") &&
    doc.includes("not imported, modified, or activated"),
);
record(
  "91 documentation explicitly starts fresh n8n account",
  doc.includes("fresh / blank account"),
);
record(
  "92 documentation says first workflow is later and inactive",
  doc.includes("QF-MVP-50-01-Core-Job-Dispatcher") &&
    doc.includes("inactive"),
);
record(
  "93 documentation forbids Supabase service-role in n8n",
  doc.includes("Supabase service-role key"),
);
record(
  "94 documentation forbids Meta token in n8n",
  doc.includes("Meta access token"),
);
record(
  "95 documentation keeps Jarvis outside n8n claim endpoint",
  doc.includes("They do not know or call the n8n claim endpoint"),
);
record(
  "96 implementation creates no n8n workflow JSON",
  !Object.values(files).some((value) =>
    value.endsWith(".workflow.json"),
  ),
);

// ---------------------------------------------------------------------------
// 12. No hidden side effects in migration
// ---------------------------------------------------------------------------
record(
  "97 migration does not write communication messages",
  !/\b(insert\s+into|update|delete\s+from)\s+public\.communication_messages\b/i.test(
    execSql,
  ),
);
record(
  "98 migration does not write assignments",
  !/\b(insert\s+into|update|delete\s+from)\s+public\.lead_assignments\b/i.test(
    execSql,
  ),
);
record(
  "99 migration does not write credits",
  !/\b(insert\s+into|update|delete\s+from)\s+public\.vendor_credit_logs\b/i.test(
    execSql,
  ),
);
record(
  "100 migration self-verifies zero transport seed rows",
  /from public\.automation_transport_requests;[\s\S]{0,120}if v_count <> 0 then/.test(
    sql,
  ),
);

const failed = results.filter((result) => !result.ok);

for (const result of results) {
  console.log(
    `${result.ok ? "PASS" : "FAIL"} ${result.name}${
      result.detail ? ` — ${result.detail}` : ""
    }`,
  );
}

console.log("");
console.log(
  `QF-MVP-50.1C: ${results.length - failed.length}/${results.length} PASS`,
);

if (failed.length > 0) {
  process.exitCode = 1;
} else {
  console.log("QF_MVP_50_1C_SECURE_N8N_TRANSPORT_READY");
}
