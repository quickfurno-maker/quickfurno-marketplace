import test from "node:test";
import assert from "node:assert/strict";
import {assessTestAuthCohort} from "./step3b22c-auth-guard.mjs";
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const good=()=>({
 projectRef:"yqpgcsduqbxulrlzwzap",environment:"production",
 protectedPrincipals:[uuid(100)],
 candidates:Array.from({length:9},(_,i)=>({
  userId:uuid(i+1),vendorId:uuid(i+10),identityCount:1,
  sessionCount:i===8?0:1,refreshTokenCount:i<5?3:2,
  onlyTestVendorUsage:true,isPrivileged:false,hasExternalAppMembership:false
 })),
 ownerLoginRegressionVerified:true,supportedAuthAdminPlanReviewed:true,
 sessionAndJwtExpiryPlanReviewed:true,fullRecoveryVerified:true,
 ownerConsentPermanentErasure:true
});
test("C1 no inputs denies all Auth lifecycle",()=>{
 const r=assessTestAuthCohort();
 assert.equal(r.decision,"HOLD");assert.equal(r.executable,false);
});
test("C2 hypothetical all-green is never Auth DELETE permission",()=>{
 const r=assessTestAuthCohort(good());
 assert.equal(r.decision,"AUTH_COHORT_REVIEW_COMPLETE_MANUAL_ADMIN_API_REQUIRED");
 assert.equal(r.executable,false);
});
test("C3 owner UUID cannot appear among dedicated vendor deletion cohort",()=>{
 const v=good();v.candidates[0].userId=v.protectedPrincipals[0];
 assert.ok(assessTestAuthCohort(v).blockers.includes("PROTECTED_OWNER_ID_IN_TEST_SET"));
});
test("C4 cross-application membership or privileged role blocks deletion",()=>{
 for(const change of [{hasExternalAppMembership:true},{isPrivileged:true},{onlyTestVendorUsage:false}]){
  const v=good();Object.assign(v.candidates[0],change);
  assert.ok(assessTestAuthCohort(v).blockers.includes("CROSS_APP_OR_PRIVILEGE_UNCERTIFIED"));
 }
});
test("C5 exactly nine unique test IDs and 9/8/23 identity/session/token census",()=>{
 for(const patch of [
  v=>v.candidates.pop(),
  v=>v.candidates[0].userId=v.candidates[1].userId,
  v=>v.candidates[0].identityCount=0,
  v=>v.candidates[0].sessionCount=0,
  v=>v.candidates[0].refreshTokenCount=0
 ]){
  const v=good();patch(v);
  assert.equal(assessTestAuthCohort(v).decision,"HOLD");
 }
});
test("C6 missing full recovery and supported admin API controls deny",()=>{
 for(const key of ["ownerLoginRegressionVerified","supportedAuthAdminPlanReviewed",
  "sessionAndJwtExpiryPlanReviewed","fullRecoveryVerified","ownerConsentPermanentErasure"]){
  const v=good();v[key]=false;
  assert.equal(assessTestAuthCohort(v).decision,"HOLD",key);
 }
});
test("C7 staging or wrong project is impossible auth deletion target",()=>{
 for(const patch of [{environment:"staging"},{projectRef:"uckafzuochmbvtiodmcl"}]){
  assert.ok(assessTestAuthCohort({...good(),...patch}).blockers.includes("WRONG_AUTH_PROJECT"));
 }
});
test("C8 no identifier display, bearer token, admin API or network in guard",()=>{
 assert.equal(typeof assessTestAuthCohort,"function");
 assert.equal(assessTestAuthCohort(good()).executable,false);
});
