import test from "node:test";
import assert from "node:assert/strict";
import {assignScopedTeamWork} from "../../../services/vox/virtualOfficeTeamAssignment.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const command={itemId:id(1),targetStaffId:id(2),nonce:id(3),expectedRevision:0,reason:""};
const tl=()=>({userId:id(10),teamId:id(11),cityId:id(12),
 role:"team_leader",canMutate:false,canReadContent:false,verifiedDepartments:[]});
const target=()=>({userId:id(2),teamId:id(11),cityId:id(12),
 active:true,revoked:false,verifiedNeutralStaff:true,role:"support_agent",
 objectGrants:[{kind:"prospect",id:id(15)}]});
const item=(state,assigneeId)=>({id:id(1),teamId:id(11),cityId:id(12),
 state,assigneeId,sourceKind:"prospect",sourceId:id(15),relatedVendorId:null});
function setup(state,assigneeId,overrideRpc){
 let calls=0;
 const deps={environment:"staging",enabled:()=>true,reviewedWriterInstalled:()=>true,
  currentLeader:async()=>tl(),currentTarget:async()=>target(),
  currentWork:async()=>item(state,assigneeId),
  rpc:async(name,args)=>{calls++;
   assert.equal(name,"qf_vox_tl_assign_work_candidate_v1");
   assert.equal(args.p_nonce,command.nonce);
   if(overrideRpc)return overrideRpc();
   return {data:[{item_id:id(1),leader_id:id(10),target_id:id(2),
    nonce:id(3),revision:1,new_state:"ASSIGNED",
    external_messages_sent:0,vendor_assignments_changed:0,
    money_minor_units:0}],error:null};
  }};
 return {deps,calls:()=>calls};
}
test("VO5 original SQL nonce can be reconciled after committed ASSIGNED state",async()=>{
 const f=setup("ASSIGNED",id(2));
 const r=await assignScopedTeamWork(command,f.deps);
 assert.equal(r.ok,true);assert.equal(r.revision,1);
 assert.equal(r.vendorAssignmentsChanged,0);assert.equal(r.moneyMinorUnits,0);
 assert.equal(f.calls(),1);
});
test("VO5 same-team task assigned to a DIFFERENT Staff denies before RPC",async()=>{
 const f=setup("ASSIGNED",id(9));
 const r=await assignScopedTeamWork(command,f.deps);
 assert.equal(r.ok,false);assert.equal(f.calls(),0);
});
test("VO5 fresh NEW work still permitted by original preflight",async()=>{
 const f=setup("NEW",null);
 assert.equal((await assignScopedTeamWork(command,f.deps)).ok,true);
 assert.equal(f.calls(),1);
});
test("VO5 SQL refuses fresh nonce on assigned item; uncertain response stays locked",async()=>{
 const f=setup("ASSIGNED",id(2),()=>({data:null,error:{code:"P0001"}}));
 const r=await assignScopedTeamWork(command,f.deps);
 assert.equal(r.ok,false);assert.equal(r.reason,"TL_ASSIGNMENT_OUTCOME_UNKNOWN");
 assert.equal(r.retrySameNonceOnly,true);assert.equal(f.calls(),1);
});
test("VO7 original nonce stays recoverable after canonical task progress",async()=>{
 for(const state of ["IN_PROGRESS","DONE"]){
  const f=setup(state,id(2));
  const r=await assignScopedTeamWork(command,f.deps);
  assert.equal(r.ok,true,state);
  assert.equal(r.revision,1);
  assert.equal(f.calls(),1);
 }
});
test("VO7 different assignee or unsupported state never reaches SQL",async()=>{
 for(const [state,assignee] of [["IN_PROGRESS",id(9)],["DONE",id(9)],
   ["BLOCKED",id(2)],["NEW",id(2)]]){
  const f=setup(state,assignee);
  assert.equal((await assignScopedTeamWork(command,f.deps)).ok,false);
  assert.equal(f.calls(),0);
 }
});
test("VO7 new nonce on completed work is checked by SQL, never a second assignment",async()=>{
 const f=setup("DONE",id(2),()=>({data:null,error:{code:"P0001"}}));
 const r=await assignScopedTeamWork(command,f.deps);
 assert.equal(r.ok,false);
 assert.equal(r.reason,"TL_ASSIGNMENT_OUTCOME_UNKNOWN");
 assert.equal(r.retrySameNonceOnly,true);
 assert.equal(f.calls(),1);
});
