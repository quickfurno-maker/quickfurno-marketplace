/** AB7K RC3 CORE_CONVERSATION consent-binding CONTRACT SCAFFOLD (#444).
 * SOURCE-SHAPE ONLY. Not installed, not signed off, never writes a source row,
 * never sends a provider message. The SQL CHECK vox_ab7b_core_conversation_blocked
 * stays in force; this module cannot lift it. It defines what a future reviewed
 * native writer must prove, and denies everything until the binding is signed off.
 *
 * Consent is NOT a payload field. It is evaluated by the injected Core authority
 * (production: authorizeConversationalWhatsAppConsent -> D2-C) against the
 * destination_hash/channel/subject read from the Core conversation row.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64=/^[0-9a-f]{64}$/;
const REQUEST_KEYS="conversationId|nonce|revision";

/** Proposed, UNSIGNED. Flipping signedOff requires a reviewed code change plus
 * the forward migration in docs/vox/VOX-AB7K-CORE-CONVERSATION-CONSENT-BINDING-RC3-20261030.md. */
export const CORE_CONVERSATION_BINDING=Object.freeze({
 schema:"qf.vox.ab7k.core-conversation-consent-binding.v1",
 signedOff:false,
 staffRole:"operations_manager",
 department:"client_success",
 channel:"whatsapp",
 consentScope:"transactional",
 sourceShapeOnly:true
});

export const CORE_CONVERSATION_DENY_REASONS=Object.freeze([
 "BINDING_NOT_SIGNED_OFF","REQUEST_SHAPE_INVALID","STAFF_NOT_CURRENT",
 "STAFF_ROLE_OR_DEPARTMENT_MISMATCH","STAFF_AAL2_REQUIRED","OBJECT_GRANT_MISSING",
 "NONCE_REPLAY","CONVERSATION_NOT_FOUND_OR_FORGED","CONVERSATION_STALE_OR_INELIGIBLE",
 "CHANNEL_UNSUPPORTED","TEAM_OR_CITY_MISMATCH","CONSENT_NOT_ALLOWED",
 "CONSENT_AUTHORITY_UNAVAILABLE","CORE_CHANGED_DURING_CHECK"]);

const deny=reason=>Object.freeze({ok:false,reason,mayWriteSourceRow:false,
 providerMessagesSent:0});
const same=(a,b)=>a.id===b.id&&a.revision===b.revision&&
 a.destinationHash===b.destinationHash&&a.subjectId===b.subjectId&&
 a.state===b.state;

/** Evaluate with an explicit binding. Exported for tests; production callers must
 * use authorizeCoreConversationSourceRow, which is hard-bound to the unsigned binding. */
export async function evaluateCoreConversationSourceRow(request,deps,binding){
 try{
  if(!request||typeof request!=="object"||Array.isArray(request)||
   Object.keys(request).sort().join("|")!==REQUEST_KEYS||
   !UUID.test(request.conversationId??"")||!UUID.test(request.nonce??"")||
   !Number.isSafeInteger(request.revision)||request.revision<1||
   !deps||["loadCurrentStaff","loadCoreConversation","isNonceUnused",
    "authorizeConsent"].some(k=>typeof deps[k]!=="function"))
   return deny("REQUEST_SHAPE_INVALID");
  // Actor is derived server-side from the session, never from the request.
  const s=await deps.loadCurrentStaff();
  if(!s||!UUID.test(s.userId??"")||!UUID.test(s.teamId??"")||
   !UUID.test(s.cityId??"")||s.active!==true||s.revoked!==false||
   s.profileRole!==null||!Number.isSafeInteger(s.expiresAtMs)||
   s.expiresAtMs<=(deps.nowMs?.()??Date.now())||s.teamActive!==true)
   return deny("STAFF_NOT_CURRENT");
  if(s.staffRole!==binding.staffRole||s.departments?.includes?.(binding.department)!==true)
   return deny("STAFF_ROLE_OR_DEPARTMENT_MISMATCH");
  if(s.aal!=="aal2")return deny("STAFF_AAL2_REQUIRED");
  if(!Array.isArray(s.conversationGrantIds)||
   !s.conversationGrantIds.includes(request.conversationId))
   return deny("OBJECT_GRANT_MISSING");
  if(await deps.isNonceUnused(request.nonce)!==true)return deny("NONCE_REPLAY");
  const c=await deps.loadCoreConversation(request.conversationId);
  if(!c||c.id!==request.conversationId)return deny("CONVERSATION_NOT_FOUND_OR_FORGED");
  if(c.channel!==binding.channel||!HEX64.test(c.destinationHash??""))
   return deny("CHANNEL_UNSUPPORTED");
  if(c.tenantId!=="quickfurno"||c.revision!==request.revision||
   !["OPEN","PAUSED"].includes(c.state)||!["client","vendor"].includes(c.subjectType)||
   !UUID.test(c.subjectId??""))
   return deny("CONVERSATION_STALE_OR_INELIGIBLE");
  // Conversation rows carry no team/city; Core must resolve them from the subject.
  if(!UUID.test(c.subjectTeamId??"")||!UUID.test(c.subjectCityId??"")||
   c.subjectTeamId!==s.teamId||c.subjectCityId!==s.cityId)
   return deny("TEAM_OR_CITY_MISMATCH");
  let o;
  try{
   o=await deps.authorizeConsent({destinationHash:c.destinationHash,
    subjectType:c.subjectType,subjectId:c.subjectId});
  }catch{return deny("CONSENT_AUTHORITY_UNAVAILABLE");}
  if(o&&o.kind==="unavailable")return deny("CONSENT_AUTHORITY_UNAVAILABLE");
  if(!o||typeof o!=="object"||Array.isArray(o))return deny("CONSENT_NOT_ALLOWED");
  if(o.kind!=="allow"||o.scope!==binding.consentScope||
   Object.keys(o).sort().join("|")!=="kind|scope")return deny("CONSENT_NOT_ALLOWED");
  // Narrow (not close) the check-then-act window; same-tx SQL proof is still required.
  const again=await deps.loadCoreConversation(request.conversationId);
  if(!again||!same(c,again))return deny("CORE_CHANGED_DURING_CHECK");
  if(binding.signedOff!==true)return deny("BINDING_NOT_SIGNED_OFF");
  return Object.freeze({ok:true,schema:binding.schema,source:"CORE_CONVERSATION",
   subjectKind:"conversation",conversationId:c.id,revision:request.revision,
   actorId:s.userId,teamId:s.teamId,cityId:s.cityId,nonce:request.nonce,
   mayWriteSourceRow:false,requireSameTransactionConsentRecheck:true,
   providerMessagesSent:0});
 }catch{return deny("CONSENT_AUTHORITY_UNAVAILABLE");}
}

export const authorizeCoreConversationSourceRow=(request,deps)=>
 evaluateCoreConversationSourceRow(request,deps,CORE_CONVERSATION_BINDING);
