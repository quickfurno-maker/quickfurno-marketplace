/** AB7F Core-only, staging-gated atomic operator RPC adapter.
 * Signature validation must happen on the trusted Jarvis/Core ingress.
 * Atomic state, native event and nonce are committed by one reviewed DB RPC.
 */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>({ok:false,reason,applied:false,providerMessagesSent:0});
export async function applyAtomicConversationControl({
 environment,enabled=false,action,conversationId,expectedRevision,operatorId,nonce,
 checkCurrentSignedCoreAuthority,checkCurrentConversationAndConsent,
 rpc
}={}){
 if(environment!=="staging"||enabled!==true||
  !["PAUSE_AI","TAKEOVER"].includes(action)||
  ![conversationId,operatorId,nonce].every(x=>typeof x==="string"&&uuid.test(x))||
  !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
  typeof checkCurrentSignedCoreAuthority!=="function"||
  typeof checkCurrentConversationAndConsent!=="function"||
  typeof rpc!=="function")return deny("ATOMIC_CORE_SIGNED_STAGING_ONLY");
 const intent=Object.freeze({action,conversationId,expectedRevision,operatorId,nonce});
 try{
  if(await checkCurrentSignedCoreAuthority(intent)!==true||
   await checkCurrentConversationAndConsent(intent)!==true)
   return deny("CURRENT_CORE_OR_CONSENT_DENIED");
  const result=await rpc("qf_vox_ab7f_conversation_atomic_operator_candidate_v1",{
   p_conversation:conversationId,p_revision:expectedRevision,
   p_operator:operatorId,p_nonce:nonce,p_action:action
  });
  if(!result||result.error||!Array.isArray(result.data)||result.data.length!==1)
   return deny("ATOMIC_CORE_CONVERSATION_RESULT_UNVERIFIED");
  const receipt=result.data[0];
  if(!receipt||!uuid.test(receipt.event_id??"")||
    receipt.revision!==expectedRevision+1||
    receipt.new_state!==(action==="TAKEOVER"?"HUMAN":"PAUSED")||
    receipt.receipt_nonce!==nonce||
    Object.keys(receipt).sort().join("|")!==
      "event_id|new_state|receipt_nonce|revision")
   return deny("ATOMIC_CORE_CONVERSATION_RECEIPT_MISMATCH");
  return Object.freeze({ok:true,applied:true,action,conversationId,
   revision:receipt.revision,eventId:receipt.event_id,
   receiptNonce:nonce,providerMessagesSent:0,
   externalDeliveryVerified:false,productionCertified:false});
 }catch{return deny("ATOMIC_CORE_TRANSPORT_OUTCOME_UNKNOWN");}
}
