import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const code=readFileSync(new URL("../../../app/api/vox/v1/staff-department-actions/route.ts",import.meta.url),"utf8");
test("Core writes are double-feature-gated and disabled without staging",()=>{
 assert.match(code,/VOX_STAFF_GRANTS_ENABLED!=="staging"/);
 assert.match(code,/VOX_DEPARTMENT_ACTIONS_ENABLED!=="staging"/);
});
test("actor is derived from real Core Auth AAL2 verifier and current scoped Team Leader",()=>{
 assert.match(code,/await verifyVoxOwnerBearer\(request\.headers\.get\("authorization"\)\)/);
 assert.match(code,/await getVerifiedScopedStaff\(request\.headers\.get\("authorization"\)\)/);
 assert.match(code,/leader\?\.role==="team_leader"/);
 assert.doesNotMatch(code,/data\.(?:authenticatedOwnerId|reviewerId|actorId|userId)/);
});
test("unknown fields, oversized bodies and arbitrary HTTP verbs rejected",()=>{
 assert.match(code,/raw.length>1300/);
 assert.match(code,/UNKNOWN_OR_MISSING_FIELDS/);
 assert.match(code,/Object\.keys\(data\)\.sort\(\)/);
 for(const method of ["GET","PUT","PATCH","DELETE"])
   assert.match(code,new RegExp("export function "+method+"\\(\\)"));
});
test("review and activation require exact independent revision",()=>{
 assert.match(code,/data.expectedRevision!==0/);
 assert.match(code,/data.expectedRevision!==1/);
 assert.match(code,/data.expectedRevision!==2/);
 assert.match(code,/qf_vox_review_department_v1/);
 assert.match(code,/qf_vox_activate_department_v1/);
 assert.match(code,/qf_vox_revoke_department_v1/);
});
test("allowed pack list has no admin or team-leader escalation",()=>{
 assert.match(code,/const PACKS=new Set\(\["client_success","vendor_success","acquisition","service_support"\]\)/);
 assert.doesNotMatch(code,/PACKS=new Set\([^\n]*"admin"/);
});
test("no external/provider side-effects or service-role exposure",()=>{
 assert.doesNotMatch(code,/inviteUserByEmail|sendWhatsApp|sendMessage|fetch\(|redirect:|SUPABASE_SERVICE_ROLE_KEY|process\.env\.SERVICE_ROLE/i);
 assert.match(code,/providerMessagesSent:0/);
 assert.match(code,/objectGrantsAdded:0/);
 assert.match(code,/cache-control":"private, no-store/);
});
test("mutation uses only reviewed SQL RPC names",()=>{
 for(const method of ["qf_vox_request_department_v1","qf_vox_review_department_v1",
   "qf_vox_activate_department_v1","qf_vox_revoke_department_v1"])
  assert.ok(code.includes(method));
 assert.equal((code.match(/db\.rpc\(/g)||[]).length,4);
});
