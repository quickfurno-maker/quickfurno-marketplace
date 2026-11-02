/**
 * UI-04 T1: owner-proposed Staff lifecycle requests for EXISTING neutral
 * identities. Not a user-invite API. Reuses Core authorizations; never
 * grants roles, sends emails, or modifies Supabase Auth.
 */
import {prepareStaffCapabilityRequest} from "./staffDepartmentPacks.mjs";
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid=v=>typeof v==="string"&&ID.test(v);
const exact=(v,keys)=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&
 Object.keys(v).sort().join("|")===keys.slice().sort().join("|");
const operations=["REQUEST_DEPARTMENT_CHANGE","REQUEST_SUSPEND","REQUEST_REVOKE","REQUEST_TEAM_CHANGE"];
const reject=reason=>Object.freeze({ok:false,reason,status:"REJECTED",
 mayInvite:false,mayActivate:false,mutationsAuthorized:false,providerMessagesSent:0});
export async function queueReviewedStaffLifecycle({
 environment="off",admin,target,team,request,now=Date.now(),
 verifyCurrentOwner,verifyCurrentTarget,verifyEligibleIndependentReviewer,
 createPendingOnce
}={}){
 if(environment!=="staging"||!Number.isSafeInteger(now)||now<=0||
  !exact(request,["operation","targetId","teamId","cityId","nonce","reason",
   "expiresAtMs","expectedRevision","packs","reviewerId"])||
  !operations.includes(request.operation)||!uuid(request.nonce)||
  !uuid(request.reviewerId)||!uuid(request.targetId)||!uuid(request.teamId)||
  !uuid(request.cityId)||!Number.isSafeInteger(request.expectedRevision)||
  request.expectedRevision<0||typeof request.reason!=="string"||
  request.reason.trim()!==request.reason||
  request.reason.length<12||request.reason.length>500||
  !Number.isSafeInteger(request.expiresAtMs)||request.expiresAtMs<=now+300000||
  request.expiresAtMs>now+30*86400000||
  typeof verifyCurrentOwner!=="function"||
  typeof verifyCurrentTarget!=="function"||
  typeof verifyEligibleIndependentReviewer!=="function"||
  typeof createPendingOnce!=="function")
  return reject("STRICT_STAGING_REVIEW_REQUEST_REQUIRED");
 if(!admin||admin.verifiedByCore!==true||admin.aal!=="aal2"||
  admin.profileRole!=="admin"||admin.adminRole!=="Superadmin"||
  admin.isActive!==true||!uuid(admin.userId)||
  !target||target.profileRole!==null||target.adminRole!=null||
  target.principal!=="vox_staff"||target.isActive!==true||
  !uuid(target.userId)||!team||team.isActive!==true||
  !uuid(team.cityId)||!uuid(team.teamId)||
  request.targetId!==target.userId||
  request.teamId!==team.teamId||request.cityId!==team.cityId||
  request.reviewerId===admin.userId||
  request.reviewerId===target.userId||admin.userId===target.userId)
  return reject("NEUTRAL_STAFF_INDEPENDENCE_REQUIRED");
 let capabilities=[];
 if(request.operation==="REQUEST_DEPARTMENT_CHANGE"){
  const prepared=prepareStaffCapabilityRequest({
   environment,admin,target,team,
   request:{nonce:request.nonce,targetId:target.userId,
    teamId:team.teamId,cityId:team.cityId,reason:request.reason,
    expiresAtMs:request.expiresAtMs,packs:request.packs},nowMs:now});
  if(!prepared.ok)return reject(prepared.error);
  capabilities=prepared.capabilities.map(x=>x.key);
 }else if(!Array.isArray(request.packs)||request.packs.length!==0)
  return reject("NO_DEPARTMENT_ELEVATION_FOR_LIFECYCLE");
 try{
  if(await verifyCurrentOwner({admin,team,operation:request.operation})!==true)
   return reject("OWNER_AAL2_OR_SCOPE_REVOKED");
  if(await verifyCurrentTarget({target,team,revision:request.expectedRevision})!==true)
   return reject("STAFF_STATE_OR_REVISION_STALE");
  if(await verifyEligibleIndependentReviewer({reviewerId:request.reviewerId,
   adminId:admin.userId,targetId:target.userId,team})!==true)
   return reject("INDEPENDENT_REVIEWER_UNAVAILABLE");
  const result=await createPendingOnce({
   operation:request.operation,adminId:admin.userId,targetId:target.userId,
   teamId:team.teamId,cityId:team.cityId,reviewerId:request.reviewerId,
   packs:capabilities,nonce:request.nonce,
   reason:request.reason,expiresAtMs:request.expiresAtMs,
   expectedRevision:request.expectedRevision
  });
  if(!exact(result,["requestId","nonce","state","persisted",
   "ownerRecheckedInTransaction","targetRecheckedInTransaction",
   "reviewerRecheckedInTransaction","nonceConsumedInTransaction",
   "targetGrantMutated","invitationSent"])||
   !uuid(result.requestId)||result.nonce!==request.nonce||
   result.state!=="PENDING_INDEPENDENT_REVIEW"||result.persisted!==true||
   result.ownerRecheckedInTransaction!==true||
   result.targetRecheckedInTransaction!==true||
   result.reviewerRecheckedInTransaction!==true||
   result.nonceConsumedInTransaction!==true||
   result.targetGrantMutated!==false||result.invitationSent!==false)
   return reject("ATOMIC_PENDING_REQUEST_UNVERIFIED");
  return Object.freeze({ok:true,status:"PENDING_INDEPENDENT_REVIEW",
   requestId:result.requestId,operation:request.operation,
   mayInvite:false,mayActivate:false,mutationsAuthorized:false,
   providerMessagesSent:0,releaseCertified:false});
 }catch{return reject("CORE_STAFF_REVIEW_STORAGE_UNAVAILABLE");}
}
