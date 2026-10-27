import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateAb4StaffReviewRequest as request,
 validateAb4StaffReviewDecision as decide}
 from "../../../contracts/vox/ab4StaffRequestGateway.mjs";
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-18T01:30:00+05:30");
const ownerId=uuid(1),reviewerId=uuid(2);
const req={
 action:"REQUEST",requestId:uuid(3),nonce:uuid(4),
 reviewerId,teamId:uuid(5),cityId:uuid(6),
 emailSha256:"a".repeat(64),departments:["acquisition","service_support"],
 expectedRosterRevision:3,expiresAt:new Date(now+3600000).toISOString()
};
test("AB4 owner can prepare pending-only Staff review (no invitation)",()=>{
 const r=request(req,{ownerId,now});
 assert.equal(r.ok,true);assert.equal(r.accountCreated,false);
 assert.equal(r.inviteSent,false);assert.equal(r.grantsActivated,false);
 assert.equal(r.insert.owner_id,ownerId);
 assert.deepEqual(r.insert.department_packs,["acquisition","service_support"]);
});
test("AB4 cannot accept owner self review or broaden to Superadmin",()=>{
 for(const patch of [
  {reviewerId:ownerId},{departments:["owner_admin"]},
  {departments:["acquisition","acquisition"]},
  {emailSha256:"plain@example.invalid"},
  {requestId:"bad"},{nonce:"bad"},
  {expiresAt:new Date(now-1).toISOString()},
  {expiresAt:new Date(now+86400001).toISOString()},
  {expectedRosterRevision:-1},
  {browserEmail:"not allowed"}
 ])assert.equal(request({...req,...patch},{ownerId,now}).ok,false);
});
test("AB4 review command derives actor exclusively from current AAL2 Staff",()=>{
 const base={action:"REVIEW",requestId:uuid(3),decision:"APPROVED",
  decisionReference:uuid(7),signatureSha256:"b".repeat(64)};
 const r=decide(base,{reviewerId});
 assert.equal(r.ok,true);
 assert.equal(r.insert.reviewer_id,reviewerId);
 assert.equal(r.inviteSent,false);
 for(const patch of [
  {reviewerId:ownerId},
  {decision:"ACTIVATE"},
  {signatureSha256:"unverified"},
  {accountCreated:true}
 ]){
  const x=patch.reviewerId?decide(base,{reviewerId:patch.reviewerId}):
   decide({...base,...patch},{reviewerId});
  if(patch.reviewerId){assert.equal(x.insert.reviewer_id,patch.reviewerId);}
  else assert.equal(x.ok,false);
 }
});
test("AB4 actual Core route is default-deny without managed candidate table",()=>{
 const route=readFileSync(new URL(
  "../../../app/api/vox/v1/ab4-staff-review/route.ts",import.meta.url),"utf8");
 for(const token of [
  "VOX_AB4_STAFF_REVIEW_ENABLED",
  "VOX_STAFF_GRANTS_ENABLED",
  "VOX_DEPARTMENT_ENFORCEMENT_ENABLED",
  "verifyVoxOwnerBearer",
  "getVerifiedScopedStaff",
  "vox_ab3_staff_invitation_requests_candidate_v1",
  "vox_ab3_staff_invitation_decisions_candidate_v1",
  "accountCreated:false","inviteSent:false","grantsActivated:false",
  "INDEPENDENT_REVIEW_REVOKED_OR_DUPLICATE",
  "METHOD_NOT_ALLOWED"
 ])assert.match(route,new RegExp(token));
 assert.doesNotMatch(route,/auth\.admin\.inviteUserByEmail|auth\.admin\.createUser|sendMail|sendWhatsApp/);
});
