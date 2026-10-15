import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const route=readFileSync(new URL("../../../app/api/vox/v1/work-transitions/route.ts",import.meta.url),"utf8");
const sql=readFileSync(new URL("../../../ops/vox/sql-candidates/20261015030000_vox_to02e_work_queue_atomic_candidate.sql",import.meta.url),"utf8");
test("all three work gates default closed, verified remote AAL2 actor",()=>{
 for(const flag of ["VOX_STAFF_GRANTS_ENABLED","VOX_DEPARTMENT_ENFORCEMENT_ENABLED","VOX_WORK_ACTIONS_ENABLED"])
  assert.ok(route.includes('process.env.'+flag+'!=="staging"'));
 assert.match(route,/getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/);
 assert.doesNotMatch(route,/p_actor:data\.|p_actor:request\.|get\("x-role"\)/);
});
test("exact command keys, bounds, nonce/revision and no extended actions",()=>{
 assert.match(route,/EXACT_FIELDS/);
 assert.match(route,/UNKNOWN_OR_MISSING_FIELDS/);
 assert.match(route,/Number\.isSafeInteger\(data\.expectedRevision\)/);
 assert.match(route,/typeof data\.reason!=="string"/);
 assert.doesNotMatch(route,/\["CLAIM","ESCALATE"/);
 for(const action of ["CLAIM","START","WAIT_EXTERNAL","REQUEST_APPROVAL","BLOCK","RESUME","COMPLETE"])
  assert.ok(route.includes('"'+action+'"'));
});
test("RPC only, no browser actor, invites, messages, or provider execution",()=>{
 assert.match(route,/\.rpc\("qf_vox_work_transition_candidate_v1"/);
 assert.match(route,/p_actor:scoped\.userId/);
 assert.doesNotMatch(route,/\.insert\(|\.update\(|\.delete\(|inviteUserByEmail|fetch\(/);
 assert.match(route,/providerMessagesSent:0/);
 assert.match(route,/affectsVendorLeadMatching:false/);
 for(const method of ["GET","PUT","PATCH","DELETE"])
  assert.match(route,new RegExp("export function "+method+"\\(\\)"));
});
test("Core SQL binds current reviewed pack and canonical source city",()=>{
 for(const token of ["for update","vox_staff_department_capabilities_v1",
  "vox_staff_department_decisions_v1","vox_staff_object_scopes_v1",
  "VOX_WORK_PROSPECT_CITY_DENIED","VOX_WORK_VENDOR_CITY_DENIED",
  "VOX_WORK_SUPPORT_CITY_DENIED","VOX_WORK_STAFF_CAPACITY_REACHED"])
  assert.ok(sql.toLowerCase().includes(token.toLowerCase()),token);
 assert.match(sql,/v\.service_zone_id/);
 assert.match(sql,/p_action='CLAIM'/);
});
