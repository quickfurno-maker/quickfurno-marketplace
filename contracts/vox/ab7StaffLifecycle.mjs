/**
 * AB7-A governed Staff suspension/revocation preparation.
 * A successful request authorizes a *pending* atomic Core transaction,
 * not an Auth delete, invite, grant, credit, provider send or approval.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>Object.freeze({ok:false,reason,accessRevoked:false,
 authSessionTerminated:false,grantsChanged:false,providerMessagesSent:0});
export async function prepareAb7StaffLifecycle({
 operation,actor,reviewer,target,nonce,expectedRevision,
 verifyOwnerCurrentAal2,verifyIndependentReviewerCurrentAal2,
 verifyTargetCurrentMembership,queueAtomicPendingAction,
 now=Date.now()
}={}){
 if(!["SUSPEND","REVOKE_DEPARTMENT","TRANSFER_TEAM"].includes(operation)||
  !actor||!reviewer||!target||!UUID.test(String(nonce))||
  !UUID.test(String(actor.id))||!UUID.test(String(reviewer.id))||
  !UUID.test(String(target.id))||!UUID.test(String(target.teamId))||
  !UUID.test(String(target.cityId))||
  !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
  actor.id===reviewer.id||actor.id===target.id||reviewer.id===target.id||
  actor.aal!=="aal2"||actor.coreRole!=="superadmin"||
  reviewer.aal!=="aal2"||reviewer.voxRole!=="team_leader"||
  reviewer.teamId!==target.teamId||reviewer.cityId!==target.cityId||
  target.isNeutralStaff!==true||target.isActive!==true||
  target.revision!==expectedRevision||
  !Number.isSafeInteger(now)||now<=0||
  typeof verifyOwnerCurrentAal2!=="function"||
  typeof verifyIndependentReviewerCurrentAal2!=="function"||
  typeof verifyTargetCurrentMembership!=="function"||
  typeof queueAtomicPendingAction!=="function")
  return deny("CURRENT_INDEPENDENT_STAFF_LIFECYCLE_REQUIRED");
 try{
  if(await verifyOwnerCurrentAal2({actor})!==true||
   await verifyIndependentReviewerCurrentAal2({reviewer,target})!==true||
   await verifyTargetCurrentMembership({target,expectedRevision})!==true)
   return deny("CURRENT_STAFF_OR_REVIEWER_REVOKED");
  const receipt=await queueAtomicPendingAction({
   operation,actorId:actor.id,reviewerId:reviewer.id,
   targetStaffId:target.id,expectedRevision,
   teamId:target.teamId,cityId:target.cityId,nonce,
   requireCurrentCoreGrantDbRecheck:true,
   requireIndependentAal2ReviewerDbRecheck:true,
   requireOneUseNonceDbConstraint:true,
   expectedState:"PENDING_INDEPENDENT_REVIEW"
  });
  if(!receipt||receipt.state!=="PENDING_INDEPENDENT_REVIEW"||
   receipt.targetStaffId!==target.id||receipt.nonce!==nonce||
   receipt.expectedRevision!==expectedRevision||
   receipt.persisted!==true||
   receipt.grantsChanged!==false||
   receipt.authSessionTerminated!==false||
   receipt.coreGrantsRecheckedInTransaction!==true||
   receipt.reviewerRecheckedInTransaction!==true||
   receipt.nonceUniqueInTransaction!==true)
   return deny("ATOMIC_PENDING_RECEIPT_UNVERIFIED");
  return Object.freeze({ok:true,
   schema:"qf.vox.ab7a.staff-lifecycle-readiness.v1",
   operation,state:"PENDING_INDEPENDENT_REVIEW",
   targetStaffId:target.id,nonce,expectedRevision,
   accessRevoked:false,authSessionTerminated:false,
   grantsChanged:false,providerMessagesSent:0,
   requiresSeparateReviewedExecution:true});
 }catch{return deny("STAFF_LIFECYCLE_PENDING_STORE_UNAVAILABLE");}
}
