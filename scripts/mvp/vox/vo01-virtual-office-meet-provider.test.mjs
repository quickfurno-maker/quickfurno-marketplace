import test from "node:test";
import assert from "node:assert/strict";
import {createScopedMeet} from "../../../services/vox/virtualOfficeMeetProvider.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const intent={nonce:id(1),taskId:id(2),title:"Team standup",participantIds:[id(3),id(4)]};
function f(){
 const calls={network:0,reserve:0,commit:0,auth:0};
 const deps={environment:"staging",enabled:()=>true,installed:()=>true,
  verifyCurrentScope:async()=>{calls.auth++;return true;},
  reserveOriginalNonce:async()=>{calls.reserve++;return {status:"RESERVED",nonce:intent.nonce,durable:true};},
  commitReceipt:async()=>{calls.commit++;return true;},
  accessToken:async()=>"secure-hosted-token-12345",
  providerFetch:async(url,opts)=>{calls.network++;
   assert.equal(url,"https://meet.googleapis.com/v2/spaces");
   assert.equal(opts.method,"POST");assert.equal(opts.body,"{}");
   return {ok:true,json:async()=>({meetingUri:"https://meet.google.com/abc-defg-hij",
    name:"spaces/abc0123"})};}
 };
 return {deps,calls};
}
test("VO1 Meet provider disabled-by-default never calls network",async()=>{
 const f0=f();f0.deps.enabled=()=>false;
 const r=await createScopedMeet(intent,f0.deps);
 assert.equal(r.ok,false);assert.equal(f0.calls.network,0);
 const f1=f();f1.deps.environment="production";
 assert.equal((await createScopedMeet(intent,f1.deps)).ok,false);
 assert.equal(f1.calls.reserve,0);
});
test("VO1 valid Core reservations create one bounded provider space",async()=>{
 const {deps,calls}=f();
 const r=await createScopedMeet(intent,deps);
 assert.equal(r.ok,true);assert.equal(r.replayed,false);
 assert.equal(r.spaceName,"spaces/abc0123");assert.equal(r.nonce,intent.nonce);
 assert.deepEqual(calls,{network:1,reserve:1,commit:1,auth:4});
});
test("VO1 replay with original nonce never contacts provider again",async()=>{
 const {deps,calls}=f();
 deps.reserveOriginalNonce=async()=>({status:"REPLAY",receipt:{
  nonce:intent.nonce,joinUrl:"https://meet.google.com/abc-defg-hij",spaceName:"spaces/abc0123"}});
 const r=await createScopedMeet(intent,deps);
 assert.equal(r.ok,true);assert.equal(r.replayed,true);assert.equal(calls.network,0);
});
test("VO1 invalid replay is held for reconciliation",async()=>{
 const {deps,calls}=f();deps.reserveOriginalNonce=async()=>({
  status:"REPLAY",receipt:{nonce:id(99),joinUrl:"https://evil.test",spaceName:"spaces/abc0123"}});
 const r=await createScopedMeet(intent,deps);
 assert.equal(r.reason,"MEETING_NONCE_RECONCILIATION_REQUIRED");
 assert.equal(calls.network,0);
});
test("VO1 provider failure or receipt write loss is UNKNOWN, not new-room retry",async()=>{
 for(const bad of ["throw","failure","wrong-url","commit-failure","scope-revoked"]){
  const {deps,calls}=f();
  if(bad==="throw")deps.providerFetch=async()=>{calls.network++;throw Error("private oauth");};
  if(bad==="failure")deps.providerFetch=async()=>{calls.network++;return {ok:false,status:503};};
  if(bad==="wrong-url")deps.providerFetch=async()=>{calls.network++;return {ok:true,
   json:async()=>({meetingUri:"https://attacker.test/path",name:"spaces/abc0123"})};};
  if(bad==="commit-failure")deps.commitReceipt=async()=>false;
  if(bad==="scope-revoked"){let n=0;deps.verifyCurrentScope=async()=>++n<=3;}
  const r=await createScopedMeet(intent,deps);
  assert.equal(r.ok,false,bad);assert.equal(r.committed,null,bad);
  assert.equal(r.retrySameNonceOnly,true,bad);
 }
});
test("VO1 actor/participant cannot be supplied from browser body",async()=>{
 const {deps,calls}=f();
 const r=await createScopedMeet({...intent,actorId:id(100)},deps);
 assert.equal(r.ok,false);assert.equal(calls.reserve,0);
});
test("VO11 token retrieval delay cannot bypass just-in-time scope revocation",async()=>{
 const {deps,calls}=f();let checks=0;
 deps.verifyCurrentScope=async()=>++checks<=2;
 const result=await createScopedMeet(intent,deps);
 assert.equal(result.ok,false);assert.equal(result.reason,"CURRENT_MEETING_SCOPE_DENIED");
 assert.equal(result.providerCalled,false);assert.equal(calls.network,0);
 assert.equal(calls.reserve,1);assert.equal(checks,3);
});
test("VO11 broken reauthorization after token retrieval prevents Google request",async()=>{
 const {deps,calls}=f();let checks=0;
 deps.verifyCurrentScope=async()=>{
  if(++checks===3)throw Error("expired grant source");
  return true;
 };
 const result=await createScopedMeet(intent,deps);
 assert.equal(result.ok,false);assert.equal(result.reason,"CURRENT_MEETING_SCOPE_UNAVAILABLE");
 assert.equal(result.providerCalled,false);assert.equal(calls.network,0);
});
test("VO8 grant revoked during nonce reservation prevents provider creation",async()=>{
 const {deps,calls}=f();
 let checks=0;
 deps.verifyCurrentScope=async()=>++checks===1;
 const result=await createScopedMeet(intent,deps);
 assert.equal(result.ok,false);
 assert.equal(result.reason,"CURRENT_MEETING_SCOPE_DENIED");
 assert.equal(result.providerCalled,false);
 assert.equal(calls.reserve,1);
 assert.equal(calls.network,0);
});

