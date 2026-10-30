/** RC4 Track A: CORE_CONVERSATION two-phase authorization (#444). SOURCE ONLY.
 * Consent truth stays in TypeScript Core (D2-C via authorizeConversationalWhatsAppConsent).
 * This module never reads consent tables, never sends, and cannot lift the SQL CHECK
 * vox_ab7b_core_conversation_blocked. Commit is gated by RC4_CONVERSATION_GATE, which is
 * hard-off: with it off, no transaction is even opened.
 *
 * Phase 1 (prepare, outside tx): derive the actor from the server session, read the Core
 *   conversation, ask the injected consent authority, read the consent-ledger fence, and mint
 *   a frozen, module-registered, digest-bound, short-TTL decision.
 * Phase 2 (commit, inside ONE tx): fixed lock order, re-verify actor + conversation + fence
 *   under locks, consume the nonce, write the source row, then commit. Any deviation rolls back.
 *
 * The fence is NOT a consent decision. It is an opaque version of the consent ledger for one
 * (destination_hash, channel); equality only proves "no consent event arrived since Phase 1".
 * It closes the TOCTOU window only if consent writers serialize on the same destination lock
 * (tx.lockConsentDestination). That writer-side change is outside this track, so
 * consentWritersSerialized stays false and the gate stays closed.
 */
import {createHash} from "node:crypto";
import {CORE_CONVERSATION_BINDING} from "./ab7kCoreConversationConsentBinding.mjs";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64=/^[0-9a-f]{64}$/;
const VERSION=/^[A-Za-z0-9._:-]{1,64}$/;
const ACTIONS=Object.freeze(["PAUSE_AI","TAKEOVER"]);
const REQUEST_KEYS="action|conversationId|nonce|revision";
export const RC4_DECISION_SCHEMA="qf.vox.rc4.conversation-decision.v1";
export const RC4_DECISION_TTL_MS=60e3;

/** Hard-off. Opening requires BOTH fields true, which needs a reviewed code change. */
export const RC4_CONVERSATION_GATE=Object.freeze({
 bindingSignedOff:false,
 consentWritersSerialized:false
});
const gateOpen=g=>!!g&&g.bindingSignedOff===true&&g.consentWritersSerialized===true;

export const RC4_DENY_REASONS=Object.freeze([
 "GATE_CLOSED","REQUEST_SHAPE_INVALID","STAFF_NOT_CURRENT","STAFF_ROLE_OR_DEPARTMENT_MISMATCH",
 "STAFF_AAL2_REQUIRED","OBJECT_GRANT_MISSING","CONVERSATION_NOT_FOUND_OR_FORGED",
 "CONVERSATION_STALE_OR_INELIGIBLE","CHANNEL_UNSUPPORTED","TEAM_OR_CITY_MISMATCH",
 "CONSENT_NOT_ALLOWED","CONSENT_AUTHORITY_UNAVAILABLE","CONSENT_FENCE_INVALID",
 "CONSENT_CHANGED_AFTER_DECISION","CORE_CHANGED_AFTER_DECISION","DECISION_FORGED",
 "DECISION_EXPIRED","DECISION_ACTOR_MISMATCH","NONCE_REPLAY","TX_INTERFACE_INVALID",
 "TX_FAILED_ROLLED_BACK","COMMIT_STATE_UNKNOWN"]);

const deny=reason=>Object.freeze({ok:false,reason,committed:false,providerMessagesSent:0});

