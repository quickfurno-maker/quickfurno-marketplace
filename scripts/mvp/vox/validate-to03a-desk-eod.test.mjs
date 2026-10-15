import test from "node:test";
import assert from "node:assert/strict";
import {projectUnifiedHumanInbox as inbox,projectEvidenceLedEod as eod}
 from "../../../contracts/vox/unifiedDeskAndEod.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const ctx={userId:id(1),teamId:id(2),cityId:id(3),role:"operations_manager",
 canMutate:false,canReadContent:true,prospectIds:[id(10)],vendorIds:[id(11)],
 supportThreadIds:[id(12)],conversationIds:[id(20),id(21),id(22)]};
const row={id:id(20),team_id:ctx.teamId,city_id:ctx.cityId,subject_kind:"vendor",
 subject_id:id(11),lane:"ANISHA",state:"HUMAN",human_takeover:true,
 consent_state:"ALLOWED",do_not_contact:false,revision:1,
 updated_at:"2026-10-15T10:00:00Z"};
test("vendor+Anisha metadata only, never a chat/reply/send permission",()=>{
 const v=inbox({context:ctx,rows:[row]});assert.equal(v.ok,true);assert.equal(v.items.length,1);
 assert.equal(v.items[0].canReply,false);assert.equal(v.items[0].canReadTranscript,false);
 assert.equal(v.items[0].providerMessagesSent,0);
 assert.equal(JSON.stringify(v).includes("subject_id"),false);
});
test("Aarohi and vendor rows need both subject AND conversation grant",()=>{
 const a={...row,id:id(21),lane:"AAROHI",subject_kind:"prospect",subject_id:id(10)};
 assert.equal(inbox({context:ctx,rows:[a]}).items.length,1);
 for(const r of [{...a,subject_id:id(66)}, {...a,id:id(88)},
  {...row,subject_id:id(66)}, {...row,id:id(90)}]){
  assert.equal(inbox({context:ctx,rows:[r]}).items.length,0);
 }
});
test("Riya client never shows without independent canonical client subject grant",()=>{
 const r={...row,id:id(22),lane:"RIYA",subject_kind:"client",subject_id:id(10)};
 assert.deepEqual(inbox({context:ctx,rows:[r]}).items,[]);
});
test("fail shut on AAL2 Core scope absence, wrong city, opt-out, AI-owned",()=>{
 assert.equal(inbox({context:null,rows:[row]}).ok,false);
 for(const r of [{...row,city_id:id(33)},{...row,team_id:id(31)},
  {...row,consent_state:"REVOKED"}, {...row,do_not_contact:true},
  {...row,state:"AI"}, {...row,human_takeover:false}])
  assert.equal(inbox({context:ctx,rows:[r]}).items.length,0);
 const x=inbox({context:{...ctx,role:"team_leader",canReadContent:false},rows:[row]});
 assert.deepEqual(x.items,[]);
});
const kind=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const watermarks=kind.map((source,i)=>({source,watermarkId:id(i+50),completeThrough:"2026-10-15T18:30:00Z"}));
const event={id:id(61),work_item_id:id(62),team_id:ctx.teamId,city_id:ctx.cityId,
 actor_id:ctx.userId,source:"CORE_WORK_LEDGER",event_type:"COMPLETED",occurred_at:"2026-10-15T15:00:00Z"};
test("EOD requires four current Core source watermarks, never guesses unobserved counts",()=>{
 const a=eod({context:ctx,events:[event,event],businessDate:"2026-10-15",sourceWatermarks:watermarks});
 assert.equal(a.ok,true);assert.equal(a.counts.completed,1);
 assert.equal(a.completeness,"SOURCE_WATERMARKS_COVER_DAY");
 assert.equal(a.canSubmit,false);
 const b=eod({context:ctx,events:[event],businessDate:"2026-10-15",sourceWatermarks:watermarks.slice(1)});
 assert.equal(b.completeness,"INCOMPLETE_OR_UNVERIFIED");
 assert.equal(b.counts.completed,1);
});
test("IST midnight, cross-team and staff-own event scope",()=>{
 const cross={...event,id:id(63),team_id:id(99)};
 const nextDay={...event,id:id(64),occurred_at:"2026-10-15T19:00:00Z"};
 const other={...event,id:id(65),actor_id:id(88)};
 const x=eod({context:{...ctx,role:"support_agent"},events:[event,cross,nextDay,other],
 businessDate:"2026-10-15",sourceWatermarks:watermarks});
 assert.equal(x.counts.completed,1);
 const y=eod({context:ctx,events:[event,cross,nextDay,other],
 businessDate:"2026-10-15",sourceWatermarks:watermarks});
 assert.equal(y.counts.completed,1);// same source/work/type deduplicated
});
test("bad event bodies never inject PII, forged/duplicate watermarks are rejected",()=>{
 const a=eod({context:ctx,events:[{...event,event_type:"REVENUE"}],
 businessDate:"2026-10-15",sourceWatermarks:watermarks});
 assert.deepEqual(Object.values(a.counts),[0,0,0,0,0,0]);
 assert.equal(eod({context:ctx,events:[],businessDate:"2026-10-15",
 sourceWatermarks:[watermarks[0],watermarks[0]]}).ok,false);
 assert.equal(eod({context:ctx,events:[],businessDate:"2026-10-15",sourceWatermarks:[]}).completeness,
 "INCOMPLETE_OR_UNVERIFIED");
});
