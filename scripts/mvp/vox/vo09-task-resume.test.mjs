import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectVerifiedStaffTimeRow} from "../../../contracts/vox/virtualOfficeTimeRead.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-11-03T10:00:00Z");
const scope={staffId:id(1),teamId:id(2),cityId:id(3),serverNowMs:now,sourceVerified:true};
const paused=()=>({
 staff_id:id(1),team_id:id(2),city_id:id(3),revision:4,
 clocked_in_at:"2026-11-03T09:00:00Z",clocked_out_at:null,
 break_started_at:null,total_break_ms:0,
 active_work_item_id:null,task_started_at:null,
 last_work_item_id:id(4),task_time_ms:300000,
 last_event_at:"2026-11-03T09:30:00Z"
});
test("VO9 exposes last paused task only in authoritative open, idle shift",()=>{
 const r=projectVerifiedStaffTimeRow(paused(),scope);
 assert.equal(r.ok,true);assert.equal(r.status,"CLOCKED_IN");
 assert.equal(r.resumeWorkItemId,id(4));
});
test("VO9 hides resume across break, active tracking, clockout, and no history",()=>{
 const cases=[
  {...paused(),break_started_at:"2026-11-03T09:50:00Z"},
  {...paused(),active_work_item_id:id(4),task_started_at:"2026-11-03T09:55:00Z"},
  {...paused(),clocked_out_at:"2026-11-03T09:58:00Z"},
  {...paused(),last_work_item_id:null}
 ];
 for(const row of cases){
  const r=projectVerifiedStaffTimeRow(row,scope);
  assert.equal(r.ok,true);
  assert.equal(r.resumeWorkItemId,null);
 }
 assert.equal(projectVerifiedStaffTimeRow(null,scope).resumeWorkItemId,null);
});
test("VO9 malformed paused-task reference never becomes selectable",()=>{
 for(const bad of ["javascript:alert(1)","not-an-id",99]){
  assert.equal(projectVerifiedStaffTimeRow({...paused(),last_work_item_id:bad},scope).ok,false);
 }
});
test("VO9 Workday only resumes assigned original task and preserves nonce",()=>{
 const component=readFileSync(new URL("../../../apps/vox-web/app/team/workday/WorkdayControls.tsx",import.meta.url),"utf8");
 const bridge=readFileSync(new URL("../../../apps/vox-web/lib/staffTime.ts",import.meta.url),"utf8");
 assert.match(component,/assignedWorkIds\.includes\(snapshot\.resumeWorkItemId\)/);
 assert.match(component,/action==="TASK_RESUME"\?snapshot\.resumeWorkItemId:workId/);
 assert.match(component,/clearPendingTimeCommand\(storage\(\),cmd,payload/);
 assert.match(bridge,/r\.status!=="CLOCKED_IN"&&r\.resumeWorkItemId!==null/);
});
