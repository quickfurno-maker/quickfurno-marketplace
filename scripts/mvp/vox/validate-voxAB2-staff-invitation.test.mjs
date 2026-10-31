import test from "node:test";
import assert from "node:assert/strict";
import {prepareIndependentStaffInvitationReview as prepare}
 from "../../../contracts/vox/ab2StaffInvitationReview.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-17T14:00:00Z");
const owner={verifiedByCore:true,aal:"aal2",adminRole:"Superadmin",
 profileRole:"admin",userId:id(1)};
const reviewer={verifiedByCore:true,aal:"aal2",role:"team_leader",
 userId:id(2),teamId:id(3),cityId:id(4)};
const request={teamId:id(3),cityId:id(4),nonce:id(5),
 reviewerId:reviewer.userId,emailDigest:"a".repeat(64),
 departments:["acquisition"],expectedRosterRevision:1,
 expiresAtMs:now+3600000};
function make(){
 let writes=0;
 const args={environment:"staging",owner,reviewer,request,now,
 verifyCurrentOwner:async()=>true,
 verifyCurrentReviewer:async()=>true,
 verifyNoExistingIdentity:async()=>true,
 persistPendingReview:async p=>{writes++;return {
  persisted:true,reviewId:id(6),nonce:p.nonce,
  state:"PENDING_INDEPENDENT_REVIEW",
  ownerRecheckedInTransaction:true,reviewerRecheckedInTransaction:true,
  identityRecheckedInTransaction:true,nonceConsumedInTransaction:true,
  accountCreated:false,inviteSent:false};}};
 return {args,get writes(){return writes}};
}
test("AB2 creates only a pending review, never Staff account or invitation",async()=>{
 const x=make(),r=await prepare(x.args);
 assert.equal(r.ok,true);assert.equal(x.writes,1);
 assert.equal(r.invitationAuthorized,false);assert.equal(r.accountCreated,false);
 assert.equal(r.providerMessagesSent,0);
});
test("AB2 refuses owner self approval and AAL1 reviewers",async()=>{
 for(const p of [
  {reviewer:{...reviewer,userId:owner.userId}},
  {reviewer:{...reviewer,aal:"aal1"}},
  {owner:{...owner,aal:"aal1"}},
  {environment:"production"},
  {request:{...request,departments:["owner_admin"]}},
  {request:{...request,departments:["acquisition","acquisition"]}},
  {request:{...request,expiresAtMs:now-100}},
  {request:{...request,emailDigest:"plain@example.com"}}
 ]){
  const x=make(),r=await prepare({...x.args,...p});
  assert.equal(r.ok,false);assert.equal(x.writes,0);
 }
});
test("AB2 current user duplicate or scope revoked means no review write",async()=>{
 for(const k of ["verifyCurrentOwner","verifyCurrentReviewer",
  "verifyNoExistingIdentity"]){
  const x=make(),r=await prepare({...x.args,[k]:async()=>false});
  assert.equal(r.ok,false);assert.equal(x.writes,0);
 }
});
test("AB2 cannot accept forged transaction receipt or false no-send evidence",async()=>{
 for(const field of ["reviewerRecheckedInTransaction",
  "identityRecheckedInTransaction","nonceConsumedInTransaction",
  "accountCreated","inviteSent"]){
  const x=make(),original=x.args.persistPendingReview;
  const r=await prepare({...x.args,persistPendingReview:async p=>({
   ...await original(p),[field]:["accountCreated","inviteSent"].includes(field)})});
  assert.equal(r.ok,false,field);
 }
});
