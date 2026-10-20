/** AB-7M strict read-only actual-managed-Staging schema and migration gate.
 * Snapshot values were queried independently from QuickFurno Staging.
 * No SQL execution, no migration scheduling, no approval authority.
 */
const six=Object.freeze({
 columns:"2441|9353af8b65889b2a4ba5823e2d821a5d",
 functions:"212|55c5ab92e50a8d5426c45b1b873a22a8",
 triggers:"75|5f45a978554dd40104eb1cf16f1960a3",
 indexes:"708|a948e7608a8aea7ec3dbdb80b7a17e6a",
 constraints:"1103|2426ec853fd70573f6be691feb9c0f3a",
 rlsPolicies:"74|1074f4271259203defff256380386a42"});
const stop=(reason,drift=[])=>Object.freeze({ok:false,reason,drift,
 sourceSchemaCompatible:false,releaseAuthorized:false,
 canInstall:false,canApplyMigrations:false,rollbackAuthorized:false,
 nextGate:"INDEPENDENT_DBA_APPSEC_CURRENT_SCHEMA_AND_ACL_SIGNOFF"});
export function inspectAb7mStagingDatabase({
 environment,projectRef,readAtMs,now=Date.now(),
 columns,functions,triggers,indexes,constraints,rlsPolicies,
 installedVoxTables,stagingAppliedMigrations,authUsers,verifiedMfaFactors,
 quarantinedFoundationCount,candidateSqlCount,
 stagingOnlyVersionIds,repoOnlyVersionIds,
 currentAclsReviewed=false,rollbackRestoreApproved=false
}={}){
 if(environment!=="staging"||projectRef!=="uckafzuochmbvtiodmcl"||
  !Number.isSafeInteger(readAtMs)||!Number.isSafeInteger(now)||
  readAtMs>now||now-readAtMs>60000)
  return stop("FRESH_ACTUAL_QUICKFURNO_STAGING_READ_ONLY_EVIDENCE_REQUIRED");
 const drift=Object.entries(six).filter(([k,v])=>({columns,functions,triggers,indexes,
 constraints,rlsPolicies})[k]!==v).map(([k])=>k);
 if(drift.length)return stop("LIVE_STAGING_SCHEMA_CHANGED_REAUDIT_BEFORE_DEPLOY",drift);
 if(![installedVoxTables,stagingAppliedMigrations,authUsers,verifiedMfaFactors,
      quarantinedFoundationCount,candidateSqlCount,
      stagingOnlyVersionIds,repoOnlyVersionIds].every(x=>Number.isSafeInteger(x)&&x>=0))
  return stop("COMPLETE_ACTUAL_MANAGED_STAGING_INVENTORY_REQUIRED");
 if(quarantinedFoundationCount!==7||candidateSqlCount!==23||
  stagingAppliedMigrations!==86||stagingOnlyVersionIds!==31||
  repoOnlyVersionIds!==107)
  return stop("MANAGED_MIGRATION_RECONCILIATION_CHANGED");
 if(installedVoxTables!==0)
  return stop("PARTIAL_OR_UNREVIEWED_MANAGED_VOX_INSTALLATION_DETECTED");
 if(authUsers!==1||verifiedMfaFactors!==0)
  return stop("MANAGED_IDENTITY_STATE_CHANGED_RECHECK_REQUIRED");
 return Object.freeze({
  ok:true,sourceSchemaCompatible:true,releaseAuthorized:false,
  canInstall:false,canApplyMigrations:false,rollbackAuthorized:false,
  currentAclsReviewed:currentAclsReviewed===true,
  rollbackRestoreApproved:rollbackRestoreApproved===true,
  migrationSemanticMappingComplete:false,
  archiveSchemaOnlyParity:true,managedStagingModified:false,
  unresolvedVersionAliases:stagingOnlyVersionIds,
  repoVersionsNotInManagedHistory:repoOnlyVersionIds,
  outstanding:["INDEPENDENT_DBA_SEMANTIC_VERSION_MAPPING",
   "INDEPENDENT_APPSEC_AND_PRIVILEGES_REVIEW",
   "SIGNED_RESTORE_AND_FORWARD_SQL",
   "FIRST_TEAM_LEADER_REAL_AAL2",
   "OWNER_SIGNED_PROTECTED_STAGING_GO"],
  reason:"SCHEMA_ONLY_PARITY_PROVEN_BUT_MANAGED_INSTALL_REQUIRES_APPROVAL"});
}
export const ab7mPinnedStagingCatalog= six;
