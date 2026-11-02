import test from "node:test";import assert from "node:assert/strict";
import {generateKeyPairSync,verify} from "node:crypto";
import {prepareAb7FourSignedSources as prepare}
 from "../../../contracts/vox/ab7FourSignedSourceReadiness.mjs";
import {canonicalAb3EodSeal}
 from "../../../contracts/vox/ab3SignedEodReadiness.mjs";
const sources=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:id(1),teamId:id(2),cityId:id(3),currentAal:"aal2",
 canReadContent:true,canMutate:false};
const now=Date.parse("2026-10-18T06:00:00Z");
const keys=sources.map(()=>generateKeyPairSync("ed25519"));
const privateKeysBySource=Object.fromEntries(sources.map((s,i)=>[s,
 keys[i].privateKey.export({format:"pem",type:"pkcs8"}).toString()]));
const publicKeysBySource=Object.fromEntries(sources.map((s,i)=>[s,
 keys[i].publicKey.export({format:"pem",type:"spki"}).toString()]));
const rowsBySource=Object.fromEntries(sources.map((source,i)=>[source,[{
 source,actorId:scope.userId,teamId:scope.teamId,cityId:scope.cityId,
 eventId:id(i+10),subjectId:id(i+20),revision:1,eventKind:"STAFF_ACTION",
 occurredAt:"2026-10-17T12:00:00Z"}]]));
const base=()=>({scope,businessDate:"2026-10-17",rowsBySource,
 privateKeysBySource,publicKeysBySource,now,
 verifyCurrentStaff:async()=>true,verifyExactSourceEvent:async()=>true});
test("AB7D creates 4 genuine verified Ed25519 manifests, not official EOD",async()=>{
 const x=await prepare(base());assert.equal(x.ok,true);
 assert.equal(x.official,false);assert.equal(x.evidence.length,4);
 for(let i=0;i<4;i++){
  const v=x.evidence[i];assert.ok(verify(null,
   Buffer.from(canonicalAb3EodSeal(v.payload)),keys[i].publicKey,
   Buffer.from(v.signature,"base64url")));
 }
});
test("AB7D refuses invented source, actor, date, object or revision",async()=>{
 for(const patch of [
  {actorId:id(91)},{occurredAt:"2026-10-18T00:00:00Z"},
  {revision:-1},{source:"OTHER"},{subjectId:"invalid"}
 ]){
  const rows={...rowsBySource,CRM_AAROHI:[{...rowsBySource.CRM_AAROHI[0],...patch}]};
  assert.equal((await prepare({...base(),rowsBySource:rows})).ok,false);
 }
});
test("AB7D private key mismatch, missing source, revoked grants deny",async()=>{
 assert.equal((await prepare({...base(),privateKeysBySource:{
  ...privateKeysBySource,CRM_AAROHI:privateKeysBySource.CORE_CONVERSATION}})).ok,false);
 assert.equal((await prepare({...base(),rowsBySource:{...rowsBySource,
  SUPPORT_DESK:undefined}})).ok,false);
 assert.equal((await prepare({...base(),
  verifyExactSourceEvent:async()=>false})).ok,false);
});
test("AB7D requires closed day and current Staff twice",async()=>{
 assert.equal((await prepare({...base(),businessDate:"2026-10-18"})).ok,false);
 let count=0;assert.equal((await prepare({...base(),
  verifyCurrentStaff:async()=>++count===1})).ok,false);
});
