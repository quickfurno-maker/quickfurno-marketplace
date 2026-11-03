import test from "node:test";
import assert from "node:assert/strict";
import {projectVerifiedTeamPresence,PRESENCE_TTL_MS}
 from "../../../contracts/vox/virtualOfficePresence.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const viewer={userId:id(1),teamId:id(2),cityId:id(3),role:"team_leader"};
const observed=(staffId,seenAtMs=1000,state="ONLINE")=>({
 staffId,teamId:id(2),cityId:id(3),seenAtMs,state});
const base={viewer,roster:[id(1),id(4)],observations:[observed(id(1))],
 nowMs:2000,rosterVerified:true};
test("VO2 verified roster distinguishes unavailable observation from offline",()=>{
 const r=projectVerifiedTeamPresence(base);
 assert.equal(r.ok,true);assert.equal(r.unknownStaffCount,1);
 assert.equal(r.entries[1].state,"UNKNOWN");
 assert.equal(r.attendanceVerified,false);assert.equal(r.timeTrackingVerified,false);
});
test("VO7 expired voluntary presence becomes UNKNOWN, not proof of offline",()=>{
 const r=projectVerifiedTeamPresence({...base,nowMs:1000+PRESENCE_TTL_MS+1});
 assert.equal(r.entries[0].state,"UNKNOWN");
 assert.equal(r.entries[1].state,"UNKNOWN");
});
test("VO2 verified Staff can view only own roster entry",()=>{
 const staff={...viewer,role:"staff"};
 assert.equal(projectVerifiedTeamPresence({...base,viewer:staff}).reason,
  "STAFF_PRESENCE_SCOPE_DENIED");
 const ok=projectVerifiedTeamPresence({...base,viewer:staff,roster:[id(1)]});
 assert.equal(ok.ok,true);assert.equal(ok.entries.length,1);
});
test("VO2 unverified roster/source cannot fabricate company metrics",()=>{
 for(const b of [{...base,rosterVerified:false},{...base,nowMs:-1},
  {...base,roster:[id(1),id(1)]},{...base,roster:[id(1),id(4),id(1)]},
  {...base,observations:[observed(id(1)),observed(id(1))]},
  {...base,observations:[observed(id(99))]}])
  assert.equal(projectVerifiedTeamPresence(b).ok,false);
});
test("VO2 cross-team and cross-city observations are denied",()=>{
 const r=projectVerifiedTeamPresence({...base,observations:[
  {...observed(id(1)),teamId:id(99)}]});
 assert.equal(r.ok,false);
 assert.equal(projectVerifiedTeamPresence({...base,observations:[
  {...observed(id(1)),cityId:id(99)}]}).ok,false);
});
test("VO2 user-supplied fake OFFLINE and future timestamps are denied",()=>{
 for(const o of [observed(id(1),1000,"OFFLINE"),
  observed(id(1),90000),{...observed(id(1)),isClockedIn:true},
  observed(id(1),1000,"WORKING_8_HOURS")])
  assert.equal(projectVerifiedTeamPresence({...base,observations:[o]}).ok,false);
});
test("VO2 zero verified staff roster is not a timekeeping event",()=>{
 const r=projectVerifiedTeamPresence({...base,roster:[],observations:[]});
 assert.equal(r.ok,true);assert.equal(r.entries.length,0);
 assert.equal(r.attendanceVerified,false);
});
