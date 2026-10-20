/**
 * VOX RC1 deterministic source release inventory, never an install/deploy.
 * Generated from a CLEAN checked-out exact Core git HEAD after final commit.
 * Private reviewers must independently validate all signatures and install.
 */
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {inspectAb7kFullVoxSources} from "./ab7kFullMigrationManifest.mjs";
const sha=/^[a-f0-9]{40}$/;
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const fail=reason=>Object.freeze({ok:false,reason,canDeploy:false,
 canInstallDatabase:false,canEnableProvider:false});
const guards=[
"contracts/vox/ab7mIdentityCutover.mjs",
"contracts/vox/ab7mDatabaseReleaseAssessment.mjs",
"contracts/vox/ab7nCanonicalCoreAclBaseline.mjs",
"app/api/vox/v1/staff-directory/route.ts",
"app/api/vox/v1/work-queue/route.ts",
"app/api/vox/v1/staff-notifications/route.ts",
"app/api/vox/v1/riya-client-cases/route.ts",
"app/api/vox/v1/staff-chat/route.ts",
"worker/voxAb7jSignedInternalOnce.mjs",
"contracts/vox/rc1CurrentStaffScope.mjs"
];
export const rc1ExternalSources=Object.freeze({
 jarvis:{repository:"quickfurno-maker/qf-jarvis",pullRequest:327,
  commit:"0e6f432985b156bcee148a3521165d2285384da7"},
 agni:{repository:"quickfurno-maker/qf-agni",pullRequest:87,
  commit:"6fa59afe8627f9a585189d759daa5bee6648c359"}
});
export function buildVoxRC1SourceCandidate({
 repoRoot,coreCommit,workingTreeClean,
 jarvisCommit=rc1ExternalSources.jarvis.commit,
 agniCommit=rc1ExternalSources.agni.commit
}={}){
 if(!repoRoot||!sha.test(coreCommit??"")||workingTreeClean!==true||
   jarvisCommit!==rc1ExternalSources.jarvis.commit||
   agniCommit!==rc1ExternalSources.agni.commit)
  return fail("EXACT_CLEAN_CORE_AND_REVIEWED_JARVIS_AGNI_HEADS_REQUIRED");
 const ddl=inspectAb7kFullVoxSources(repoRoot);
 if(!ddl.ok||ddl.totalFiles!==30||ddl.canApply!==false)
  return fail("ALL_THIRTY_REVIEWED_DDL_DIGESTS_REQUIRED");
 try{
  const tracked=guards.map(path=>Object.freeze({
   path,sha256:hash(readFileSync(resolve(repoRoot,path)))}));
  // The digest is stable for the same exact source candidate. It is not a
  // substitute for a separately signed human release attestation.
  const sourceDigest=hash(Buffer.from(
   JSON.stringify({coreCommit,jarvisCommit,agniCommit,
    ddlDigest:ddl.manifestDigest,tracked})));
  return Object.freeze({
   ok:true,schema:"qf.vox.rc1.source-candidate.v1",
   stage:"SOURCE_CERTIFIED_REVIEW_PENDING",
   releaseStatus:"HOLD",environment:"staging",
   core:{repository:"quickfurno-maker/quickfurno-marketplace",
    pullRequest:0,commit:coreCommit},
   jarvis:rc1ExternalSources.jarvis,agni:rc1ExternalSources.agni,
   ddl:Object.freeze({sourceCount:30,quarantinedFoundationCount:7,
    uninstalledCandidateCount:23,sourceDigest:ddl.manifestDigest,
    installedManagedTablesNotAsserted:true}),
   reviewedCode:tracked,sourceDigest,
   configuration:Object.freeze({
    outboundWhatsApp:"disabled",pushProvider:"disabled",
    autonomousAgents:"disabled",workerScheduler:"disabled",
    productionActions:"disabled",initialMigrations:"not-applied"}),
   independentDbaApproved:false,independentAppSecApproved:false,
   firstTeamLeaderGenuineMfaVerified:false,
   protectedStagingE2eCertified:false,ownerGoSigned:false,
   canDeploy:false,canInstallDatabase:false,canEnableProvider:false,
   blockingRequirements:Object.freeze([
    "INDEPENDENT_DBA_EFFECTIVE_SCHEMA_ACL_MIGRATION_MAPPING_AND_RESTORE",
    "INDEPENDENT_APPSEC_REVIEW_AND_SIGNED_KEY_CUSTODY",
    "GENUINE_OWNER_AND_DISTINCT_FIRST_TEAM_LEADER_AAL2",
    "RECHECK_SIGNED_FINAL_CORE_SHA_VS_MANAGED_DEPLOYMENT",
    "SIGNED_AUTHENTICATED_STAGING_NO_SEND_E2E",
    "SEPARATE_SIGNED_OWNER_GO_NO_GO"])
  });
 }catch{return fail("SOURCE_FILE_MISSING_OR_UNREADABLE");}
}
