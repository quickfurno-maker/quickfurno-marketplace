import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign as edSign} from "node:crypto";
import {verifyIndependentReviewerPackets as verify}
 from "../../../contracts/vox/independentReviewerSignatures.mjs";
const sha="a".repeat(64),owner="quickfurno-owner-identifier";
const now=Date.parse("2026-10-16T11:00:00.000Z");
function prepare(){
 const registry=[];const packets=[];
 for(const [i,gate] of ["DBA","APPSEC","FIRST_TEAM_LEADER"].entries()){
  const pair=generateKeyPairSync("ed25519");
  const reviewerRef="independent-human-synthetic-"+i;
  registry.push({gate,reviewerRef,
   publicKeyPem:pair.publicKey.export({type:"spki",format:"pem"}).toString()});
  const payload={schema:"qf.vox.independent-review.attestation.v1",
   gate,environment:"staging",sourceSha:sha,reviewerRef,ownerRef:owner,
   decision:"APPROVED",issuedAt:new Date(now-1000).toISOString(),
   expiresAt:new Date(now+3600000).toISOString(),
   nonce:String(i+1).padStart(64,"1")};
  const signature=edSign(null,Buffer.from(JSON.stringify(payload),"utf8"),
   pair.privateKey).toString("base64url");
  packets.push({payload,signature});
 }
 return {registry,packets,ownerRef:owner,sourceSha:sha,now};
}
test("three actual synthetic Ed25519 signatures verify, but never human approval",()=>{
 const r=verify(prepare());
 assert.equal(r.ok,true);
 assert.equal(r.cryptographicPacketsVerified,3);
 assert.equal(r.independentHumanIdentitiesVerified,false);
 assert.equal(r.reviewersEngaged,false);
 assert.equal(r.trustedRegistryProvenanceExternallyVerified,false);
 assert.equal(r.firstTeamLeaderOnboarded,false);
 assert.equal(r.protectedStagingPermitted,false);
 assert.equal(r.productionPermitted,false);
});
test("wrong payload source/hash/owner/decision rejected after signing",()=>{
 for(const patch of [{sourceSha:"b".repeat(64)},{ownerRef:"another-owner-00001"},
  {decision:"REJECTED"},{environment:"production"},
  {gate:"UNTRUSTED_OWNER"}]){
  const f=prepare();Object.assign(f.packets[0].payload,patch);
  assert.equal(verify(f).ok,false);
 }
});
test("wrong Ed25519 signature and swapped source key rejected",()=>{
 const f=prepare();f.packets[0].signature=f.packets[1].signature;
 assert.equal(verify(f).ok,false);
 const second=prepare();second.registry[0].publicKeyPem=second.registry[1].publicKeyPem;
 assert.equal(verify(second).ok,false);
});
test("no owner self-attestation, duplicate reviewer, or cross-gate signer",()=>{
 for(const change of [
  f=>{f.registry[0].reviewerRef=owner;},
  f=>{f.registry[1].reviewerRef=f.registry[0].reviewerRef;},
  f=>{f.packets[1].payload.reviewerRef=f.registry[0].reviewerRef;}
 ]){
  const f=prepare();change(f);assert.equal(verify(f).ok,false);
 }
});
test("nonce replay or signed future/expired packets fail",()=>{
 for(const change of [
  f=>{f.packets[1].payload.nonce=f.packets[0].payload.nonce;},
  f=>{f.packets[1].payload.issuedAt=new Date(now+86400000).toISOString();},
  f=>{f.packets[1].payload.expiresAt=new Date(now-1000).toISOString();}
 ]){
  const f=prepare();change(f);assert.equal(verify(f).ok,false);
 }
});
test("missing real key registry and fake reviewer status never unlock stage",()=>{
 assert.equal(verify().protectedStagingPermitted,false);
 const f=prepare();f.registry.pop();
 assert.equal(verify(f).ok,false);
 const g=prepare();g.packets[0].payload.status="HUMAN_APPROVED";
 assert.equal(verify(g).ok,false);
});
test("invalid key family and malformed signature are refused",()=>{
 const f=prepare();f.registry[0].publicKeyPem="not a real Ed25519 key";
 assert.equal(verify(f).ok,false);
 const g=prepare();g.packets[0].signature="forged";
 assert.equal(verify(g).ok,false);
});
test("no user PII, root signer private key or release token in result",()=>{
 const s=JSON.stringify(verify(prepare()));
 for(const word of ["privateKey","signerEmail","accessToken","staffPhone",
  "authenticatedHumanSignature","releaseToken"]){
  assert.equal(s.includes(word),false);
 }
});
