import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {canonicalSourceEventBody} from "../../../contracts/vox/f1CanonicalSourceRecorder.mjs";
import {commitCurrentStaffMutationAndEvent} from "../../../contracts/vox/phaseBNativeSourceWriter.mjs";
const uid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-17T13:30:00Z");
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const publicKeyPem=publicKey.export({format:"pem",type:"spki"}).toString();
const plans=[
 ["CORE_WORK_LEDGER","CORE_WORK_TRANSITION","prospect"],
 ["CRM_AAROHI","AAROHI_STAFF_FOLLOWUP","prospect"],
 ["SUPPORT_DESK","STAFF_SUPPORT_ACTION","support_thread"],
 ["CORE_CONVERSATION","STAFF_CONVERSATION_ACTION","conversation"]
];
function fixture(source,origin,subjectKind){
 const command={schema:"qf.vox.f1.staff-source-action.v1",
  id:uid(1),source,sourceEventId:uid(2),actorId:uid(3),
  teamId:uid(4),cityId:uid(5),objectId:uid(6),revision:3,
  eventKind:"STAFF_ACTION",occurredAt:new Date(now).toISOString(),
  subjectKind,subjectId:uid(7),nonce:uid(8),
  issuedAtMs:now-1000,expiresAtMs:now+30000};
 const signature=sign(null,Buffer.from(canonicalSourceEventBody(command)),
  privateKey).toString("base64url");
 const sourceMutation={source,origin,sourceEventId:command.sourceEventId,
  subjectId:command.subjectId,objectId:command.objectId,
  expectedRevision:command.revision,actorId:command.actorId,
  nonce:command.nonce,effect:"CORE_INTERNAL_ONLY"};
 let commits=0;
 const args={environment:"staging",command,signature,publicKeyPem,
  sourceMutation,now,verifyCurrentNeutralStaff:async()=>true,
  verifyImmutableSourceObject:async()=>true,
  verifyExactObjectGrant:async()=>true,
  commitSourceAndEventOnce:async ({command:c,transactionIsolation})=>{
   commits++;
   return {id:c.id,sourceEventId:c.sourceEventId,
    persisted:true,provenanceCheckedInTransaction:true,
    staffCheckedInTransaction:true,grantCheckedInTransaction:true,
    nonceConsumedInTransaction:true,sourceMutationCommittedInTransaction:true,
    canonicalEventInsertedInTransaction:true,transactionIsolation,
    providerMessagesSent:0};
  }};
 return {args,get commits(){return commits}};
}
for(const [source,origin,kind] of plans){
 test("Phase B "+source+" must commit native source and canonical event together",async()=>{
  const x=fixture(source,origin,kind);
  const result=await commitCurrentStaffMutationAndEvent(x.args);
  assert.equal(result.ok,true);assert.equal(x.commits,1);
  assert.equal(result.source,source);
  assert.equal(result.staffActivityCertified,false);
  assert.equal(result.providerMessagesSent,0);
 });
}
test("four-source native adapters never accept unauthenticated or past event replays",async()=>{
 const x=fixture(...plans[1]);
 for(const patch of [
  {environment:"production"},
  {signature:"forged"},
  {sourceMutation:{...x.args.sourceMutation,actorId:uid(80)}},
  {sourceMutation:{...x.args.sourceMutation,subjectId:uid(81)}},
  {sourceMutation:{...x.args.sourceMutation,origin:"PROVIDER_OR_AI"}},
  {sourceMutation:{...x.args.sourceMutation,nonce:uid(90)}},
  {sourceMutation:{...x.args.sourceMutation,source:"SUPPORT_DESK"}},
  {now:now+120000}
 ]){
  const y=fixture(...plans[1]);
  const result=await commitCurrentStaffMutationAndEvent({...y.args,...patch});
  assert.equal(result.ok,false,JSON.stringify(patch));assert.equal(y.commits,0);
 }
});
test("Core actor, source and object verification denial stops original mutation",async()=>{
 for(const key of ["verifyCurrentNeutralStaff","verifyImmutableSourceObject",
  "verifyExactObjectGrant"]){
  const x=fixture(...plans[2]);
  assert.equal((await commitCurrentStaffMutationAndEvent({
   ...x.args,[key]:async()=>false})).ok,false);
  assert.equal(x.commits,0);
 }
});
test("fabricated DB atomicity receipts cannot certify Staff history",async()=>{
 const fields=["persisted","provenanceCheckedInTransaction",
  "staffCheckedInTransaction","grantCheckedInTransaction",
  "nonceConsumedInTransaction","sourceMutationCommittedInTransaction",
  "canonicalEventInsertedInTransaction"];
 for(const key of fields){
  const x=fixture(...plans[0]),orig=x.args.commitSourceAndEventOnce;
  const result=await commitCurrentStaffMutationAndEvent({...x.args,
   commitSourceAndEventOnce:async r=>({...await orig(r),[key]:false})});
  assert.equal(result.ok,false,key);
 }
 for(const patch of [
  {transactionIsolation:"READ_COMMITTED"},
  {providerMessagesSent:1},{sourceEventId:uid(91)}
 ]){
  const x=fixture(...plans[0]),orig=x.args.commitSourceAndEventOnce;
  const result=await commitCurrentStaffMutationAndEvent({...x.args,
   commitSourceAndEventOnce:async r=>({...await orig(r),...patch})});
  assert.equal(result.ok,false);
 }
});
test("disposable synthetic nonce ledger rejects reused original mutation",async()=>{
 const nonces=new Set(),x=fixture(...plans[1]),orig=x.args.commitSourceAndEventOnce;
 const storage=async args=>{
  if(nonces.has(args.command.nonce))throw Error("REPLAY");
  nonces.add(args.command.nonce);
  return orig(args);
 };
 assert.equal((await commitCurrentStaffMutationAndEvent({...x.args,
  commitSourceAndEventOnce:storage})).ok,true);
 assert.equal((await commitCurrentStaffMutationAndEvent({...x.args,
  commitSourceAndEventOnce:storage})).ok,false);
 assert.equal(x.commits,1);
});
test("no historical backfill or provider-triggered staff credit",()=>{
 const x=fixture(...plans[3]);
 assert.equal(x.args.sourceMutation.effect,"CORE_INTERNAL_ONLY");
 assert.equal(x.args.sourceMutation.origin,"STAFF_CONVERSATION_ACTION");
});
