import test from "node:test";
import assert from "node:assert/strict";
import {buildVerifiedTeamShiftWindow,TEAM_SHIFT_SCHEMA}
 from "../../../contracts/vox/virtualOfficeTeamShiftRead.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={leaderId:id(1),teamId:id(2),cityId:id(3),
 serverNowMs:Date.parse("2026-11-03T09:00:00Z"),
 rosterVerified:true,rowSourceVerified:true};
const m=n=>({staffId:id(n),teamId:id(2),cityId:id(3),
 role:"support_agent",verifiedNeutralStaff:true});
const r=n=>({staff_id:id(n),team_id:id(2),city_id:id(3),
 revision:1,clocked_in_at:"2026-11-03T08:00:00Z",
 clocked_out_at:null,break_started_at:null,total_break_ms:0,
 active_work_item_id:null,task_started_at:null,last_work_item_id:null,
 task_time_ms:0,last_event_at:"2026-11-03T08:00:00Z"});
test("VO5 confirmed two-member roster with one real shift never claims payroll or live presence",()=>{
 const x=buildVerifiedTeamShiftWindow([m(7),m(8)],[r(7)],scope);
 assert.equal(x.ok,true);assert.equal(x.schema,TEAM_SHIFT_SCHEMA);
 assert.equal(x.staffCount,2);assert.equal(x.states.CLOCKED_IN,1);
 assert.equal(x.states.NOT_STARTED,1);assert.equal(x.attendanceMs,3600000);
 assert.equal(x.completeHistory,false);assert.equal(x.officialEod,false);
 assert.equal(x.payrollVerified,false);assert.equal(x.livePresence,false);
 assert.deepEqual(Object.keys(x.staff[0]).sort(),[
 "staffRef","status","attendanceMs","breakMs","taskMs","unattributedMs"].sort());
});
test("VO5 error, unknown and incomplete roster are NOT zero productivity",()=>{
 for(const s of [{...scope,rosterVerified:false},
  {...scope,rowSourceVerified:false},{...scope,serverNowMs:NaN}]){
  assert.equal(buildVerifiedTeamShiftWindow([m(7)],[],s).ok,false);
 }
 assert.equal(buildVerifiedTeamShiftWindow([m(7)],[],scope).ok,true);
});
test("VO5 cross city, duplicated person, TL self, anonymous candidate denied",()=>{
 for(const members of [[m(7),m(7)],[{...m(7),cityId:id(88)}],
  [{...m(7),verifiedNeutralStaff:false}],
  [{...m(7),role:"team_leader"}],[m(1)]])
  assert.equal(buildVerifiedTeamShiftWindow(members,[],scope).ok,false);
});
test("VO5 foreign/duplicate/tampered ledger rows fail closed",()=>{
 for(const rows of [[r(89)],[r(7),r(7)],[{...r(7),team_id:id(99)}],
  [{...r(7),task_time_ms:999999999}]])
   assert.equal(buildVerifiedTeamShiftWindow([m(7)],rows,scope).ok,false);
});
test("VO5 20-person bound enforced even with valid staff",()=>{
 const members=Array.from({length:21},(_,i)=>m(i+7));
 assert.equal(buildVerifiedTeamShiftWindow(members,[],scope).ok,false);
});
