import test from "node:test";
import assert from "node:assert/strict";
import {initialTimeState,transitionTimeState} from "../../../contracts/vox/virtualOfficeTimeState.mjs";
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const A=uuid(11),B=uuid(12);
function make(){
 let state=initialTimeState(),seq=1;
 const send=(action,atMs,workItemId,opts={})=>{
  const command={action,nonce:uuid(seq++),expectedRevision:state.revision,
   ...(workItemId?{workItemId}:{})};
  const out=transitionTimeState(state,command,{serverNowMs:atMs,verifiedWorkItem:true,...opts});
  if(out.ok)state=out.state;
  return {out,command};
 };
 return {send,get state(){return state;}};
}
test("VO1 real state transitions calculate task vs break vs attendance separately",()=>{
 const w=make();
 assert.equal(w.send("CLOCK_IN",1000).out.ok,true);
 assert.equal(w.send("TASK_START",2000,A).out.ok,true);
 assert.equal(w.send("TASK_SWITCH",5000,B).out.ok,true);
 assert.equal(w.send("BREAK_START",7000).out.ok,true);
 assert.equal(w.send("BREAK_END",9000).out.ok,true);
 assert.equal(w.send("TASK_START",10000,A).out.ok,true);
 assert.equal(w.send("TASK_STOP",14000,A).out.ok,true);
 assert.equal(w.send("CLOCK_OUT",16000).out.ok,true);
 assert.equal(w.state.taskTimeMs,9000);
 assert.equal(w.state.totalBreakMs,2000);
 assert.equal(w.state.clockedOutAt-w.state.clockedInAt,15000);
 assert.equal(w.state.receipts.length,8);
 assert.equal(w.state.activeTask,null);
});
test("VO1 duplicate original nonce replays only one committed event",()=>{
 const w=make();const first=w.send("CLOCK_IN",1000);
 const again=transitionTimeState(w.state,first.command,{serverNowMs:999999});
 assert.equal(again.ok,true);assert.equal(again.replayed,true);
 assert.equal(again.state.events.length,1);
 const tampered=transitionTimeState(w.state,{...first.command,expectedRevision:1},{serverNowMs:9000});
 assert.equal(tampered.reason,"NONCE_CONFLICT");
});
test("VO1 one active task, bound to current verified task ownership",()=>{
 const w=make();w.send("CLOCK_IN",1000);
 w.send("TASK_START",2000,A);
 const overlap=w.send("TASK_START",3000,B);
 assert.equal(overlap.out.reason,"TIMER_ALREADY_ACTIVE");
 assert.equal(w.state.activeTask.workItemId,A);
 assert.equal(w.send("TASK_SWITCH",4000,B,{verifiedWorkItem:false}).out.reason,
  "CURRENT_ASSIGNED_WORK_REQUIRED");
 assert.equal(w.state.activeTask.workItemId,A);
});
test("VO1 time is server-owned: clock regression rejected, no corrupt event",()=>{
 const w=make();w.send("CLOCK_IN",1000);w.send("TASK_START",3000,A);
 const r=w.send("TASK_STOP",2500,A);
 assert.equal(r.out.reason,"NON_MONOTONIC_SERVER_TIME");
 assert.equal(w.state.taskTimeMs,0);
 assert.equal(w.state.events.length,2);
});
test("VO1 no timer during break, and stop requires an active shift",()=>{
 const w=make();
 assert.equal(w.send("TASK_START",100,A).out.ok,false);
 w.send("CLOCK_IN",500);w.send("BREAK_START",1000);
 assert.equal(w.send("TASK_START",1200,A).out.ok,false);
 assert.equal(w.send("CLOCK_OUT",1500).out.ok,false);
 w.send("BREAK_END",1600);w.send("CLOCK_OUT",2000);
 assert.equal(w.send("TASK_START",2200,A).out.ok,false);
});
test("VO1 correct same task resume and stop after pause",()=>{
 const w=make();w.send("CLOCK_IN",100);
 w.send("TASK_START",200,A);w.send("TASK_PAUSE",300,A);
 assert.equal(w.send("TASK_RESUME",500,B).out.ok,false);
 assert.equal(w.send("TASK_RESUME",500,A).out.ok,true);
 assert.equal(w.send("TASK_STOP",800,A).out.ok,true);
 assert.equal(w.send("TASK_RESUME",900,A).out.ok,false);
 assert.equal(w.state.taskTimeMs,400);
});
test("VO1 negative and forged inputs cannot mutate Core state",()=>{
 const w=make(),before=JSON.stringify(w.state);
 for(const value of [-1,NaN,Infinity,"2026-01-01",null]){
  const r=w.send("CLOCK_IN",value);
  assert.equal(r.out.ok,false);
 }
 assert.equal(JSON.stringify(w.state),before);
});
test("VO1 stale original revision does not create an event or timer",()=>{
 const w=make();w.send("CLOCK_IN",100);
 const before=w.state.events.length;
 const r=transitionTimeState(w.state,{action:"TASK_START",nonce:uuid(91),
  expectedRevision:0,workItemId:A},{serverNowMs:200,verifiedWorkItem:true});
 assert.equal(r.reason,"STALE_REVISION");
 assert.equal(w.state.events.length,before);
});
