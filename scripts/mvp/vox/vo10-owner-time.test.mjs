import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {buildVerifiedOwnerTeamTimeWindow} from "../../../contracts/vox/virtualOfficeOwnerTime.mjs";
const id=n=>String(n).padStart(8,"0")+"-0000-4000-8000-000000000001";
const now=Date.parse("2026-11-03T12:00:00Z");
const m=n=>({staffId:id(n),teamId:id(12),cityId:id(13),
 role:"acquisition_agent",verifiedNeutralStaff:true});
const shift=n=>({staff_id:id(n),team_id:id(12),city_id:id(13),
 revision:3,clocked_in_at:"2026-11-03T11:00:00Z",clocked_out_at:null,
 break_started_at:null,total_break_ms:600000,active_work_item_id:null,
 task_started_at:null,last_work_item_id:id(70),task_time_ms:1200000,
 last_event_at:"2026-11-03T11:45:00Z"});
const opts={ownerId:id(90),serverNowMs:now,
 rosterVerified:true,rowSourceVerified:true,hasMore:false};
test("VO10 Owner time uses actual Core Staff shift rows, not online inference",()=>{
 const r=buildVerifiedOwnerTeamTimeWindow([m(1),m(2)],[shift(1)],opts);
 assert.equal(r.ok,true,r.reason);assert.equal(r.staffCount,2);
 assert.equal(r.states.CLOCKED_IN,1);assert.equal(r.states.NOT_STARTED,1);
 assert.equal(r.attendanceMs,3600000);assert.equal(r.taskMs,1200000);
 assert.equal(r.breakMs,600000);assert.equal(r.unattributedMs,1800000);
 assert.equal(r.staff[0].teamRef,"TEAM-00000012");
 assert.equal(r.completeHistory,false);assert.equal(r.livePresence,false);
 assert.equal(r.officialEod,false);assert.equal(r.payrollVerified,false);
 assert.equal(r.moneyMinorUnits,0);assert.equal(r.providerMessagesSent,0);
 assert.equal("staffId" in r.staff[0],false);
});
test("VO10 rejects unverified sources, neutral identity mismatch and foreign rows",()=>{
 for(const o of [{...opts,rosterVerified:false},{...opts,rowSourceVerified:false},
  {...opts,ownerId:"invalid"}]){
  assert.equal(buildVerifiedOwnerTeamTimeWindow([m(1)],[shift(1)],o).ok,false);
 }
 for(const bad of [
  [{...m(1),role:"team_leader"}],
  [{...m(1),verifiedNeutralStaff:false}],
  [{...m(1),staffId:opts.ownerId}],
  [m(1),m(1)]
 ]){
  assert.equal(buildVerifiedOwnerTeamTimeWindow(bad,[shift(1)],opts).ok,false);
 }
 assert.equal(buildVerifiedOwnerTeamTimeWindow([m(1)],[shift(2)],opts).ok,false);
});
test("VO10 never trusts duplicated, cross-city or inflated time rows",()=>{
 const r=shift(1);
 for(const bad of [{...r,city_id:id(99)}, {...r,task_time_ms:900000000},
  {...r,staff_id:id(99)}]){
  assert.equal(buildVerifiedOwnerTeamTimeWindow([m(1)],[bad],opts).ok,false);
 }
 assert.equal(buildVerifiedOwnerTeamTimeWindow([m(1)],[r,r],opts).ok,false);
});
test("VO10 bounded first 20 window and truthful remaining marker",()=>{
 const members=Array.from({length:20},(_,i)=>m(i+1));
 const r=buildVerifiedOwnerTeamTimeWindow(members,[],{...opts,hasMore:true});
 assert.equal(r.ok,true,r.reason);assert.equal(r.staffCount,20);assert.equal(r.hasMore,true);
 assert.equal(buildVerifiedOwnerTeamTimeWindow([...members,m(21)],[],opts).ok,false);
});
test("VO10 Owner endpoint is source-hard-disabled and rechecks real Owner and Staff scopes",()=>{
 const route=readFileSync(new URL("../../../app/api/vox/v1/owner-team-time/route.ts",import.meta.url),"utf8");
 const bff=readFileSync(new URL("../../../apps/vox-web/lib/ownerTeamTime.ts",import.meta.url),"utf8");
 const page=readFileSync(new URL("../../../apps/vox-web/app/owner/team-time/page.tsx",import.meta.url),"utf8");
 assert.match(route,/VO10_MANAGED_OWNER_TIME_CERTIFIED=false as const/);
 assert.match(route,/verifyVoxOwnerBearer\(header\)/);
 assert.match(route,/freshOwner!==owner/);
 assert.match(route,/OWNER_OR_STAFF_SCOPE_CHANGED/);
 assert.match(route,/\.limit\(21\)/);
 assert.match(route,/\.gt\("expires_at",new Date\(\)\.toISOString\(\)\)/);
 assert.match(route,/new URL\(request\.url\)\.search/);
 assert.doesNotMatch(route,/request\.json\(\)|request\.text\(\)/);
 assert.match(bff,/verifiedMfaSession\(\)/);
 assert.match(bff,/r\.sourceVerified!==true/);
 assert.match(page,/fetchOwnerTeamTime\(\)/);
 assert.doesNotMatch(page,/navigator\.geolocation|setInterval|MediaRecorder/);
});
