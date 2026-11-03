import test from "node:test";
import assert from "node:assert/strict";
import {assessCleanupRelease,PROJECT,STAGING_PROJECT,ARCHIVE_SHA,STAGING_ARCHIVE_SHA,EXPECTED,STAGING_EXPECTED,ID_FINGERPRINTS} from "./step3b18-evidence-gates.mjs";
const sha="b".repeat(40);
const complete=()=>({
 projectRef:PROJECT,environment:"production",stagingProjectRef:STAGING_PROJECT,
 archiveSha256:ARCHIVE_SHA,archiveVerified:true,
 stagingArchiveSha256:STAGING_ARCHIVE_SHA,stagingArchiveVerified:true,
 restoredTableCount:21,restoredRowCountsVerified:true,
 restoredOrphans:0,counts:{...EXPECTED},stagingCounts:{...STAGING_EXPECTED},
 idFingerprints:{production:{...ID_FINGERPRINTS.production},staging:{...ID_FINGERPRINTS.staging}},
 eventsImmutableTriggerEnabled:true,truncateGuardEnabled:true,
 oneTimeErasureExceptionReviewed:{assignmentEvents:true,campaignAudience:true,
  vendorInternalNotes:true,automationHistory:true},
 archivePreservesEventProofs:true,archiveWormValidated:true,
 retentionAndLegalReviewed:true,independentLedgerReviewApproved:true,
 backupIncludesPitrAndClusterRoles:true,storageBinariesRestorable:true,
 restorePostgis337:true,restoreVault031:true,fullFkRlsAuthCloneRestored:true,
 fullRestoreRollbackPassed:true,nov3FullSchemaIsolatedRestorePassed:true,
 productionPublicRlsTables:141,stagingPublicRlsTables:142,
 productionValidatedForeignKeys:272,stagingValidatedForeignKeys:272,
 freshSnapshotDriftRechecked:true,ownerAccountExcludedFromDelete:true,
 authCrossAppMembershipReviewed:true,authAdminRevocationTested:true,
 authDedicatedIdentitiesApproved:true,backupTestDataRetentionPlanApproved:true,
 externalProviderCopiesDispositionReviewed:true,exactUuidAllowlistProtected:true,
 jsonOpaqueReferencesReviewed:true,fullSchemaTriggerDryRunPassed:true,
 noLiveOrOutboxJobsRunning:true,stagingCanaryVerifiedPresent:true,
 stagingLiveErasureCertified:true,productionWorkerFreezeVerified:true,
 providerOutboxFreezeVerified:true,managedProductionReadOnlyAccessApproved:true,
 candidateCommit:sha,
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
 assert.ok(assessCleanupRelease(e).blockers.includes("B:NOV3_ARCHIVE_HASH_UNVERIFIED"));
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

test("15 November production and staging archive SHA-256 values are independently pinned",()=>{
 for(const changes of [{stagingArchiveSha256:"0".repeat(64)}, {stagingArchiveVerified:false},
   {archiveSha256:"0".repeat(64)}, {archiveVerified:false}]){
  const r=assessCleanupRelease({...complete(),...changes});
  assert.equal(r.decision,"HOLD");
  assert.ok(r.blockers.includes("B:NOV3_ARCHIVE_HASH_UNVERIFIED"));
 }
});
test("16 Staging canary and all unrelated Staging Auth users must survive",()=>{
 for(const [field,change] of [["outsideScopeVendors",0],["nonVendorAuthUsers",1],["vendors",27]]){
  const e=complete();e.stagingCounts[field]=change;
  const r=assessCleanupRelease(e);
  assert.equal(r.decision,"HOLD");
  assert.ok(r.blockers.some(x=>x.endsWith("EXACT_COUNT_DRIFT:STAGING_"+field)));
 }
 assert.equal(assessCleanupRelease({...complete(),stagingCanaryVerifiedPresent:false}).decision,"HOLD");
});
test("17 every Pune/Mumbai vendor and lead UUID fingerprint is fail-closed",()=>{
 for(const env of ["production","staging"]){
  for(const root of ["vendors","leads"]){
   const e=complete();e.idFingerprints[env][root]="0".repeat(32);
   assert.ok(assessCleanupRelease(e).blockers.includes(
    "D:TARGET_IDSET_DRIFT:"+env.toUpperCase()+"_"+root));
  }
 }
});
test("18 a full-schema copy without full Supabase role/ACL/PITR recovery still HOLD",()=>{
 for(const changes of [{fullRestoreRollbackPassed:false},
   {productionPublicRlsTables:140},{stagingPublicRlsTables:141},
   {productionValidatedForeignKeys:271},{stagingValidatedForeignKeys:271},
   {nov3FullSchemaIsolatedRestorePassed:false},{freshSnapshotDriftRechecked:false}]){
  const r=assessCleanupRelease({...complete(),...changes});
  assert.equal(r.decision,"HOLD");
 }
});
test("19 each append-only table family needs independent exceptional review",()=>{
 for(const domain of ["assignmentEvents","campaignAudience","vendorInternalNotes","automationHistory"]){
  const e=complete();e.oneTimeErasureExceptionReviewed[domain]=false;
  assert.ok(assessCleanupRelease(e).blockers.includes(
   "A:PROTECTED_HISTORY_EXCEPTION_NOT_REVIEWED:"+domain));
 }
});
test("20 owner consent and offline proof cannot waive managed access or staged live UAT",()=>{
 for(const changes of [{managedProductionReadOnlyAccessApproved:false},
   {stagingLiveErasureCertified:false},{productionWorkerFreezeVerified:false},
   {providerOutboxFreezeVerified:false},{noLiveOrOutboxJobsRunning:false},
   {backupTestDataRetentionPlanApproved:false},{externalProviderCopiesDispositionReviewed:false}]){
  assert.equal(assessCleanupRelease({...complete(),...changes}).decision,"HOLD");
 }
});
test("21 real current evidence cannot claim green before independent release",()=>{
 const e=complete();
 e.managedProductionReadOnlyAccessApproved=false; // tool safety check denied SELECT
 e.stagingLiveErasureCertified=false; // no live Staging deletion
 e.productionWorkerFreezeVerified=false;
 e.providerOutboxFreezeVerified=false;
 e.backupIncludesPitrAndClusterRoles=false;
 e.storageBinariesRestorable=false;
 e.independentDbaReviewApproved=false;
 e.independentAppsecReviewApproved=false;
 e.oneTimeErasureExceptionReviewed={};
 const r=assessCleanupRelease(e);
 assert.equal(r.decision,"HOLD");
 assert.equal(r.advisoryOnly,true);
 assert.ok(r.blockers.includes("E:MANAGED_PRODUCTION_ACCESS_DENIED"));
 assert.ok(r.blockers.includes("D:STAGING_AND_WORKER_FREEZE_PENDING"));
 assert.ok(r.blockers.includes("B:FULL_SUPABASE_RECOVERY_UNCERTIFIED"));
 assert.ok(r.blockers.includes("E:PINNED_RELEASE_APPROVAL_MISSING"));
});
