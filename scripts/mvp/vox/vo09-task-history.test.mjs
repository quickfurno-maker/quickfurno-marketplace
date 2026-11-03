import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectVerifiedTaskIntervals} from "../../../contracts/vox/virtualOfficeTimeHistory.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const at=Date.parse("2026-11-03T10:00:00Z");
const scope={staffId:id(1),teamId:id(2),cityId:id(3),serverNowMs:at,sourceVerified:true};
const row=(n=1)=>({
 closed_by_event_nonce:id(200+n),staff_id:id(1),team_id:id(2),city_id:id(3),
 work_item_id:id(4),started_at:new Date(at-n*60000).toISOString(),
 ended_at:new Date(at-n*60000+30000).toISOString(),
 elapsed_ms:30000,state_revision:n,closing_action:"TASK_STOP"
});
test("VO9 returns only bounded, verified own Staff immutable intervals",()=>{
 const r=projectVerifiedTaskIntervals([row(1),row(2)],scope);
 assert.equal(r.ok,true);assert.equal(r.sourceVerified,true);
 assert.equal(r.entries.length,2);assert.equal(r.entries[0].workItemId,id(4));
 assert.equal(r.hasMore,false);assert.equal(r.completeHistory,false);
 assert.equal(r.payrollVerified,false);assert.equal(r.officialEod,false);
 assert.equal("closedByEventNonce" in r.entries[0],false);
});
test("VO9 21st row proves hasMore without exposing it",()=>{
 const r=projectVerifiedTaskIntervals(Array.from({length:21},(_,i)=>row(i+1)),scope);
 assert.equal(r.ok,true);assert.equal(r.entries.length,20);
 assert.equal(r.hasMore,true);assert.equal(r.windowSize,20);
 assert.equal(projectVerifiedTaskIntervals(Array.from({length:22},(_,i)=>row(i+1)),scope).ok,false);
});
test("VO9 denies cross-Staff, cross-team, forged field, duplicate nonce/revision",()=>{
 const good=row();
 for(const x of [{...good,staff_id:id(99)},{...good,team_id:id(99)},
  {...good,city_id:id(99)},{...good,clientPhone:"+919999999999"},
  {...good,elapsed_ms:-1},{...good,closing_action:"PAYROLL_EXPORT"},
  {...good,work_item_id:"bad-id"}]){
  assert.equal(projectVerifiedTaskIntervals([x],scope).ok,false);
 }
 assert.equal(projectVerifiedTaskIntervals([good,good],scope).ok,false);
 assert.equal(projectVerifiedTaskIntervals([row(1),{...row(2),state_revision:1}],scope).ok,false);
});
test("VO9 rejects invalid chronology, future, inflated elapsed and unsorted rows",()=>{
 for(const x of [{...row(),ended_at:"2026-11-03T09:00:00Z"},
  {...row(),ended_at:"2026-11-04T09:00:00Z"},
  {...row(),elapsed_ms:999999999}]){
  assert.equal(projectVerifiedTaskIntervals([x],scope).ok,false);
 }
 assert.equal(projectVerifiedTaskIntervals([row(2),row(1)],scope).ok,false);
});
test("VO9 no Auth/DB proof cannot manufacture empty valid history",()=>{
 assert.equal(projectVerifiedTaskIntervals([],{...scope,sourceVerified:false}).ok,false);
 assert.equal(projectVerifiedTaskIntervals(null,scope).ok,false);
 const valid=projectVerifiedTaskIntervals([],scope);
 assert.equal(valid.ok,true);assert.equal(valid.entries.length,0);
});
test("VO9 protected HTTP source and Web never accept browser-selected Staff or dates",()=>{
 const core=readFileSync(new URL("../../../app/api/vox/v1/staff-time-history/route.ts",import.meta.url),"utf8");
 const bridge=readFileSync(new URL("../../../apps/vox-web/lib/staffTimeHistory.ts",import.meta.url),"utf8");
 const page=readFileSync(new URL("../../../apps/vox-web/app/team/workday/page.tsx",import.meta.url),"utf8");
 assert.match(core,/VO9_MANAGED_INTERVAL_HISTORY_CERTIFIED=false as const/);
 assert.match(core,/\.eq\("staff_id",actor\.userId\)/);
 assert.match(core,/sameScope\(actor,latest\)/);
 assert.match(core,/\.limit\(21\)/);
 assert.match(core,/url\.searchParams\.keys\(\)/);
 assert.match(core,/intervalHistoryKeysetFilter\(cursor\)/);
 assert.doesNotMatch(core,/request\.json\(\)|request\.text\(\)/);
 assert.match(bridge,/verifiedMfaSession\(\)/);
 assert.match(bridge,/r\.sourceVerified!==true/);
 assert.match(bridge,/r\.completeHistory!==false/);
 assert.match(page,/fetchMyTaskIntervals\(cursor\)/);
});
