import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = JSON.parse(readFileSync(new URL("../../contracts/qfj-scale-contract-v1.json", import.meta.url), "utf8"));
const scale = readFileSync(new URL("../../lib/jarvis/scaleContract.ts", import.meta.url), "utf8");
const isolation = readFileSync(new URL("../../lib/jarvis/scaleIsolation.ts", import.meta.url), "utf8");
const transport = readFileSync(new URL("../../services/jarvisScaleTransport.ts", import.meta.url), "utf8");
const riya = readFileSync(new URL("../../services/jarvisRiyaWebGatewayService.ts", import.meta.url), "utf8");
const whatsapp = readFileSync(new URL("../../services/jarvisWhatsAppGatewayService.ts", import.meta.url), "utf8");
const signedAuth = readFileSync(new URL("../../lib/jarvis/signedRequestAuth.ts", import.meta.url), "utf8");
const coreDecisionRoute = readFileSync(new URL("../../app/api/internal/jarvis/core-decision/route.ts", import.meta.url), "utf8");
const operatorSnapshotRoute = readFileSync(new URL("../../app/api/internal/jarvis/operator-snapshot/route.ts", import.meta.url), "utf8");
const operatorCommandRoute = readFileSync(new URL("../../app/api/internal/jarvis/operator-command/route.ts", import.meta.url), "utf8");
const sharedScaleRoutes = [
  "aarohi-phase2",
  "aarohi-projection",
  "aarohi-runtime-context",
  "action-request",
  "context",
  "service-availability",
  "whatsapp-conversation-context",
  "whatsapp-media-content",
  "whatsapp-reply",
  "whatsapp-turn-material",
].map((name) => ({
  name,
  code: readFileSync(
    new URL(`../../app/api/internal/jarvis/${name}/route.ts`, import.meta.url),
    "utf8",
  ),
}));

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push([name, true]);
  } catch (error) {
    checks.push([name, false, error]);
  }
}

check("canonical contract identity and coexistence window are locked", () => {
  assert.equal(contract.protocol, "qfj.scale.http");
  assert.equal(contract.version, 1);
  assert.deepEqual(contract.acceptedVersions, [0, 1]);
  assert.equal(contract.legacyRemovalNotBefore, "2027-01-05T00:00:00Z");
});

check("all required request metadata headers exist", () => {
  const required = ["version","requestId","idempotencyKey","correlationId","traceId","actor","expectedRevision","deadlineAt","signature","keyId"];
  for (const name of required) assert.equal(typeof contract.requestHeaders[name], "string", name);
});

check("canonical error and retryability map is complete", () => {
  for (const key of ["QFJ_NONE","QFJ_CONTRACT_INVALID","QFJ_AUTHENTICATION_FAILED","QFJ_DEADLINE_EXCEEDED","QFJ_BACKPRESSURE","QFJ_CIRCUIT_OPEN","QFJ_UPSTREAM_TIMEOUT","QFJ_UPSTREAM_UNAVAILABLE","QFJ_REMOTE_REFUSED","QFJ_CONFLICT","QFJ_INVALID_RESPONSE","QFJ_INTERNAL_ERROR"]) {
    assert.equal(typeof contract.errors[key], "boolean", key);
  }
});

check("resilience budget is bounded and has zero inline queue/retry", () => {
  assert.equal(contract.resilience.maxConcurrentPerProcess, 8);
  assert.equal(contract.resilience.maxQueued, 0);
  assert.equal(contract.resilience.maxSocketsPerOrigin, 8);
  assert.equal(contract.resilience.maxFreeSocketsPerOrigin, 2);
  assert.equal(contract.resilience.inlineRetries, 0);
  assert.ok(contract.resilience.defaultTimeoutMs <= 2500);
  assert.ok(contract.resilience.maxTimeoutMs <= 5000);
});

