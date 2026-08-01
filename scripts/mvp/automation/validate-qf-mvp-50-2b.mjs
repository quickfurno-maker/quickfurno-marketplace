#!/usr/bin/env node

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCoreToN8nResponseSignature,
  createN8nToCoreSignature,
  sha256Hex,
} from "../../../lib/automation/transportAuth.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workflowPath = path.join(
  ROOT,
  "automation/n8n/QF-MVP-50-01-Core-Job-Dispatcher.50.2B-selfhost-env.workflow.json",
);
const docPath = path.join(
  ROOT,
  "docs/QF-MVP-50-2B-SECURE-SIGNED-CLAIM-HANDSHAKE.md",
);

const workflowText = readFileSync(workflowPath, "utf8");
const doc = readFileSync(docPath, "utf8");
const workflow = JSON.parse(workflowText);
const nodes = workflow.nodes ?? [];
const connections = workflow.connections ?? {};
const node = (name) => nodes.find((n) => n.name === name);
const results = [];
const record = (name, ok) => results.push({ name, ok: Boolean(ok) });

const executableNodes = nodes.filter((n) => n.type !== "n8n-nodes-base.stickyNote");
const executableText = JSON.stringify(
  executableNodes.map(({ notes, ...rest }) => rest),
);
const allNodeText = JSON.stringify(nodes);

const envNames = [
  "QF_N8N_TRANSPORT_ENABLED",
  "QF_CORE_STAGING_BASE_URL",
  "QF_N8N_WORKER_ID",
  "QF_N8N_TO_CORE_HMAC_SECRET",
  "QF_CORE_TO_N8N_HMAC_SECRET",
];

const runtime = node("50.2B Runtime Preconditions");
const configIf = node("IF — Transport Configured");
const uuidNode = node("Generate Request UUID");
const bodyNode = node("Build Exact Claim Body");
const bodyHash = node("SHA256 — Claim Body");
const requestCanonical = node("Build Request Canonical");
const requestHmac = node("HMAC — n8n to Core");
const http = node("POST Signed Claim to Core — STAGING ONLY");
const normalize = node("Normalize Core Response");
const responseHash = node("SHA256 — Core Response Body");
const responseCanonical = node("Build Response Canonical");
const responseHmac = node("HMAC — Verify Core Response");
const verify = node("Verify Signed Core Response");
const verifyIf = node("IF — Core Response Verified");
const parse = node("Parse Verified Claim — Routing Disabled");
const sticky = node("SECURITY — 50.2B READ FIRST");

const runtimeCode = runtime?.parameters?.jsCode ?? "";
const bodyCode = bodyNode?.parameters?.jsCode ?? "";
const reqCanonicalCode = requestCanonical?.parameters?.jsCode ?? "";
const normalizeCode = normalize?.parameters?.jsCode ?? "";
const respCanonicalCode = responseCanonical?.parameters?.jsCode ?? "";
const verifyCode = verify?.parameters?.jsCode ?? "";
const parseCode = parse?.parameters?.jsCode ?? "";

// 1-15: Workflow identity, safe status, source boundary.
record("001 exact 50.2B candidate workflow name", workflow.name === "QF-MVP-50-01-Core-Job-Dispatcher-50.2B-SELFHOST-CANDIDATE");
record("002 workflow inactive", workflow.active === false);
record("003 workflow has no tags", Array.isArray(workflow.tags) && workflow.tags.length === 0);
record("004 pinData empty", workflow.pinData && Object.keys(workflow.pinData).length === 0);
record("005 execution order v1", workflow.settings?.executionOrder === "v1");
record("006 timezone UTC", workflow.settings?.timezone === "UTC");
record("007 successful execution data not saved", workflow.settings?.saveDataSuccessExecution === "none");
record("008 error execution data saved for handshake diagnosis", workflow.settings?.saveDataErrorExecution === "all");
record("009 manual execution storage enabled", workflow.settings?.saveManualExecutions === true);
record("010 template credential setup false", workflow.meta?.templateCredsSetupCompleted === false);
record("011 UUID-shaped workflow versionId", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workflow.versionId));
record("012 all node IDs unique", new Set(nodes.map((n) => n.id)).size === nodes.length);
record("013 all node names unique", new Set(nodes.map((n) => n.name)).size === nodes.length);
record("014 exactly one sticky note", nodes.filter((n) => n.type === "n8n-nodes-base.stickyNote").length === 1);
record("015 no published top-level override", !Object.prototype.hasOwnProperty.call(workflow, "published"));

