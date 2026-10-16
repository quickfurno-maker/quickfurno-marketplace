import test from "node:test";
import assert from "node:assert/strict";
import {preflightRiyaClientHandover as preflight}
 from "../../../contracts/vox/riyaClientHandoverGate.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-16T11:00:00Z");
const base=()=>{
 const scope={userId:id(1),teamId:id(2),cityId:id(3),
  role:"support_agent",canReadContent:true,canMutate:false,
  conversationIds:[id(7)]};
 const department={department:"client_success",staffId:id(1),teamId:id(2),
  cityId:id(3),approvedByIndependentTl:true,
  expiresAt:"2026-10-17T15:00:00Z",revokedAt:null};
 const conversation={id:id(7),clientId:id(4),projectId:id(5),
  teamId:id(2),cityId:id(3),assignedStaffId:id(1),
  revision:4,state:"AI",humanTakeover:false,pausedRiya:false,
  providerOwner:"CORE",consentState:"ALLOWED",doNotContact:false,
  humanRequestedStop:false};
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
 const verifyGrant=async()=>true,verifyCanonicalLocation=async()=>true,
  verifyJarvis=async()=>true;
 return {scope,department,conversation,clientGrant,canonicalLocationProof,
  jarvisReceipt,request,verifyGrant,verifyCanonicalLocation,verifyJarvis,now};
};
test("only non-executable Core preflight with separate trusted verifiers",async()=>{
 const result=await preflight(base());
 assert.equal(result.ok,true);
 assert.equal(result.schema,"qf.vox.riya.client.preflight.v2");
 assert.equal(result.kind,"NON_EXECUTABLE_PREFLIGHT");
 assert.equal(result.action,"REQUEST_TAKEOVER");
 assert.equal(result.proposedState,"TAKEOVER_PENDING");
 assert.equal(result.executionAuthorized,false);
 assert.equal(result.canReadTranscript,false);
 assert.equal(result.canSendReply,false);
 assert.equal(result.canChangeAgentState,false);
 assert.equal(result.providerMessagesSent,0);
 assert.equal(result.requiresFreshCoreGrantAtExecution,true);
});
test("missing verifier is never an implicit owner/AI approval",async()=>{
 for(const which of ["verifyGrant","verifyJarvis","verifyCanonicalLocation"]){
  const x=base();delete x[which];
  const result=await preflight(x);assert.equal(result.ok,false);
 }
});
test("refuse false verification and thrown verifier (fail closed)",async()=>{
 for(const which of ["verifyGrant","verifyJarvis","verifyCanonicalLocation"]){
  const x=base();x[which]=async()=>false;
  assert.equal((await preflight(x)).ok,false);
  const y=base();y[which]=async()=>{throw Error("unavailable")};
  assert.equal((await preflight(y)).ok,false);
 }
});
test("cannot derive or expand existing Core Staff conversation grants",async()=>{
 for(const field of ["userId","teamId","cityId"]){
  const x=base();x.scope[field]=id(99);
  assert.equal((await preflight(x)).ok,false);
 }
 const x=base();x.scope.conversationIds=[];
 assert.equal((await preflight(x)).ok,false);
 const y=base();y.scope.role="team_leader";
 assert.equal((await preflight(y)).ok,false);
 const z=base();z.scope.canMutate=true;
 assert.equal((await preflight(z)).ok,false);
});
test("independent current department grant mandatory",async()=>{
 for(const change of [
  {approvedByIndependentTl:false},
  {department:"acquisition"},
  {revokedAt:"2026-10-16T09:00:00Z"},
  {staffId:id(99)},
  {expiresAt:"2026-10-16T00:00:00Z"}
 ]){
  const x=base();Object.assign(x.department,change);
  assert.equal((await preflight(x)).ok,false);
 }
});
test("canonical client, project and team/city must agree",async()=>{
 for(const k of ["clientId","projectId","teamId","cityId","assignedStaffId"]){
  const x=base();x.conversation[k]=id(99);
  assert.equal((await preflight(x)).ok,false);
 }
 const x=base();x.clientGrant.projectId=id(99);
 assert.equal((await preflight(x)).ok,false);
});
test("Google Places canonical location proof cannot be free text",async()=>{
 for(const change of [
  {googleVerified:false},{cityId:id(99)},{projectId:id(99)},
  {placeId:"typed Pune address"},
  {placeId:"a"}
 ]){
  const x=base();Object.assign(x.canonicalLocationProof,change);
  assert.equal((await preflight(x)).ok,false);
 }
});
test("signed Jarvis context exact revision, sub & expiry must hold",async()=>{
 for(const change of [
  {conversationId:id(99)},
  {revision:3},
  {projectId:id(99)},
  {signatureVersion:"unsigned"},
  {expiresAtMs:now-1},
  {expiresAtMs:now+3600000}
 ]){
  const x=base();Object.assign(x.jarvisReceipt,change);
  assert.equal((await preflight(x)).ok,false);
 }
});
test("no consent, DNC, human stop or provider non-Core ownership",async()=>{
 const variations=[
  {consentState:"DENIED"},{doNotContact:true},{humanRequestedStop:true},
  {providerOwner:"JARVIS"}
 ];
 for(const c of variations){
  const x=base();Object.assign(x.conversation,c);
  assert.equal((await preflight(x)).ok,false);
 }
});
test("stale revision, client-chosen role and forged authority fields denied",async()=>{
 for(const change of [
  {expectedRevision:5},{action:"SEND_WHATSAPP"},
  {staffId:id(9)},{teamId:id(2)},{reason:"short"},
  {reason:" bad leading whitespace "}
 ]){
  const x=base();Object.assign(x.request,change);
  assert.equal((await preflight(x)).ok,false);
 }
});
test("transition requires actual current Jarvis/Core state",async()=>{
 const x=base();x.request.action="PROPOSE_REPLY";
 assert.equal((await preflight(x)).ok,false);
 const y=base();y.conversation.state="HUMAN";
 y.conversation.humanTakeover=true;
 y.request.action="PROPOSE_REPLY";
 const res=await preflight(y);
 assert.equal(res.ok,true);assert.equal(res.canSendReply,false);
 const z=base();z.conversation.state="HUMAN";
 z.conversation.humanTakeover=true;z.request.action="RELEASE_TO_RIYA";
 assert.equal((await preflight(z)).ok,false);
 z.conversation.pausedRiya=true;
 assert.equal((await preflight(z)).ok,true);
});
test("case metadata contains no transcript, phone, keys or delivery claim",async()=>{
 const x=base(),res=await preflight(x);
 assert.equal(res.ok,true);
 const text=JSON.stringify(res);
 assert.equal(text.includes("phone"),false);
 assert.equal(text.includes("signedJarvisContextVerified"),false);
 assert.equal(text.includes("placeId"),false);
 assert.equal(text.includes("CAN_SEND"),false);
 assert.equal(res.providerMessagesSent,0);
});
