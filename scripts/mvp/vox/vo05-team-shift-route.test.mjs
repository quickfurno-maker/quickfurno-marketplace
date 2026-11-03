import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const s=readFileSync(new URL("../../../app/api/vox/v1/team-shifts/route.ts",import.meta.url),"utf8");
test("VO5 reports remain literal hard-OFF until managed source certified",()=>{
 assert.match(s,/VO5_MANAGED_TEAM_SHIFT_REPORT_CERTIFIED=false as const/);
 assert.match(s,/if\(!VO5_MANAGED_TEAM_SHIFT_REPORT_CERTIFIED\|\|/);
 assert.match(s,/VOX_VO5_TEAM_SHIFTS_ENABLED!=="staging"/);
});
test("VO5 reports require current verified TL AAL2, city and team recheck",()=>{
 assert.match(s,/getVerifiedScopedStaff\(header\)/);
 assert.match(s,/tl\.role!=="team_leader"/);
 assert.match(s,/latest\.teamId!==tl\.teamId/);
 assert.match(s,/latest\.cityId!==tl\.cityId/);
 assert.match(s,/canMutate!==false/);
});
test("VO5 roster must be complete and neutral, no global queries",()=>{
 assert.match(s,/eq\("team_id",tl\.teamId\)/);
 assert.match(s,/\.limit\(22\)/);
 assert.match(s,/getUserById\(id\)/);
 assert.match(s,/app_metadata\?\.admin_role!=null/);
 assert.match(s,/\.in\("staff_id",ids\)\.limit\(21\)/);
 assert.match(s,/rowSourceVerified:true/);
});
test("VO5 team-shift endpoint never submits EOD or writes money",()=>{
 assert.match(s,/buildVerifiedTeamShiftWindow\(members,ledger\.data/);
 assert.match(s,/return send\(result,200\)/);
 for(const method of ["POST","PUT","PATCH","DELETE"])
  assert.match(s,new RegExp("export function "+method+"\\(\\)"));
 assert.doesNotMatch(s,/\.rpc\(|\.insert\(|\.update\(/);
});
