import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { QFJ_CONTEXT_PATH, QFJ_CONTEXT_SIGNING_DOMAIN, parseQfjContextReadRequest } from "../../../lib/jarvis/contextContract.ts";
import { QFJ_ACTION_REQUEST_PATH, QFJ_ACTION_REQUEST_SIGNING_DOMAIN, parseQfjActionRequest } from "../../../lib/jarvis/actionRequestContract.ts";
import { qfjSignedRequestSigningInput, verifyQfjSignedRequestSignature } from "../../../lib/jarvis/signedRequestAuth.ts";
import { parseQfjVerificationKeys, rawQfjBodyDigest } from "../../../lib/jarvis/coreDecisionAuth.ts";
import { resolveQfJarvisRuntimePolicy, isQfJarvisActionTypeEnabled } from "../../../lib/jarvis/runtimePolicy.ts";
import { readJarvisSanitizedContextFromSource } from "../../../lib/jarvis/contextRead.ts";
import { submitJarvisRecommendationToStore } from "../../../lib/jarvis/recommendationIntake.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let passed = 0, failed = 0;
const check = (name, ok) => { if (ok) { passed++; console.log(`PASS ${name}`); } else { failed++; console.error(`FAIL ${name}`); } };
const now = "2026-09-15T06:30:00.000Z";
const keys = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" });
const keyId = "qfj-phase60-test";
const ring = parseQfjVerificationKeys(JSON.stringify([{ keyId, publicKeyPem }]));

const leadReq = { protocol:"qfj.context.read", version:1, caller:"qf-jarvis", audience:"quickfurno-core", requestId:"ctx-1", issuedAt:now, actor:"RIYA", entityType:"lead", entityId:"11111111-1111-1111-1111-111111111111" };
const vendorReq = { ...leadReq, requestId:"ctx-2", actor:"ANISHA", entityType:"vendor", entityId:"22222222-2222-2222-2222-222222222222" };
check("45 context route identity is fixed", QFJ_CONTEXT_PATH === "/api/internal/jarvis/context" && QFJ_CONTEXT_SIGNING_DOMAIN === "qfj.context.read.http.sig.v1");
check("46 Riya lead context request parses", parseQfjContextReadRequest(leadReq)?.entityType === "lead");
check("47 Riya vendor scope is refused", parseQfjContextReadRequest({ ...leadReq, entityType:"vendor" }) === null);
check("48 Anisha vendor context request parses", parseQfjContextReadRequest(vendorReq)?.actor === "ANISHA");
check("49 Anisha lead scope is refused", parseQfjContextReadRequest({ ...vendorReq, entityType:"lead" }) === null);
check("50 context request rejects unknown keys", parseQfjContextReadRequest({ ...leadReq, phone:"forbidden" }) === null);

const ctxBody = Buffer.from(JSON.stringify(leadReq), "utf8");
const ctxInput = qfjSignedRequestSigningInput({ domain:QFJ_CONTEXT_SIGNING_DOMAIN, path:QFJ_CONTEXT_PATH, requestId:leadReq.requestId, issuedAt:leadReq.issuedAt, keyId, bodyDigest:rawQfjBodyDigest(ctxBody) });
const ctxSig = crypto.sign(null, Buffer.from(ctxInput,"utf8"), keys.privateKey).toString("base64url");
check("51 context signature verifies", ring !== null && verifyQfjSignedRequestSignature({ rawBody:ctxBody, domain:QFJ_CONTEXT_SIGNING_DOMAIN, path:QFJ_CONTEXT_PATH, requestId:leadReq.requestId, issuedAt:leadReq.issuedAt, keyId, signature:ctxSig, keys:ring, now }));
check("52 context signature cannot replay on action path", ring !== null && !verifyQfjSignedRequestSignature({ rawBody:ctxBody, domain:QFJ_ACTION_REQUEST_SIGNING_DOMAIN, path:QFJ_ACTION_REQUEST_PATH, requestId:leadReq.requestId, issuedAt:leadReq.issuedAt, keyId, signature:ctxSig, keys:ring, now }));

