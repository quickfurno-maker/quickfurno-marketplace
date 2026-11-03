import test from "node:test";
import assert from "node:assert/strict";
import {validateTlAssignmentIntent,assignScopedTeamWork}
 from "../../../services/vox/virtualOfficeTeamAssignment.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const cmd={itemId:id(41),targetStaffId:id(42),nonce:id(43),expectedRevision:0,reason:""};
const leader=()=>({userId:id(1),teamId:id(2),cityId:id(3),role:"team_leader",
 canMutate:false,canReadContent:false,verifiedDepartments:["service_support"]});
const staff=()=>({userId:id(42),teamId:id(2),cityId:id(3),
 role:"support_agent",active:true,revoked:false,verifiedNeutralStaff:true,
 objectGrants:[{kind:"support_thread",id:id(54)},{kind:"vendor",id:id(55)}]});
const work=()=>({id:id(41),teamId:id(2),cityId:id(3),state:"NEW",
 assigneeId:null,sourceKind:"support_thread",sourceId:id(54),relatedVendorId:id(55)});
function setup(){
 let calls=0;
 const deps={environment:"staging",enabled:()=>true,reviewedWriterInstalled:()=>true,
  currentLeader:async()=>leader(),currentTarget:async()=>staff(),currentWork:async()=>work(),
  rpc:async(name,args)=>{calls++;
   assert.equal(name,"qf_vox_tl_assign_work_candidate_v1");
   assert.deepEqual(args,{p_leader:id(1),p_target:id(42),p_item:id(41),
    p_expected_revision:0,p_nonce:id(43),p_reason:""});
   return {error:null,data:[{item_id:id(41),leader_id:id(1),target_id:id(42),
    nonce:id(43),revision:1,new_state:"ASSIGNED",external_messages_sent:0,
    vendor_assignments_changed:0,money_minor_units:0}]};}
 };
 return {deps,calls:()=>calls};
}
test("VO3 manager writer remains disabled without independent approval",async()=>{
 for(const key of ["enabled","reviewedWriterInstalled"]){
  const f=setup();f.deps[key]=()=>false;
  assert.equal((await assignScopedTeamWork(cmd,f.deps)).ok,false);
  assert.equal(f.calls(),0);
 }
 const f=setup();f.deps.environment="production";
 assert.equal((await assignScopedTeamWork(cmd,f.deps)).ok,false);
 assert.equal(f.calls(),0);
});
test("VO3 valid team/city/Core-task assignment accepts exact receipt",async()=>{
 const f=setup();const r=await assignScopedTeamWork(cmd,f.deps);
 assert.equal(r.ok,true);assert.equal(r.revision,1);
 assert.equal(r.moneyMinorUnits,0);assert.equal(r.vendorAssignmentsChanged,0);
 assert.equal(f.calls(),1);
});
test("VO3 forged browser role/staff/city cannot enter SQL",async()=>{
 for(const extra of [{actorId:id(2)},{teamId:id(3)},{cityId:id(3)},
  {role:"owner"},{amount:500},{vendorLeadId:id(99)}]){
  const f=setup();const r=await assignScopedTeamWork({...cmd,...extra},f.deps);
  assert.equal(r.ok,false);assert.equal(f.calls(),0);
 }
 assert.equal(validateTlAssignmentIntent({...cmd,nonce:"bad"}).ok,false);
});
test("VO3 TL cannot assign own work or foreign team/city staff",async()=>{
 for(const target of [{...staff(),userId:id(1)},{
  ...staff(),teamId:id(77)},{...staff(),cityId:id(98)},{
  ...staff(),verifiedNeutralStaff:false}]){
  const f=setup();f.deps.currentTarget=async()=>target;
  assert.equal((await assignScopedTeamWork(cmd,f.deps)).ok,false);
  assert.equal(f.calls(),0);
 }
});
test("VO3 dual vendor grant and canonical work state are required",async()=>{
 for(const issue of [
  {target:{...staff(),objectGrants:[{kind:"support_thread",id:id(54)}]}},
  {work:{...work(),state:"DONE"}},
  {work:{...work(),teamId:id(90)}},
  {work:{...work(),assigneeId:id(90)}}]){
  const f=setup();
  if(issue.target)f.deps.currentTarget=async()=>issue.target;
  if(issue.work)f.deps.currentWork=async()=>issue.work;
  assert.equal((await assignScopedTeamWork(cmd,f.deps)).ok,false);
  assert.equal(f.calls(),0);
 }
});
test("VO3 unknown SQL response or changed post-grants never certifies assignment",async()=>{
 for(const mutate of [
  deps=>{deps.rpc=async()=>{throw Error("timeout");};},
  deps=>{deps.rpc=async()=>({error:{code:"DENIED"},data:null});},
  deps=>{deps.rpc=async()=>({error:null,data:[{item_id:id(41)}]});},
  deps=>{let count=0;deps.currentLeader=async()=>++count===1?leader():{...leader(),teamId:id(99)};},
  deps=>{let count=0;deps.currentTarget=async()=>++count===1?staff():{...staff(),revoked:true};}
 ]){
  const f=setup();mutate(f.deps);
  const r=await assignScopedTeamWork(cmd,f.deps);
  assert.equal(r.ok,false);assert.equal(r.reason,"TL_ASSIGNMENT_OUTCOME_UNKNOWN");
  assert.equal(r.retrySameNonceOnly,true);
 }
});
test("VO3 replay nonce with changed request details is syntactically forbidden",()=>{
 for(const v of [{...cmd,expectedRevision:-1},{...cmd,reason:"  work "},
  {...cmd,reason:"hello\nworld"},{...cmd,reason:"x".repeat(201)},
  {...cmd,nonce:21},{...cmd,expectedRevision:2147483647}])
  assert.equal(validateTlAssignmentIntent(v).ok,false);
});
