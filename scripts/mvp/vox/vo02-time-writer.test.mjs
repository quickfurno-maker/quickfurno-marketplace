import test from "node:test";
import assert from "node:assert/strict";
import {writeScopedTimeCommand} from "../../../services/vox/virtualOfficeTimeWriter.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope=()=>({userId:id(10),teamId:id(11),cityId:id(12),role:"staff",canMutate:false,
 verifiedDepartments:["vendor_success"],prospectIds:[],vendorIds:[],supportThreadIds:[],conversationIds:[]});
const command={action:"TASK_START",nonce:id(20),expectedRevision:0,workItemId:id(21)};
function setup(){
 let writes=0,checks=0;
 const deps={environment:"staging",enabled:()=>true,installed:()=>true,
  currentScopedStaff:async()=>{checks++;return scope();},
  currentTaskGrant:async()=>true,
  rpc:async(name,args)=>{writes++;
   assert.equal(name,"qf_vox_staff_time_atomic_candidate_v1");
   assert.deepEqual(args,{p_actor:id(10),p_team:id(11),p_city:id(12),
    p_action:"TASK_START",p_nonce:id(20),p_expected_revision:0,p_work_item:id(21)});
   return {data:[{nonce:id(20),actor_id:id(10),event_id:id(30),revision:1,
    applied:true,occurred_at:"2026-11-03T00:00:00.000Z",work_item_id:id(21),
    external_messages_sent:0,money_minor_units:0}],error:null};}
 };
 return {deps,writes:()=>writes,checks:()=>checks};
}
test("VO2 time writer OFF unless actual staging installation approved",async()=>{
 for(const override of [{enabled:()=>false},{installed:()=>false},{environment:"production"}]){
  const f=setup(),r=await writeScopedTimeCommand(command,{...f.deps,...override});
  assert.equal(r.ok,false);assert.equal(f.writes(),0);
 }
});
test("VO2 exact Staff-scoped server parameters, SQL receipt and postcheck",async()=>{
 const f=setup(),r=await writeScopedTimeCommand(command,f.deps);
 assert.equal(r.ok,true);assert.equal(r.revision,1);
 assert.equal(r.providerMessagesSent,0);assert.equal(f.writes(),1);
 assert.equal(f.checks(),2);
});
test("VO2 must never trust browser supplied Staff/clock/payroll fields",async()=>{
 for(const extra of [{actorId:id(40)},{clientTime:123},{durationMs:4000},{teamId:id(11)},{refund:1}]){
  const f=setup(),r=await writeScopedTimeCommand({...command,...extra},f.deps);
  assert.equal(r.ok,false);assert.equal(f.writes(),0);
 }
});
test("VO2 revoked task and Team Leader cannot trigger a database write",async()=>{
 const f=setup();f.deps.currentTaskGrant=async()=>false;
 assert.equal((await writeScopedTimeCommand(command,f.deps)).reason,
  "CURRENT_ASSIGNED_TASK_REQUIRED");
 assert.equal(f.writes(),0);
 const leader=setup();leader.deps.currentScopedStaff=async()=>({...scope(),role:"team_leader"});
 assert.equal((await writeScopedTimeCommand(command,leader.deps)).ok,false);
 assert.equal(leader.writes(),0);
});
test("VO2 timeout or malformed SQL receipt is UNKNOWN; never retry automatically",async()=>{
 for(const mutate of [
  deps=>{deps.rpc=async()=>{throw Error("timeout");};},
  deps=>{deps.rpc=async()=>({error:{code:"DB_ERR"},data:null});},
  deps=>{deps.rpc=async()=>({error:null,data:[{nonce:id(20)}]});},
  deps=>{deps.rpc=async()=>({error:null,data:[{nonce:id(20),actor_id:id(10),
   event_id:id(30),revision:1,applied:true,occurred_at:"2026-11-03T00:00:00Z",
   work_item_id:id(21),external_messages_sent:0,money_minor_units:1}]});}
 ]){
  const f=setup();mutate(f.deps);
  const r=await writeScopedTimeCommand(command,f.deps);
  assert.equal(r.reason,"TIME_WRITE_OUTCOME_UNKNOWN");
  assert.equal(r.retrySameNonceOnly,true);
 }
});
test("VO2 loss of Staff grants after SQL write is UNKNOWN not success",async()=>{
 const f=setup();let n=0;
 f.deps.currentScopedStaff=async()=>{n++;return n===1?scope():{...scope(),teamId:id(99)};};
 const r=await writeScopedTimeCommand(command,f.deps);
 assert.equal(r.reason,"TIME_WRITE_OUTCOME_UNKNOWN");
 assert.equal(f.writes(),1);
});
test("VO2 current Staff scope must contain complete effective grant arrays",async()=>{
 const f=setup();f.deps.currentScopedStaff=async()=>({userId:id(10),teamId:id(11),
  cityId:id(12),role:"staff",canMutate:false});
 assert.equal((await writeScopedTimeCommand(command,f.deps)).ok,false);
 assert.equal(f.writes(),0);
});
