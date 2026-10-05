import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const worker = read("worker/conversationTransportWorker.ts");
const pm2 = read("ops/production/quickfurno-conversation-transport.config.cjs");
const pkg = JSON.parse(read("package.json"));

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
    console.log("PASS", name);
  } catch (error) {
    checks.push({ name, ok: false });
    console.error("FAIL", name, error instanceof Error ? error.message : String(error));
  }
}

check("dedicated worker owns only conversational transport services", () => {
  assert.match(worker, /jarvisWhatsAppGatewayService/);
  assert.match(worker, /conversationalWhatsAppService/);
  assert.doesNotMatch(worker, /nativeAutomationEngineService|automationStudioService/);
});

check("worker drains both Jarvis turns and WhatsApp reply outbox", () => {
  assert.match(worker, /dispatchNextJarvisWhatsAppTurn/);
  assert.match(worker, /dispatchNextConversationalOutbox/);
  assert.match(worker, /maxDrain/);
});

check("idle transport is event-driven with bounded database fallback", () => {
  assert.match(worker, /waitForDurableWorkWakeup/);
  assert.match(worker, /TRANSPORT_LANES = \["provider-outbound", "jarvis-ingress"\]/);
  assert.match(worker, /QF_CONVERSATION_TRANSPORT_LANES/);
  assert.match(worker, /"conversation-outbox"/);
  assert.match(worker, /"jarvis-turn-outbox"/);
  assert.match(worker, /topics: wakeTopics/);
  assert.match(worker, /QF_CONVERSATION_TRANSPORT_IDLE_POLL_MS/);
  assert.match(worker, /1000,\s*250,\s*5000/);
  assert.match(worker, /QF_CONVERSATION_TRANSPORT_BUSY_POLL_MS/);
  assert.match(worker, /25,\s*10,\s*500/);
  assert.match(worker, /wake\.status === "unavailable"/);
});

check("PM2 keeps exactly one dedicated autorestarting worker", () => {
  assert.match(pm2, /quickfurno-conversation-transport/);
  assert.match(pm2, /instances:\s*1/);
  assert.match(pm2, /autorestart:\s*true/);
  assert.match(pm2, /isAbsolute\(envFile\)/);
  assert.match(pm2, /QF_ENV_FILE:\s*envFile/);
  assert.match(pm2, /QF_RUNTIME_ENV:\s*"production"/);
  assert.match(pm2, /QF_CONFIG_SCHEMA_VERSION:\s*"1"/);
  assert.match(pm2, /QF_SERVICE_ID:\s*"quickfurno\.conversation-transport"/);
  assert.doesNotMatch(pm2, /QF_ENV_FILE:\s*"\.env(?:\.local|\.production)?"/);
  assert.match(pm2, /QF_CONVERSATION_TRANSPORT_IDLE_POLL_MS:\s*"1000"/);
  assert.match(pm2, /QF_CONVERSATION_TRANSPORT_BUSY_POLL_MS:\s*"25"/);
});

check("worker preserves Core authority rather than sending Meta directly", () => {
  assert.doesNotMatch(worker, /MetaCloudWhatsAppProvider|graph\.facebook\.com|WHATSAPP_ACCESS_TOKEN/);
  assert.doesNotMatch(worker, /communication_conversations|communication_conversation_outbox/);
});

check("package exposes build and runtime commands", () => {
  assert.equal(typeof pkg.scripts["build:conversation-transport"], "string");
  assert.equal(typeof pkg.scripts["start:conversation-transport"], "string");
  assert.match(pkg.scripts["build:conversation-transport"], /conversationTransportWorker\.ts/);
});

const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error("\nConversation fast-path failed.");
  process.exit(1);
}

console.log("\nConversation fast-path: all checks passed.");
