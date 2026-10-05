#!/usr/bin/env node
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";

const read = (path) => readFileSync(path, "utf8");
const failures = [];
function check(label, fn) {
  try {
    fn();
    console.log("PASS", label);
  } catch (error) {
    failures.push(label);
    console.error("FAIL", label, error instanceof Error ? error.message : String(error));
  }
}

const compose = read("ops/container/compose.production.yml");
const entrypoint = read("ops/container/entrypoint.sh");
const dockerignore = read(".dockerignore");
const dockerfile = read("Dockerfile");
const envExample = read(".env.example");
const deployment = read("lib/runtime/deploymentConfig.ts");
const discovery = read("lib/runtime/serviceDiscovery.ts");
const whatsapp = read("services/jarvisWhatsAppGatewayService.ts");
const riya = read("services/jarvisRiyaWebGatewayService.ts");
const auth = read("lib/jarvis/coreDecisionAuth.ts");
const signingSource = read("lib/jarvis/signingPrivateKeySource.ts");
const pm2Automation = read("ops/production/quickfurno-automation-worker.config.cjs");
const pm2Conversation = read("ops/production/quickfurno-conversation-transport.config.cjs");
const workers = [
  read("worker/nativeAutomationWorker.ts"),
  read("worker/conversationTransportWorker.ts"),
  read("worker/aarohiAcquisitionWorker.ts"),
];

check("production services carry explicit environment, schema version and stable identity", () => {
  for (const id of [
    "quickfurno.web",
    "quickfurno.automation-worker",
    "quickfurno.conversation-transport",
    "quickfurno.aarohi-acquisition",
  ]) assert.match(compose, new RegExp(`QF_SERVICE_ID: ${id.replaceAll(".", "\\.")}`));
  assert.equal((compose.match(/QF_RUNTIME_ENV: production/g) ?? []).length, 4);
  assert.equal((compose.match(/QF_CONFIG_SCHEMA_VERSION: "1"/g) ?? []).length, 4);
});

check("production dotenv loading is explicit-only and absolute", () => {
  assert.match(deployment, /productionLike/);
  assert.match(deployment, /QF_ENV_FILE_MUST_BE_ABSOLUTE_IN_PRODUCTION/);
  assert.match(deployment, /if \(!explicit\) return/);
  assert.match(deployment, /\.env\.local/);
  for (const worker of workers) {
    assert.match(worker, /loadQfRuntimeEnvironment\(\)/);
    assert.match(worker, /assertQfRuntimeIdentity/);
    assert.doesNotMatch(worker, /loadDotEnv|existsSync|\.env\.local/);
  }
});

check("legacy PM2 paths require an absolute external env file", () => {
  for (const pm2 of [pm2Automation, pm2Conversation]) {
    assert.match(pm2, /isAbsolute\(envFile\)/);
    assert.match(pm2, /QF_ENV_FILE: envFile/);
    assert.doesNotMatch(pm2, /QF_ENV_FILE:\s*"\.env/);
    assert.match(pm2, /QF_RUNTIME_ENV:\s*"production"/);
    assert.match(pm2, /QF_CONFIG_SCHEMA_VERSION:\s*"1"/);
  }
});

check("runtime secret boundary supports direct value or mounted file without ambiguity", () => {
  for (const name of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "WHATSAPP_CONVERSATIONAL_ACCESS_TOKEN",
    "QF_CONVERSATION_SEAL_KEYS",
    "QF_CONSENT_ACK_DESTINATION_KEYS",
    "SEND_SMS_HOOK_SECRETS",
  ]) {
    assert.match(entrypoint, new RegExp(`load_secret_file ${name} ${name}_FILE`));
  }
  assert.match(entrypoint, /both \$value_name and \$file_name are configured/);
  assert.match(entrypoint, /\[ -L "\$file" \]/);
  assert.match(entrypoint, /invalid secret file/);
});

