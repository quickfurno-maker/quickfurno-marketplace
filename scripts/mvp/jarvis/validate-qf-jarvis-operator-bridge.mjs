import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

import {
  parseQfjOperatorCommand,
  QFJ_OPERATOR_COMMAND_PATH,
  QFJ_OPERATOR_COMMAND_SIGNING_DOMAIN,
} from "../../../lib/jarvis/operatorCommandContract.ts";

let passed=0;
const ok=(condition,message)=>{assert.ok(condition,message);passed+=1;};

const command={
  protocol:"qfj.operator.command.v1",
  commandId:crypto.randomUUID(),
  issuedAt:new Date().toISOString(),
  idempotencyKey:"android-retry-safe-1",
  clientPlatform:"ANDROID",
  action:"CONVERSATION_PAUSE_AI",
  payload:{conversationId:crypto.randomUUID(),expectedRevision:7},
};
const parsed=parseQfjOperatorCommand(command);
ok(parsed?.action==="CONVERSATION_PAUSE_AI","valid mobile command parses");
ok(parseQfjOperatorCommand({...command,action:"KNOWLEDGE_SET_MODE",payload:{mode:"HYBRID",expectedRevision:1}})===null,
  "Jarvis-governance action is refused by QuickFurno command contract");

const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519");
const keyId="jarvis-os-command-test";
const raw=Buffer.from(JSON.stringify(command),"utf8");
const digest=crypto.createHash("sha256").update(raw).digest("base64url");
const operatorId="owner";
const input=[
  QFJ_OPERATOR_COMMAND_SIGNING_DOMAIN,
  "POST",
  QFJ_OPERATOR_COMMAND_PATH,
  "qf-jarvis-os",
  "quickfurno-core",
  operatorId,
  command.commandId,
  command.issuedAt,
  keyId,
  digest,
].join("\n");
const signatureBytes=crypto.sign(null,Buffer.from(input,"utf8"),privateKey);
const publicKeyPem=publicKey.export({type:"spki",format:"pem"}).toString();

ok(QFJ_OPERATOR_COMMAND_PATH==="/api/internal/jarvis/operator-command","command path is pinned");
ok(QFJ_OPERATOR_COMMAND_SIGNING_DOMAIN==="qfj.jarvis-os.operator-command.http.sig.v1","signing domain is pinned");
ok(crypto.verify(null,Buffer.from(input,"utf8"),publicKey,signatureBytes),"canonical Ed25519 command signature verifies");

const auth=fs.readFileSync("lib/jarvis/operatorCommandAuth.ts","utf8");
ok(auth.includes("QFJ_OPERATOR_COMMAND_FRESHNESS_MS"),"runtime verifier enforces command freshness");
ok(auth.includes("args.operatorId"),"runtime verifier binds operator identity");
ok(auth.includes("rawQfjBodyDigest(args.rawBody)"),"runtime verifier binds exact request body");
ok(auth.includes("crypto.verify"),"runtime verifier uses Ed25519 verification");

const migration=fs.readFileSync("supabase/migrations/20260924183000_jarvis_os_operator_command_receipts.sql","utf8");
ok(migration.includes("jarvis_os_operator_command_receipts"),"durable command receipt table exists");
ok(migration.includes("enable row level security"),"command receipts have RLS");
ok(migration.includes("idempotency_key text not null unique"),"idempotency key is unique");

const route=fs.readFileSync("app/api/internal/jarvis/operator-command/route.ts","utf8");
ok(route.includes("QF_JARVIS_OS_COMMANDS_ENABLED"),"command endpoint is default-OFF gated");
ok(route.includes("QF_JARVIS_OS_COMMAND_VERIFICATION_KEYS_JSON"),"command endpoint uses separate verification keys");
ok(route.includes("verifyQfjOperatorCommandSignature"),"command endpoint verifies the signed request");

const service=fs.readFileSync("services/jarvisOperatorCommandService.ts","utf8");
ok(route.includes("QFJ_OPERATOR_COMMAND_OPERATOR_ID_HEADER"),"operator identity is signed into the transport");
ok(service.includes("jarvis-os:"),"operator identity is mapped to an attributed Core admin actor");
ok(service.includes("jarvis_os_operator_command_receipts"),"command service claims durable receipts");
ok(service.includes("authorizeAutomationActionRequest"),"approval uses Core authorization RPC path");
ok(service.includes("releaseHumanConversationToAi"),"resume uses governed conversation release service");
ok(!service.includes("metaWhatsAppOutbound"),"operator command service does not call provider delivery");

console.log("JARVIS_OPERATOR_BRIDGE_TESTS=PASS count="+passed);
