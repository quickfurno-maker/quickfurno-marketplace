import test from "node:test";import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {recordVerifiedStaffSourceAction as record,
 canonicalSourceEventBody} from "../../../contracts/vox/f1CanonicalSourceRecorder.mjs";
import {acknowledgeIndependentFourSourceEod as ack}
 from "../../../contracts/vox/f1OfficialEodTransitions.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const keys=generateKeyPairSync("ed25519"),now=Date.parse("2026-10-16T12:00:00Z");
const publicKeyPem=keys.publicKey.export({format:"pem",type:"spki"}).toString();
const base=()=>({schema:"qf.vox.f1.staff-source-action.v1",
 id:id(1),source:"CRM_AAROHI",sourceEventId:id(2),actorId:id(3),
 teamId:id(4),cityId:id(5),objectId:id(6),revision:1,
 eventKind:"FOLLOW_UP",occurredAt:new Date(now).toISOString(),
 subjectKind:"prospect",subjectId:id(7),nonce:id(8),
 issuedAtMs:now,expiresAtMs:now+45000});
const signature=r=>sign(null,Buffer.from(canonicalSourceEventBody(r)),
 keys.privateKey).toString("base64url");
const args=()=>{const command=base();let inserts=0;return {
 command,signature:signature(command),publicKeyPem,now,
 verifyCurrentNeutralStaff:async()=>true,
 verifyImmutableSourceObject:async()=>true,
 verifyExactObjectGrant:async()=>true,
 insertOnce:async()=>{inserts++;return {id:command.id,persisted:true,
  provenanceCheckedInTransaction:true,staffCheckedInTransaction:true,
  grantCheckedInTransaction:true,nonceConsumedInTransaction:true};},
 get inserts(){return inserts;}
};};
test("verified human-only canonical CRM action signs and appends exactly once",async()=>{
 const a=args(),r=await record(a);assert.equal(r.ok,true);
 assert.equal(r.inserted,true);assert.equal(r.providerMessagesSent,0);
 assert.equal(a.inserts,1);
});
test("forged actor, source, event, nonce, subject and expiry cannot append",async()=>{
 for(const patch of [{actorId:id(55)},{source:"CORE_AI"},
  {eventKind:"WHATSAPP_SEND"},{nonce:id(75)},
  {subjectKind:"conversation"},{expiresAtMs:now-1}]){
  const a=args(),r=await record({...a,command:{...a.command,...patch}});
  assert.equal(r.ok,false);assert.equal(a.inserts,0);
 }
});
test("grant, Staff AAL2, immutable source reject before insert",async()=>{
 for(const field of ["verifyCurrentNeutralStaff","verifyImmutableSourceObject",
  "verifyExactObjectGrant"]){
  const a=args(),r=await record({...a,[field]:async()=>false});
  assert.equal(r.ok,false);assert.equal(a.inserts,0);
 }
});
test("fake post-commit proofs cannot certify Staff event",async()=>{
 for(const field of ["nonceConsumedInTransaction","provenanceCheckedInTransaction",
  "grantCheckedInTransaction","staffCheckedInTransaction"]){
  const a=args(),r=await record({...a,insertOnce:async()=>({
   id:a.command.id,persisted:true,nonceConsumedInTransaction:true,
   provenanceCheckedInTransaction:true,staffCheckedInTransaction:true,
   grantCheckedInTransaction:true,[field]:false
  })});
  assert.equal(r.ok,false);
 }
});
test("independent Team Leader ACK cannot self-approve or skip database proof",async()=>{
 const reviewer={userId:id(10),teamId:id(11),cityId:id(12),
  currentAal:"aal2",role:"team_leader"};
 const input={reviewer,reportId:id(13),nonce:id(14),
  verifyCurrentLeader:async()=>true,
  decideInDatabase:async()=>({reportId:id(13),state:"ACKNOWLEDGED",
   revision:1,reviewerId:id(10),staffId:id(15),
   sourceSealRechecked:true,independentReviewerRecheckedInTransaction:true,
   nonceConsumedInTransaction:true})};
 assert.equal((await ack(input)).ok,true);
 for(const changes of [
  {reviewer:{...reviewer,userId:id(15)}},
  {reviewer:{...reviewer,currentAal:"aal1"}},
  {verifyCurrentLeader:async()=>false},
  {decideInDatabase:async()=>({...await input.decideInDatabase(),staffId:id(10)})},
  {decideInDatabase:async()=>({...await input.decideInDatabase(),sourceSealRechecked:false})}
 ])assert.equal((await ack({...input,...changes})).ok,false);
});
