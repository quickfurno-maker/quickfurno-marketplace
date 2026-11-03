import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {canonical,evaluateSignedRelease,SHAS,FINGERPRINTS} from "./step3b22a-signed-release.mjs";
const commit="c".repeat(40), digest="d".repeat(64);
const asOf="2026-11-03T16:10:00Z";
const payload=()=>({
 environment:"staging",projectRef:"uckafzuochmbvtiodmcl",candidateCommit:commit,
 backupSha256:SHAS.staging,fingerprints:{...FINGERPRINTS.staging},
 encryptedAllowlistSha256:digest,recoveryEvidenceSha256:digest,freezeEvidenceSha256:digest,
 issuedAt:"2026-11-03T16:05:00Z",expiresAt:"2026-11-03T16:20:00Z",
 controls:{
  fullRestoreVerified:true,immutableHistoryExceptionReviewed:true,
  authOwnerExclusionVerified:true,providerFreezeVerified:true,
  legalRetentionDispositionReviewed:true,rollbackRehearsalPassed:true
 }
});
const signed=(p=payload())=>{
 const trust={};const signatures=[];
 for(const role of ["DBA","APPSEC","SRE"]){
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  const keyId=role+"-reviewer";
  trust[role]={[keyId]:{independent:true,identity:keyId,publicKey:publicKey.export({format:"pem",type:"spki"})}};
  signatures.push({role,keyId,signature:sign(null,Buffer.from(canonical(p)),privateKey).toString("base64")});
 }
 return {trust,envelope:{payload:p,signatures}};
};
test("A1 missing signed evidence fails closed",()=>{
 const x=evaluateSignedRelease({},{},"2026-11-03T16:10:00Z");
 assert.equal(x.decision,"HOLD");assert.equal(x.executable,false);
});
test("A2 canonical document independent of field insertion order",()=>{
 assert.equal(canonical({b:1,a:{y:true,x:false}}),canonical({a:{x:false,y:true},b:1}));
});
test("A3 test-only all-green verified signatures never return executable approval",()=>{
 const {trust,envelope}=signed();
 const x=evaluateSignedRelease(envelope,trust,asOf);
 assert.equal(x.decision,"SIGNED_REVIEW_EVIDENCE_PRESENT_MANUAL_CHANGE_REQUIRED");
 assert.equal(x.executable,false);
});
test("A4 SHA drift, wrong target and missing control always deny",()=>{
 for(const patch of [
  {projectRef:"bad"},{backupSha256:"0".repeat(64)},
  {encryptedAllowlistSha256:"bad"},{candidateCommit:"bad"},
  {fingerprints:{...FINGERPRINTS.staging,leads:"bad"}},
  {controls:{...payload().controls,immutableHistoryExceptionReviewed:false}}
 ]){
  const p={...payload(),...patch};const {trust,envelope}=signed(p);
  assert.equal(evaluateSignedRelease(envelope,trust,asOf).decision,"HOLD");
 }
});
test("A5 valid signatures reject a subsequent changed payload",()=>{
 const {trust,envelope}=signed();
 envelope.payload.projectRef="wrong";
 assert.ok(evaluateSignedRelease(envelope,trust,asOf).blockers.some(x=>x.startsWith("INVALID_SIGNATURE")));
});
test("A6 duplicated role/key and untrusted reviewers deny",()=>{
 const {trust,envelope}=signed();
 envelope.signatures[2]={...envelope.signatures[0]};
 assert.equal(evaluateSignedRelease(envelope,trust,asOf).decision,"HOLD");
 const other=signed();delete other.trust.APPSEC;
 assert.equal(evaluateSignedRelease(other.envelope,other.trust,asOf).decision,"HOLD");
});
test("A7 expired and excessively long approval window deny",()=>{
 for(const p of [
 {...payload(),expiresAt:"2026-11-03T16:09:00Z"},
 {...payload(),expiresAt:"2026-11-03T17:00:00Z"}
 ]){const {trust,envelope}=signed(p);assert.equal(evaluateSignedRelease(envelope,trust,asOf).decision,"HOLD")}
});
test("A8 production cannot be signed without actual staging certification",()=>{
 const p={...payload(),environment:"production",projectRef:"yqpgcsduqbxulrlzwzap",
 backupSha256:SHAS.production,fingerprints:{...FINGERPRINTS.production}};
 const {trust,envelope}=signed(p);
 assert.ok(evaluateSignedRelease(envelope,trust,asOf).blockers.includes("STAGING_NOT_CERTIFIED"));
});
