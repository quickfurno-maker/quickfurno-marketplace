import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectVerifiedTaskIntervals}
 from "../../../contracts/vox/virtualOfficeTimeHistory.mjs";
import {decodeHistoryCursor}
 from "../../../contracts/vox/virtualOfficeHistoryCursor.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-11-03T12:00:00Z");
const scope={staffId:id(1),teamId:id(2),cityId:id(3),serverNowMs:now,sourceVerified:true};
const item=n=>({
 closed_by_event_nonce:id(n+800),staff_id:id(1),team_id:id(2),
 city_id:id(3),work_item_id:id(4),
 started_at:"2026-11-03T10:00:00.123000+00:00",
 ended_at:"2026-11-03T10:00:00.123456+00:00",
 elapsed_ms:0,state_revision:n,closing_action:"TASK_STOP"
});
test("VO11 own Staff page returns exactly one cursor for the 20th verified row",()=>{
 const rows=Array.from({length:21},(_,i)=>item(21-i));
 const v=projectVerifiedTaskIntervals(rows,scope);
 assert.equal(v.ok,true);assert.equal(v.entries.length,20);
 assert.equal(v.hasMore,true);
 assert.deepEqual(decodeHistoryCursor(v.nextCursor,now),{
  endedAt:rows[19].ended_at,nonce:rows[19].closed_by_event_nonce
 });
 const last=projectVerifiedTaskIntervals(rows.slice(0,20),scope);
 assert.equal(last.ok,true);assert.equal(last.hasMore,false);
 assert.equal(last.nextCursor,null);
});
test("VO11 Staff history HTTP scopes before cursor filtering and never accepts actor ID",()=>{
 const route=readFileSync(new URL("../../../app/api/vox/v1/staff-time-history/route.ts",import.meta.url),"utf8");
 const bff=readFileSync(new URL("../../../apps/vox-web/lib/staffTimeHistory.ts",import.meta.url),"utf8");
 const page=readFileSync(new URL("../../../apps/vox-web/app/team/workday/page.tsx",import.meta.url),"utf8");
 const ui=readFileSync(new URL("../../../apps/vox-web/app/team/workday/TaskHistory.tsx",import.meta.url),"utf8");
 assert.match(route,/VO9_MANAGED_INTERVAL_HISTORY_CERTIFIED=false as const/);
 assert.match(route,/\.eq\("staff_id",actor\.userId\)/);
 assert.match(route,/\.eq\("team_id",actor\.teamId\)/);
 assert.match(route,/\.eq\("city_id",actor\.cityId\)/);
 assert.match(route,/query=query\.or\(filter\)/);
 assert.match(route,/intervalHistoryKeysetFilter\(cursor\)/);
 assert.match(route,/keys\.length>1/);
 assert.match(bff,/r\.hasMore===false&&r\.nextCursor!==null/);
 assert.match(page,/fetchMyTaskIntervals\(cursor\)/);
 assert.match(ui,/Older verified intervals/);
});
