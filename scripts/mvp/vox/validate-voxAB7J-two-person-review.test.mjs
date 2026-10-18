import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const code=readFileSync(new URL("../../../ops/vox/sql-candidates/20261018120000_vox_ab7j_two_person_staff_suspend_candidate.sql",import.meta.url),"utf8");
test("AB7J Owner and TL use two separate authenticated AAL2 user identities",()=>{
 assert.match(code,/qf_vox_ab7j_owner_propose_staff_suspend_v1/);
 assert.match(code,/qf_vox_ab7j_tl_approve_staff_suspend_v1/);
 assert.equal((code.match(/auth\.uid\(\)/g)||[]).length,2);
 assert.equal((code.match(/auth\.jwt\(\)->>'aal'/g)||[]).length,2);
 assert.match(code,/req\.reviewer_id<>me/);
 assert.match(code,/req\.owner_id=me/);
});
test("AB7J service_role may not manufacture independent Staff review",()=>{
 assert.match(code,/from public,anon,authenticated,service_role/);
 assert.match(code,/grant execute on function public\.qf_vox_ab7j_tl_approve_staff_suspend_v1/);
 assert.match(code,/to authenticated;/);
 assert.doesNotMatch(code,/grant execute[\s\S]*to service_role;/);
});
