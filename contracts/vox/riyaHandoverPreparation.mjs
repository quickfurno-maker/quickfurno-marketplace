// VOX TO-03B: non-executable Core/Riya handover intents, no Jarvis writes.
// Context and source are requirements for a FUTURE Core-verified bridge.
// NEVER authorize WhatsApp replies, Riya resume/pause or source edits here.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=x=>typeof x==="string"&&UUID.test(x);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const STATES=new Set(["AI","TAKEOVER_PENDING","HUMAN","CLOSED"]);
const ACTIONS=Object.freeze({
 REQUEST_TAKEOVER:{from:["AI"],to:"TAKEOVER_PENDING"},
 ACCEPT_TAKEOVER:{from:["TAKEOVER_PENDING"],to:"HUMAN"},
 PROPOSE_REPLY:{from:["HUMAN"],to:"HUMAN"},
 RELEASE_TO_RIYA:{from:["HUMAN"],to:"AI"}
});
const refuse=error=>Object.freeze({ok:false,error,executionAuthorized:false,providerMessagesSent:0});
/** This is shape validation and a non-executable proposal, not verified
 * authority. Only future Core can construct trusted fields after actual
 * Supabase Auth + canonical city/client/project + signed Jarvis lookups.
 */
export function prepareRiyaHandoverIntent({context,conversation,request,now=Date.now()}={}){
 if(!obj(context)||context.coreVerified!==true||context.aal!=="aal2"||
    context.currentStaffActive!==true||context.isOwner===true||
    context.department!=="client_success"||context.departmentActive!==true||
    !id(context.staffId)||!id(context.cityId)||!id(context.teamId)||
    !Array.isArray(context.clientIds)||context.clientIds.length>200||
    context.clientIds.some(x=>!id(x)))
   return refuse("VERIFIED_CURRENT_CLIENT_STAFF_SCOPE_REQUIRED");
 if(!obj(conversation)||!id(conversation.id)||!id(conversation.clientId)||
    !id(conversation.projectId)||!id(conversation.cityId)||!id(conversation.teamId)||
    conversation.cityId!==context.cityId||conversation.teamId!==context.teamId||
    !context.clientIds.includes(conversation.clientId)||
    !STATES.has(conversation.state)||!Number.isSafeInteger(conversation.revision)||
    conversation.revision<0||conversation.coreSubjectVerified!==true||
    conversation.canonicalGoogleLocationVerified!==true||
    conversation.signedJarvisContextVerified!==true||
    conversation.providerOwner!=="CORE"||
    !id(conversation.assignedStaffId??""))
   return refuse("CLIENT_SUBJECT_OR_SIGNED_CONTEXT_REQUIRED");
 if(!obj(request)||!Object.prototype.hasOwnProperty.call(ACTIONS,request.action)||
    !id(request.nonce)||request.expectedRevision!==conversation.revision||
    !Number.isSafeInteger(request.expectedRevision)||
    typeof request.reason!=="string"||request.reason.trim()!==request.reason||
    request.reason.length<12||request.reason.length>300||
    Object.keys(request).sort().join("|")!=="action|expectedRevision|nonce|reason")
   return refuse("INVALID_HANDOVER_INTENT_OR_REVISION");
 if(!Number.isSafeInteger(now)||now<=0||
    !Number.isSafeInteger(conversation.signedContextExpiresAtMs)||
    conversation.signedContextExpiresAtMs<=now||
    conversation.signedContextExpiresAtMs>now+300000)
   return refuse("EXPIRED_OR_UNVERIFIED_JARVIS_PROOF");
 if(conversation.doNotContact!==false||conversation.consentState!=="ALLOWED"||
    conversation.isHumanRequestedStop===true)
   return refuse("CLIENT_CONSENT_OR_STOP_DENIED");
 const rule=ACTIONS[request.action];
 if(!rule.from.includes(conversation.state))
  return refuse("INVALID_HANDOVER_STATE");
 // A staff operator must be explicitly assigned by Core. There is NO
 // escalation from client-provided IDs, free-text address or AI instructions.
 if(conversation.assignedStaffId!==context.staffId)
  return refuse("ASSIGNED_CASE_STAFF_REQUIRED");
 if(request.action==="PROPOSE_REPLY"&&conversation.human_takeover!==true)
  return refuse("RIYA_MUST_BE_PAUSED_FIRST");
 if(request.action==="RELEASE_TO_RIYA"&&conversation.pausedRiya!==true)
  return refuse("NO_VERIFIED_AI_PAUSE_RECEIPT");
 return Object.freeze({
  ok:true,schema:"qf.vox.riya.handover.intent.v1",kind:"NON_EXECUTABLE_INTENT",
  staffId:context.staffId,conversationId:conversation.id,clientId:conversation.clientId,
  cityId:context.cityId,teamId:context.teamId,
  action:request.action,expectedRevision:request.expectedRevision,
  nonce:request.nonce,fromState:conversation.state,proposedState:rule.to,
  requiresAtomicCoreHandover:true,requiresSignedJarvisPauseAck:true,
  requiresFreshConsentAtSend:true,requiresCurrentSubjectGrant:true,
  requiresIdempotentProviderOutbox:true,
  executionAuthorized:false,providerMessagesSent:0,
  affectsVendorLeadMatching:false,maxAdditionalVendorAssignments:0
 });
}
