import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectVerifiedTlTaskHistory}
 from "../../../contracts/vox/virtualOfficeTlTaskHistory.mjs";
import {decodeHistoryCursor}
 from "../../../contracts/vox/virtualOfficeHistoryCursor.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-11-03T11:00:00Z");
const members=[{staffId:id(1),teamId:id(2),cityId:id(3),
 role:"support_agent",verifiedNeutralStaff:true}];
const scope={leaderId:id(99),teamId:id(2),cityId:id(3),
 serverNowMs:now,rosterVerified:true,rowSourceVerified:true};
const event=n=>({
 closed_by_event_nonce:id(200+n),staff_id:id(1),team_id:id(2),
 city_id:id(3),work_item_id:id(4),
 started_at:"2026-11-03T10:00:00.123000+00:00",
 ended_at:"2026-11-03T10:00:00.123456+00:00",
 elapsed_ms:0,state_revision:n,closing_action:"TASK_STOP"
});
test("VO11 Team Leader older-page pointer binds original immutable 20th nonce",()=>{
 const rows=Array.from({length:21},(_,i)=>event(21-i));
 const projected=projectVerifiedTlTaskHistory(members,rows,scope);
 assert.equal(projected.ok,true,projected.reason);
 assert.equal(projected.hasMore,true);assert.equal(projected.entries.length,20);
 assert.deepEqual(decodeHistoryCursor(projected.nextCursor,now),{
  endedAt:rows[19].ended_at,nonce:rows[19].closed_by_event_nonce
 });
 const last=projectVerifiedTlTaskHistory(members,rows.slice(0,20),scope);
 assert.equal(last.ok,true);assert.equal(last.nextCursor,null);
});
test("VO11 Team Leader pagination preserves exact team-only Core/Staff checks",()=>{
 const route=readFileSync(new URL("../../../app/api/vox/v1/team-task-history/route.ts",import.meta.url),"utf8");
 const bff=readFileSync(new URL("../../../apps/vox-web/lib/teamTaskHistory.ts",import.meta.url),"utf8");
 const page=readFileSync(new URL("../../../apps/vox-web/app/team/shifts/page.tsx",import.meta.url),"utf8");
 const view=readFileSync(new URL("../../../apps/vox-web/app/team/shifts/TeamTaskHistory.tsx",import.meta.url),"utf8");
 assert.match(route,/VO10_MANAGED_TL_TASK_HISTORY_CERTIFIED=false as const/);
 assert.match(route,/\.eq\("team_id",tl!\.teamId\)/);
 assert.match(route,/\.eq\("city_id",tl!\.cityId\)/);
 assert.match(route,/query=query\.in\("staff_id",ids\)/);
 assert.match(route,/query=query\.or\(filter\)/);
 assert.match(route,/intervalHistoryKeysetFilter\(cursor\)/);
 assert.match(route,/TEAM_TASK_SCOPE_CHANGED/);
 assert.match(bff,/x\.hasMore===false&&x\.nextCursor!==null/);
 assert.match(page,/fetchTeamTaskHistory\(cursor\)/);
 assert.match(view,/Older verified team intervals/);
});
