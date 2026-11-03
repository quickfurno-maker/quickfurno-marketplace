import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../../../app/api/vox/v1/staff-time-state/route.ts",import.meta.url),"utf8");
test("VO4 current shift HTTP is hard disabled pending certified managed SQL",()=>{
 assert.match(src,/const VO4_MANAGED_TIME_READ_CERTIFIED=false as const/);
 assert.match(src,/if\(!VO4_MANAGED_TIME_READ_CERTIFIED\|\|/);
 assert.match(src,/VOX_VO4_TIME_READ_ENABLED!=="staging"/);
 assert.match(src,/VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"/);
});
test("VO4 reads only currently scoped Staff via existing real AAL2 authority",()=>{
 assert.match(src,/getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/);
 assert.match(src,/eq\("staff_id",scoped\.userId\)/);
 assert.match(src,/canReadContent!==true/);
 assert.match(src,/\["team_leader","auditor"\]/);
 assert.match(src,/same\(scoped as unknown/);
});
test("VO4 no user-provided date or identity nor falsely complete EOD",()=>{
 assert.match(src,/new URL\(request\.url\)\.search/);
 assert.match(src,/projectVerifiedStaffTimeRow\(result\.data/);
 assert.match(src,/serverNowMs:Date\.now\(\),sourceVerified:true/);
 assert.match(src,/CURRENT_SHIFT_INTEGRITY_UNVERIFIED/);
 assert.doesNotMatch(src,/request\.json\(\)|request\.text\(\)/);
 for(const method of ["POST","PUT","PATCH","DELETE"])
  assert.match(src,new RegExp("export function "+method+"\\(\\)"));
});
