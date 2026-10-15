import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../../../ops/vox/sql-candidates/20261015020000_vox_to02c_reviewed_department_actions.sql",import.meta.url),"utf8");
const fixture=readFileSync(new URL("./fixtures/vox-to02c-real-rpc-assertions.sql",import.meta.url),"utf8");
test("Core ACTIVATE independently requires Owner != reviewer != target even after prior APPROVE",()=>{
 const activate=sql.split("create or replace function public.qf_vox_department_activate_v1(")[1]
  ?.split("create or replace function public.qf_vox_department_revoke_v1(")[0];
 assert.ok(activate);
 assert.match(activate,/r\.requested_by<>p_owner/);
 assert.match(activate,/r\.decided_by=p_owner/);
 assert.match(activate,/r\.decided_by=r\.target_staff_id/);
 assert.match(activate,/r\.target_staff_id=p_owner/);
});
test("real PG17 fixture simulates forged reviewed TL target and checks exact rejection",()=>{
 assert.match(fixture,/set target_staff_id='00000000-0000-4000-8000-000000000003'/);
 assert.match(fixture,/v_self_denied:=v_rejection='VOX_DEPT_ACTIVATION_STALE'/);
 assert.match(fixture,/if not v_self_denied then/);
 assert.match(fixture,/SELF_APPROVAL_CREATED_GRANT_OR_ACTIVATION/);
 assert.match(fixture,/set target_staff_id='00000000-0000-4000-8000-000000000002'/);
});
