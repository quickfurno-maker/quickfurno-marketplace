import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../../../app/api/vox/v1/staff-departments/route.ts",import.meta.url),"utf8");
test("two mandatory source flags default off",()=>{
 assert.match(src,/VOX_STAFF_GRANTS_ENABLED!=="staging"/);
 assert.match(src,/VOX_STAFF_DEPARTMENT_WRITES_ENABLED!=="staging"/);
});
test("owner Core AAL2 and TL remote AAL2 boundaries",()=>{
 assert.match(src,/getVerifiedScopedStaff\(token\)/);
 assert.match(src,/tl\?\.role==="team_leader"/);
 assert.match(src,/verifyVoxOwnerBearer\(token\)/);
 assert.doesNotMatch(src,/actor\s*=\s*data\.|actor\s*=\s*request\.headers\.get\("x-/);
});
test("request+review+activate+revoke use only governed SQL",()=>{
 for(const f of ["qf_vox_department_request_v1","qf_vox_department_review_v1",
  "qf_vox_department_activate_v1","qf_vox_department_revoke_v1"])
  assert.ok(src.includes(f));
 assert.doesNotMatch(src,/\.insert\(|\.update\(|\.delete\(|inviteUserByEmail|createUser\(/);
});
test("review requires distinct scoped Team Leader and revision zero",()=>{
 assert.match(src,/action==="review"\?\(tl\?\.role==="team_leader"\?tl.userId:null\)/);
 assert.match(src,/data\.revision!==0/);
});
test("all decisions are server-returned with expected Core receipts",()=>{
 assert.match(src,/item\.request_state!=="PENDING"/);
 assert.match(src,/item\.request_revision!==0/);
 assert.match(src,/item\.new_revision!==3/);
 assert.match(src,/effect:"REVIEW_ONLY"/);
 assert.match(src,/execution:"NO_CAPABILITY_ACTIVE"/);
});
test("feature gate denies non-enabled mutation",()=>assert.match(src,/DEPARTMENT_WRITES_DISABLED/));
test("transport and payload bounds",()=>{
 assert.match(src,/application\/json/);
 assert.match(src,/raw\.length>1600/);
 assert.match(src,/Date\.parse\(data\.expiresAt\)/);
});
test("no browser-controlled owner actor or raw Auth/Admin token",()=>{
 assert.doesNotMatch(src,/request\.headers\.get\("x-role"\)|data\.ownerId|data\.actorId/);
 assert.doesNotMatch(src,/service_role|process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
});
test("other HTTP methods explicitly fail closed",()=>{
 for(const method of ["GET","PUT","PATCH","DELETE"])
  assert.match(src,new RegExp("export function "+method+"\\(\\)"));
});
test("no raw user or company data emitted",()=>{
 assert.doesNotMatch(src,/select\(.*email|password|phone|wallet|chat_message/i);
 assert.match(src,/private, no-store/);
});