/** Deterministic JSON: sorted keys, no undefined, no non-finite numbers. */
export function canonicalJson(v){
 if(v===null||typeof v==="string"||typeof v==="boolean")return JSON.stringify(v);
 if(typeof v==="number"){if(!Number.isFinite(v))throw new TypeError("non-finite");return JSON.stringify(v);}
 if(Array.isArray(v))return `[${v.map(canonicalJson).join(",")}]`;
 if(v&&typeof v==="object")return `{${Object.keys(v).sort().filter(k=>v[k]!==undefined)
  .map(k=>`${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
 throw new TypeError("unsupported");
}
export const decisionDigest=body=>createHash("sha256").update(canonicalJson(body)).digest("hex");

const deepFreeze=o=>{if(o&&typeof o==="object"&&!Object.isFrozen(o)){
 Object.values(o).forEach(deepFreeze);Object.freeze(o);}return o;};

/** Shared by both phases so the checks cannot drift. Returns a deny reason or null. */
function staffProblem(s,binding,nowMs){
 if(!s||!UUID.test(s.userId??"")||!UUID.test(s.teamId??"")||!UUID.test(s.cityId??"")||
  s.active!==true||s.revoked!==false||s.profileRole!==null||
  !Number.isSafeInteger(s.expiresAtMs)||s.expiresAtMs<=nowMs||s.teamActive!==true)
  return "STAFF_NOT_CURRENT";
 if(s.staffRole!==binding.staffRole||s.departments?.includes?.(binding.department)!==true)
  return "STAFF_ROLE_OR_DEPARTMENT_MISMATCH";
 if(s.aal!=="aal2")return "STAFF_AAL2_REQUIRED";
 return null;
}
function conversationProblem(c,id,s,binding){
 if(!c||c.id!==id)return "CONVERSATION_NOT_FOUND_OR_FORGED";
 if(c.channel!==binding.channel||!HEX64.test(c.destinationHash??""))return "CHANNEL_UNSUPPORTED";
 if(c.tenantId!=="quickfurno"||!Number.isSafeInteger(c.revision)||
  !["OPEN","PAUSED"].includes(c.state)||!["client","vendor"].includes(c.subjectType)||
  !UUID.test(c.subjectId??""))return "CONVERSATION_STALE_OR_INELIGIBLE";
 if(!UUID.test(c.subjectTeamId??"")||!UUID.test(c.subjectCityId??"")||
  c.subjectTeamId!==s.teamId||c.subjectCityId!==s.cityId)return "TEAM_OR_CITY_MISMATCH";
 return null;
}
const fenceOk=f=>!!f&&typeof f==="object"&&!Array.isArray(f)&&
 Object.keys(f).sort().join("|")==="eventCount|latestEventId|policyVersion"&&
 Number.isSafeInteger(f.eventCount)&&f.eventCount>=0&&
 (f.eventCount===0?f.latestEventId===null&&f.policyVersion===null
  :UUID.test(f.latestEventId??"")&&VERSION.test(f.policyVersion??""));
const sameFence=(a,b)=>a.eventCount===b.eventCount&&a.latestEventId===b.latestEventId&&
 a.policyVersion===b.policyVersion;

/** Decisions this module minted. A look-alike object is never accepted. */
const ISSUED=new WeakSet();

/** PHASE 1. deps: loadCurrentStaff, loadCoreConversation, authorizeConsent, readConsentFence, nowMs?. */
export async function prepareConversationDecision(request,deps,binding=CORE_CONVERSATION_BINDING){
 try{
  if(!request||typeof request!=="object"||Array.isArray(request)||
   Object.keys(request).sort().join("|")!==REQUEST_KEYS||!ACTIONS.includes(request.action)||
   !UUID.test(request.conversationId??"")||!UUID.test(request.nonce??"")||
   !Number.isSafeInteger(request.revision)||request.revision<1||
   !deps||["loadCurrentStaff","loadCoreConversation","authorizeConsent","readConsentFence"]
    .some(k=>typeof deps[k]!=="function"))return deny("REQUEST_SHAPE_INVALID");
  const now=deps.nowMs?.()??Date.now();
  const s=await deps.loadCurrentStaff();
  const sp=staffProblem(s,binding,now);if(sp)return deny(sp);
  if(!Array.isArray(s.conversationGrantIds)||!s.conversationGrantIds.includes(request.conversationId))
   return deny("OBJECT_GRANT_MISSING");
  const c=await deps.loadCoreConversation(request.conversationId);
  const cp=conversationProblem(c,request.conversationId,s,binding);if(cp)return deny(cp);
  if(c.revision!==request.revision)return deny("CONVERSATION_STALE_OR_INELIGIBLE");
  let o;
  try{o=await deps.authorizeConsent({destinationHash:c.destinationHash,
   subjectType:c.subjectType,subjectId:c.subjectId});}
  catch{return deny("CONSENT_AUTHORITY_UNAVAILABLE");}
  if(o&&o.kind==="unavailable")return deny("CONSENT_AUTHORITY_UNAVAILABLE");
  if(!o||typeof o!=="object"||Array.isArray(o)||o.kind!=="allow"||
   o.scope!==binding.consentScope||Object.keys(o).sort().join("|")!=="kind|scope")
   return deny("CONSENT_NOT_ALLOWED");
  // Fence is read AFTER the authority answered, so any event it missed changes the fence later.
  // (Reading before would let an event slip between fence read and authority read.)
  const fence=await deps.readConsentFence(c.destinationHash,binding.channel);
  if(!fenceOk(fence))return deny("CONSENT_FENCE_INVALID");
  const body={schema:RC4_DECISION_SCHEMA,conversationId:c.id,revision:c.revision,
   action:request.action,channel:binding.channel,scope:binding.consentScope,
   destinationHash:c.destinationHash,subjectType:c.subjectType,subjectId:c.subjectId,
   consentFence:{eventCount:fence.eventCount,latestEventId:fence.latestEventId,
    policyVersion:fence.policyVersion},
   actor:{userId:s.userId,teamId:s.teamId,cityId:s.cityId,staffRole:s.staffRole,
    department:binding.department,aal:"aal2"},
   nonce:request.nonce,issuedAtMs:now,expiresAtMs:now+RC4_DECISION_TTL_MS};
  const decision=deepFreeze({body,digest:decisionDigest(body)});
  ISSUED.add(decision);
  return Object.freeze({ok:true,decision});
 }catch{return deny("CONSENT_AUTHORITY_UNAVAILABLE");}
}

const TX_METHODS=["lockConsentDestination","lockConversationForUpdate","lockStaffForUpdate",
 "readConsentFence","consumeNonce","insertSourceRow","commit","rollback"];

/** PHASE 2. beginTransaction() -> tx. Gate is checked BEFORE any transaction is opened. */
export async function commitConversationDecision(decision,beginTransaction,
 gate=RC4_CONVERSATION_GATE,binding=CORE_CONVERSATION_BINDING,nowMs=()=>Date.now()){
 if(!gateOpen(gate))return deny("GATE_CLOSED");
 if(!decision||!ISSUED.has(decision)||decision.digest!==decisionDigest(decision.body))
  return deny("DECISION_FORGED");
 if(typeof beginTransaction!=="function")return deny("TX_INTERFACE_INVALID");
 const b=decision.body;
 if(nowMs()>=b.expiresAtMs)return deny("DECISION_EXPIRED");
 let tx;
 try{
  tx=await beginTransaction();
  if(!tx||TX_METHODS.some(k=>typeof tx[k]!=="function"))return deny("TX_INTERFACE_INVALID");
 }catch{return deny("TX_FAILED_ROLLED_BACK");}
 let settled=false;
 const rollback=async reason=>{
  if(!settled){settled=true;try{await tx.rollback();}catch{}}
  return deny(reason);};
 try{
  // Fixed order: consent destination -> conversation -> staff. Consent writers MUST take the first.
  await tx.lockConsentDestination(b.destinationHash,b.channel);
  const c=await tx.lockConversationForUpdate(b.conversationId);
  const s=await tx.lockStaffForUpdate(b.actor.userId);
  if(!s||s.userId!==b.actor.userId||s.teamId!==b.actor.teamId||s.cityId!==b.actor.cityId||
   s.staffRole!==b.actor.staffRole)return await rollback("DECISION_ACTOR_MISMATCH");
  const sp=staffProblem(s,binding,nowMs());if(sp)return await rollback(sp);
  if(!Array.isArray(s.conversationGrantIds)||!s.conversationGrantIds.includes(b.conversationId))
   return await rollback("OBJECT_GRANT_MISSING");
  const cp=conversationProblem(c,b.conversationId,s,binding);if(cp)return await rollback(cp);
  if(c.revision!==b.revision||c.destinationHash!==b.destinationHash||
   c.subjectType!==b.subjectType||c.subjectId!==b.subjectId)
   return await rollback("CORE_CHANGED_AFTER_DECISION");
  const f=await tx.readConsentFence(b.destinationHash,b.channel);
  if(!fenceOk(f))return await rollback("CONSENT_FENCE_INVALID");
  if(!sameFence(f,b.consentFence))return await rollback("CONSENT_CHANGED_AFTER_DECISION");
  if(await tx.consumeNonce(b.nonce,decision.digest)!==true)return await rollback("NONCE_REPLAY");
  await tx.insertSourceRow({source:"CORE_CONVERSATION",conversationId:b.conversationId,
   revision:b.revision,actorId:b.actor.userId,teamId:b.actor.teamId,cityId:b.actor.cityId,
   nonce:b.nonce,decisionDigest:decision.digest});
  settled=true;
  try{await tx.commit();}
  catch{return deny("COMMIT_STATE_UNKNOWN");} // never retry blindly; nonce row decides on reconcile
  return Object.freeze({ok:true,committed:true,conversationId:b.conversationId,
   decisionDigest:decision.digest,providerMessagesSent:0});
 }catch{return await rollback("TX_FAILED_ROLLED_BACK");}
}

/** Production entry: hard-bound to the closed gate, so it can only ever return GATE_CLOSED. */
export const commitConversationDecisionProduction=(decision,beginTransaction)=>
 commitConversationDecision(decision,beginTransaction,RC4_CONVERSATION_GATE);
