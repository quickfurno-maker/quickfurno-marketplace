import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("single existing Superadmin + Staff Auth model, only canonical reviewed RPC route",()=>{
 const canonical=read("app/api/vox/v1/staff-departments/route.ts");
 assert.match(canonical,/verifyVoxOwnerBearer|verifyVoxStaffBearer/);
 assert.equal(existsSync(resolve(root,"app/api/vox/v1/staff-department-actions/route.ts")),false);
 assert.ok(existsSync(resolve(root,"contracts/vox/effectiveDepartments.mjs")));
 assert.ok(existsSync(resolve(root,"ops/vox/sql-candidates/20261015020000_vox_to02c_reviewed_department_actions.sql")));
});
test("cannot expose queue by enabling flag without real TL and department intersection",()=>{
 const queue=read("app/api/vox/v1/work-queue/route.ts");
 const reader=read("services/vox/verifiedScopedStaff.ts");
 const contract=read("contracts/vox/effectiveDepartments.mjs");
 assert.match(queue,/VOX_DEPARTMENT_ENFORCEMENT_ENABLED/);
 assert.match(queue,/getVerifiedScopedStaff/);
 assert.match(reader,/restrictScopedStaffByDepartment/);
 assert.match(reader,/db\.auth\.admin\.getUserById\(id\)/);
 assert.match(contract,/!liveReviewers\.has\(r\.decided_by\)/);
});
test("work mutation is not enabled by queue display; SQL never managed",()=>{
 const q=read("app/api/vox/v1/work-queue/route.ts");
 const w=read("app/api/vox/v1/work-transitions/route.ts");
 assert.match(q,/export function POST\(\)/);
 assert.match(w,/VOX_WORK_ACTIONS_ENABLED!=="staging"/);
 assert.match(w,/p_actor:scoped\.userId/);
 assert.ok(existsSync(resolve(root,"ops/vox/sql-candidates/20261015030000_vox_to02e_work_queue_atomic_candidate.sql")));
 assert.equal(existsSync(resolve(root,"supabase/migrations/20261015030000_vox_to02e_work_queue_atomic_candidate.sql")),false);
});
test("single Core+Web Staff session, read-only queue UI and owner-controlled setup",()=>{
 const bff=read("apps/vox-web/lib/core.ts");
 const env=read("apps/vox-web/.env.example");
 const page=read("apps/vox-web/app/team/work-queue/page.tsx");
 assert.match(bff,/fetchStaffWorkQueuePreview\([\s\S]*verifiedMfaSession\(\)/);
 assert.match(bff,/base\+"\/api\/vox\/v1\/work-queue"/);
 assert.match(bff,/x-content-type-options|CORE_STAFF_SCOPE_DENIED_OR_UNAVAILABLE/);
 assert.match(env,/VOX_WORK_QUEUE_UI_ENABLED=disabled/);
 // Preserve the original MFA Core reader even when independent AB3
 // department read executes concurrently. Never replace it with browser data.
 assert.ok(/await fetchStaffWorkQueuePreview\(\)/.test(page)||
  (/await Promise\.all\(\[/.test(page)&&
   /fetchStaffWorkQueuePreview\(\)/.test(page)&&
   /fetchAb3DomainWindow\(\)/.test(page)));
 if(page.includes("fetchAb3DomainWindow()")){
  const domain=read("apps/vox-web/lib/ab3Domain.ts");
  assert.match(domain,/verifiedMfaSession\(\)/);
  assert.match(domain,/VOX_AB3_DOMAIN_WEB_ENABLED/);
  assert.match(domain,/cache:"no-store"/);
 }
 assert.match(page,/<button type="button" disabled/);
 assert.doesNotMatch(page,/fetch\(|localStorage|sessionStorage|createUser|sendMessage/);
 assert.ok(existsSync(resolve(root,"apps/vox-web/app/team/admin/staff/page.tsx")));
});
test("Riya remains non-executable and EOD non-complete until authorized",()=>{
 const riya=read("contracts/vox/riyaHandoverPreparation.mjs");
 const eod=read("contracts/vox/coreWorkEodPreview.mjs");
 assert.match(riya,/requiresSignedJarvisPauseAck:true/);
 assert.match(riya,/executionAuthorized:false,providerMessagesSent:0/);
 assert.match(eod,/completeness:"PARTIAL_UNVERIFIED_TOTAL"/);
 assert.match(eod,/canSubmit:false/);
});
test("independent first TL bootstrap and full staging release still HOLD",()=>{
 const hold=JSON.parse(read("ops/vox/certification/TO04A-HOLD.json"));
 assert.equal(hold.status,"HOLD");
 assert.equal(hold.bootstrapIndependentReviewer,null);
 assert.equal(hold.productionActivationAuthorized,false);
 assert.equal(hold.canonicalGrantChain,null);
 const sql=read("ops/vox/sql-candidates/20261015020000_vox_to02c_reviewed_department_actions.sql");
 assert.match(sql,/r\.requested_by<>p_owner/);
});