check("scale metadata is independently Ed25519 signed", () => {
  assert.match(scale, /QFJ_SCALE_SIGNING_DOMAIN/);
  assert.match(scale, /qfjScaleSigningInput/);
  assert.match(scale, /crypto[\s\S]*?\.sign\(/);
  assert.match(scale, /crypto[\s\S]*?\.verify\(/);
  assert.match(scale, /bodyDigest/);
  assert.match(scale, /expectedRevision/);
  assert.match(scale, /deadlineAt/);
});

check("QuickFurno isolation is fail-fast and queue-free", () => {
  assert.match(isolation, /maxConcurrent/);
  assert.match(isolation, /QFJ_BACKPRESSURE/);
  assert.match(isolation, /QFJ_CIRCUIT_OPEN/);
  assert.match(isolation, /breakerFailureThreshold/);
  assert.doesNotMatch(isolation, /queue\.push|pendingQueue|waiters/i);
});

check("dedicated keep-alive socket pools are bounded and plaintext is loopback-only", () => {
  assert.match(transport, /new https\.Agent/);
  assert.match(transport, /new http\.Agent/);
  assert.match(transport, /maxSockets: QFJ_SCALE_DEFAULTS\.maxSockets/);
  assert.match(transport, /maxTotalSockets: QFJ_SCALE_DEFAULTS\.maxSockets/);
  assert.match(transport, /maxFreeSockets: QFJ_SCALE_DEFAULTS\.maxFreeSockets/);
  assert.match(transport, /function protocolAllowed/);
  assert.match(transport, /url\.protocol === "https:"/);
  assert.match(transport, /url\.hostname === "127\.0\.0\.1"/);
  assert.match(transport, /QFJ_CONTRACT_INVALID/);
});

check("transport does not consume QuickFurno DB capacity or retry inline", () => {
  assert.doesNotMatch(transport, /supabase|adminClient|postgres|pg\b/i);
  assert.doesNotMatch(transport, /queue\.push|pendingQueue|retry\s*\(/i);
});

check("Riya web ingress uses the shared scale transport", () => {
  assert.match(riya, /postJarvisScale/);
  assert.match(riya, /actor: "RIYA"/);
  assert.match(riya, /idempotencyKey: args\.requestId/);
});

check("WhatsApp turns use scale transport with actor + expected revision", () => {
  assert.match(whatsapp, /postJarvisScale/);
  assert.match(whatsapp, /actor: turn\.assignedActor/);
  assert.match(whatsapp, /idempotencyKey: turn\.inboundMessageId/);
  assert.match(whatsapp, /expectedRevision: turn\.conversationRevision/);
});

check("shared signed-request verifier enforces scale V1 when present", () => {
  assert.match(signedAuth, /verifyQfjScaleRequest/);
  assert.match(signedAuth, /allowLegacy: true/);
  for (const route of sharedScaleRoutes) {
    assert.match(route.code, /requestHeaders:\s*request\.headers/, route.name);
  }
});

check("all three specialized Core routes enforce the scale envelope", () => {
  for (const [name, code] of [
    ["core-decision", coreDecisionRoute],
    ["operator-snapshot", operatorSnapshotRoute],
    ["operator-command", operatorCommandRoute],
  ]) {
    assert.match(code, /verifyQfjScaleWebRequest/, name);
    assert.match(code, /allowLegacy:\s*true/, name);
  }
});

check("all 13 Jarvis-to-Core internal routes are covered", () => {
  assert.equal(sharedScaleRoutes.length + 3, 13);
});

const failed = checks.filter((entry) => !entry[1]);
for (const entry of checks) {
  const name = entry[0];
  const ok = entry[1];
  console.log((ok ? "PASS " : "FAIL ") + name);
  if (!ok) console.error(entry[2]);
}
if (failed.length) {
  console.error("Phase 11 contract validation failed: " + failed.length + "/" + checks.length);
  process.exit(1);
}
console.log("PHASE11_CONTRACT=PASS checks=" + checks.length);
