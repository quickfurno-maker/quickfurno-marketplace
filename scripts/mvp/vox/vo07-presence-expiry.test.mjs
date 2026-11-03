import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectVerifiedTeamPresence,PRESENCE_TTL_MS}
 from "../../../contracts/vox/virtualOfficePresence.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const viewer={userId:id(1),teamId:id(2),cityId:id(3),role:"team_leader"};
const observation=(n,state,seenAtMs)=>({
 staffId:id(n),teamId:id(2),cityId:id(3),state,seenAtMs});
test("VO7 expired voluntary choice never fabricates OFFLINE or active headcount",()=>{
 const now=2_000_000;
 const result=projectVerifiedTeamPresence({viewer,roster:[id(4),id(5),id(6)],
  observations:[observation(4,"ONLINE",now-PRESENCE_TTL_MS-1),
   observation(5,"AWAY",now-PRESENCE_TTL_MS)],
  nowMs:now,rosterVerified:true});
 assert.equal(result.ok,true);
 assert.deepEqual(result.entries.map(x=>x.state),["UNKNOWN","AWAY","UNKNOWN"]);
 assert.equal(result.unknownStaffCount,2);
 assert.equal(result.latestObservationsVerified,1);
 assert.equal(result.attendanceVerified,false);
 assert.equal(result.timeTrackingVerified,false);
});
test("VO7 all expired voluntary observations remain unknown, no synthetic offline",()=>{
 const now=3_000_000;
 const result=projectVerifiedTeamPresence({viewer,roster:[id(4)],
  observations:[observation(4,"IN_MEETING",now-PRESENCE_TTL_MS-2000)],
  nowMs:now,rosterVerified:true});
 assert.equal(result.ok,true);
 assert.equal(result.entries[0].state,"UNKNOWN");
 assert.equal(result.latestObservationsVerified,0);
});
test("VO7 Web receipt cannot claim an inferred OFFLINE state",()=>{
 const web=readFileSync(new URL("../../../apps/vox-web/lib/teamPresence.ts",
  import.meta.url),"utf8");
 assert.match(web,/const states=new Set\(/);
 assert.doesNotMatch(web,/const states=new Set\([^\n]*"OFFLINE"/);
});
