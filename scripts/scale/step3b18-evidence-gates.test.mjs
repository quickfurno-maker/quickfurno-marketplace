import test from "node:test";
import assert from "node:assert/strict";
import {assessCleanupRelease,PROJECT,ARCHIVE_SHA,EXPECTED} from "./step3b18-evidence-gates.mjs";
const sha="b".repeat(40);
const complete=()=>({
 projectRef:PROJECT,environment:"production",archiveSha256:ARCHIVE_SHA,
 archiveVerified:true,restoredTableCount:21,restoredRowCountsVerified:true,
 restoredOrphans:0,counts:{...EXPECTED},
 eventsImmutableTriggerEnabled:true,truncateGuardEnabled:true,
 archivePreservesEventProofs:true,archiveWormValidated:true,
 retentionAndLegalReviewed:true,independentLedgerReviewApproved:true,
 backupIncludesPitrAndClusterRoles:true,storageBinariesRestorable:true,
 restorePostgis337:true,restoreVault031:true,fullFkRlsAuthCloneRestored:true,
 fullRestoreRollbackPassed:true,ownerAccountExcludedFromDelete:true,
 authCrossAppMembershipReviewed:true,authAdminRevocationTested:true,
 authDedicatedIdentitiesApproved:true,exactUuidAllowlistProtected:true,
 jsonOpaqueReferencesReviewed:true,fullSchemaTriggerDryRunPassed:true,
 noLiveOrOutboxJobsRunning:true,candidateCommit:sha,
 reviewerPinnedCommit:sha,reviewerIdentity:"independent-DBA-AppSec",
 independentDbaReviewApproved:true,independentAppsecReviewApproved:true,
 finalOwnerApproval:true
});
const fields={
 A:["eventsImmutableTriggerEnabled","truncateGuardEnabled","archivePreservesEventProofs",
    "archiveWormValidated","retentionAndLegalReviewed","independentLedgerReviewApproved"],
 B:["archiveVerified","restoredRowCountsVerified","backupIncludesPitrAndClusterRoles",
    "storageBinariesRestorable","restorePostgis337","restoreVault031",
    "fullFkRlsAuthCloneRestored","fullRestoreRollbackPassed"],
 C:["ownerAccountExcludedFromDelete","authCrossAppMembershipReviewed",
    "authAdminRevocationTested","authDedicatedIdentitiesApproved"],
 D:["exactUuidAllowlistProtected","jsonOpaqueReferencesReviewed",
    "fullSchemaTriggerDryRunPassed","noLiveOrOutboxJobsRunning"],
 E:["independentDbaReviewApproved","independentAppsecReviewApproved","finalOwnerApproval"]
};
test("1 no evidence fails closed for all five tracks",()=>{
 const v=assessCleanupRelease();
 assert.equal(v.decision,"HOLD");assert.equal(v.advisoryOnly,true);
 assert.deepEqual(Object.keys(v.tracks),["A","B","C","D","E"]);
 assert.ok(Object.values(v.tracks).every(t=>t.status==="HOLD"));
});
test("2 hypothetical all-green is only a separate manual change",()=>{
 const x=assessCleanupRelease(complete());
 assert.equal(x.decision,"REQUIRES_SEPARATE_PRODUCTION_CHANGE");
 assert.equal(x.advisoryOnly,true);assert.equal(x.blockers.length,0);
});
test("3 every A/B/C/D/E boolean prerequisite independently blocks",()=>{
 for(const [track,keys] of Object.entries(fields)){
  for(const key of keys){
   const e=complete();e[key]=false;
   const r=assessCleanupRelease(e);
   assert.equal(r.decision,"HOLD",key);
   assert.equal(r.tracks[track].status,"HOLD",key);
  }
 }
});
test("4 exact 29/74/71/73 and all financial/Auth/FK counts deny drift",()=>{
 for(const [key,n] of Object.entries(EXPECTED)){
  const e=complete();e.counts[key]=n+1;
  assert.ok(assessCleanupRelease(e).blockers.some(z=>z.endsWith("EXACT_COUNT_DRIFT:"+key)),key);
 }
});
test("5 malformed count and missing count deny",()=>{
 for(const c of [null,undefined,"29",-1,29.5,Infinity,NaN]){
  const e=complete();e.counts.vendors=c;
  assert.equal(assessCleanupRelease(e).decision,"HOLD",String(c));
 }
});
test("6 correct archive size or 21-table restore is not full recovery",()=>{
 for(const e of [
  {...complete(),fullRestoreRollbackPassed:false},
  {...complete(),backupIncludesPitrAndClusterRoles:false},
  {...complete(),storageBinariesRestorable:false}
 ])assert.ok(assessCleanupRelease(e).blockers.includes("B:FULL_SUPABASE_RECOVERY_UNCERTIFIED"));
});
test("7 custom manifest SHA is pinned and mismatch denies",()=>{
 const e=complete();e.archiveSha256="a".repeat(64);
 assert.ok(assessCleanupRelease(e).blockers.includes("B:ARCHIVE_HASH_UNVERIFIED"));
});
test("8 21-table data-only restore requires orphan and row proof",()=>{
 for(const changes of [{restoredTableCount:20},{restoredRowCountsVerified:false},{restoredOrphans:1}]){
  const v=assessCleanupRelease({...complete(),...changes});
  assert.ok(v.blockers.includes("B:SELECTED_TABLE_RESTORE_INCOMPLETE"));
 }
});
test("9 project and environment must be precise",()=>{
 for(const changes of [{projectRef:"staging"},{environment:"staging"},{projectRef:""}]){
  assert.ok(assessCleanupRelease({...complete(),...changes}).blockers.includes("E:WRONG_TARGET"));
 }
});
test("10 no source/reviewer commit mismatch allowed",()=>{
 for(const changes of [
  {reviewerPinnedCommit:"a".repeat(40)}, {candidateCommit:"nonsense"},
  {reviewerIdentity:""}, {reviewerIdentity:null}
 ]){
  assert.ok(assessCleanupRelease({...complete(),...changes})
   .blockers.includes("E:PINNED_RELEASE_APPROVAL_MISSING"));
 }
});
test("11 Owner separate approval does not waive independent review",()=>{
 const e=complete();e.independentDbaReviewApproved=false;
 assert.equal(assessCleanupRelease(e).decision,"HOLD");
});
test("12 append-only trigger disappearance is a BLOCKER not escape",()=>{
 const e=complete();e.eventsImmutableTriggerEnabled=false;
 assert.ok(assessCleanupRelease(e).blockers.includes("A:IMMUTABILITY_INVARIANT_NOT_PROVEN"));
});
test("13 missing JSON/outbox inspection independently blocks",()=>{
 for(const field of ["jsonOpaqueReferencesReviewed","noLiveOrOutboxJobsRunning"]){
  const e=complete();e[field]=false;
  assert.equal(assessCleanupRelease(e).tracks.D.status,"HOLD");
 }
});
test("14 vendor identity cannot be confused with lone non-vendor Auth",()=>{
 const e=complete();e.counts.nonVendorAuthUsers=0;
 assert.equal(assessCleanupRelease(e).tracks.C.status,"HOLD");
});
