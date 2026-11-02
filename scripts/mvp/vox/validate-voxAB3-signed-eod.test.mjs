import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {canonicalAb3EodSeal,verifyAb3SignedEodReadiness as attest}
 from "../../../contracts/vox/ab3SignedEodReadiness.mjs";
const names=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-17T16:00:00Z");
const scope={userId:id(1),teamId:id(2),cityId:id(3),
 currentAal:"aal2",canReadContent:true,canMutate:false};
const keys=names.map(()=>generateKeyPairSync("ed25519"));
const publicKeysBySource=Object.fromEntries(names.map((s,i)=>[s,
 keys[i].publicKey.export({format:"pem",type:"spki"}).toString()]));
const payloads=names.map((source,i)=>({
 schema:"qf.vox.ab3.source-eod-seal.v1",source,
 staffId:scope.userId,teamId:scope.teamId,cityId:scope.cityId,
 businessDate:"2026-10-16",eventCount:i+1,lastRevision:i+1,
 sourceSha256:String(i+1).repeat(64),issuedAtMs:now-2000,
 expiresAtMs:now+20000
}));
const signed=(p,i)=>({payload:p,signature:sign(null,
 Buffer.from(canonicalAb3EodSeal(p)),keys[i].privateKey).toString("base64url")});
const evidence=payloads.map((p,i)=>signed(p,i));
const params=()=>({scope,businessDate:"2026-10-16",evidence,
 publicKeysBySource,now,
 verifyCurrentStaff:async()=>true,
 verifyDbSourceSeal:async()=>true,
 verifyExactSourceObjectGrants:async()=>true});
test("AB3 four valid Ed25519 source attestations are read-only, not official EOD",async()=>{
 const r=await attest(params());assert.equal(r.ok,true);
 assert.equal(r.sourceCount,4);
 assert.equal(r.signatureVerifiedForAllFour,true);
 assert.equal(r.official,false);assert.equal(r.eligibleForOfficialSubmission,false);
});
test("AB3 altered count/date/city with old Ed25519 signature denied",async()=>{
 for(const property of ["eventCount","businessDate","cityId","staffId"]){
  const p={...payloads[0],[property]:property==="eventCount"?99:
   property==="businessDate"?"2026-10-15":id(55)};
  const changed=[{...evidence[0],payload:p},...evidence.slice(1)];
  assert.equal((await attest({...params(),evidence:changed})).ok,false);
 }
});
test("AB3 missing source, duplicate source or pinned key mismatch denied",async()=>{
 for(const bad of [
  {evidence:evidence.slice(1)},
  {evidence:[evidence[0],evidence[0],evidence[2],evidence[3]]},
  {publicKeysBySource:{...publicKeysBySource,
    CORE_WORK_LEDGER:publicKeysBySource.CRM_AAROHI}}
 ]){
  assert.equal((await attest({...params(),...bad})).ok,false);
 }
});
test("AB3 expired signature, stale verified staff and DB grant denial",async()=>{
 const e=[signed({...payloads[0],issuedAtMs:now-300001,
  expiresAtMs:now-1},0),...evidence.slice(1)];
 assert.equal((await attest({...params(),evidence:e})).ok,false);
 for(const key of ["verifyCurrentStaff","verifyDbSourceSeal",
  "verifyExactSourceObjectGrants"]){
  assert.equal((await attest({...params(),[key]:async()=>false})).ok,false);
 }
});
