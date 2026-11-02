import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../../../app/api/vox/v1/tl-assignments/route.ts",import.meta.url),"utf8");
test("VO5 Core Team Leader remains hard off",()=>{
 assert.match(src,/VO5_MANAGED_TL_ASSIGNMENT_CERTIFIED=false as const/);
 assert.match(src,/if\(!VO5_MANAGED_TL_ASSIGNMENT_CERTIFIED\|\|/);
 assert.match(src,/VOX_VO5_TL_ASSIGNMENT_WRITES_ENABLED!=="staging"/);
 assert.match(src,/VOX_VO5_TL_ASSIGNMENT_READ_ENABLED!=="staging"/);
});
test("VO5 Core verifies real AAL2 neutral TL and target without client claims",()=>{
 assert.match(src,/getVerifiedScopedStaff\(header\)/);
 assert.match(src,/getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/);
 assert.match(src,/getUserById\(targetId\)/);
 assert.match(src,/currentTarget:async\(targetId:string\)/);
 assert.match(src,/currentWork:async\(itemId:string\)/);
 assert.doesNotMatch(src,/body\.actorId|body\.teamId|body\.cityId/);
});
test("VO5 Team Leader metadata view is bounded and zero external sends",()=>{
 assert.match(src,/mode:"REFERENCES_ONLY",boundedWindow:true,totalKnown:false/);
 assert.match(src,/actionsEnabled:false,items:safeItems,staff/);
 assert.match(src,/\.limit\(21\)/);
 assert.match(src,/marketplaceLeadAssignmentsChanged:0/);
});
test("VO5 assignment uses atomic writer and same original nonce",()=>{
 assert.match(src,/assignScopedTeamWork\(body,/);
 assert.match(src,/vox_staff_object_scopes_v1/);
 assert.match(src,/vox_work_items_candidate_v1/);
 assert.match(src,/TL_ASSIGNMENT_OUTCOME_UNKNOWN/);
 assert.match(src,/retrySameNonceOnly:true/);
 assert.match(src,/vendorAssignmentsChanged:0,moneyMinorUnits:0/);
});
