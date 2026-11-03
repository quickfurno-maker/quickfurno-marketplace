/** 3B-18/3B-20: pure advisory cleanup release assessment.
 * This module has no database, Auth, secrets, filesystem, or destructive APIs.
 * Green hypothetical evidence never grants permission to execute a live DELETE.
 */
export const PROJECT="yqpgcsduqbxulrlzwzap";
export const STAGING_PROJECT="uckafzuochmbvtiodmcl";
export const ARCHIVE_SHA="679457E1FEFB79FBB2996F11E3BAD6077FCE476C430FA3996F82565066BF516F";
export const STAGING_ARCHIVE_SHA="720165400E7B8807CAFEC19D81AF9B9C606FD234A1D3B95FD6B285D996FBD1A5";
export const EXPECTED=Object.freeze({
 vendors:29,puneVendors:27,mumbaiVendors:2,leads:74,assignments:71,
 events:73,assignmentOperations:36,vendorCredits:81,authVendorUsers:9,
 authIdentities:9,authVendorSessions:8,nonVendorAuthUsers:1,
 foreignKeyLinks:66,referenceColumns:82
});
export const STAGING_EXPECTED=Object.freeze({
 vendors:26,leads:7,assignments:9,events:6,vendorCredits:6,
 authVendorUsers:0,nonVendorAuthUsers:2,outsideScopeVendors:1
});
// For drift detection only: sorted UUID-set MD5s are NOT forensic proof or custody hashes.
export const ID_FINGERPRINTS=Object.freeze({
 production:Object.freeze({
  vendors:"767228fc486c378f500df83af36da4b6",
  leads:"fccc2594dd5ce49bc12c590f6f9f2dff"
 }),
 staging:Object.freeze({
  vendors:"b3437e2ec13bcc794f77783eab598749",
  leads:"de829b5d5c1f5e2109407805454bcbf7"
 })
});
const text=(v)=>typeof v==="string"&&v.trim().length>0;
const goodCommit=(v)=>typeof v==="string"&&/^[a-f0-9]{40}$/i.test(v);
const onlySafeInt=(v)=>Number.isSafeInteger(v)&&v>=0;
const expectedCounts=(e,expected,track,deny,prefix)=>{
 for(const [name,count] of Object.entries(expected)){
  if(!onlySafeInt(e?.[name])||e[name]!==count)
   deny(name.startsWith("auth")||name==="nonVendorAuthUsers"?"C":track,
    "EXACT_COUNT_DRIFT:"+prefix+name);
 }
};
export function assessCleanupRelease(e={}){
 const track={A:[],B:[],C:[],D:[],E:[]};
 const deny=(t,reason)=>track[t].push(reason);
 if(e.projectRef!==PROJECT||e.environment!=="production")deny("E","WRONG_TARGET");
 if(e.stagingProjectRef!==STAGING_PROJECT)deny("E","WRONG_STAGING_TARGET");

 if(e.archiveSha256!==ARCHIVE_SHA||e.archiveVerified!==true||
    e.stagingArchiveSha256!==STAGING_ARCHIVE_SHA||e.stagingArchiveVerified!==true)
   deny("B","NOV3_ARCHIVE_HASH_UNVERIFIED");
 if(e.restoredTableCount!==21||e.restoredRowCountsVerified!==true||e.restoredOrphans!==0)
   deny("B","SELECTED_TABLE_RESTORE_INCOMPLETE");
 expectedCounts(e.counts,EXPECTED,"D",deny,"");
 expectedCounts(e.stagingCounts,STAGING_EXPECTED,"D",deny,"STAGING_");
 for(const env of ["production","staging"]){
  for(const root of ["vendors","leads"]){
   if(e.idFingerprints?.[env]?.[root]!==ID_FINGERPRINTS[env][root])
    deny("D","TARGET_IDSET_DRIFT:"+env.toUpperCase()+"_"+root);
  }
 }
 if(e.eventsImmutableTriggerEnabled!==true||e.truncateGuardEnabled!==true)
   deny("A","IMMUTABILITY_INVARIANT_NOT_PROVEN");
 if(e.archivePreservesEventProofs!==true||e.archiveWormValidated!==true||
   e.retentionAndLegalReviewed!==true||e.independentLedgerReviewApproved!==true)
   deny("A","GOVERNED_AUDIT_PRESERVATION_NOT_APPROVED");
 for(const domain of ["assignmentEvents","campaignAudience","vendorInternalNotes","automationHistory"]){
  if(e.oneTimeErasureExceptionReviewed?.[domain]!==true)
   deny("A","PROTECTED_HISTORY_EXCEPTION_NOT_REVIEWED:"+domain);
 }
 if(e.backupIncludesPitrAndClusterRoles!==true||e.storageBinariesRestorable!==true||
   e.restorePostgis337!==true||e.restoreVault031!==true||
   e.fullFkRlsAuthCloneRestored!==true||e.fullRestoreRollbackPassed!==true)
   deny("B","FULL_SUPABASE_RECOVERY_UNCERTIFIED");
 if(e.nov3FullSchemaIsolatedRestorePassed!==true||
    e.productionPublicRlsTables!==141||e.stagingPublicRlsTables!==142||
    e.productionValidatedForeignKeys!==272||e.stagingValidatedForeignKeys!==272||
    e.freshSnapshotDriftRechecked!==true)
   deny("B","NOV3_FULL_SCHEMA_AND_LIVE_DRIFT_UNVERIFIED");
 if(e.ownerAccountExcludedFromDelete!==true||e.authCrossAppMembershipReviewed!==true||
   e.authAdminRevocationTested!==true||e.authDedicatedIdentitiesApproved!==true)
   deny("C","AUTH_LIFECYCLE_UNCERTIFIED");
 if(e.backupTestDataRetentionPlanApproved!==true||
    e.externalProviderCopiesDispositionReviewed!==true)
   deny("C","RESIDUAL_TEST_DATA_ERASURE_UNCERTIFIED");
 if(e.exactUuidAllowlistProtected!==true||e.jsonOpaqueReferencesReviewed!==true||
   e.fullSchemaTriggerDryRunPassed!==true||e.noLiveOrOutboxJobsRunning!==true)
   deny("D","FULL_SCHEMA_SCOPED_DRY_RUN_PENDING");
 if(e.stagingCanaryVerifiedPresent!==true||e.stagingLiveErasureCertified!==true||
    e.productionWorkerFreezeVerified!==true||e.providerOutboxFreezeVerified!==true)
   deny("D","STAGING_AND_WORKER_FREEZE_PENDING");
 if(e.managedProductionReadOnlyAccessApproved!==true)
   deny("E","MANAGED_PRODUCTION_ACCESS_DENIED");
 if(!goodCommit(e.candidateCommit)||e.reviewerPinnedCommit!==e.candidateCommit||
   !text(e.reviewerIdentity)||e.independentDbaReviewApproved!==true||
   e.independentAppsecReviewApproved!==true||e.finalOwnerApproval!==true)
   deny("E","PINNED_RELEASE_APPROVAL_MISSING");
 const blockers=Object.freeze(Object.entries(track).flatMap(([k,v])=>v.map(x=>k+":"+x)));
 const tracks=Object.freeze(Object.fromEntries(Object.entries(track).map(([k,v])=>[
  k,Object.freeze({status:v.length?"HOLD":"EVIDENCE_PRESENT",blockers:Object.freeze(v)})
 ])));
 return Object.freeze({
  decision:blockers.length?"HOLD":"REQUIRES_SEPARATE_PRODUCTION_CHANGE",
  advisoryOnly:true,tracks,blockers
 });
}
