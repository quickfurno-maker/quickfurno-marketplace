import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const path=new URL("../../../app/api/vox/v1/staff-time/route.ts",import.meta.url);
const source=readFileSync(path,"utf8");
test("VO3 HTTP time bridge stays literally uncertified regardless of env",()=>{
 assert.match(source,/const VO3_MANAGED_TIME_WRITER_CERTIFIED=false as const;/);
 assert.match(source,/if\(!VO3_MANAGED_TIME_WRITER_CERTIFIED\|\|/);
 assert.match(source,/VOX_VO3_TIME_WRITES_ENABLED!=="staging"/);
 assert.match(source,/VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"/);
 assert.doesNotMatch(source,/process\.env\.VOX_VO3_TIME_WRITES_ENABLED\s*=\s*["']staging["']/);
});
test("VO3 current Core Staff AAL2 and current object assignment never browser role",()=>{
 assert.match(source,/getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/);
 assert.match(source,/row\.data\.assignee_id===s\.userId/);
 assert.match(source,/row\.data\.team_id===s\.teamId/);
 assert.match(source,/row\.data\.city_id===s\.cityId/);
 assert.match(source,/row\.data\.state==="IN_PROGRESS"/);
 assert.doesNotMatch(source,/command\.actorId|command\.teamId|command\.cityId/);
});
test("VO3 exact shapes reject fake client timestamp and Staff identity",()=>{
 assert.match(source,/same\(command,task\(command\.action\)/);
 assert.match(source,/"action","nonce","expectedRevision","workItemId"/);
 assert.match(source,/"action","nonce","expectedRevision"/);
 assert.match(source,/TIME_WRITE_OUTCOME_UNKNOWN/);
 assert.match(source,/retrySameNonceOnly:true/);
 assert.match(source,/cache-control":"private, no-store/);
});
test("VO3 successful HTTP receipt cannot mint cash or claim Production",()=>{
 assert.match(source,/moneyMinorUnits:0,productionCertified:false/);
 assert.match(source,/providerMessagesSent:0/);
 assert.match(source,/outcome\.nonce!==command\.nonce/);
 assert.match(source,/outcome\.revision!==(command\.expectedRevision as number)\+1/);
 for(const method of ["GET","PUT","PATCH","DELETE"])
  assert.match(source,new RegExp('export function '+method+'\\(\\)'));
});
