import test from "node:test";
import assert from "node:assert/strict";
import {reviewVendorRlsScenario as vendor,reviewAdminRlsScenario as admin} from "../../contracts/vox/step3b7PolicyReview.mjs";
const uid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const v=()=>({role:"vendor",status:"active",actorUserId:uid(1),ownerUserId:uid(1),
 vendorId:uid(2),recordVendorId:uid(2),validSession:true,
 verifiedCurrentOwnership:true,resource:"accept_job"});
test("P0 policy review model never grants even active operational candidate",()=>{
 const a=vendor(v());assert.equal(a.candidateForReview,"ACTIVE_CASE");
 assert.equal(a.mayRead,false);assert.equal(a.mayMutate,false);
 assert.equal(a.actualRlsEvaluated,false);assert.equal(a.requiresIndependentAppsec,true);
});
test("P0 suspended operational vendor is deny case, no outbound or new work",()=>{
 for(const resource of ["new_lead","accept_job","payment_write","whatsapp_outbound","profile_change"]){
  const a=vendor({...v(),resource,status:"suspended"});
  assert.equal(a.candidateForReview,"DENY_CASE");assert.equal(a.maySend,false);
 }
});
test("P0 suspended vendor historical data requires product/AppSec decision, never auto-access",()=>{
 for(const resource of ["old_invoice","historic_dispute","prior_support_case","prior_notification"]){
  const a=vendor({...v(),resource,status:"suspended"});
  assert.equal(a.candidateForReview,"SUSPENDED_HISTORICAL_REQUIRES_DECISION");
  assert.equal(a.historicalBusinessDecisionApproved,false);assert.equal(a.mayRead,false);
 }
});
test("P0 inactive/revoked or forged cross-owner/cross-vendor/current scope loss denied",()=>{
 for(const patch of [{status:"inactive"},{status:"revoked"},{actorUserId:uid(99)},
  {recordVendorId:uid(99)},{verifiedCurrentOwnership:false},
  {validSession:false},{resource:"unknown"},{vendorId:"bad"},{ownerUserId:null}]){
  assert.equal(vendor({...v(),...patch}).candidateForReview,"DENY_CASE");
 }
});
test("P0 history candidate loses eligibility when session revoked or ownership removed",()=>{
 for(const patch of [{validSession:false},{verifiedCurrentOwnership:false},{recordVendorId:uid(9)}]){
  assert.equal(vendor({...v(),resource:"old_invoice",status:"suspended",...patch}).candidateForReview,"DENY_CASE");
 }
});
test("P0 inactive admin, stale token, AAL1, revoked role cannot become active review candidate",()=>{
 const a={role:"admin",status:"active",isActive:true,authSessionVerified:true,durableRoleActive:true,aal:"aal2"};
 assert.equal(admin(a).candidateForReview,"ACTIVE_ADMIN_REQUIRES_FULL_POLICY_REVIEW");
 for(const patch of [{status:"inactive"},{status:"revoked"},{isActive:false},
   {authSessionVerified:false},{durableRoleActive:false},{aal:"aal1"},{role:"staff"}]){
  assert.equal(admin({...a,...patch}).candidateForReview,"DENY_CASE");
 }
 assert.equal(admin(a).actualRlsAuthorized,false);assert.equal(admin(a).mayGrant,false);
});
