import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const route=readFileSync(new URL("../../../app/api/vox/v1/staff-directory/route.ts",import.meta.url),"utf8");
const sql=readFileSync(new URL("../../../ops/vox/sql-candidates/20261015010000_vox_to02b_staff_department_governance.sql",import.meta.url),"utf8");
test("directory requires independent Core Superadmin AAL2 verifier",()=>{
 assert.match(route,/verifyVoxOwnerBearer\(request\.headers\.get\("authorization"\)\)/);
 assert.match(route,/VOX_STAFF_DIRECTORY_ENABLED!=="staging"/);
 assert.match(route,/VOX_STAFF_GRANTS_ENABLED!=="staging"/);
});
test("directory returns bounded read only projections and never raw contact details",()=>{
 assert.match(route,/\.limit\(41\)/);
 assert.match(route,/membership\.data\.length>40/);
 assert.match(route,/actionsEnabled:false/);
 assert.match(route,/totalKnown:false/);
 assert.match(route,/no-store/);
 assert.doesNotMatch(route,/\.select\("[^"]*(email|phone|metadata|password|token)/i);
});
test("directory cannot grant or mutate staff records",()=>{
 assert.doesNotMatch(route,/db\.rpc\(|\.insert\(|\.update\(|\.delete\(|inviteUserByEmail/);
 for(const verb of ["POST","PUT","PATCH","DELETE"])
  assert.match(route,new RegExp("export function "+verb+"\\(\\)"));
});
test("additive SQL keeps existing staff role and old finalizer intact",()=>{
 assert.doesNotMatch(sql,/drop table|alter table public\.vox_staff_memberships_v1|create or replace function public\.qf_vox_activate_reviewed_access_v1/i);
 for(const table of ["requests","decisions","capabilities","activations","events"]){
  assert.match(sql,new RegExp("create table public\\.vox_staff_department_"+table+"_v1"));
  assert.match(sql,new RegExp("alter table public\\.vox_staff_department_"+table+"_v1 force row level security"));
 }
});
test("denies direct public actor rights and delete",()=>{
 assert.match(sql,/revoke all on public\.vox_staff_department_requests_v1 from public,anon,authenticated/);
 assert.doesNotMatch(sql,/grant (?:delete|all)\b.*to service_role/i);
 assert.doesNotMatch(sql,/grant .*to authenticated/i);
});
test("department requests bind identities and reject self-grants",()=>{
 assert.match(sql,/constraint vox_department_request_not_self check\(requested_by<>target_staff_id\)/);
 assert.match(sql,/request_nonce uuid not null unique/);
 assert.match(sql,/create unique index vox_staff_department_one_live_v1/);
 assert.match(sql,/check\(department in[\s\S]*client_success[\s\S]*vendor_success/);
});
