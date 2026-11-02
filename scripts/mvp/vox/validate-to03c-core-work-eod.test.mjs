import test from "node:test";
import assert from "node:assert/strict";
import {projectCurrentCoreWorkEod as eod} from "../../../contracts/vox/coreWorkEodPreview.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:id(1),teamId:id(2),cityId:id(3),role:"support_agent",
 canReadContent:true,canMutate:false,prospectIds:[id(10)],vendorIds:[id(11)],
 supportThreadIds:[id(12)],conversationIds:[]};
const item={id:id(30),team_id:id(2),city_id:id(3),source_kind:"support_thread",
 source_id:id(12),revision:5};
const mk=(n,kind,revision)=>({id:id(n),work_item_id:item.id,actor_id:id(1),
 event_type:kind,from_revision:revision-1,to_revision:revision,
 created_at:"2026-10-15T12:00:00Z"});
const ids={prospect:[id(10)],vendor:[id(11)],support_thread:[id(12)]};
const args=(events,more={})=>({scope,workItems:[item],events,verifiedSourceIds:ids,businessDate:"2026-10-15",...more});
test("multiple same-state transitions count as real events, not one work-kind label",()=>{
 const out=eod(args([mk(41,"START",1),mk(42,"BLOCK",2),mk(43,"START",3),mk(44,"COMPLETE",4)]));
 assert.equal(out.ok,true);assert.equal(out.counts.starts,2);
 assert.equal(out.counts.blocks,1);assert.equal(out.counts.completions,1);
 assert.equal(out.eventsIncluded,4);
 assert.equal(out.completeness,"PARTIAL_UNVERIFIED_TOTAL");
 assert.equal(out.canSubmit,false);assert.equal(out.canExport,false);
});
test("revoke current canonical source proof means no previous work or count leaks",()=>{
 const out=eod(args([mk(41,"START",1)],{verifiedSourceIds:{...ids,support_thread:[]}}));
 assert.equal(out.ok,true);assert.equal(out.counts.starts,0);
 assert.equal(out.eventsIncluded,0);
});
test("client data, wrong city/team and stale work record denied",()=>{
 assert.equal(eod(args([mk(41,"START",1)],{workItems:[{...item,city_id:id(88)}]})).ok,false);
 assert.equal(eod(args([mk(41,"START",1)],{workItems:[{...item,team_id:id(88)}]})).ok,false);
 assert.equal(eod(args([mk(41,"START",1)],{workItems:[{...item,source_kind:"client"}]})).ok,false);
 assert.equal(eod(args([mk(41,"START",5)])).ok,true);
 assert.equal(eod(args([mk(41,"START",6)])).ok,false);
});
test("no AAL1-like missing scoped principal, TL/auditor access or manufactured source IDs",()=>{
 assert.equal(eod(args([mk(41,"START",1)],{scope:{...scope,canReadContent:false}})).ok,false);
 assert.equal(eod(args([mk(41,"START",1)],{scope:{...scope,role:"team_leader"}})).ok,false);
 assert.equal(eod(args([], {verifiedSourceIds:{...ids,support_thread:[id(99)]}})).ok,false);
});
test("disallow forged duplicate revision or event replay and inaccurate IST day",()=>{
 assert.equal(eod(args([mk(41,"START",1),mk(42,"BLOCK",1)])).ok,false);
 assert.equal(eod(args([mk(41,"START",1),mk(41,"START",2)])).ok,false);
 assert.equal(eod(args([{...mk(41,"START",1),created_at:"2026-10-15T20:00:00Z"}])).ok,false);
 assert.equal(eod(args([],{businessDate:"2026-02-30"})).ok,false);
 assert.equal(eod(args([],{businessDate:"2026-10-15"})).ok,true);
});
test("out-of-scope actor event and client/WhatsApp payload cannot enter report",()=>{
 assert.equal(eod(args([{...mk(41,"START",1),actor_id:id(9)}])).ok,false);
 const out=eod(args([mk(41,"BLOCK",1)]));
 assert.equal(JSON.stringify(out).includes("work_item_id"),false);
 assert.equal(JSON.stringify(out).includes("contact"),false);
 assert.equal(out.providerMessagesSent,0);
});
