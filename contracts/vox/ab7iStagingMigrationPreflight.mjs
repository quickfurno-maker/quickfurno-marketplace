/**
 * Read-only migration preflight. This does not fetch or install migrations.
 * It deliberately cannot certify launch if a single VOX base table is absent.
 */
const BASE=["communication_conversations","communication_conversation_events",
 "jarvis_os_operator_command_receipts","communication_preferences",
 "communication_suppressions","communication_consent_events"];
const VOX=["vox_staff_teams_v1","vox_staff_memberships_v1",
 "vox_staff_object_scopes_v1","vox_staff_department_capabilities_v1",
 "vox_staff_source_events_candidate_v1","vox_ab3_staff_source_snapshots_candidate_v1",
 "vox_ab7f_four_source_eod_candidate_v1"];
const digest=/^[a-f0-9]{64}$/;
export function assessAb7iStagingInventory({
 projectKind,tableNames,migrationSha256,rollbackSha256,
 signedIndependentReview=false,ownerGo=false
}={}){
 const deny=reason=>Object.freeze({ready:false,canApply:false,reason,
  missing:[],schemaDrift:false,managedChangesApplied:false});
 if(projectKind!=="QuickFurno Staging"||
  !Array.isArray(tableNames)||tableNames.length>1000||
  !tableNames.every(x=>typeof x==="string"&&/^[a-z0-9_]{1,90}$/.test(x))||
  new Set(tableNames).size!==tableNames.length)
  return deny("TRUSTED_STAGING_INVENTORY_REQUIRED");
 const names=new Set(tableNames);
 const missingBase=BASE.filter(x=>!names.has(x));
 const missingVox=VOX.filter(x=>!names.has(x));
 const partial=missingVox.length>0&&missingVox.length<VOX.length;
 const hashesOk=digest.test(migrationSha256??"")&&digest.test(rollbackSha256??"");
 const approved=signedIndependentReview===true&&ownerGo===true&&hashesOk;
 return Object.freeze({
  ready:missingBase.length===0&&missingVox.length===0&&approved,
  canApply:false, // separate DBA-controlled migration runner only
  reason:missingBase.length?"MISSING_CANONICAL_CORE_SCHEMA":
   partial?"PARTIALLY_INSTALLED_VOX_SCHEMA_HALT":
   missingVox.length?"VOX_MIGRATIONS_NOT_INSTALLED":
   !hashesOk?"MIGRATION_ROLLBACK_DIGESTS_NOT_VERIFIED":
   !approved?"INDEPENDENT_REVIEW_AND_OWNER_GO_REQUIRED":"SOURCE_SCHEMA_PREFLIGHT_ONLY",
  missing:missingBase.concat(missingVox),
  schemaDrift:partial,managedChangesApplied:false,
  requiredReleaseGates:["DBA_RECONCILIATION","APPSEC_INDEPENDENT_REVIEW",
   "OWNER_GO","AUTHENTICATED_STAGE_E2E"],
  sourceOnly:true
 });
}
export const ab7iRequiredCanonicalTables=Object.freeze([...BASE]);
export const ab7iRequiredVoxTables=Object.freeze([...VOX]);
