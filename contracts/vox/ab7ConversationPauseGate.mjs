/** AB7C read-only Core conversation PAUSE preparation. No writes or sends. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>Object.freeze({ok:false,reason,mayExecute:false,
 coreConversationUpdated:false,providerMessagesSent:0});
export async function prepareCanonicalCorePause({
 staff,conversation,expectedRevision,nonce,canonicalSnapshot,
 verifyCurrentCoreConversation,verifyCurrentStaffAal2,
 verifySignedJarvisPause,verifyCanonicalOptOut,now=Date.now()
}={}){
 if(!staff||staff.role!=="client_success_agent"||
  !UUID.test(staff.userId??"")||!UUID.test(staff.teamId??"")||
  !UUID.test(staff.cityId??"")||staff.currentAal!=="aal2"||
  !Array.isArray(staff.conversationIds)||!conversation||
  !UUID.test(conversation.id??"")||!UUID.test(nonce??"")||
  !staff.conversationIds.includes(conversation.id)||
  !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
  conversation.revision!==expectedRevision||
  !["OPEN","PAUSED"].includes(conversation.state)||
  !["RIYA","ANISHA","AAROHI"].includes(conversation.assigned_actor)||
  conversation.human_takeover!==false||!UUID.test(conversation.subject_id??"")||
  !["client","vendor"].includes(conversation.subject_type)||
  !canonicalSnapshot||
  Object.keys(canonicalSnapshot).sort().join("|")!==
   ["conversationId","principalType","principalId","destinationHash",
    "preferenceLastEventId","suppressionCheckedAtMs",
    "currentAllowed","notSuppressed"].sort().join("|")||
  canonicalSnapshot.conversationId!==conversation.id||
  canonicalSnapshot.principalType!==conversation.subject_type||
  canonicalSnapshot.principalId!==conversation.subject_id||
  !/^[a-f0-9]{64}$/.test(canonicalSnapshot.destinationHash??"")||
  !UUID.test(canonicalSnapshot.preferenceLastEventId??"")||
  canonicalSnapshot.currentAllowed!==true||
  canonicalSnapshot.notSuppressed!==true||
  !Number.isSafeInteger(now)||
  !Number.isSafeInteger(canonicalSnapshot.suppressionCheckedAtMs)||
  canonicalSnapshot.suppressionCheckedAtMs>now||
  now-canonicalSnapshot.suppressionCheckedAtMs>15000||
  typeof verifyCurrentCoreConversation!=="function"||
  typeof verifyCurrentStaffAal2!=="function"||
  typeof verifySignedJarvisPause!=="function"||
  typeof verifyCanonicalOptOut!=="function")
  return deny("CANONICAL_CURRENT_CONVERSATION_CONSENT_AND_SCOPE_REQUIRED");
 try{
  const proof={conversationId:conversation.id,expectedRevision,
   actorId:staff.userId,teamId:staff.teamId,cityId:staff.cityId,nonce,
   subjectId:conversation.subject_id,subjectType:conversation.subject_type};
  if(await verifyCurrentStaffAal2({staff,proof})!==true||
   await verifyCurrentCoreConversation({conversation,proof})!==true||
   await verifyCanonicalOptOut({canonicalSnapshot,proof})!==true||
   await verifySignedJarvisPause({proof,requireDistinctTrustedSigner:true})!==true)
   return deny("CURRENT_PAUSE_EVIDENCE_REVOKED");
  return Object.freeze({ok:true,schema:"qf.vox.ab7c.core-pause-preparation.v1",
   action:"PAUSE_AI_ONLY",state:"PENDING_CANONICAL_CORE_ATOMIC_RECHECK",
   conversationId:conversation.id,expectedRevision,nonce,
   requireOriginalConversationEventSameTransaction:true,
   requireDurableConsentRecheck:true,requireOneUseNonce:true,
   requireSignedJarvisPause:true,mayExecute:false,
   coreConversationUpdated:false,providerMessagesSent:0});
 }catch{return deny("CORE_PAUSE_PROOF_UNAVAILABLE");}
}