// 16-28: Trigger/gate/terminal topology primitives.
record("016 exactly one schedule trigger", nodes.filter((n) => n.type === "n8n-nodes-base.scheduleTrigger").length === 1);
record("017 schedule trigger exact name", Boolean(node("Schedule Trigger — INACTIVE")));
record("018 schedule cadence one minute", node("Schedule Trigger — INACTIVE")?.parameters?.rule?.interval?.[0]?.field === "minutes" && node("Schedule Trigger — INACTIVE")?.parameters?.rule?.interval?.[0]?.minutesInterval === 1);
record("019 exactly one manual trigger", nodes.filter((n) => n.type === "n8n-nodes-base.manualTrigger").length === 1);
record("020 manual trigger exact name", Boolean(node("Manual Trigger — Handshake Test")));
record("021 runtime precondition Code node exists", runtime?.type === "n8n-nodes-base.code");
record("022 transport configured IF exists", configIf?.type === "n8n-nodes-base.if");
record("023 default-stop node exists", node("STOP — Secure Runtime Not Configured")?.type === "n8n-nodes-base.noOp");
record("024 unverified-stop node exists", node("STOP — Reject Unverified Response")?.type === "n8n-nodes-base.noOp");
record("025 handshake-complete stop exists", node("STOP — 50.2B Handshake Complete")?.type === "n8n-nodes-base.noOp");
record("026 no Execute Workflow child node", !nodes.some((n) => /executeWorkflow/i.test(n.type)));
record("027 no Webhook node", !nodes.some((n) => /webhook/i.test(n.type)));
record("028 no Wait node", !nodes.some((n) => /wait/i.test(n.type)));

// 29-43: Runtime fail-closed configuration and no emitted secrets.
record("029 runtime requires explicit enable true", runtimeCode.includes("$env.QF_N8N_TRANSPORT_ENABLED === 'true'"));
record("030 runtime reads staging base env only", runtimeCode.includes("$env.QF_CORE_STAGING_BASE_URL"));
record("031 runtime reads worker env", runtimeCode.includes("$env.QF_N8N_WORKER_ID"));
record("032 runtime reads inbound HMAC env", runtimeCode.includes("$env.QF_N8N_TO_CORE_HMAC_SECRET"));
record("033 runtime reads response HMAC env", runtimeCode.includes("$env.QF_CORE_TO_N8N_HMAC_SECRET"));
record("034 runtime requires HTTPS base", runtimeCode.includes("/^https:\\/\\//.test(baseUrl)"));
record("035 runtime enforces worker grammar", runtimeCode.includes("^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$"));
record("036 runtime requires inbound >=32", runtimeCode.includes("inbound.length >= 32"));
record("037 runtime requires response >=32", runtimeCode.includes("response.length >= 32"));
record("038 runtime requires distinct secrets", runtimeCode.includes("inbound !== response"));
record("039 runtime configured includes enable", /configured\s*=\s*Boolean\([\s\S]*enabled/.test(runtimeCode));
record("040 runtime output does not emit inbound secret", !/^\s*inbound\s*[,}]?\s*$/m.test(runtimeCode.split("return [{")[1] ?? "") && !/inboundSecret\s*:/.test(runtimeCode.split("return [{")[1] ?? ""));
record("041 runtime output does not emit response secret", !/^\s*response\s*[,}]?\s*$/m.test(runtimeCode.split("return [{")[1] ?? "") && !/responseSecret\s*:/.test(runtimeCode.split("return [{")[1] ?? ""));
record("042 runtime reports secret source selfhost_env", runtimeCode.includes("secretSource: 'selfhost_env'"));
record("043 runtime reports booleans rather than secret values", runtimeCode.includes("inboundSecretConfigured: inbound.length >= 32") && runtimeCode.includes("responseSecretConfigured: response.length >= 32"));

