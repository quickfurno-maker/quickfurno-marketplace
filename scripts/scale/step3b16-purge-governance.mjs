/** Production TEST-only purge safety gate. PURE / ADVISORY: absolutely no SQL writes.
 * This module deliberately refuses any release while immutable event history
 * prevents deleting 73 test-linked events; there is NO bypass in this branch.
 */
export const PROJECT_REF = "yqpgcsduqbxulrlzwzap";
export const RESTORED_SHA256 = "5EEAEC9949485E839126285EE2FF29E67363404BF8ABCDF063D9848A0161E797";
export const EXPECTED = Object.freeze({vendors:29,puneVendors:27,mumbaiVendors:2,leads:74,
  assignments:71,assignmentEvents:73,assignmentOperations:36,vendorCredits:81,
  linkedAuthUsers:9,authSessions:8,fkLinks:66,namedRefColumns:82});
export function evaluateTestDataPurge(e) {
 const blockers=[];
 const number=(x)=>Number.isSafeInteger(x)&&x>=0;
 if(e.projectRef!==PROJECT_REF||e.production!==true)blockers.push("WRONG_PRODUCTION_TARGET");
 if(e.archiveSha256!==RESTORED_SHA256||e.archiveHashVerified!==true)blockers.push("BACKUP_HASH_UNVERIFIED");
 if(!number(e.verifiedRestoredTableCount)||e.verifiedRestoredTableCount<21)
   blockers.push("AFFECTED_DATA_RESTORE_UNVERIFIED");
 if(e.fullSupabaseRecoveryVerified!==true)blockers.push("FULL_ROLLBACK_UNVERIFIED");
 for(const k of ["vendors","puneVendors","mumbaiVendors","leads","assignments",
   "assignmentEvents","assignmentOperations","vendorCredits","linkedAuthUsers",
   "authSessions","fkLinks","namedRefColumns"]){
  if(!number(e[k])||e[k]!==EXPECTED[k])blockers.push("EXPECTED_COUNT_DRIFT:"+k);
 }
 if(e.noGenuineCustomerOrVendorRecordsConfirmed!==true)
   blockers.push("GENUINE_DATA_EXCLUSION_UNCERTIFIED");
 if(e.immutableEventDeleteTriggerEnabled!==true)
   blockers.push("IMMUTABLE_LEDGER_TRIGGER_MISSING_OR_TAMPERED");
 if(e.immutableLedgerExceptionApprovedByIndependentReview!==true||
    e.immutableAuditPreservationProven!==true||
    e.scopedPurgeSecurityApproved!==true)
    blockers.push("IMMUTABLE_AUDIT_GOVERNANCE_HOLD");
 if(e.authAdminIdentitiesReviewed!==true||e.authSessionsRevocationPlanApproved!==true)
   blockers.push("AUTH_REVOCATION_GOVERNANCE_HOLD");
 if(e.financialAuditRetentionApproved!==true)
   blockers.push("FINANCE_AUDIT_RETENTION_HOLD");
 if(e.triggerSafeFullSchemaDryRunPassed!==true)
   blockers.push("REAL_SCHEMA_REHEARSAL_UNVERIFIED");
 if(e.ownerSpecificProductionReleaseApproval!==true)
   blockers.push("FINAL_OWNER_RELEASE_NOT_APPROVED");
 return Object.freeze({
  decision:blockers.length?"HOLD":"REQUIRES_SEPARATE_MANUAL_PRODUCTION_CHANGE",
  blockers:Object.freeze(blockers),
  advisoryOnly:true
 });
}