let contextCalls = 0;
const off = resolveQfJarvisRuntimePolicy({});
const leadSource = { readLead: async () => { contextCalls++; return { city:"Pune", service_required:"2 BHK", budget:"4-8L", property_type:"Apartment", timeline:"1-3 months", status:"New", verification_status:"Verified", is_duplicate:false, phone:"should-never-escape", message:"private" }; }, readVendor: async () => null };
const offCtx = await readJarvisSanitizedContextFromSource({ request:parseQfjContextReadRequest(leadReq), policy:off, source:leadSource });
check("53 context OFF means zero database/source calls", !offCtx.ok && offCtx.reason === "disabled" && contextCalls === 0);
const ctxPolicy = resolveQfJarvisRuntimePolicy({ QF_JARVIS_MODE:"shadow", QF_JARVIS_CONTEXT_READ_ENABLED:"true", QF_JARVIS_RIYA_ENABLED:"true", QF_JARVIS_ANISHA_ENABLED:"true" });
const leadCtx = await readJarvisSanitizedContextFromSource({ request:parseQfjContextReadRequest(leadReq), policy:ctxPolicy, source:leadSource });
check("54 Riya receives bounded lead projection", leadCtx.ok && leadCtx.context.kind === "client_lead" && leadCtx.context.serviceRequired === "2 BHK" && leadCtx.context.budgetBand === "4-8L");
check("55 lead context strips name phone email message and location precision", leadCtx.ok && !/["']?(phone|name|email|message|latitude|longitude|formatted_address)["']?/i.test(JSON.stringify(leadCtx.context)));
const vendorSource = { readLead: async () => null, readVendor: async () => ({ city:"Pune", service_categories:["Interiors","Carpentry"], status:"Approved", remaining_credits:2, is_active:true, public_visibility:true, paid_status:"paid", package_status:"active", phone:"never" }) };
const vendorCtx = await readJarvisSanitizedContextFromSource({ request:parseQfjContextReadRequest(vendorReq), policy:ctxPolicy, source:vendorSource });
check("56 Anisha receives bounded vendor projection", vendorCtx.ok && vendorCtx.context.kind === "vendor_profile" && vendorCtx.context.packageReadinessBand === "LOW_CREDITS");
check("57 vendor context exposes a band not an exact credit balance", vendorCtx.ok && !JSON.stringify(vendorCtx.context).includes("remaining_credits") && !JSON.stringify(vendorCtx.context).includes('"2"'));

const actionReq = { protocol:"qfj.action.request", version:1, caller:"qf-jarvis", audience:"quickfurno-core", requestId:"33333333-3333-4333-8333-333333333333", issuedAt:now, source:"riya", actionType:"client.requirement_collection", entityType:"lead", entityId:"11111111-1111-1111-1111-111111111111", evidenceId:"conversation.turn.17", reasonCode:"client_details_incomplete", confidence:0.91, safeContext:{ phase:"DISCOVERY", missingCount:2 } };
check("58 action-request path/domain are versioned", QFJ_ACTION_REQUEST_PATH === "/api/internal/jarvis/action-request" && QFJ_ACTION_REQUEST_SIGNING_DOMAIN === "qfj.action.request.http.sig.v1");
check("59 Riya recommendation request parses", parseQfjActionRequest(actionReq)?.source === "riya");
check("60 Riya cannot recommend vendor automation", parseQfjActionRequest({ ...actionReq, actionType:"vendor.onboarding_reminder", entityType:"vendor" }) === null);
check("61 Anisha cannot recommend client automation", parseQfjActionRequest({ ...actionReq, source:"anisha" }) === null);
check("62 campaign execution is never agent-recommendable", parseQfjActionRequest({ ...actionReq, source:"jarvis", actionType:"campaign.execute_batch", entityType:"vendor" }) === null);
check("63 vendor lead offer is never agent-recommendable", parseQfjActionRequest({ ...actionReq, source:"anisha", actionType:"vendor.lead_offer", entityType:"vendor" }) === null);
check("64 bounded connection-assurance action remains Core-only", parseQfjActionRequest({ ...actionReq, actionType:"client.transactional_followup" }) === null);
check("65 forbidden safe-context authority fields are refused", parseQfjActionRequest({ ...actionReq, safeContext:{ ignoreConsent:true } }) === null);
check("66 phone-shaped authority key is refused", parseQfjActionRequest({ ...actionReq, safeContext:{ phone:"9999999999" } }) === null);

const shadowPolicy = resolveQfJarvisRuntimePolicy({ QF_JARVIS_MODE:"shadow", QF_JARVIS_RIYA_ENABLED:"true", QF_JARVIS_RECOMMENDATION_INTAKE_ENABLED:"true", QF_JARVIS_ACTION_PROPOSALS_ENABLED:"true", QF_JARVIS_ENABLED_ACTION_TYPES:"client.requirement_collection" });
const activePolicy = resolveQfJarvisRuntimePolicy({ QF_JARVIS_MODE:"active", QF_JARVIS_RIYA_ENABLED:"true", QF_JARVIS_RECOMMENDATION_INTAKE_ENABLED:"true", QF_JARVIS_ACTION_PROPOSALS_ENABLED:"true", QF_JARVIS_ENABLED_ACTION_TYPES:"client.requirement_collection" });
const invalidAllowlist = resolveQfJarvisRuntimePolicy({ QF_JARVIS_MODE:"active", QF_JARVIS_ACTION_PROPOSALS_ENABLED:"true", QF_JARVIS_ENABLED_ACTION_TYPES:"client.requirement_collection,campaign.execute_batch" });
check("67 action proposal allowlist defaults empty", off.enabledActionTypes.length === 0 && off.actionProposalEnabled === false);
check("68 invalid allowlist fails closed to empty", invalidAllowlist.enabledActionTypes.length === 0);
check("69 shadow can never mark an action type enabled for promotion", !isQfJarvisActionTypeEnabled(shadowPolicy,"client.requirement_collection"));
check("70 active requires both exact type and proposal switch", isQfJarvisActionTypeEnabled(activePolicy,"client.requirement_collection") && !isQfJarvisActionTypeEnabled(activePolicy,"client.matching_update"));

let saves = 0; let observedState = null;
const fakeStore = { save: async ({ actionState }) => { saves++; observedState = actionState; return { recommendationId:"rec-1", actionState, runId:actionReq.requestId }; } };
const shadowSaved = await submitJarvisRecommendationToStore({ request:parseQfjActionRequest(actionReq), policy:shadowPolicy, store:fakeStore });
check("71 shadow persists recommendation as advisory-only", shadowSaved.ok && observedState === "advisory_only" && saves === 1);
const activeSaved = await submitJarvisRecommendationToStore({ request:parseQfjActionRequest(actionReq), policy:activePolicy, store:fakeStore });
check("72 active allowlisted recommendation may become proposable only", activeSaved.ok && observedState === "proposable" && activeSaved.recommendation.actionState === "proposable");
const pausedPolicy = resolveQfJarvisRuntimePolicy({ QF_JARVIS_MODE:"active", QF_JARVIS_RECOMMENDATION_INTAKE_ENABLED:"true", QF_JARVIS_ACTION_PROPOSALS_ENABLED:"true", QF_JARVIS_ENABLED_ACTION_TYPES:"client.requirement_collection" });
const beforePaused=saves; const paused = await submitJarvisRecommendationToStore({ request:parseQfjActionRequest(actionReq), policy:pausedPolicy, store:fakeStore });
check("73 Riya kill switch blocks intake before persistence", !paused.ok && paused.reason === "agent_paused" && saves === beforePaused);

const actionRoute = fs.readFileSync(path.join(root,"app/api/internal/jarvis/action-request/route.ts"),"utf8");
const contextRoute = fs.readFileSync(path.join(root,"app/api/internal/jarvis/context/route.ts"),"utf8");
const recommendationService = fs.readFileSync(path.join(root,"services/jarvisRecommendationService.ts"),"utf8");
const contextService = fs.readFileSync(path.join(root,"services/jarvisContextService.ts"),"utf8");
const scopeLock = fs.readFileSync(path.join(root,"supabase/migrations/20260912050000_qf_lead_generation_scope_lock.sql"),"utf8");
check("74 Jarvis route cannot call automation producer or authorizer", !/createAutomationActionRequest|authorizeAutomationActionRequest|createAutomationJob/.test(actionRoute));
check("75 agent recommendation persistence uses advisory ledger", /aos_recommendations/.test(recommendationService) && /aos_runs/.test(recommendationService));
check("76 promotion uses Core/system provenance, never agent source", /const request:CoreActionRequest=\{[^\n]*source:"system"[^\n]*requestedBy:\{ actorType:"system", actorId:"qf-jarvis-proposal-bridge" \}/.test(recommendationService));
check("77 promotion creates only a pending request, not authorization/job", !/authorizeAutomationActionRequest|createAutomationJob/.test(recommendationService));
check("78 final DB scope lock still excludes Jarvis/Riya/Anisha new automation writes", /source in \('core', 'admin', 'system'\)/.test(scopeLock) && /historical provenance values/.test(scopeLock));
check("79 context DB query excludes direct PII/free-text columns", !/\.select\([^\n]*(phone|email|owner_name|business_name|message|latitude|longitude|formatted_address)/i.test(contextService));
check("80 both new routes require signed Jarvis authentication", /verifyQfjSignedRequestSignature/.test(actionRoute) && /verifyQfjSignedRequestSignature/.test(contextRoute));
check("81 action route response explicitly grants no authority", /authorized:\s*false/.test(actionRoute) && /automationRequestId:\s*null/.test(actionRoute) && /jobCreated:\s*false/.test(actionRoute));
check("82 no provider/n8n credential path enters the Phase-60 routes", !/GROQ_API_KEY|NARA_API_KEY|META_ACCESS_TOKEN|WHATSAPP_TOKEN|n8n/i.test(`${actionRoute}\n${contextRoute}`));

console.log(`RESULT ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
