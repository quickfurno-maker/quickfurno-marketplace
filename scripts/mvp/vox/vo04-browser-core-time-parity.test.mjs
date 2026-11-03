import test from "node:test";
import assert from "node:assert/strict";
import {validateTimeCommand} from "../../../contracts/vox/virtualOfficeTimekeeping.mjs";
import {savePendingTimeCommand,readPendingTimeCommand}
 from "../../../apps/vox-web/lib/vo03PendingStaffTime.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const makeStore=()=>{const m=new Map();return {
 getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v),
 removeItem:k=>m.delete(k)
};};
const actions=["CLOCK_IN","BREAK_START","BREAK_END","CLOCK_OUT",
 "TASK_START","TASK_PAUSE","TASK_RESUME","TASK_STOP","TASK_SWITCH"];
test("VO4 browser validator accepts exactly Core time actions and canonical data",()=>{
 for(const action of actions){
  const value={action,nonce:id(10),expectedRevision:0,
   ...(action.startsWith("TASK_")?{workItemId:id(11)}:{})};
  const store=makeStore();
  assert.equal(validateTimeCommand(value).ok,true,action);
  assert.equal(savePendingTimeCommand(store,value),true,action);
  assert.deepEqual(readPendingTimeCommand(store).pending,
   validateTimeCommand(value).command);
 }
});
test("VO4 browser/Core validators reject the same forged command surfaces",()=>{
 const valid={action:"TASK_START",nonce:id(1),expectedRevision:0,workItemId:id(2)};
 const invalid=[
  {...valid,actorId:id(7)},{...valid,teamId:id(9)},{...valid,clientAt:200},
  {...valid,money:1},{...valid,workItemId:"bad"},
  {...valid,expectedRevision:-1},{...valid,expectedRevision:2147483647},
  {...valid,nonce:"bad"},{...valid,action:"TASK_DELETE"},
  {action:"CLOCK_IN",nonce:id(1),expectedRevision:0,workItemId:id(2)},
  {action:"CLOCK_IN",nonce:id(1),expectedRevision:0,elapsedMs:4000},
  {action:"TASK_SWITCH",nonce:id(1),expectedRevision:0}
 ];
 for(const value of invalid){
  assert.equal(validateTimeCommand(value).ok,false,JSON.stringify(value));
  assert.equal(savePendingTimeCommand(makeStore(),value),false,JSON.stringify(value));
 }
});
