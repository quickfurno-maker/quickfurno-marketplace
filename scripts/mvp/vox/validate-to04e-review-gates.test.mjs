import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {assess} from "./check-to04c-schema-readiness.mjs";
const root=resolve(import.meta.dirname,"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const live=JSON.parse(read("ops/vox/certification/TO04C-LIVE-SCHEMA-EVIDENCE.json"));
const hold=JSON.parse(read("ops/vox/certification/TO04A-HOLD.json"));
test("live missing VOX DB objects and DBA approval block release",()=>{
 const verdict=assess(live);
 assert.equal(verdict.ready,false);
 assert.ok(verdict.blockers.includes("STAGING_VOX_SCHEMA_MISSING"));
 assert.equal(hold.productionActivationAuthorized,false);
 assert.equal(hold.bootstrapIndependentReviewer,null);
});
test("initial Team Leader signature is not a Core privilege bootstrap",()=>{
 const src=read("contracts/vox/firstTlAttestation.mjs");
 assert.match(src,/INDEPENDENT_APPROVED_SERVER_REGISTRY/);
 assert.match(src,/bootstrapAuthorized:false/);
 assert.match(src,/requiresIndependentDbaApprovedNonceConsumption:true/);
 assert.doesNotMatch(src,/\.from\(|\.rpc\(|inviteUserByEmail|createUser\(/);
});
test("source integration retains single canonical route, scoped work and no live client messages",()=>{
 assert.equal(existsSync(resolve(root,"app/api/vox/v1/staff-department-actions/route.ts")),false);
 assert.ok(existsSync(resolve(root,"app/api/vox/v1/staff-departments/route.ts")));
 assert.ok(existsSync(resolve(root,"services/vox/verifiedScopedStaff.ts")));
 const code=read("app/api/vox/v1/work-queue/route.ts");
 assert.match(code,/VOX_DEPARTMENT_ENFORCEMENT_ENABLED/);
 const riya=read("contracts/vox/riyaHandoverPreparation.mjs");
 assert.match(riya,/executionAuthorized:false/);
});
