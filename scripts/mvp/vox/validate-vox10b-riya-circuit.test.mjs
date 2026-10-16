import test from "node:test";import assert from "node:assert/strict";
import {prepareRiyaHandoverCircuit as circuit}
 from "../../../contracts/vox/riyaHandoverCircuit.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-16T11:00:00Z");
const fixture=()=>{
 const scope={userId:id(1),teamId:id(2),cityId:id(3),
  role:"support_agent",canReadContent:true,canMutate:false,conversationIds:[id(7)]};
 const department={department:"client_success",staffId:id(1),teamId:id(2),
  cityId:id(3),approvedByIndependentTl:true,
  expiresAt:"2026-10-17T15:00:00Z",revokedAt:null};
 const conversation={id:id(7),clientId:id(4),projectId:id(5),teamId:id(2),
  cityId:id(3),assignedStaffId:id(1),revision:4,state:"AI",
  humanTakeover:false,pausedRiya:false,providerOwner:"CORE",
  consentState:"ALLOWED",doNotContact:false,humanRequestedStop:false};
 const clientGrant={clientId:id(4),projectId:id(5),staffId:id(1),
  conversationId:id(7),teamId:id(2),cityId:id(3),status:"ACTIVE",
  expiresAt:"2026-10-17T10:00:00Z",grantRevision:1};
 const canonicalLocationProof={projectId:id(5),cityId:id(3),
  placeId:"ChIJ8AUExamplePlaceID",googleVerified:true};
 const jarvisReceipt={conversationId:id(7),clientId:id(4),
  projectId:id(5),revision:4,expiresAtMs:now+60000,
  signatureVersion:"qfj.scale.http.v1"};
 const request={action:"REQUEST_TAKEOVER",nonce:id(8),
  expectedRevision:4,reason:"Client requested human help"};
 const preflightArgs={scope,department,conversation,clientGrant,
  canonicalLocationProof,jarvisReceipt,request,
  verifyGrant:async()=>true,verifyCanonicalLocation:async()=>true,
  verifyJarvis:async()=>true};
 const observation={schema:"qfj.vox.riya.handover.observation.v1",
  conversationId:id(7),clientId:id(4),projectId:id(5),revision:4,
  state:"AI",providerMessagesSent:0,origin:"JARVIS_READ_ONLY",
  observedAt:"2026-10-16T10:59:59.000Z"};
 const last={scope,department,conversation,clientGrant,canonicalLocationProof,jarvisReceipt};
 return {preflightArgs,readCurrentCoreSnapshot:async()=>last,
  readVerifiedJarvisObservation:async()=>observation,
  verifyCurrentJarvisObservation:async()=>true,clock:()=>now,
  observation,last};
};
test("Core/Jarvis only prepare a non-executable current-scope circuit",async()=>{
 const r=await circuit(fixture());
 assert.equal(r.ok,true);assert.equal(r.grantRechecked,true);
 assert.equal(r.executionAuthorized,false);assert.equal(r.canSendReply,false);
 assert.equal(r.providerMessagesSent,0);
 assert.equal(r.requiresRealJarvisPauseOrResumeAck,true);
});
test("missing Core scope or separate Jarvis verifier blocks",async()=>{
 for(const prop of ["preflightArgs","readCurrentCoreSnapshot",
  "readVerifiedJarvisObservation","verifyCurrentJarvisObservation"]){
  const f=fixture();delete f[prop];
  assert.equal((await circuit(f)).ok,false);
 }
});
test("real Jarvis observation unavailable or mis-signed is denied",async()=>{
 for(const patch of [
  {readVerifiedJarvisObservation:async()=>{throw Error("OFFLINE")}},
  {verifyCurrentJarvisObservation:async()=>false},
  {verifyCurrentJarvisObservation:async()=>{throw Error("REPLAY")}},
 ]){
  const r=await circuit({...fixture(),...patch});assert.equal(r.ok,false);
 }
});
test("cross-project, wrong revision, provider sends and PII are denied",async()=>{
 const mods=[
  {projectId:id(99)},{clientId:id(99)},{revision:8},
  {providerMessagesSent:1},{phone:"PRIVATE"},
  {origin:"BROWSER"},{observedAt:"2026-10-16T09:00:00Z"}
 ];
 for(const change of mods){
  const f=fixture();f.readVerifiedJarvisObservation=async()=>({...f.observation,...change});
  const r=await circuit(f);assert.equal(r.ok,false);
 }
});
test("revocation during async Jarvis read invalidates even prior positive preflight",async()=>{
 for(const change of [
  {department:{...fixture().last.department,revokedAt:"2026-10-16T11:00:00Z"}},
  {conversation:{...fixture().last.conversation,doNotContact:true}},
  {clientGrant:{...fixture().last.clientGrant,status:"REVOKED"}}
 ]){
  const f=fixture();f.readCurrentCoreSnapshot=async()=>({...f.last,...change});
  assert.equal((await circuit(f)).ok,false);
 }
});
test("changed Core revision invalidates stale Jarvis scope",async()=>{
 const f=fixture();
 f.readCurrentCoreSnapshot=async()=>({...f.last,
  conversation:{...f.last.conversation,revision:5}});
 assert.equal((await circuit(f)).error,"CORE_STATE_CHANGED_DURING_HANDOVER");
});
test("different Jarvis and Core conversation states require explicit reconciliation",async()=>{
 const f=fixture();
 f.readVerifiedJarvisObservation=async()=>({...f.observation,state:"HUMAN"});
 assert.equal((await circuit(f)).error,"CORE_JARVIS_STATE_NOT_RECONCILED");
});
test("no transcript, contact, signed token or provider delivery in response",async()=>{
 const r=await circuit(fixture()),s=JSON.stringify(r);
 for(const k of ["phone","transcript","signature","secret","providerToken"]){
  assert.equal(s.includes(k),false);
 }
});
