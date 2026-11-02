/**
 * Phase B native Core writer gate, not a deployed database RPC.
 * Requires the original verified source mutation and its canonical staff
 * event to commit in ONE serializable transaction with unique nonce.
 * Never upgrades legacy text actor_reference, null sender_id, provider/AI
 * messages or historical conversation state into employee activity.
 */
import {recordVerifiedStaffSourceAction} from "./f1CanonicalSourceRecorder.mjs";
const sources={
 CORE_WORK_LEDGER:{subjectKinds:["prospect","vendor","support_thread"],origin:"CORE_WORK_TRANSITION"},
 CRM_AAROHI:{subjectKinds:["prospect"],origin:"AAROHI_STAFF_FOLLOWUP"},
 SUPPORT_DESK:{subjectKinds:["support_thread"],origin:"STAFF_SUPPORT_ACTION"},
 CORE_CONVERSATION:{subjectKinds:["conversation"],origin:"STAFF_CONVERSATION_ACTION"}
};
const strict=(r,keys)=>r&&typeof r==="object"&&!Array.isArray(r)&&
 Object.keys(r).sort().join("|")===keys.slice().sort().join("|");
const deny=reason=>Object.freeze({ok:false,reason,commitVerified:false,
 staffActivityCertified:false,providerMessagesSent:0});
export async function commitCurrentStaffMutationAndEvent({
 environment="off",command,signature,publicKeyPem,sourceMutation,
 verifyCurrentNeutralStaff,verifyImmutableSourceObject,verifyExactObjectGrant,
 commitSourceAndEventOnce,now=Date.now()
}={}){
 const spec=sources[command?.source];
 if(environment!=="staging"||!spec||
  !spec.subjectKinds.includes(command?.subjectKind)||
  !strict(sourceMutation,["source","origin","sourceEventId","subjectId",
   "objectId","expectedRevision","actorId","nonce","effect"])||
  sourceMutation.source!==command.source||
  sourceMutation.origin!==spec.origin||
  sourceMutation.sourceEventId!==command.sourceEventId||
  sourceMutation.subjectId!==command.subjectId||
  sourceMutation.objectId!==command.objectId||
  sourceMutation.expectedRevision!==command.revision||
  sourceMutation.actorId!==command.actorId||
  sourceMutation.nonce!==command.nonce||
  sourceMutation.effect!=="CORE_INTERNAL_ONLY"||
  typeof commitSourceAndEventOnce!=="function")
  return deny("AUTHENTICATED_NATIVE_SOURCE_TRANSACTION_REQUIRED");
 const result=await recordVerifiedStaffSourceAction({
  command,signature,publicKeyPem,verifyCurrentNeutralStaff,
  verifyImmutableSourceObject,verifyExactObjectGrant,now,
  insertOnce:async verified=>{
   // Injected Core SQL procedure must lock source row and all staff/object
   // grants, perform mutation and canonical event insert with nonce together.
   const receipt=await commitSourceAndEventOnce({
    command:verified,sourceMutation,
    transactionIsolation:"SERIALIZABLE",
    requireOriginalMutationInSameTransaction:true,
    requireCanonicalEventInSameTransaction:true,
    requireSingleNonceUse:true
   });
   if(!strict(receipt,["id","persisted","provenanceCheckedInTransaction",
    "staffCheckedInTransaction","grantCheckedInTransaction",
    "nonceConsumedInTransaction","sourceMutationCommittedInTransaction",
    "canonicalEventInsertedInTransaction","transactionIsolation",
    "providerMessagesSent","sourceEventId"])||
    receipt.id!==verified.id||
    receipt.sourceEventId!==verified.sourceEventId||
    receipt.transactionIsolation!=="SERIALIZABLE"||
    receipt.sourceMutationCommittedInTransaction!==true||
    receipt.canonicalEventInsertedInTransaction!==true||
    receipt.providerMessagesSent!==0)
    throw Error("SOURCE_AND_EVENT_ATOMICITY_NOT_PROVEN");
   const {sourceMutationCommittedInTransaction,canonicalEventInsertedInTransaction,
    transactionIsolation,providerMessagesSent,sourceEventId,...base}=receipt;
   return base;
  }
 });
 if(result.ok!==true)return deny(result.reason);
 return Object.freeze({ok:true,source:command.source,
  eventId:result.id,commitVerified:true,staffActivityCertified:false,
  provenance:"NATIVE_SAME_TRANSACTION_RECEIPT",
  requiresIndependentStagingReview:true,providerMessagesSent:0});
}
