/**
 * Phase B two-phase reviewed Staff offboarding.
 * Only operates on EXISTING neutral Staff identities. SQL access revocation
 * is atomic; external Auth session invalidation cannot share that database
 * transaction, so a failed/uncertain Auth call leaves status PENDING_REVIEW.
 * A revoked Staff identity is not allowed back by an uncertain Auth receipt.
 */
const id=x=>typeof x==="string"&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const exact=(obj,names)=>obj&&typeof obj==="object"&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join("|")===names.slice().sort().join("|");
const denied=reason=>Object.freeze({ok:false,reason,
 fullyOffboarded:false,providerMessagesSent:0,grantsApplied:false});
export async function requestReviewedStaffOffboarding({
 environment="off",operation,admin,target,reviewer,team,nonce,
 expectedRevision,incidentReference,verifyCurrentOwner,
 verifyCurrentIndependentReviewer,verifyCurrentTargetAndTeam,
 commitAtomicStaffRevocation,confirmAuthSessionsInvalidated
}={}){
 if(environment!=="staging"||
  !["SUSPEND","REVOKE"].includes(operation)||
  !id(nonce)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||
  typeof incidentReference!=="string"||incidentReference.trim()!==incidentReference||
  incidentReference.length<12||incidentReference.length>120||
  !admin||admin.verifiedByCore!==true||admin.aal!=="aal2"||
  admin.adminRole!=="Superadmin"||admin.profileRole!=="admin"||
  admin.isActive!==true||!id(admin.userId)||
  !target||target.principal!=="vox_staff"||target.profileRole!==null||
  target.adminRole!=null||target.isActive!==true||!id(target.userId)||
  !reviewer||reviewer.verifiedByCore!==true||reviewer.aal!=="aal2"||
  reviewer.role!=="team_leader"||reviewer.isActive!==true||
  !id(reviewer.userId)||!team||!id(team.id)||!id(team.cityId)||
  team.isActive!==true||
  new Set([admin.userId,target.userId,reviewer.userId]).size!==3||
  reviewer.teamId!==team.id||reviewer.cityId!==team.cityId||
  target.teamId!==team.id||target.cityId!==team.cityId||
  typeof verifyCurrentOwner!=="function"||
  typeof verifyCurrentIndependentReviewer!=="function"||
  typeof verifyCurrentTargetAndTeam!=="function"||
  typeof commitAtomicStaffRevocation!=="function"||
  typeof confirmAuthSessionsInvalidated!=="function")
  return denied("CURRENT_INDEPENDENT_STAFF_REVOCATION_REQUIRED");
 try{
  if(await verifyCurrentOwner({admin,team})!==true||
   await verifyCurrentIndependentReviewer({admin,reviewer,target,team})!==true||
   await verifyCurrentTargetAndTeam({target,team,expectedRevision})!==true)
   return denied("CURRENT_OWNER_TL_OR_TARGET_REVOKED");
  const r=await commitAtomicStaffRevocation({
   actorId:admin.userId,targetId:target.userId,
   independentlyReviewedBy:reviewer.userId,
   operation,teamId:team.id,cityId:team.cityId,nonce,
   expectedRevision,incidentReference,
   requireTransactionRecheck:true,requireOneNonce:true
  });
  if(!exact(r,["targetId","revision","nonce","state","teamGrantsRevoked",
   "departmentGrantsRevoked","objectGrantsRevoked",
   "pendingWorkReassigned","currentActorRecheckedInTransaction",
   "independentReviewerRecheckedInTransaction",
   "targetRevisionRecheckedInTransaction","nonceConsumedInTransaction"])||
   r.targetId!==target.userId||r.nonce!==nonce||
   r.revision!==expectedRevision+1||
   r.state!=="ACCESS_DISABLED_PENDING_SESSION_REVOKE"||
   r.teamGrantsRevoked!==true||r.departmentGrantsRevoked!==true||
   r.objectGrantsRevoked!==true||r.pendingWorkReassigned!==true||
   r.currentActorRecheckedInTransaction!==true||
   r.independentReviewerRecheckedInTransaction!==true||
   r.targetRevisionRecheckedInTransaction!==true||
   r.nonceConsumedInTransaction!==true)
   return denied("ATOMIC_CORE_ACCESS_REVOCATION_UNVERIFIED");
  // A separate Supabase Auth call may fail after committed SQL: never
  // restore grants or claim signout on an uncertain response.
  let revoked;
  try{
   revoked=await confirmAuthSessionsInvalidated({
    targetId:target.userId,nonce,expectedMembershipRevision:r.revision
   });
  }catch{revoked=null;}
  if(!exact(revoked,["targetId","allSessionsInvalidated",
    "authenticatedProviderVerified"])||
   revoked.targetId!==target.userId||
   revoked.allSessionsInvalidated!==true||
   revoked.authenticatedProviderVerified!==true)
   return Object.freeze({ok:true,status:"CORE_ACCESS_DISABLED_AUTH_CONFIRMATION_PENDING",
    targetId:target.userId,fullyOffboarded:false,
    grantsApplied:false,requiresOwnerAuthFollowup:true,
    providerMessagesSent:0});
  return Object.freeze({ok:true,status:"AUTH_REVOCATION_ATTESTED",
   targetId:target.userId,fullyOffboarded:true,
   grantsApplied:false,requiresOwnerAuthFollowup:false,
   providerMessagesSent:0});
 }catch{return denied("STAFF_OFFBOARD_RECONCILIATION_UNAVAILABLE");}
}
