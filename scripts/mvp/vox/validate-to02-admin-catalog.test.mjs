import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const core=readFileSync(new URL("../../../app/api/vox/v1/staff-capability-catalog/route.ts",import.meta.url),"utf8");
test("capability directory never offers a staff Admin role",()=>{
 assert.match(core,/verifyVoxOwnerBearer\(request\.headers\.get\("authorization"\)\)/);
 assert.match(core,/VOX_STAFF_GRANTS_ENABLED!=="staging"/);
 assert.match(core,/VOX_MULTI_DEPARTMENT_CATALOG_ENABLED!=="staging"/);
 assert.match(core,/mode:"READ_ONLY"/);
 assert.match(core,/requiresSeparateReview:true/);
 assert.match(core,/requiresObjectScopes:true/);
});
test("no authorization or login from browser-selected role",()=>{
 assert.doesNotMatch(core,/localStorage|query\.role|request\.headers\.get\("x-role"\)|getVerifiedScopedStaff/);
});
test("all mutation methods explicitly denied",()=>{
 for(const verb of ["POST","PUT","PATCH","DELETE"])
   assert.match(core,new RegExp("export const "+verb+"=denied"));
 assert.doesNotMatch(core,/\.insert\(|\.update\(|\.delete\(|inviteUserByEmail|createUser\(/);
});
