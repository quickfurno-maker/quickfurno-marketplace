import test from "node:test";
import assert from "node:assert/strict";
import {projectVerifiedStaffTimeRow,TIME_READ_SCHEMA}
 from "../../../contracts/vox/virtualOfficeTimeRead.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const asOf=Date.parse("2026-11-03T09:00:00Z");
const scope={staffId:id(1),teamId:id(2),cityId:id(3),serverNowMs:asOf,sourceVerified:true};
const row=()=>({staff_id:id(1),team_id:id(2),city_id:id(3),
 revision:3,clocked_in_at:"2026-11-03T08:00:00Z",clocked_out_at:null,
 break_started_at:null,total_break_ms:600000,active_work_item_id:null,
 task_started_at:null,last_work_item_id:id(4),task_time_ms:1200000,
 last_event_at:"2026-11-03T08:45:00Z"});
test("VO4 unknown Core source must never become zero attendance",()=>{
 assert.equal(projectVerifiedStaffTimeRow(null,{...scope,sourceVerified:false}).ok,false);
 const v=projectVerifiedStaffTimeRow(null,scope);
 assert.equal(v.status,"NOT_STARTED");assert.equal(v.officialEod,false);
});
test("VO4 verified current shift is bounded, never complete history",()=>{
 const v=projectVerifiedStaffTimeRow(row(),scope);
 assert.equal(v.ok,true);assert.equal(v.schema,TIME_READ_SCHEMA);
 assert.equal(v.attendanceMs,3600000);assert.equal(v.breakMs,600000);
 assert.equal(v.taskMs,1200000);assert.equal(v.netShiftMs,3000000);
 assert.equal(v.unattributedMs,1800000);assert.equal(v.completeHistory,false);
});
test("VO4 ongoing task adds only server-observed span",()=>{
 const v=projectVerifiedStaffTimeRow({...row(),active_work_item_id:id(4),
  task_started_at:"2026-11-03T08:50:00Z"},scope);
 assert.equal(v.ok,true);assert.equal(v.status,"TRACKING_TASK");
 assert.equal(v.taskMs,1800000);
});
test("VO4 break and task cannot overlap",()=>{
 const v=projectVerifiedStaffTimeRow({...row(),active_work_item_id:id(4),
  task_started_at:"2026-11-03T08:50:00Z",break_started_at:"2026-11-03T08:52:00Z"},scope);
 assert.equal(v.ok,false);
});
test("VO4 cross Staff/city/team, forged field and numeric inflation fail closed",()=>{
 for(const x of [{...row(),staff_id:id(99)},{...row(),city_id:id(99)},
  {...row(),team_id:id(99)},{...row(),refund:1},
  {...row(),task_time_ms:99999999},{...row(),revision:-1},
  {...row(),last_event_at:"2026-11-04T10:00:00Z"},
  {...row(),clocked_out_at:"2026-11-03T07:00:00Z"}])
  assert.equal(projectVerifiedStaffTimeRow(x,scope).ok,false);
});
test("VO4 end-shift metrics do not claim official EOD",()=>{
 const v=projectVerifiedStaffTimeRow({...row(),
  clocked_out_at:"2026-11-03T08:50:00Z"},scope);
 assert.equal(v.ok,true);assert.equal(v.status,"CLOCKED_OUT");
 assert.equal(v.attendanceMs,3000000);assert.equal(v.payrollVerified,false);
});
