import test from "node:test";
import assert from "node:assert/strict";
import {projectScopedWorkQueue,aggregateScopedDailyEvents} from "../../../contracts/vox/teamOperations.mjs";
const id=(n)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const city=id(1),team=id(2),user=id(3),other=id(4),source=id(5),item=id(6),eid=id(7);
const context={userId:user,teamId:team,cityId:city,role:"support_agent",canMutate:false,
 prospectIds:[],vendorIds:[],supportThreadIds:[source],conversationIds:[]};
const row={id:item,city_id:city,team_id:team,source_kind:"support_thread",source_id:source,
 assignee_id:user,state:"ASSIGNED",priority:"P1",revision:0,
 created_at:"2026-10-15T10:00:00.000Z",updated_at:"2026-10-15T10:00:00.000Z",due_at:null};
test("scoped verified work item exposes minimal permitted metadata",()=>{
 const out=projectScopedWorkQueue({rows:[row],context});
 assert.equal(out.ok,true);assert.equal(out.items.length,1);
 assert.equal(out.items[0].subjectRef,source);
 for(const action of ["canClaim","canTransfer","canClose","canReply"])assert.equal(out.items[0][action],false);
 assert.equal(out.actionsEnabled,false);
});
test("mismatched city and team are denied",()=>{
 for(const changed of [{city_id:id(8)},{team_id:id(9)}]){
  assert.equal(projectScopedWorkQueue({rows:[{...row,...changed}],context}).items.length,0);
 }
});
test("ungranted foreign staff work is invisible",()=>{
 assert.equal(projectScopedWorkQueue({rows:[{...row,assignee_id:other}],context:{...context,supportThreadIds:[]}}).items.length,0);
});
test("assignee without subject grant never gets subject ID",()=>{
 const out=projectScopedWorkQueue({rows:[row],context:{...context,supportThreadIds:[]}});
 assert.equal(out.items.length,1);assert.equal(out.items[0].subjectRef,null);
});
test("team leader sees team metadata but no source ID",()=>{
 const out=projectScopedWorkQueue({rows:[row],context:{...context,role:"team_leader"}});
 assert.equal(out.items.length,1);assert.equal(out.items[0].subjectRef,null);
});
test("auditor cannot see subject ID or mutate",()=>{
 const out=projectScopedWorkQueue({rows:[row],context:{...context,role:"auditor"}});
 assert.equal(out.items[0].subjectRef,null);assert.equal(out.items[0].canClose,false);
});
test("invalid context fails closed",()=>{
 for(const c of [null,{}, {...context,canMutate:true},{...context,userId:"bad"}])
  assert.equal(projectScopedWorkQueue({rows:[row],context:c}).ok,false);
});
test("out of range and malformed rows are not exposed",()=>{
 for(const changed of [{revision:-1},{id:"broken"},{priority:"P-100"},{due_at:"tomorrow"},{assignee_id:"bad"}])
  assert.equal(projectScopedWorkQueue({rows:[{...row,...changed}],context}).items.length,0);
});
test("bounded queue cannot return more than 32",()=>{
 const rows=Array.from({length:40},(_,i)=>({...row,id:id(i+100)}));
 const out=projectScopedWorkQueue({rows,context});
 assert.equal(out.items.length,32);
 assert.equal(projectScopedWorkQueue({rows,context,limit:100}).ok,false);
 assert.equal(projectScopedWorkQueue({rows:Array(201).fill(row),context}).ok,false);
});
test("deduplicate repeated work IDs",()=>{
 assert.equal(projectScopedWorkQueue({rows:[row,row],context}).items.length,1);
});
test("event-based EOD count is deduplicated and correctly scoped",()=>{
 const e={id:eid,work_item_id:item,team_id:team,city_id:city,assignee_id:user,
 event_type:"WORK_COMPLETED",occurred_at:"2026-10-15T15:00:00.000Z"};
 const r=aggregateScopedDailyEvents({events:[e,e,{...e,id:id(8),city_id:id(9)},
  {...e,id:id(10),team_id:id(11)}],context,businessDate:"2026-10-15"});
 assert.equal(r.ok,true);assert.equal(r.counts.completed,1);
 assert.equal(r.completeness,"UNVERIFIED_SOURCE_WATERMARK");
});
test("IST date boundary not UTC midnight",()=>{
 const e={id:eid,work_item_id:item,team_id:team,city_id:city,assignee_id:user,
 event_type:"WORK_ASSIGNED",occurred_at:"2026-10-15T19:10:00.000Z"};
 const today=aggregateScopedDailyEvents({events:[e],context,businessDate:"2026-10-15"});
 const next=aggregateScopedDailyEvents({events:[e],context,businessDate:"2026-10-16"});
 assert.equal(today.counts.assigned,0);assert.equal(next.counts.assigned,1);
});
test("ordinary staff cannot count teammate activity",()=>{
 const e={id:eid,work_item_id:item,team_id:team,city_id:city,assignee_id:other,
 event_type:"WORK_BLOCKED",occurred_at:"2026-10-15T15:00:00.000Z"};
 assert.equal(aggregateScopedDailyEvents({events:[e],context,businessDate:"2026-10-15"}).counts.blocked,0);
 assert.equal(aggregateScopedDailyEvents({events:[e],context:{...context,role:"team_leader"},businessDate:"2026-10-15"}).counts.blocked,1);
});
test("events input bounds and missing proof fail closed",()=>{
 assert.equal(aggregateScopedDailyEvents({events:Array(1001).fill({}),context,businessDate:"2026-10-15"}).ok,false);
 assert.equal(aggregateScopedDailyEvents({events:[],context:{...context,teamId:"bad"},businessDate:"2026-10-15"}).ok,false);
});
