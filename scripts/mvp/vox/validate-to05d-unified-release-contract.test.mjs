import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../../..");
const file=p=>readFileSync(resolve(root,p),"utf8");
test("VOX-05 single Core admin and one neutral Staff account, no alternate route",()=>{
 assert.equal(existsSync(resolve(root,"app/api/vox/v1/staff-department-actions/route.ts")),false);
 assert.ok(existsSync(resolve(root,"app/api/vox/v1/staff-departments/route.ts")));
 assert.match(file("services/vox/verifiedScopedStaff.ts"),/restrictScopedStaffByDepartment/);
 assert.match(file("contracts/vox/firstTlAttestation.mjs"),/bootstrapAuthorized:false/);
});
test("reviewed target and independently attested reviewer remain distinct at final Core activation",()=>{
 const sql=file("ops/vox/sql-candidates/20261015020000_vox_to02c_reviewed_department_actions.sql");
 assert.match(sql,/r\.decided_by=r\.target_staff_id/);
 assert.match(sql,/r\.requested_by<>p_owner/);
 assert.match(file("scripts/mvp/vox/fixtures/vox-to05a-department-work-assertions.sql"),/VOX_WORK_DEPARTMENT_NOT_REVIEWED/);
});
test("one synthetically tested PostgreSQL transaction and backup/restore verify revocation",()=>{
 const workflow=file(".github/workflows/vox-to05a-unified-pg17-restore.yml");
 assert.match(workflow,/vox-to02c-real-rpc-assertions\.sql/);
 assert.match(workflow,/vox-to05a-department-work-assertions\.sql/);
 assert.match(workflow,/pg_dump -Fc/);
 assert.match(workflow,/pg_restore --no-owner --exit-on-error/);
 assert.match(workflow,/vox-to05a-restored-state-assertions\.sql/);
});
test("Staff work hub and Owner setup are gated by existing Core identity, never invented actions",()=>{
 const web=file("apps/vox-web/app/team/page.tsx");
 assert.match(web,/fetchStaffOverview\(\)/);
 assert.match(web,/fetchAdminStaffCapabilityCatalog\(\)/);
 assert.match(web,/if\(!overview\.ok\)/);
 assert.match(web,/admin\.ok\?<section/);
 assert.match(web,/Actions disabled pending certification/);
 assert.doesNotMatch(web,/sendMessage|inviteUserByEmail|onClick|fetch\(/);
});
test("read-only client Riya and all current release gates stay blocked",()=>{
 const riya=file("contracts/vox/riyaHandoverPreparation.mjs");
 const flags=JSON.parse(file("ops/vox/certification/TO04A-HOLD.json"));
 assert.match(riya,/executionAuthorized:false,providerMessagesSent:0/);
 for(const k of ["backupRestoreRehearsed","actualSupabaseAuthAal2E2e",
  "signedCoreJarvisAgniCandidate","protectedHumanStagingApproval",
  "externalMessageEgressAuthorized","productionActivationAuthorized"])
  assert.equal(flags[k],false,k);
 assert.equal(flags.bootstrapIndependentReviewer,null);
 assert.equal(flags.canonicalGrantChain,null);
 assert.equal(flags.status,"HOLD");
});
