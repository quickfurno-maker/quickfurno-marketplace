import {readFileSync,readdirSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
const root=resolve(import.meta.dirname,"../../..");
export const MANIFEST="ops/vox/certification/VOX-PR300-MANAGED-SQL-RELEASE-HOLD.json";
const old=[
 "20261014010000_vox_v1_scoped_staff_authority.sql",
 "20261014020000_vox_v1_staff_review_workflow.sql",
 "20261014030000_vox_v1_approved_grant_finalizer.sql",
 "20261014040000_vox_v1_staff_emergency_revocation.sql",
 "20261014050000_vox_v1_team_leader_review_policy.sql",
 "20261014060000_vox_operational_intent_review.sql",
 "20261014070000_vox_approved_followup_executor.sql"
].map(name=>"ops/vox/quarantined-migrations/legacy-20261014/"+name);
const newer=[
 "20261015010000_vox_to02b_staff_department_governance.sql",
 "20261015020000_vox_to02c_reviewed_department_actions.sql",
 "20261015030000_vox_to02e_work_queue_atomic_candidate.sql"
].map(name=>"ops/vox/sql-candidates/"+name);
const approvals=["independentDbReviewer","securityReviewer","firstTeamLeaderHumanReviewer",
 "original86LedgerSqlBytesReconciled","originalStagingBackupRestoredInIsolation",
 "protectedStageAal2IdorConsentCertified","signedImmutableDeployRollback","ownerGoNoGo"];
const deployment=["managedMigrationAutoApplyPermitted","activationFlagsEnabled",
 "aiProviderSendsEnabled","productionAuthorized"];
const fail=error=>({ok:false,releaseAllowed:false,error});
export function checkVoxPr300MigrationHold(
 evidence,read=(p)=>readFileSync(resolve(root,p)),
 listManaged=()=>readdirSync(resolve(root,"supabase/migrations"))
){
 if(!evidence||typeof evidence!=="object"||
   evidence.schema!=="qf.vox.release.migration.quarantine.v2"||
   !Array.isArray(evidence.legacyManagedMigrations)||
   !Array.isArray(evidence.proposedSqlCandidates))
  return fail("INVALID_SOURCE_PROVENANCE");
 const names1=evidence.legacyManagedMigrations.map(x=>x?.path);
 const names2=evidence.proposedSqlCandidates.map(x=>x?.path);
 if(JSON.stringify(names1)!==JSON.stringify(old)||
    JSON.stringify(names2)!==JSON.stringify(newer))return fail("MISSING_OR_REORDERED_MANAGED_SQL");
 // Fail closed on any surprise managed VOX migration not independently
 // inventoried. Checking only listed SQL blobs misses an eighth migration
 // added beside the seven known files. This is source integrity, not
 // deployment permission or a substitute for actual reviewer signatures.
 let managed;
 try{managed=listManaged();}catch{return fail("MANAGED_MIGRATION_DISCOVERY_FAILED");}
 if(!Array.isArray(managed)||managed.some(x=>typeof x!=="string"))
  return fail("MANAGED_MIGRATION_DISCOVERY_INVALID");
 const observed=managed.filter(n=>/vox/i.test(n)&&n.endsWith(".sql")).sort();
 const expected=[];
 if(JSON.stringify(observed)!==JSON.stringify(expected))
  return fail("UNDECLARED_MANAGED_VOX_SQL");
 const all=[...evidence.legacyManagedMigrations,...evidence.proposedSqlCandidates];
 for(const item of all){
  if(item.approvedForAutoApply!==false||
     typeof item.gitBlobSha!=="string"||
     !/^[0-9a-f]{40}$/.test(item.gitBlobSha))return fail("UNAPPROVED_SQL_DIGEST");
  let bytes;
  try{bytes=read(item.path);}catch{return fail("MISSING_SOURCE_SQL:"+item.path);}
  if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
  const blobSha=createHash("sha1")
   .update("blob "+bytes.byteLength+"\0").update(bytes).digest("hex");
  if(blobSha!==item.gitBlobSha)return fail("SOURCE_SQL_CHANGED_REVIEW_REQUIRED:"+item.path);
 }
 for(const env of ["staging","production"]){
  const v=evidence.databaseReadiness?.[env];
  if(!v||v.checked!==true||v.recordedMigrations!==86||
    v.voxMigrationVersionsApplied!==0||v.missingVoxTables!==13||
    !Array.isArray(v.baselineCoreTablesPresent)||
    !["cities","profiles","aarohi_tasks","aarohi_events","aarohi_prospects"]
      .every(n=>v.baselineCoreTablesPresent.includes(n)))
   return fail("LIVE_METADATA_RECONCILIATION_NEEDED:"+env);
 }
 if(evidence.schemaTracks?.canonicalSelected!==false||
    evidence.schemaTracks.duplicateAuthorityReviewed!==false||
    evidence.schemaTracks.independentGrantDecisionSignatureVerified!==false)
  return fail("CANONICAL_GRANT_CHAIN_UNAPPROVED");
 if(!evidence.approvals||!approvals.every(k=>evidence.approvals[k]===false))
  return fail("INDEPENDENT_APPROVALS_UNVERIFIED");
 if(!evidence.deployment||!deployment.every(k=>evidence.deployment[k]===false))
  return fail("UNAUTHORIZED_DEPLOYMENT_STATE");
 return Object.freeze({ok:true,releaseAllowed:false,
  reason:"QUARANTINED_TWO_SQL_AUTHORITY_TRACKS_UNAPPROVED_LIVE_SCHEMA_ABSENT",
  managedMigrationCount:0,quarantinedLegacyCount:old.length,unappliedCandidateCount:newer.length,
  latestStageAndProductionVoxTablesPresent:0,
  independentDbaAndStageReviewRequired:true});
}
const report=checkVoxPr300MigrationHold(
 JSON.parse(readFileSync(resolve(root,MANIFEST),"utf8")));
if(process.argv[1]&&import.meta.url===new URL("file://"+resolve(process.argv[1])).href){
 console.log(JSON.stringify(report));
 if(process.argv.includes("--release-check"))process.exit(report.releaseAllowed?0:42);
 process.exit(report.ok?0:1);
}
