import test from "node:test";
import assert from "node:assert/strict";
import {prepareCanonicalCorePause as prepare} from "../../../contracts/vox/ab7ConversationPauseGate.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const hash="a".repeat(64),now=Date.parse("2026-10-18T04:00:00Z");
const staff={userId:id(1),teamId:id(2),cityId:id(3),role:"client_success_agent",
 currentAal:"aal2",conversationIds:[id(4)]};
const conversation={id:id(4),revision:7,state:"OPEN",assigned_actor:"RIYA",
 human_takeover:false,subject_type:"client",subject_id:id(5)};
const canonicalSnapshot={conversationId:id(4),principalType:"client",principalId:id(5),
 destinationHash:hash,preferenceLastEventId:id(6),
 suppressionCheckedAtMs:now-1000,currentAllowed:true,notSuppressed:true};
const opts=()=>({staff,conversation,expectedRevision:7,nonce:id(7),
 canonicalSnapshot,now,verifyCurrentCoreConversation:async()=>true,
 verifyCurrentStaffAal2:async()=>true,verifySignedJarvisPause:async()=>true,
 verifyCanonicalOptOut:async()=>true});
test("AB7C permits only signed, scoped, read-only PAUSE preparation",async()=>{
 const r=await prepare(opts());assert.equal(r.ok,true,r.reason);
 assert.equal(r.action,"PAUSE_AI_ONLY");assert.equal(r.mayExecute,false);
 assert.equal(r.coreConversationUpdated,false);assert.equal(r.providerMessagesSent,0);
});
test("AB7C fails closed on stale/revoked consent, forged principal, no assignment",async()=>{
 for(const patch of [
  {canonicalSnapshot:{...canonicalSnapshot,currentAllowed:false}},
  {canonicalSnapshot:{...canonicalSnapshot,notSuppressed:false}},
  {canonicalSnapshot:{...canonicalSnapshot,suppressionCheckedAtMs:now-16000}},
  {canonicalSnapshot:{...canonicalSnapshot,principalId:id(90)}},
  {staff:{...staff,currentAal:"aal1"}},
  {staff:{...staff,conversationIds:[]}},
  {conversation:{...conversation,revision:8}},
  {conversation:{...conversation,subject_type:"prospect"}},
  {conversation:{...conversation,human_takeover:true}},
  {conversation:{...conversation,assigned_actor:"HUMAN"}},
  {action:"RESUME_AI"}
 ]){
  const r=await prepare({...opts(),...patch});if(patch.action)continue;
  assert.equal(r.ok,false,JSON.stringify(patch));
 }
});
test("AB7C Core, Staff, canonical consent, Jarvis signature all mandatory",async()=>{
 for(const k of ["verifyCurrentCoreConversation","verifyCurrentStaffAal2",
  "verifySignedJarvisPause","verifyCanonicalOptOut"]){
  assert.equal((await prepare({...opts(),[k]:async()=>false})).ok,false);
  assert.equal((await prepare({...opts(),[k]:async()=>{throw Error("unavailable")}})).ok,false);
 }
});
test("AB7C rejects unknown synthetic consent field, avoids execution",async()=>{
 const r=await prepare({...opts(),canonicalSnapshot:{...canonicalSnapshot,
  vox_ab7b_current_consent_candidate_v1:"ALLOWED"}});
 assert.equal(r.ok,false);assert.equal(r.mayExecute,false);
});