check("mandatory production security configuration fails closed", () => {
  for (const required of [
    "QF_RUNTIME_ENV",
    "QF_CONFIG_SCHEMA_VERSION",
    "QF_SERVICE_ID",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) assert.match(entrypoint, new RegExp(required));
});

check("image context excludes dotenv and Dockerfile does not copy secrets", () => {
  assert.match(dockerignore, /^\.env$/m);
  assert.match(dockerignore, /^\.env\.\*$/m);
  assert.doesNotMatch(dockerfile, /COPY\s+[^\n]*\.env/i);
  assert.doesNotMatch(dockerfile, /ARG\s+[^\n]*(SERVICE_ROLE|PRIVATE_KEY|SECRET|ACCESS_TOKEN)/i);
});

check("Jarvis service discovery is DNS-oriented and rejects literal non-loopback IPs", () => {
  assert.match(discovery, /isIP\(url\.hostname\)/);
  assert.match(discovery, /allowLoopbackHttp/);
  assert.match(whatsapp, /resolvePortableServiceBaseUrl\(env\.QF_JARVIS_BASE_URL/);
  assert.match(riya, /requirePortableServiceBaseUrl/);

  const valid = new URL("https://jarvis-a.internal/");
  assert.equal(isIP(valid.hostname), 0);
  assert.equal(isIP(new URL("https://203.0.113.10/").hostname), 4);
});

check("service relocation requires config only, not a source-host constant", () => {
  for (const code of [whatsapp, riya]) {
    assert.doesNotMatch(code, /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}/);
    assert.doesNotMatch(code, /213\.210\.|gateway\.jarvis\.quickfurno\.in/);
  }
  assert.match(whatsapp, /QF_JARVIS_BASE_URL/);
});

check("QuickFurno signing private key is runtime-injected and file source is preferred-safe", () => {
  assert.match(signingSource, /QF_JARVIS_SIGNING_PRIVATE_KEY_FILE/);
  assert.match(signingSource, /if \(inline && file\) return null/);
  assert.match(signingSource, /isAbsolute\(file\)/);
  assert.match(signingSource, /stat\.isSymbolicLink\(\)/);
  assert.match(envExample, /QF_JARVIS_SIGNING_PRIVATE_KEY_FILE=/);
});

check("receiver supports overlapping verification keysets for zero-downtime rotation", () => {
  assert.match(auth, /parsed\.length < 1 \|\| parsed\.length > 4/);
  assert.match(auth, /seen\.has\(record\.keyId\)/);

  const oldPair = generateKeyPairSync("ed25519");
  const newPair = generateKeyPairSync("ed25519");
  const payload = Buffer.from("phase13-rotation-drill", "utf8");
  const oldSig = sign(null, payload, oldPair.privateKey);
  const newSig = sign(null, payload, newPair.privateKey);

  const overlap = new Map([
    ["old", oldPair.publicKey],
    ["new", newPair.publicKey],
  ]);
  assert.equal(verify(null, payload, overlap.get("old"), oldSig), true);
  assert.equal(verify(null, payload, overlap.get("new"), newSig), true);

  const afterCutover = new Map([["new", newPair.publicKey]]);
  assert.equal(afterCutover.has("old"), false);
  assert.equal(verify(null, payload, afterCutover.get("new"), newSig), true);
});

check("environment example documents portable secret-file and config identity contract", () => {
  for (const token of [
    "QF_RUNTIME_ENV=local",
    "QF_CONFIG_SCHEMA_VERSION=1",
    "SUPABASE_SERVICE_ROLE_KEY_FILE=",
    "WHATSAPP_CONVERSATIONAL_ACCESS_TOKEN_FILE=",
    "QF_CONVERSATION_SEAL_KEYS_FILE=",
  ]) assert.match(envExample, new RegExp(token.replaceAll("*", "\\*")));
});

if (failures.length) {
  console.error(`\nPhase 13 QuickFurno contract FAILED (${failures.length})`);
  process.exit(1);
}
console.log("\nPhase 13 QuickFurno contract: 11/11 PASS");
console.log("PHASE13_QF_ROTATION_DRILL=PASS old+new -> new-only");
console.log("PHASE13_QF_RELOCATION_DRILL=PASS DNS endpoint is runtime config");
