import test from "node:test";
import assert from "node:assert/strict";
import {evaluateTestDataPurge,EXPECTED,PROJECT_REF,RESTORED_SHA256} from "./step3b16-purge-governance.mjs";
const all=()=>({
 projectRef:PROJECT_REF,production:true,archiveSha256:RESTORED_SHA256,
 archiveHashVerified:true,verifiedRestoredTableCount:21,fullSupabaseRecoveryVerified:true,
 ...EXPECTED,
 noGenuineCustomerOrVendorRecordsConfirmed:true,
 immutableEventDeleteTriggerEnabled:true,
 immutableLedgerExceptionApprovedByIndependentReview:true,
 immutableAuditPreservationProven:true,scopedPurgeSecurityApproved:true,
 authAdminIdentitiesReviewed:true,authSessionsRevocationPlanApproved:true,
 financialAuditRetentionApproved:true,triggerSafeFullSchemaDryRunPassed:true,
 ownerSpecificProductionReleaseApproval:true
});
test("G1 no evidence or wrong project fails closed",()=>{
 const v=evaluateTestDataPurge({});
 assert.equal(v.decision,"HOLD");assert.equal(v.advisoryOnly,true);
 assert.ok(v.blockers.includes("WRONG_PRODUCTION_TARGET"));
});
test("G2 actual current historical blocker cannot be waived by fresh backup alone",()=>{
 const e=all();
 e.immutableLedgerExceptionApprovedByIndependentReview=false;
 e.fullSupabaseRecoveryVerified=false;
 e.authSessionsRevocationPlanApproved=false;
 const v=evaluateTestDataPurge(e);
 assert.equal(v.decision,"HOLD");
 assert.ok(v.blockers.includes("IMMUTABLE_AUDIT_GOVERNANCE_HOLD"));
 assert.ok(v.blockers.includes("FULL_ROLLBACK_UNVERIFIED"));
 assert.ok(v.blockers.includes("AUTH_REVOCATION_GOVERNANCE_HOLD"));
});
test("G3 count mismatch in any protected root/related table denies purge",()=>{
 for(const k of Object.keys(EXPECTED)){
  const e=all();e[k]=e[k]+1;
  assert.ok(evaluateTestDataPurge(e).blockers.includes("EXPECTED_COUNT_DRIFT:"+k),k);
 }
});
test("G4 incorrect archive hash or missing exact restore evidence denies",()=>{
 for(const changes of [{archiveHashVerified:false},{archiveSha256:"bad"},
  {verifiedRestoredTableCount:9}]){
   const v=evaluateTestDataPurge({...all(),...changes});
   assert.equal(v.decision,"HOLD");
 }
});
test("G5 immutable trigger absent is a tamper indicator, not a safety pass",()=>{
 const v=evaluateTestDataPurge({...all(),immutableEventDeleteTriggerEnabled:false});
 assert.ok(v.blockers.includes("IMMUTABLE_LEDGER_TRIGGER_MISSING_OR_TAMPERED"));
});
test("G6 any missing separate Auth or financial signoff denies",()=>{
 for(const k of ["authAdminIdentitiesReviewed","authSessionsRevocationPlanApproved",
   "financialAuditRetentionApproved"]){
  const v=evaluateTestDataPurge({...all(),[k]:false});
  assert.equal(v.decision,"HOLD",k);
 }
});
test("G7 a successful evaluation is never an executable GO",()=>{
 const v=evaluateTestDataPurge(all());
 assert.equal(v.decision,"REQUIRES_SEPARATE_MANUAL_PRODUCTION_CHANGE");
 assert.equal(v.advisoryOnly,true);
});
test("G8 missing external-reviewed ledger exception always remains HOLD",()=>{
 for(const k of ["immutableLedgerExceptionApprovedByIndependentReview",
  "immutableAuditPreservationProven","scopedPurgeSecurityApproved"]){
  const v=evaluateTestDataPurge({...all(),[k]:false});
  assert.ok(v.blockers.includes("IMMUTABLE_AUDIT_GOVERNANCE_HOLD"));
 }
});
test("G9 final Owner signoff and trigger-aware rehearsal are independent",()=>{
 for(const k of ["ownerSpecificProductionReleaseApproval","triggerSafeFullSchemaDryRunPassed"]){
  assert.equal(evaluateTestDataPurge({...all(),[k]:false}).decision,"HOLD");
 }
});
test("G10 documented snapshot cannot be misconstrued as a full recovery",()=>{
 const e=all();e.fullSupabaseRecoveryVerified=false;
 assert.ok(evaluateTestDataPurge(e).blockers.includes("FULL_ROLLBACK_UNVERIFIED"));
});
