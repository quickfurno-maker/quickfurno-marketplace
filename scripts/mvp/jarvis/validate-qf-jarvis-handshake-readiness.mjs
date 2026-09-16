import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  QFJ_HANDSHAKE_PATH,
  QFJ_HANDSHAKE_SIGNING_DOMAIN,
  parseQfjHandshakeRequest,
} from "../../../lib/jarvis/handshakeContract.ts";
import { resolveQfJarvisOutboundConfig } from "../../../lib/jarvis/outboundConfig.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`PASS ${name}`); } else { failed++; console.error(`FAIL ${name}`); } };
const now = new Date().toISOString();
const request = { protocol:"qfj.handshake", version:1, caller:"qf-jarvis", audience:"quickfurno-core", requestId:"handshake-1", issuedAt:now, jarvisInstanceId:"jarvis-prod-1" };

check("01 handshake path fixed", QFJ_HANDSHAKE_PATH === "/api/internal/jarvis/handshake");
check("02 handshake signing domain versioned", QFJ_HANDSHAKE_SIGNING_DOMAIN === "qfj.handshake.http.sig.v1");
check("03 valid handshake parses", parseQfjHandshakeRequest(request)?.jarvisInstanceId === "jarvis-prod-1");
check("04 unknown handshake key refused", parseQfjHandshakeRequest({ ...request, extra:true }) === null);
check("05 wrong audience refused", parseQfjHandshakeRequest({ ...request, audience:"other" }) === null);
const { privateKey } = crypto.generateKeyPairSync("ed25519");
const privateKeyPem = privateKey.export({ type:"pkcs8", format:"pem" }).toString();
check("06 outbound config defaults absent", resolveQfJarvisOutboundConfig({}).reason === "not_configured");
check("07 partial outbound config fails closed", resolveQfJarvisOutboundConfig({ QF_JARVIS_BASE_URL:"https://jarvis.example/" }).reason === "invalid_config");
check("08 plaintext public Jarvis URL refused", resolveQfJarvisOutboundConfig({ QF_JARVIS_BASE_URL:"http://jarvis.example/", QF_JARVIS_SIGNING_KEY_ID:"qf-prod-1", QF_JARVIS_SIGNING_PRIVATE_KEY_PEM:privateKeyPem }).reason === "invalid_config");
const configured = resolveQfJarvisOutboundConfig({ QF_JARVIS_BASE_URL:"https://jarvis.example/", QF_JARVIS_SIGNING_KEY_ID:"qf-prod-1", QF_JARVIS_SIGNING_PRIVATE_KEY_PEM:privateKeyPem });
check("09 complete Ed25519 outbound config accepted", configured.ok && configured.config.timeoutMs === 5000);

const route = fs.readFileSync(path.join(root,"app/api/internal/jarvis/handshake/route.ts"),"utf8");
const adapter = fs.readFileSync(path.join(root,"services/jarvisRiyaConfiguredGatewayService.ts"),"utf8");
const coreRoute = fs.readFileSync(path.join(root,"app/api/internal/jarvis/core-decision/route.ts"),"utf8");
const authorizer = fs.readFileSync(path.join(root,"services/jarvisProductionCoreAuthorizer.ts"),"utf8");
const replay = fs.readFileSync(path.join(root,"services/jarvisCoreDecisionReplayService.ts"),"utf8");
const migration = fs.readFileSync(path.join(root,"supabase/migrations/20260916070000_qf_jarvis_core_decision_replay.sql"),"utf8");
check("10 handshake route requires signed Jarvis auth", route.includes("verifyQfjSignedRequestSignature") && route.includes("QF_JARVIS_CORE_VERIFICATION_KEYS_JSON"));
check("11 handshake returns no secrets", !/PRIVATE_KEY|SERVICE_ROLE|ACCESS_TOKEN|SUPABASE_SERVICE/i.test(route));
check("12 handshake is no-store", route.includes('"cache-control": "no-store"'));
check("13 outbound adapter honors web-turn kill switch", adapter.includes("riyaWebTurnEnabled"));
check("14 outbound adapter uses validated config only", adapter.includes("resolveQfJarvisOutboundConfig"));
check("15 outbound adapter delegates to signed gateway", adapter.includes("sendRiyaWebTurn"));
check("16 core-decision route uses durable replay service", coreRoute.includes("decideJarvisCoreCommandWithReplay"));
check("17 production authorizer accepts NO_ACTION only", authorizer.includes('proposalKind === "NO_ACTION"') && authorizer.includes('reply_authority_not_activated') && !/proposalKind === "REPLY"[\s\S]{0,160}ACCEPTED/.test(authorizer));
check("18 replay ledger command id is primary key", /command_id text primary key/.test(migration));
check("19 replay ledger idempotency key is unique", /idempotency_key text not null unique/.test(migration));
check("20 replay ledger has RLS and service-role-only grants", /enable row level security/.test(migration) && /grant select, insert, update[\s\S]*to service_role/.test(migration));
check("21 replay service refuses identity conflicts", replay.includes('reason: "conflict"') && replay.includes("sameCommand"));
check("22 replay service returns stored completed response", replay.includes('replayed: true') && replay.includes('state === "completed"'));
console.log(`RESULT ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
