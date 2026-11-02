/**
 * AB7A two-phase Core Staff access fencing.
 * Stage-gated and callable only with independent reviewed current proofs.
 * This revokes a Core staff permission lease in an injected atomic Core RPC;
 * it does NOT assert GoTrue sessions were globally invalidated.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>Object.freeze({ok:false,reason,accessRevocationVerified:false,
 authSessionsInvalidated:false,staffLoginDisabled:false});
export async function executeReviewedStaffAccessFence({
 enabled=false,environment,owner,reviewer,target,review,nonce,
 verifyCurrentOwnerAal2,verifyCurrentTlAal2,
 verifyImmutableDecision,atomicCoreRevoke
}={}){
 if(enabled!==true||environment!=="staging"||!owner||!reviewer||!target||
  !UUID.test(owner.id??"")||!UUID.test(reviewer.id??"")||
  !UUID.test(target.id??"")||!UUID.test(review?.decisionId??"")||
  !UUID.test(nonce??"")||!Number.isSafeInteger(target.revision)||
  target.revision<0||owner.id===reviewer.id||owner.id===target.id||
  reviewer.id===target.id||owner.aal!=="aal2"||
  owner.coreRole!=="superadmin"||reviewer.aal!=="aal2"||
  reviewer.voxRole!=="team_leader"||
  reviewer.teamId!==target.teamId||reviewer.cityId!==target.cityId||
  review.action!=="SUSPEND"||review.state!=="APPROVED"||
  review.targetId!==target.id||review.ownerId!==owner.id||
  review.reviewerId!==reviewer.id||review.expectedRevision!==target.revision||
  review.nonce!==nonce||review.signaturesVerified!==true||
  typeof verifyCurrentOwnerAal2!=="function"||
  typeof verifyCurrentTlAal2!=="function"||
  typeof verifyImmutableDecision!=="function"||
  typeof atomicCoreRevoke!=="function")
  return deny("SIGNED_INDEPENDENT_STAFF_SUSPENSION_REQUIRED");
 try{
  const intent={action:"SUSPEND",decisionId:review.decisionId,
   ownerId:owner.id,reviewerId:reviewer.id,targetId:target.id,
   teamId:target.teamId,cityId:target.cityId,expectedRevision:target.revision,
   nonce,denyExistingJwtByFreshMembershipCheck:true};
  if(await verifyCurrentOwnerAal2(owner)!==true||
   await verifyCurrentTlAal2(reviewer)!==true||
   await verifyImmutableDecision(intent)!==true)
   return deny("CURRENT_INDEPENDENT_REVIEW_REVOKED");
  const receipt=await atomicCoreRevoke(intent);
  if(!receipt||receipt.decisionId!==review.decisionId||
   receipt.targetId!==target.id||receipt.nonce!==nonce||
   receipt.revision!==target.revision+1||
   receipt.state!=="SUSPENDED"||receipt.membershipRevoked!==true||
   receipt.departmentCapabilitiesRevoked!==true||
   receipt.objectScopesRevoked!==true||
   receipt.auditedAtomically!==true||receipt.currentReviewRechecked!==true||
   receipt.oneUseNonceConsumed!==true||receipt.authProviderSessionsInvalidated!==false)
   return deny("CORE_ATOMIC_FENCE_RECEIPT_UNVERIFIED");
  return Object.freeze({ok:true,schema:"qf.vox.ab7a.access-fence.v1",
   state:"CORE_ACCESS_SUSPENDED_AUTH_RECONCILIATION_PENDING",
   targetId:target.id,revision:receipt.revision,accessRevocationVerified:true,
   authSessionsInvalidated:false,staffLoginDisabled:false,
   requiresGoTrueSessionReconciliation:true,providerMessagesSent:0});
 }catch{return deny("CORE_ATOMIC_REVOKE_UNAVAILABLE_OR_REPLAY");}
}
