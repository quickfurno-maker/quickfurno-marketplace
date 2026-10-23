import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const evidence=JSON.parse(readFileSync(resolve(root,"ops/vox/certification/STEP3B4-ABCD-INTERNAL-REHEARSAL-20261023.json"),"utf8"));
const candidate=readFileSync(resolve(root,"docs/finance/sql-review/20261023010000_step3b4_is_admin_active_guard_REVIEW_ONLY.sql"),"utf8");
const guarded=readFileSync(resolve(root,"scripts/owner-superadmin-bootstrap-preflight.mjs"),"utf8");
const legacy=readFileSync(resolve(root,"scripts/grant-superadmin.mjs"),"utf8");
const checks=[
 ["evidence is explicitly synthetic offline, not deployment",evidence.schema==="qf.step3b4abcd.internal-prelaunch-rehearsal.v1" && evidence.trackA.managedStagingWrites===0 && evidence.releaseAuthorized===false],
 ["bounded backup source exact locked digest",evidence.environment.cloneSourceSha256==="E303BC25D904899459C56493F7D67B1960056DA4F4EAF78905B4F2F50AF75753"],
 ["disposable clone has no network/ports",evidence.environment.offlineNetworkMode==="none" && evidence.environment.publishedPorts===0],
 ["exact Phase22 source digest and two successful isolated runs",evidence.trackA.sourceMigrationSha256==="6F53E1781E4D2BD277645ED17B2EB635BE70F1D2C4DF7525CD176DFB0C2F28BA" && evidence.trackA.firstApplyExitCode===0 && evidence.trackA.reapplyExitCode===0],
 ["two principals, one inherited legacy role, RLS 4",evidence.trackA.post.principals===2 && evidence.trackA.post.legacySuperadminRoles===1 && evidence.trackA.post.rlsEnabledIdentityTables===4],
 ["local negative direct grants zero",evidence.trackA.post.anonDirectSelectGrants===0 && evidence.trackA.post.authenticatedDirectSelectGrants===0],
 ["rollback via exact backup gives original source shape",evidence.trackA.rollbackRehearsal.identityTablesAbsent===true && evidence.trackA.rollbackRehearsal.migrationHistory===86 && evidence.trackA.rollbackRehearsal.authUsers===2],
 ["source-only bootstrap never granted live owner",!evidence.trackB.bootstrapActualApplied && !evidence.trackB.executionWiredToLegacyGrantScript && !evidence.trackB.independentApproverVerified],
 ["legacy grant script still has partial grant order",legacy.indexOf('auth.admin.updateUserById')>=0 && legacy.indexOf('auth.admin.updateUserById')<legacy.indexOf('.from("profiles").upsert') && legacy.indexOf('.from("profiles").upsert')<legacy.indexOf('.from("identity_admin_roles")')],
 ["preflight fails closed for revoked and wrong target roles",guarded.includes("EXISTING_ADMIN_ROLE_REVOKED") && guarded.includes("TARGET_HAS_DIFFERENT_EXISTING_ADMIN_ROLE")],
 ["appsec finding on revocation helper referenced by 59 policies",evidence.trackC.liveRlsPoliciesReferencingIsAdmin===59 && evidence.trackC.offlineCloneInactiveAdminStillPassesIsAdmin===true],
 ["review-only SQL candidate enforces is_active without live deploy",candidate.includes("NOT A DEPLOYABLE MIGRATION") && candidate.includes("p.is_active IS TRUE") && candidate.includes("SECURITY DEFINER") && !evidence.trackC.independentReviewCertified],
 ["owns_vendor existing 22 RLS policy uses in review",evidence.trackC.liveRlsPoliciesReferencingOwnsVendor===22],
 ["focused QA enumerated without conflating release",evidence.trackD.ownerPreflightMockTests==="10/10 PASS" && evidence.trackD.financeFocusedTests==="79/79 PASS" && evidence.trackD.coreTypecheck==="PASS" && evidence.trackD.voxTypecheck==="PASS"],
 ["all managed release and MFA gates remain false",Object.values(evidence.hardHolds).every(v=>v===false)]
];
let total=0;for(const [label,ok] of checks){assert.ok(ok,label);console.log("PASS "+label);total++}
console.log("STEP3B4_ABCD_INTERNAL_EVIDENCE_PASS "+total+"/"+total+" RELEASE_HOLD");
