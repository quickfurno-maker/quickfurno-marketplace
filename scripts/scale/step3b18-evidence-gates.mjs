/** Phase 3B-18A-E: pure read-only evidence adjudication, no managed DB interface.
 * An advisory REVIEW_READY never means Production approval or an executable GO.
 */
export const PROJECT="yqpgcsduqbxulrlzwzap";
export const ARCHIVE_SHA="5EEAEC9949485E839126285EE2FF29E67363404BF8ABCDF063D9848A0161E797";
export const EXPECTED=Object.freeze({
  vendors:29,puneVendors:27,mumbaiVendors:2,leads:74,assignments:71,
  events:73,assignmentOperations:36,vendorCredits:81,authVendorUsers:9,
  authIdentities:9,authVendorSessions:8,nonVendorAuthUsers:1,
  foreignKeyLinks:66,referenceColumns:82
});
const text=(v)=>typeof v==="string"&&v.trim().length>0;
const goodCommit=(v)=>typeof v==="string"&&/^[a-f0-9]{40}$/i.test(v);
const onlySafeInt=(v)=>Number.isSafeInteger(v)&&v>=0;
export function assessCleanupRelease(e={}){
 const track={A:[],B:[],C:[],D:[],E:[]};
 const deny=(t,reason)=>track[t].push(reason);
 if(e.projectRef!==PROJECT||e.environment!=="production")deny("E","WRONG_TARGET");
 if(e.archiveSha256!==ARCHIVE_SHA||e.archiveVerified!==true)deny("B","ARCHIVE_HASH_UNVERIFIED");
 if(e.restoredTableCount!==21||e.restoredRowCountsVerified!==true||e.restoredOrphans!==0)
   deny("B","SELECTED_TABLE_RESTORE_INCOMPLETE");
 for(const [name,expected] of Object.entries(EXPECTED)){
  if(!onlySafeInt(e.counts?.[name])||e.counts[name]!==expected)
    deny(name.startsWith("auth")||name==="nonVendorAuthUsers"?"C":"D","EXACT_COUNT_DRIFT:"+name);
 }
 if(e.eventsImmutableTriggerEnabled!==true||e.truncateGuardEnabled!==true)
   deny("A","IMMUTABILITY_INVARIANT_NOT_PROVEN");
 if(e.archivePreservesEventProofs!==true||e.archiveWormValidated!==true||
  e.retentionAndLegalReviewed!==true||e.independentLedgerReviewApproved!==true)
   deny("A","GOVERNED_AUDIT_PRESERVATION_NOT_APPROVED");
 if(e.backupIncludesPitrAndClusterRoles!==true||e.storageBinariesRestorable!==true||
   e.restorePostgis337!==true||e.restoreVault031!==true||
   e.fullFkRlsAuthCloneRestored!==true||e.fullRestoreRollbackPassed!==true)
   deny("B","FULL_SUPABASE_RECOVERY_UNCERTIFIED");
 if(e.ownerAccountExcludedFromDelete!==true||e.authCrossAppMembershipReviewed!==true||
   e.authAdminRevocationTested!==true||e.authDedicatedIdentitiesApproved!==true)
   deny("C","AUTH_LIFECYCLE_UNCERTIFIED");
 if(e.exactUuidAllowlistProtected!==true||e.jsonOpaqueReferencesReviewed!==true||
   e.fullSchemaTriggerDryRunPassed!==true||e.noLiveOrOutboxJobsRunning!==true)
   deny("D","FULL_SCHEMA_SCOPED_DRY_RUN_PENDING");
 if(!goodCommit(e.candidateCommit)||e.reviewerPinnedCommit!==e.candidateCommit||
   !text(e.reviewerIdentity)||e.independentDbaReviewApproved!==true||
   e.independentAppsecReviewApproved!==true||e.finalOwnerApproval!==true)
   deny("E","PINNED_RELEASE_APPROVAL_MISSING");
 const blockers=Object.freeze(Object.entries(track).flatMap(([k,v])=>v.map(x=>k+":"+x)));
 const tracks=Object.freeze(Object.fromEntries(Object.entries(track).map(([k,v])=>[
  k,Object.freeze({status:v.length?"HOLD":"EVIDENCE_PRESENT",blockers:Object.freeze(v)})
 ])));
 return Object.freeze({decision:blockers.length?"HOLD":"REQUIRES_SEPARATE_PRODUCTION_CHANGE",
   advisoryOnly:true,tracks,blockers});
}
