import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectVerifiedTeamPresence,PRESENCE_TTL_MS}
 from "../../../contracts/vox/virtualOfficePresence.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const viewer={userId:id(1),teamId:id(2),cityId:id(3),role:"team_leader"};
const staff=(n,state,seenAtMs)=>({staffId:id(n),teamId:id(2),cityId:id(3),
 state,seenAtMs});
const source=(path)=>readFileSync(new URL("../../../"+path,import.meta.url),"utf8");
test("VO6 unobserved remains UNKNOWN; expired verified observation becomes OFFLINE",()=>{
 const now=1000000;
 const r=projectVerifiedTeamPresence({viewer,roster:[id(4),id(5),id(6)],
  observations:[staff(4,"ONLINE",now-1000),
   staff(5,"AWAY",now-PRESENCE_TTL_MS-1)],nowMs:now,rosterVerified:true});
 assert.equal(r.ok,true);assert.equal(r.entries[0].state,"ONLINE");
 assert.equal(r.entries[1].state,"OFFLINE");
 assert.equal(r.entries[2].state,"UNKNOWN");
 assert.equal(r.unknownStaffCount,1);
 assert.equal(r.attendanceVerified,false);assert.equal(r.timeTrackingVerified,false);
});
test("VO6 foreign roster, duplicate, stale identity and unauthorized self-view fail",()=>{
 for(const variant of [
  {viewer:{...viewer,role:"staff"},roster:[id(4)],observations:[]},
  {viewer,roster:[id(4),id(4)],observations:[]},
  {viewer,roster:[id(4)],observations:[staff(99,"ONLINE",100)]},
  {viewer,roster:[id(4)],observations:[{...staff(4,"ONLINE",100),cityId:id(99)}]},
  {viewer,roster:[id(4)],observations:[]}
 ]){
  const r=projectVerifiedTeamPresence({
   ...variant,nowMs:1000,
   rosterVerified:variant===undefined?true:true
  });
  if(variant.roster.length===1&&variant.observations.length===0&&variant.viewer.role==="team_leader")
   assert.equal(r.ok,true);
  else assert.equal(r.ok,false);
 }
});
test("VO6 missing roster verification always fails, never synthetic online count",()=>{
 const r=projectVerifiedTeamPresence({viewer,roster:[id(4)],observations:[],
  nowMs:1000,rosterVerified:false});
 assert.equal(r.ok,false);
});
test("VO6 Core route and Web dashboard remain AAL2 scoped and hard disabled",()=>{
 const core=source("app/api/vox/v1/team-presence/route.ts");
 const web=source("apps/vox-web/lib/teamPresence.ts");
 const page=source("apps/vox-web/app/team/presence/page.tsx");
 assert.match(core,/VO6_MANAGED_PRESENCE_CERTIFIED=false as const/);
 assert.match(core,/getVerifiedScopedStaff\(header\)/);
 assert.match(core,/getUserById\(id\)/);
 assert.match(core,/same\(scope,refreshed\)/);
 assert.match(web,/verifiedMfaSession\(\)/);
 assert.match(web,/x\.liveRealtimeConnected!==false/);
 assert.match(web,/x\.attendanceVerified!==false/);
 assert.match(page,/fetchVerifiedTeamPresence\(\)/);
 assert.match(page,/not a live subscription or an attendance report/);
 assert.doesNotMatch(page,/setInterval|navigator\.geolocation|MediaRecorder/);
});
