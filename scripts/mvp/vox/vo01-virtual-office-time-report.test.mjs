import test from "node:test";
import assert from "node:assert/strict";
import {initialTimeState,transitionTimeState} from "../../../contracts/vox/virtualOfficeTimeState.mjs";
import {buildVerifiedTimeSummary,aggregateVerifiedTimeSummaries}
 from "../../../contracts/vox/virtualOfficeTimeReport.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
function time(){
 let state=initialTimeState(),n=1;
 const act=(action,atMs,workItemId)=>{
  const r=transitionTimeState(state,{action,nonce:id(n++),
   expectedRevision:state.revision,...(workItemId?{workItemId}:{})},{
   serverNowMs:atMs,verifiedWorkItem:true});
  assert.equal(r.ok,true,action);state=r.state;
 };
 return {act,get state(){return state;}};
}
test("VO1 genuine source required: unknown never appears as productivity zero",()=>{
 const empty=initialTimeState();
 assert.equal(buildVerifiedTimeSummary(empty,{asOfMs:200}).ok,false);
 const s=buildVerifiedTimeSummary(empty,{asOfMs:200,sourceVerified:true});
 assert.equal(s.ok,true);assert.equal(s.status,"NOT_STARTED");
});
test("VO1 active task and open break are accounted separately",()=>{
 const w=time();w.act("CLOCK_IN",1000);w.act("TASK_START",2000,id(42));
 let s=buildVerifiedTimeSummary(w.state,{asOfMs:5000,sourceVerified:true});
 assert.equal(s.status,"CLOCKED_IN");assert.equal(s.attendanceMs,4000);
 assert.equal(s.taskMs,3000);assert.equal(s.unattributedMs,1000);
 w.act("BREAK_START",6000);
 s=buildVerifiedTimeSummary(w.state,{asOfMs:8000,sourceVerified:true});
 assert.equal(s.breakMs,2000);assert.equal(s.taskMs,4000);
 assert.equal(s.netShiftMs,5000);
});
test("VO1 clock out yields complete verified time, no online proxy",()=>{
 const w=time();w.act("CLOCK_IN",0);w.act("TASK_START",1000,id(42));
 w.act("TASK_STOP",3000,id(42));w.act("CLOCK_OUT",4000);
 const s=buildVerifiedTimeSummary(w.state,{asOfMs:10000,sourceVerified:true});
 assert.equal(s.complete,true);assert.equal(s.attendanceMs,4000);
 assert.equal(s.taskMs,2000);assert.equal(s.unattributedMs,2000);
 assert.equal(s.status,"CLOCKED_OUT");
});
test("VO1 stale, impossible or forged ledger is rejected",()=>{
 const w=time();w.act("CLOCK_IN",1000);
 const state=structuredClone(w.state);
 for(const bad of [
  {...state,revision:99}, {...state,clockedOutAt:500},
  {...state,totalBreakMs:99999},{...state,taskTimeMs:999999},
  {...state,events:[{...state.events[0],atMs:99999}]},
  {...state,receipts:[]}
 ]){
  assert.equal(buildVerifiedTimeSummary(bad,{asOfMs:5000,sourceVerified:true}).ok,false);
 }
});
test("VO1 rollup keeps unknown Staff separate from zero time",()=>{
 const w=time();w.act("CLOCK_IN",1000);w.act("CLOCK_OUT",2000);
 const summary=buildVerifiedTimeSummary(w.state,{asOfMs:3000,sourceVerified:true});
 const r=aggregateVerifiedTimeSummaries([{staffId:id(1),summary}],
  {expectedStaffCount:3});
 assert.equal(r.ok,true);assert.equal(r.complete,false);
 assert.equal(r.verifiedStaffCount,1);assert.equal(r.unknownStaffCount,2);
 assert.equal(r.attendanceMs,1000);
});
test("VO1 duplicate actor or malformed source cannot inflate team totals",()=>{
 const w=time();w.act("CLOCK_IN",1000);w.act("CLOCK_OUT",2000);
 const summary=buildVerifiedTimeSummary(w.state,{asOfMs:3000,sourceVerified:true});
 const same={staffId:id(1),summary};
 assert.equal(aggregateVerifiedTimeSummaries([same,same],
  {expectedStaffCount:2}).ok,false);
 assert.equal(aggregateVerifiedTimeSummaries([same],
  {expectedStaffCount:0}).ok,false);
 assert.equal(aggregateVerifiedTimeSummaries([{staffId:id(1),summary:{ok:false}}],
  {expectedStaffCount:1}).ok,false);
});
