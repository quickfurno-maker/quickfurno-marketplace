import test from "node:test";
import assert from "node:assert/strict";
import {requestReviewedStaffOffboarding} from "../../../contracts/vox/phaseBStaffOffboarding.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const admin={verifiedByCore:true,aal:"aal2",adminRole:"Superadmin",
 profileRole:"admin",isActive:true,userId:id(1)};
const target={principal:"vox_staff",profileRole:null,adminRole:null,
 isActive:true,userId:id(2),teamId:id(4),cityId:id(5)};
const reviewer={verifiedByCore:true,aal:"aal2",role:"team_leader",
 isActive:true,userId:id(3),teamId:id(4),cityId:id(5)};
const team={id:id(4),cityId:id(5),isActive:true};
function fixture(){
 let commits=0,auth=0;
 const args={environment:"staging",operation:"REVOKE",admin,target,reviewer,
  team,nonce:id(6),expectedRevision:7,incidentReference:"Approved 2026 team departure",
  verifyCurrentOwner:async()=>true,
  verifyCurrentIndependentReviewer:async()=>true,
  verifyCurrentTargetAndTeam:async()=>true,
  commitAtomicStaffRevocation:async p=>{
   commits++;
   return {targetId:target.userId,revision:8,nonce:id(6),
    state:"ACCESS_DISABLED_PENDING_SESSION_REVOKE",
    teamGrantsRevoked:true,departmentGrantsRevoked:true,
    objectGrantsRevoked:true,pendingWorkReassigned:true,
    currentActorRecheckedInTransaction:true,
    independentReviewerRecheckedInTransaction:true,
    targetRevisionRecheckedInTransaction:true,nonceConsumedInTransaction:true};
  },
  confirmAuthSessionsInvalidated:async()=>{auth++;
   return {targetId:target.userId,allSessionsInvalidated:true,
    authenticatedProviderVerified:true};
  }};
 return {args,get commits(){return commits},get auth(){return auth}};
}
test("Phase B independently reviewed offboarding requires 2 verified security phases",async()=>{
 const x=fixture(),r=await requestReviewedStaffOffboarding(x.args);
 assert.equal(r.ok,true);assert.equal(r.fullyOffboarded,true);
 assert.equal(r.status,"AUTH_REVOCATION_ATTESTED");
 assert.equal(x.commits,1);assert.equal(x.auth,1);
 assert.equal(r.providerMessagesSent,0);
});
test("Owner, TL and target must be distinct neutral Core principals",async()=>{
 for(const patch of [
  {reviewer:{...reviewer,userId:admin.userId}},
  {reviewer:{...reviewer,userId:target.userId}},
  {reviewer:{...reviewer,aal:"aal1"}},
  {reviewer:{...reviewer,teamId:id(99)}},
  {target:{...target,profileRole:"admin"}},
  {target:{...target,adminRole:"Superadmin"}},
  {admin:{...admin,aal:"aal1"}},
  {environment:"production"},{operation:"ADD_ROLE"},
  {expectedRevision:-1}
 ]){
  const x=fixture(),r=await requestReviewedStaffOffboarding({...x.args,...patch});
  assert.equal(r.ok,false);assert.equal(x.commits,0);
 }
});
test("Current Owner, independent reviewer and target failures block SQL",async()=>{
 for(const key of ["verifyCurrentOwner","verifyCurrentIndependentReviewer",
  "verifyCurrentTargetAndTeam"]){
  const x=fixture(),r=await requestReviewedStaffOffboarding({
   ...x.args,[key]:async()=>false});
  assert.equal(r.ok,false);assert.equal(x.commits,0);
 }
});
test("Atomic SQL nonce, reviewer, all grant classes and work handoff required",async()=>{
 for(const key of ["teamGrantsRevoked","departmentGrantsRevoked",
  "objectGrantsRevoked","pendingWorkReassigned",
  "currentActorRecheckedInTransaction",
  "independentReviewerRecheckedInTransaction",
  "targetRevisionRecheckedInTransaction","nonceConsumedInTransaction"]){
  const x=fixture(),orig=x.args.commitAtomicStaffRevocation;
  const r=await requestReviewedStaffOffboarding({...x.args,
   commitAtomicStaffRevocation:async v=>({...await orig(v),[key]:false})});
  assert.equal(r.ok,false,key);assert.equal(x.auth,0);
 }
});
test("External Auth unavailable AFTER SQL never falsely claims full offboarding",async()=>{
 for(const confirm of [
  async()=>null,
  async()=>{throw Error("supabase unavailable")},
  async()=>({targetId:target.userId,allSessionsInvalidated:false,
   authenticatedProviderVerified:false})
 ]){
  const x=fixture(),r=await requestReviewedStaffOffboarding({...x.args,
   confirmAuthSessionsInvalidated:confirm});
  assert.equal(x.commits,1);assert.equal(r.ok,true);
  assert.equal(r.fullyOffboarded,false);
  assert.equal(r.requiresOwnerAuthFollowup,true);
  assert.equal(r.status,"CORE_ACCESS_DISABLED_AUTH_CONFIRMATION_PENDING");
 }
});
test("No Core privileges automatically restored by revoke pipeline",async()=>{
 const x=fixture(),r=await requestReviewedStaffOffboarding(x.args);
 assert.equal(r.grantsApplied,false);assert.equal(r.providerMessagesSent,0);
});
