import test from "node:test";
import assert from "node:assert/strict";
import {applyAtomicConversationControl as apply} from "../../../contracts/vox/ab7fAtomicConversation.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const opts=()=>({environment:"staging",enabled:true,action:"PAUSE_AI",
 conversationId:id(1),expectedRevision:2,operatorId:id(2),nonce:id(3),
 checkCurrentSignedCoreAuthority:async()=>true,
 checkCurrentConversationAndConsent:async()=>true,
 rpc:async()=>({data:[{event_id:id(4),revision:3,new_state:"PAUSED",
 receipt_nonce:id(3)}]})});
test("AB7F exact native event/revision/nonce receipt, never sends",async()=>{
 const r=await apply(opts());assert.equal(r.ok,true);
 assert.equal(r.providerMessagesSent,0);assert.equal(r.productionCertified,false);
});
test("AB7F release and signature gate prevents Core RPC",async()=>{
 for(const patch of [{enabled:false},{environment:"production"},
  {checkCurrentSignedCoreAuthority:async()=>false},
  {checkCurrentConversationAndConsent:async()=>false},
  {action:"RESUME_AI"},{nonce:"not-uuid"}]){
  let calls=0;const s=opts();const r=await apply({...s,...patch,
   rpc:async()=>{calls++;return s.rpc();}});
  assert.equal(r.ok,false);assert.equal(calls,0);
 }
});
test("AB7F mismatched/ambiguous receipts fail closed",async()=>{
 for(const data of [[{event_id:id(4),revision:5,new_state:"PAUSED",receipt_nonce:id(3)}],
 [{event_id:id(4),revision:3,new_state:"PAUSED",receipt_nonce:id(5)}],
 [],[{event_id:id(4),revision:3,new_state:"PAUSED",receipt_nonce:id(3),
 forgedDelivery:true}]]){
  const r=await apply({...opts(),rpc:async()=>({data})});
  assert.equal(r.ok,false);
 }
 assert.equal((await apply({...opts(),rpc:async()=>{throw Error("unknown")}})).ok,false);
});
