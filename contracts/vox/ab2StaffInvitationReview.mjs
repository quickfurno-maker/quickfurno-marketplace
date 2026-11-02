/**
 * VOX AB-2: independently governed pre-invitation evidence, not an
 * invitation executor. Core remains the sole Admin and Staff identity.
 * This deliberately does not call Supabase Auth or email providers.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=x=>typeof x==="string"&&UUID.test(x);
const fail=reason=>Object.freeze({ok:false,reason,
 invitationAuthorized:false,accountCreated:false,providerMessagesSent:0});
export async function prepareIndependentStaffInvitationReview({
 environment="off",owner,reviewer,request,
 verifyCurrentOwner,verifyCurrentReviewer,verifyNoExistingIdentity,
 persistPendingReview,now=Date.now()
}={}){
 if(environment!=="staging"||!owner||!reviewer||!request||
  owner.verifiedByCore!==true||owner.aal!=="aal2"||
  owner.adminRole!=="Superadmin"||owner.profileRole!=="admin"||
  !id(owner.userId)||reviewer.verifiedByCore!==true||
  reviewer.aal!=="aal2"||reviewer.role!=="team_leader"||
  !id(reviewer.userId)||reviewer.userId===owner.userId||
  !id(request.teamId)||!id(request.cityId)||!id(request.nonce)||
  request.reviewerId!==reviewer.userId||
  request.teamId!==reviewer.teamId||request.cityId!==reviewer.cityId||
  typeof request.emailDigest!=="string"||
  !/^[a-f0-9]{64}$/.test(request.emailDigest)||
  !Array.isArray(request.departments)||request.departments.length===0||
  request.departments.length>5||
  request.departments.some(x=>!["acquisition","vendor_success",
   "service_support","client_success"].includes(x))||
  new Set(request.departments).size!==request.departments.length||
  !Number.isSafeInteger(request.expectedRosterRevision)||
  request.expectedRosterRevision<0||
  !Number.isSafeInteger(request.expiresAtMs)||
  !Number.isSafeInteger(now)||request.expiresAtMs<=now||
  request.expiresAtMs>now+24*3600000||
  typeof verifyCurrentOwner!=="function"||
  typeof verifyCurrentReviewer!=="function"||
  typeof verifyNoExistingIdentity!=="function"||
  typeof persistPendingReview!=="function")
  return fail("INDEPENDENT_STAFF_IDENTITY_REVIEW_REQUIRED");
 try{
  if(await verifyCurrentOwner({owner,request})!==true||
   await verifyCurrentReviewer({reviewer,request})!==true||
   await verifyNoExistingIdentity({emailDigest:request.emailDigest})!==true)
   return fail("CURRENT_IDENTITY_OR_INDEPENDENCE_UNVERIFIED");
  const receipt=await persistPendingReview({
   actorId:owner.userId,reviewerId:reviewer.userId,
   teamId:request.teamId,cityId:request.cityId,
   emailDigest:request.emailDigest,
   departments:Object.freeze([...request.departments].sort()),
   nonce:request.nonce,expiresAtMs:request.expiresAtMs,
   expectedRosterRevision:request.expectedRosterRevision,
   requireAtomicNonce:true,requireReviewerRecheck:true,
   requireExistingIdentityRecheck:true
  });
  if(!receipt||receipt.persisted!==true||
   receipt.state!=="PENDING_INDEPENDENT_REVIEW"||
   receipt.nonce!==request.nonce||!id(receipt.reviewId)||
   receipt.ownerRecheckedInTransaction!==true||
   receipt.reviewerRecheckedInTransaction!==true||
   receipt.identityRecheckedInTransaction!==true||
   receipt.nonceConsumedInTransaction!==true||
   receipt.accountCreated!==false||receipt.inviteSent!==false)
   return fail("ATOMIC_PENDING_IDENTITY_REVIEW_UNVERIFIED");
  return Object.freeze({ok:true,reviewId:receipt.reviewId,
   state:"PENDING_INDEPENDENT_REVIEW",
   invitationAuthorized:false,accountCreated:false,
   providerMessagesSent:0,releaseCertified:false});
 }catch{return fail("IDENTITY_REVIEW_STORAGE_UNAVAILABLE");}
}
