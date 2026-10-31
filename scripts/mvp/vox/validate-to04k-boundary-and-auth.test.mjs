
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {inspectVendorBoundary} from "./check-to04i-rls-boundary.mjs";
import {inspect as inspectMigrations} from "./verify-to04g-migration-history.mjs";
import {assess as inspectSchema} from "./check-to04c-schema-readiness.mjs";
import {protectedInputs} from "./run-to04j-protected-aal2.mjs";
const root=resolve(import.meta.dirname,"../../..");
const read=x=>readFileSync(resolve(root,x),"utf8");
test("real Supabase metadata and migration SHA/DBA gaps remain independently blocked",()=>{
 const rls=inspectVendorBoundary(JSON.parse(read("ops/vox/certification/TO04I-LIVE-RLS-BOUNDARY.json")));
 const mig=inspectMigrations(JSON.parse(read("ops/vox/certification/TO04G-READONLY-MIGRATION-METADATA.json")));
 const schema=inspectSchema(JSON.parse(read("ops/vox/certification/TO04C-LIVE-SCHEMA-EVIDENCE.json")));
 assert.equal(rls.ok,true);assert.equal(rls.releaseAllowed,false);
 assert.equal(mig.ok,true);assert.equal(mig.ready,false);
 assert.equal(schema.ok,undefined);
 assert.equal(schema.ready,false);
 assert.ok(rls.findings.some(x=>x.includes("STAGING_PRODUCTION_ACL_DRIFT")));
});
test("protected Stage Auth cannot execute without approved human + pinned host + three real tokens",()=>{
 assert.equal(protectedInputs({}).ready,false);
 const src=read("scripts/mvp/vox/run-to04j-protected-aal2.mjs");
 assert.match(src,/https:\/\/staging-core\.quickfurno\.in/);
 assert.match(src,/method:"GET"/);
 assert.match(src,/redirect:"error"/);
 assert.doesNotMatch(src,/method:"POST"|method:"PATCH"|method:"DELETE"|inviteUserByEmail|service_role/);
});
test("VOX same sole owner, one neutral Staff identity and current TL reviewer enforced",()=>{
 assert.equal(existsSync(resolve(root,"app/api/vox/v1/staff-department-actions/route.ts")),false);
 const staff=read("services/vox/verifiedScopedStaff.ts");
 assert.match(staff,/getVerifiedScopedStaff/);
 assert.match(staff,/restrictScopedStaffByDepartment/);
 assert.match(staff,/jwt\.aal!=="aal2"/);
 const hold=JSON.parse(read("ops/vox/certification/TO04A-HOLD.json"));
 assert.equal(hold.bootstrapIndependentReviewer,null);
 assert.equal(hold.productionActivationAuthorized,false);
 const riya=read("contracts/vox/riyaHandoverPreparation.mjs");
 assert.match(riya,/executionAuthorized:false/);
});