test("VO8 unavailable grant validation after reservation fails closed",async()=>{
 const {deps,calls}=f();
 let checks=0;
 deps.verifyCurrentScope=async()=>{if(++checks===2)throw Error("private");return true;};
 const result=await createScopedMeet(intent,deps);
 assert.equal(result.reason,"CURRENT_MEETING_SCOPE_UNAVAILABLE");
 assert.equal(result.providerCalled,false);
 assert.equal(calls.network,0);
});

test("VO1 revoked scope before reservation never creates meeting",async()=>{
 const {deps,calls}=f();
 deps.verifyCurrentScope=async()=>false;
 assert.equal((await createScopedMeet(intent,deps)).reason,"CURRENT_MEETING_SCOPE_DENIED");
 assert.equal(calls.network,0);assert.equal(calls.reserve,0);
});

test("VO2 previously created meeting cannot leak after replay scope revoked",async()=>{
 const {deps,calls}=f();
 let checks=0;
 deps.verifyCurrentScope=async()=>++checks===1;
 deps.reserveOriginalNonce=async()=>({status:"REPLAY",receipt:{
  nonce:intent.nonce,joinUrl:"https://meet.google.com/abc-defg-hij",spaceName:"spaces/abc0123"}});
 const result=await createScopedMeet(intent,deps);
 assert.equal(result.ok,false);assert.equal(result.reason,"CURRENT_MEETING_SCOPE_DENIED");
 assert.equal(calls.network,0);
});
test("VO2 unbound or non-durable reservations never create provider meetings",async()=>{
 for(const reservation of [{status:"RESERVED"},{
  status:"RESERVED",nonce:id(99),durable:true},{
  status:"RESERVED",nonce:intent.nonce,durable:false}]){
  const {deps,calls}=f();
  deps.reserveOriginalNonce=async()=>reservation;
  const result=await createScopedMeet(intent,deps);
  assert.equal(result.ok,false);
  assert.equal(result.reason,"MEETING_NONCE_NOT_RESERVED");
  assert.equal(calls.network,0);
 }
});
test("VO2 valid replay performs two current Core grant checks",async()=>{
 const {deps,calls}=f();
 deps.reserveOriginalNonce=async()=>({status:"REPLAY",receipt:{
  nonce:intent.nonce,joinUrl:"https://meet.google.com/abc-defg-hij",spaceName:"spaces/abc0123"}});
 const result=await createScopedMeet(intent,deps);
 assert.equal(result.ok,true);assert.equal(result.replayed,true);
 assert.equal(calls.auth,2);assert.equal(calls.network,0);
});
