/**
 * AB7N independent artifact preflight for exact source change gates.
 * Never authorizes managed migration, deployment or provider actions.
 */
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {inspectAb7kFullVoxSources} from "./ab7kFullMigrationManifest.mjs";
const sha=x=>createHash("sha256").update(x).digest("hex");
const fail=reason=>Object.freeze({ok:false,reason,
 canDeploy:false,canApplyMigrations:false,
 canProvisionStaff:false,externalMessagesAuthorized:false});
export function inspectAb7nIntegratedReleaseTree(root){
 const manifest=inspectAb7kFullVoxSources(root);
 if(!manifest.ok||manifest.totalFiles!==30||
    manifest.releaseReady!==false||manifest.canApply!==false)
  return fail("UNCHANGED_PINNED_30_SQL_SOURCE_TREE_REQUIRED");
 const paths=[
 "app/api/vox/v1/riya-client-cases/route.ts",
 "app/api/vox/v1/staff-chat/route.ts",
 "worker/voxAb7jSignedInternalOnce.mjs",
 "contracts/vox/ab7nCanonicalCoreAclBaseline.mjs",
 "scripts/mvp/vox/validate-voxAB7N-canonical-acl.test.mjs",
 "scripts/mvp/vox/validate-voxAB7N-revocation-recheck.test.mjs"
 ];
 try{
  const files=Object.fromEntries(paths.map(path=>
   [path,readFileSync(resolve(root,path),"utf8")]));
  const client=files[paths[0]],chat=files[paths[1]],worker=files[paths[2]];
  if(!client.includes("CLIENT_CASE_AUTH_REVOKED_DURING_READ")||
   !client.includes("CLIENT_CASE_OBJECT_GRANT_REVOKED_DURING_READ")||
   !chat.includes("TEAM_CHAT_SCOPE_REVOKED_DURING_READ")||
   !worker.includes("INDEPENDENT_RELEASE_EXPIRED_DURING_PREFLIGHT"))
   return fail("LATE_AUTHORIZATION_OR_SIGNED_WORKER_GUARD_MISSING");
  const digest=sha(Buffer.from(paths.map(p=>p+"|"+sha(files[p])).join("\n")));
  return Object.freeze({
   ok:true,sourceBoundDigest:digest,sourceCount:paths.length,
   migrationDigest:manifest.manifestDigest,all30SourceSqlAccountedFor:true,
   canDeploy:false,canApplyMigrations:false,
   canProvisionStaff:false,externalMessagesAuthorized:false,
   requires:["CURRENT_INDEPENDENT_DBA_APPSEC_APPROVAL",
    "ACTUAL_MANAGED_STAGING_ACL_AND_RESTORE",
    "GENUINE_OWNER_AND_INDEPENDENT_TL_AAL2",
    "SEPARATE_SIGNED_OWNER_GO",
    "REAL_AUTHENTICATED_STAGING_E2E"]
  });
 }catch{return fail("MISSING_AB7N_SOURCE_OR_QA_EVIDENCE");}
}