// 44-52: Secret and credential containment.
record("044 no credentials object in workflow", !allNodeText.includes('"credentials"'));
record("045 no hardcoded HMAC secret assignment", !/QF_N8N_TO_CORE_HMAC_SECRET\s*=\s*[^"'`\s]/.test(workflowText) && !/QF_CORE_TO_N8N_HMAC_SECRET\s*=\s*[^"'`\s]/.test(workflowText));
record("046 request HMAC secret is exact env reference", requestHmac?.parameters?.secret === "={{ $env.QF_N8N_TO_CORE_HMAC_SECRET }}");
record("047 response HMAC secret is exact env reference", responseHmac?.parameters?.secret === "={{ $env.QF_CORE_TO_N8N_HMAC_SECRET }}");
record("048 no literal Bearer auth", !/Bearer\s+[A-Za-z0-9._~-]{8,}/i.test(workflowText));
record("049 no Supabase project refs", !/(uckafzuochmbvtiodmcl|yqpgcsduqbxulrlzwzap|coilipywdvxklewquqvv)/.test(workflowText));
record("050 no service role terminology in executable nodes", !/service[_ -]?role/i.test(executableText));
record("051 no Meta token/id fields", !/META_ACCESS_TOKEN|phone_number_id|waba|facebookGraphApi/i.test(executableText));
record("052 no legacy x-qf-n8n-secret", !/x-qf-n8n-secret|new_n8n_secret/i.test(workflowText));

// 53-64: Request generation/hash/canonical/HMAC.
record("053 UUID node is Crypto", uuidNode?.type === "n8n-nodes-base.crypto");
record("054 UUID node action generate", uuidNode?.parameters?.action === "generate");
record("055 UUID node writes requestId", uuidNode?.parameters?.dataPropertyName === "requestId");
record("056 UUID node typeVersion 1", uuidNode?.typeVersion === 1);
record("057 exact body validates UUID", bodyCode.includes("QF_50_2B_REQUEST_ID_INVALID"));
record("058 exact body timestamp unix seconds", bodyCode.includes("Math.floor(Date.now() / 1000)"));
record("059 exact body JSON field order locked", bodyCode.includes("JSON.stringify({ transportVersion: 1, requestId, workerId })"));
record("060 body hash is Crypto SHA256", bodyHash?.type === "n8n-nodes-base.crypto" && bodyHash?.parameters?.action === "hash" && bodyHash?.parameters?.type === "SHA256");
record("061 body hash reads rawBody", bodyHash?.parameters?.value === "={{ $json.rawBody }}");
record("062 body hash writes bodySha256", bodyHash?.parameters?.dataPropertyName === "bodySha256");
record("063 request canonical has exact domain/direction", reqCanonicalCode.includes("'QF-AUTOMATION-TRANSPORT-V1'") && reqCanonicalCode.includes("'N8N_TO_CORE'"));
record("064 request canonical has exact POST/path", reqCanonicalCode.includes("'POST'") && reqCanonicalCode.includes("'/api/internal/automation/n8n/claim'"));

// 65-72: Request HMAC node.
record("065 request canonical joins newline", reqCanonicalCode.includes(".join('\\n')"));
record("066 request canonical uses requestId", reqCanonicalCode.includes("$json.requestId"));
record("067 request canonical uses timestamp", reqCanonicalCode.includes("String($json.timestamp)"));
record("068 request canonical uses body hash", reqCanonicalCode.includes("$json.bodySha256"));
record("069 request HMAC Crypto node", requestHmac?.type === "n8n-nodes-base.crypto");
record("070 request HMAC action hmac SHA256", requestHmac?.parameters?.action === "hmac" && requestHmac?.parameters?.type === "SHA256");
record("071 request HMAC reads canonical", requestHmac?.parameters?.value === "={{ $json.requestCanonical }}");
record("072 request HMAC writes requestHmac", requestHmac?.parameters?.dataPropertyName === "requestHmac");

// 73-88: HTTP request containment and exact transport headers.
record("073 exactly one HTTP Request node", nodes.filter((n) => n.type === "n8n-nodes-base.httpRequest").length === 1);
record("074 HTTP method POST", http?.parameters?.method === "POST");
record("075 HTTP node version 4.2", http?.typeVersion === 4.2);
record("076 HTTP URL uses staging env reference", String(http?.parameters?.url ?? "").includes("$env.QF_CORE_STAGING_BASE_URL"));
record("077 HTTP URL exact claim path", String(http?.parameters?.url ?? "").includes("/api/internal/automation/n8n/claim"));
record("078 no hardcoded http hostname", !/https?:\/\/[A-Za-z0-9]/.test(String(http?.parameters?.url ?? "")));
record("079 sends headers", http?.parameters?.sendHeaders === true);
record("080 exact six headers", http?.parameters?.headerParameters?.parameters?.length === 6);
const hdr = Object.fromEntries((http?.parameters?.headerParameters?.parameters ?? []).map((x) => [String(x.name).toLowerCase(), x.value]));
record("081 content-type json header", hdr["content-type"] === "application/json");
record("082 transport version header exact", hdr["x-qf-transport-version"] === "1");
record("083 request id header expression exact", hdr["x-qf-request-id"] === "={{ $json.requestId }}");
record("084 timestamp header expression exact", hdr["x-qf-timestamp"] === "={{ String($json.timestamp) }}");
record("085 body hash header expression exact", hdr["x-qf-body-sha256"] === "={{ $json.bodySha256 }}");
record("086 signature header v1 expression exact", hdr["x-qf-signature"] === "={{ 'v1=' + $json.requestHmac }}");
record("087 sends raw application/json body", http?.parameters?.sendBody === true && http?.parameters?.contentType === "raw" && http?.parameters?.rawContentType === "application/json");
record("088 HTTP body is exact rawBody expression", http?.parameters?.body === "={{ $json.rawBody }}");

// 89-96: HTTP failure/response behavior.
const httpOptions = http?.parameters?.options ?? {};
record("089 HTTP timeout 10000", httpOptions.timeout === 10000);
record("090 full response enabled", httpOptions.response?.response?.fullResponse === true);
record("091 neverError enabled", httpOptions.response?.response?.neverError === true);
record("092 response format text", httpOptions.response?.response?.responseFormat === "text");
record("093 no retryOnFail", !Object.prototype.hasOwnProperty.call(http ?? {}, "retryOnFail"));
record("094 no maxTries", !Object.prototype.hasOwnProperty.call(http ?? {}, "maxTries"));
record("095 no waitBetweenTries", !Object.prototype.hasOwnProperty.call(http ?? {}, "waitBetweenTries"));
record("096 no continueOnFail/onError override", !Object.prototype.hasOwnProperty.call(http ?? {}, "continueOnFail") && !Object.prototype.hasOwnProperty.call(http ?? {}, "onError"));

// 97-108: Response normalization/hash/canonical/HMAC.
record("097 normalize lowercases response headers", normalizeCode.includes(".toLowerCase()"));
record("098 normalize preserves exact raw response body string", normalizeCode.includes("typeof response.body === 'string' ? response.body"));
record("099 normalize reads all five signed response headers", ["x-qf-response-version","x-qf-response-request-id","x-qf-response-timestamp","x-qf-response-body-sha256","x-qf-response-signature"].every((h) => normalizeCode.includes(h)));
record("100 response body hash Crypto SHA256", responseHash?.type === "n8n-nodes-base.crypto" && responseHash?.parameters?.action === "hash" && responseHash?.parameters?.type === "SHA256");
record("101 response hash reads exact raw body", responseHash?.parameters?.value === "={{ $json.rawResponseBody }}");
record("102 response hash writes actualResponseBodySha256", responseHash?.parameters?.dataPropertyName === "actualResponseBodySha256");
record("103 response canonical exact domain", respCanonicalCode.includes("'QF-AUTOMATION-TRANSPORT-V1'"));
record("104 response canonical exact direction", respCanonicalCode.includes("'CORE_TO_N8N_RESPONSE'"));
record("105 response canonical exact claim path", respCanonicalCode.includes("'/api/internal/automation/n8n/claim'"));
record("106 response canonical joins newline", respCanonicalCode.includes(".join('\\n')"));
record("107 response HMAC action hmac SHA256", responseHmac?.type === "n8n-nodes-base.crypto" && responseHmac?.parameters?.action === "hmac" && responseHmac?.parameters?.type === "SHA256");
record("108 response HMAC reads canonical and writes expectedResponseHmac", responseHmac?.parameters?.value === "={{ $json.responseCanonical }}" && responseHmac?.parameters?.dataPropertyName === "expectedResponseHmac");

// 109-120: Fail-closed response verification.
record("109 verification requires response version 1", verifyCode.includes("$json.responseVersion === '1'"));
record("110 verification binds response requestId to original", verifyCode.includes("$json.responseRequestId === $json.requestId"));
record("111 verification requires ten-digit timestamp", verifyCode.includes("/^\\d{10}$/.test($json.responseTimestamp)"));
record("112 verification enforces 300 second window", verifyCode.includes("Math.abs(now - ts) <= 300"));
record("113 verification requires lowercase 64-hex body hash", verifyCode.includes("/^[0-9a-f]{64}$/.test($json.responseBodySha256Header)"));
record("114 verification compares body hash", verifyCode.includes("$json.responseBodySha256Header === $json.actualResponseBodySha256"));
record("115 verification requires v1 64-hex signature", verifyCode.includes("/^v1=[0-9a-f]{64}$/.test($json.responseSignature)"));
record("116 verification compares expected signature", verifyCode.includes("$json.responseSignature === expectedSig"));
record("117 verification combines all checks", verifyCode.includes("Object.values(checks).every(Boolean)"));
record("118 verified IF node exists", verifyIf?.type === "n8n-nodes-base.if");
record("119 failed verification routes to reject stop", connections["IF — Core Response Verified"]?.main?.[1]?.[0]?.node === "STOP — Reject Unverified Response");
record("120 successful verification routes only to parser", connections["IF — Core Response Verified"]?.main?.[0]?.[0]?.node === "Parse Verified Claim — Routing Disabled");

// 121-131: Claim envelope and non-execution invariants.
record("121 parser JSON parses only after verification path", parseCode.includes("JSON.parse($json.rawResponseBody)"));
record("122 parser requires transportVersion 1", parseCode.includes("payload.transportVersion !== 1"));
record("123 parser requires requestId match", parseCode.includes("payload.requestId !== $json.requestId"));
record("124 parser allows only empty claimed states", parseCode.includes("new Set(['empty', 'claimed'])"));
record("125 parser requires replayed boolean", parseCode.includes("typeof payload.replayed !== 'boolean'"));
record("126 parser requires executable boolean", parseCode.includes("typeof payload.executable !== 'boolean'"));
record("127 replay executable invariant enforced", parseCode.includes("payload.replayed || payload.state === 'empty'"));
record("128 non-executable invariant error exists", parseCode.includes("QF_50_2B_NONEXECUTABLE_INVARIANT"));
record("129 routing is explicitly disabled", parseCode.includes("routingEnabled: false"));
record("130 handshake safe marker exact", parseCode.includes("QF_50_2B_SIGNED_HANDSHAKE_VERIFIED_ROUTING_DISABLED"));
record("131 parser routes only to handshake complete stop", connections["Parse Verified Claim — Routing Disabled"]?.main?.[0]?.[0]?.node === "STOP — 50.2B Handshake Complete");

// 132-139: No business/provider side effects.
record("132 no Supabase/Postgres node", !nodes.some((n) => /supabase|postgres/i.test(n.type)));
record("133 no Meta/Facebook node", !nodes.some((n) => /facebook|meta/i.test(n.type)));
record("134 no WhatsApp node", !nodes.some((n) => /whatsapp/i.test(n.type)));
record("135 no Jarvis node/reference in executable flow", !/jarvis|riya|anisha/i.test(executableText));
record("136 no assignment mutation vocabulary in executable flow", !/assignvendor|assignment.*update|update.*assignment/i.test(executableText));
record("137 no credit/package mutation vocabulary in executable flow", !/credit.*update|package.*update|debit|deduct/i.test(executableText));
record("138 no consent/suppression bypass vocabulary", !/skip[_ -]?consent|bypass[_ -]?suppression|retry_anyway/i.test(executableText));
record("139 only HTTP target is Core staging env claim route", nodes.filter((n) => n.type === "n8n-nodes-base.httpRequest").every((n) => String(n.parameters?.url ?? "").includes("$env.QF_CORE_STAGING_BASE_URL") && String(n.parameters?.url ?? "").includes("/api/internal/automation/n8n/claim")));

// 140-150: Exact topology and default fail-closed path.
record("140 schedule points to runtime gate only", connections["Schedule Trigger — INACTIVE"]?.main?.[0]?.length === 1 && connections["Schedule Trigger — INACTIVE"].main[0][0].node === "50.2B Runtime Preconditions");
record("141 manual points to runtime gate only", connections["Manual Trigger — Handshake Test"]?.main?.[0]?.length === 1 && connections["Manual Trigger — Handshake Test"].main[0][0].node === "50.2B Runtime Preconditions");
record("142 runtime points to configured IF only", connections["50.2B Runtime Preconditions"]?.main?.[0]?.length === 1 && connections["50.2B Runtime Preconditions"].main[0][0].node === "IF — Transport Configured");
record("143 configured false path goes to safe stop", connections["IF — Transport Configured"]?.main?.[1]?.[0]?.node === "STOP — Secure Runtime Not Configured");
record("144 configured true path begins UUID", connections["IF — Transport Configured"]?.main?.[0]?.[0]?.node === "Generate Request UUID");
const chain = [
  ["Generate Request UUID","Build Exact Claim Body"],
  ["Build Exact Claim Body","SHA256 — Claim Body"],
  ["SHA256 — Claim Body","Build Request Canonical"],
  ["Build Request Canonical","HMAC — n8n to Core"],
  ["HMAC — n8n to Core","POST Signed Claim to Core — STAGING ONLY"],
  ["POST Signed Claim to Core — STAGING ONLY","Normalize Core Response"],
  ["Normalize Core Response","SHA256 — Core Response Body"],
  ["SHA256 — Core Response Body","Build Response Canonical"],
  ["Build Response Canonical","HMAC — Verify Core Response"],
  ["HMAC — Verify Core Response","Verify Signed Core Response"],
  ["Verify Signed Core Response","IF — Core Response Verified"],
];
record("145 signed handshake chain exact", chain.every(([a,b]) => connections[a]?.main?.[0]?.length === 1 && connections[a].main[0][0].node === b));
record("146 safe runtime stop terminal", !connections["STOP — Secure Runtime Not Configured"]);
record("147 reject response stop terminal", !connections["STOP — Reject Unverified Response"]);
record("148 handshake complete stop terminal", !connections["STOP — 50.2B Handshake Complete"]);
record("149 sticky has no connection", !connections["SECURITY — 50.2B READ FIRST"]);
record("150 no extra connection sources", Object.keys(connections).every((k) => [
  "Schedule Trigger — INACTIVE","Manual Trigger — Handshake Test","50.2B Runtime Preconditions","IF — Transport Configured",
  ...chain.map(([a]) => a),"IF — Core Response Verified","Parse Verified Claim — Routing Disabled"
].includes(k)));

// 151-160: Documentation/security operational boundary.
record("151 doc marks source candidate", doc.includes("**Status:** SOURCE CANDIDATE"));
record("152 doc pins exact base", doc.includes("a568d526461b3ac85c5245fcf5ccb97171f541bc"));
record("153 doc staging only", doc.includes("**Target:** staging handshake only"));
record("154 doc workflow activation none", doc.includes("**Workflow activation:** NONE"));
record("155 doc Meta WhatsApp none", doc.includes("**Meta / WhatsApp:** NONE"));
record("156 doc Supabase credential none", doc.includes("**Supabase credential in n8n:** NONE"));
record("157 doc warns Cloud not assumed", doc.includes("If the current n8n account is n8n Cloud, do not import this candidate"));
record("158 doc lists all five runtime env names", envNames.every((x) => doc.includes(x)));
record("159 doc states routing disabled even fresh claim", doc.includes("routingEnabled = false"));
record("160 doc says no deployment/import/activation side effects", doc.includes("does not:") && doc.includes("deploy QuickFurno") && doc.includes("create any n8n credential") && doc.includes("activate/publish any workflow"));

// 161-168: Contract regression against Core crypto implementation.
const fixture = {
  secret: "0123456789abcdef0123456789abcdef",
  path: "/api/internal/automation/n8n/claim",
  method: "POST",
  requestId: "11111111-1111-4111-8111-111111111111",
  timestamp: 1785561600,
  rawBody: '{"transportVersion":1,"requestId":"11111111-1111-4111-8111-111111111111","workerId":"qf-staging-n8n-01"}',
};
const fixtureHash = sha256Hex(fixture.rawBody);
const independentRequestCanonical = [
  "QF-AUTOMATION-TRANSPORT-V1",
  "N8N_TO_CORE",
  "POST",
  fixture.path,
  fixture.requestId,
  String(fixture.timestamp),
  fixtureHash,
].join("\n");
const independentRequestSig = `v1=${createHmac("sha256", fixture.secret).update(independentRequestCanonical, "utf8").digest("hex")}`;
const coreRequestSig = createN8nToCoreSignature({
  secret: fixture.secret,
  method: fixture.method,
  path: fixture.path,
  requestId: fixture.requestId,
  timestamp: fixture.timestamp,
  bodySha256: fixtureHash,
});
record("161 request test vector Core signature matches independent canonical", coreRequestSig === independentRequestSig);
record("162 fixture body hash lower hex 64", /^[0-9a-f]{64}$/.test(fixtureHash));
record("163 workflow request domain equals Core fixture domain", reqCanonicalCode.includes("QF-AUTOMATION-TRANSPORT-V1"));
record("164 workflow request direction equals Core fixture direction", reqCanonicalCode.includes("N8N_TO_CORE"));

const responseBody = '{"ok":true,"transportVersion":1,"requestId":"11111111-1111-4111-8111-111111111111","state":"empty","replayed":false,"executable":false}';
const responseHashFixture = sha256Hex(responseBody);
const independentResponseCanonical = [
  "QF-AUTOMATION-TRANSPORT-V1",
  "CORE_TO_N8N_RESPONSE",
  fixture.path,
  fixture.requestId,
  String(fixture.timestamp),
  responseHashFixture,
].join("\n");
const independentResponseSig = `v1=${createHmac("sha256", fixture.secret).update(independentResponseCanonical, "utf8").digest("hex")}`;
const coreResponseSig = createCoreToN8nResponseSignature({
  secret: fixture.secret,
  path: fixture.path,
  requestId: fixture.requestId,
  timestamp: fixture.timestamp,
  bodySha256: responseHashFixture,
});
record("165 response test vector Core signature matches independent canonical", coreResponseSig === independentResponseSig);
record("166 response fixture body hash lower hex 64", /^[0-9a-f]{64}$/.test(responseHashFixture));
record("167 workflow response domain equals Core fixture domain", respCanonicalCode.includes("QF-AUTOMATION-TRANSPORT-V1"));
record("168 workflow response direction equals Core fixture direction", respCanonicalCode.includes("CORE_TO_N8N_RESPONSE"));

// 169-176: final static leak / unsafe behavior checks.
record("169 no actual secret-shaped environment values embedded", !(workflowText.match(/[A-Za-z0-9+/_=-]{80,}/g) ?? []).some((v) => !v.includes("QF_50_2B")));
record("170 no production domain literal", !/quickfurno\.in/i.test(workflowText));
record("171 no localhost/internal fallback URL", !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(workflowText));
record("172 no blind retry vocabulary", !/retryOnFail|maxTries|waitBetweenTries|retry_anyway/i.test(workflowText));
record("173 no deletion/truncate SQL", !/\bdelete\s+from\b|\btruncate\b/i.test(executableText));
record("174 no raw SQL query node", !/executeQuery|queryRaw|sqlQuery/i.test(executableText));
record("175 no provider-side send node", !/sendMessage|sendTemplate|sendWhatsApp|communicationService/i.test(executableText));
record("176 final candidate remains handshake-only", workflow.active === false && http?.parameters?.method === "POST" && parseCode.includes("routingEnabled: false") && !nodes.some((n) => /executeWorkflow|facebook|whatsapp|supabase|postgres/i.test(n.type)));

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}`);
}
console.log("");
console.log(`QF-MVP-50.2B: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  process.exitCode = 1;
} else {
  console.log("QF_MVP_50_2B_SECURE_SIGNED_CLAIM_HANDSHAKE_CANDIDATE_READY");
}
