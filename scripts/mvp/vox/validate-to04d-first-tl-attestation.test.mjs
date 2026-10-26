import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash,sign} from "node:crypto";
import {readFileSync} from "node:fs";
import {verifyIndependentTlAttestation as check,CANONICAL_ATTESTATION_FIELDS as FIELDS}
 from "../../../contracts/vox/firstTlAttestation.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-15T14:00:00Z");
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const publicKeyPem=publicKey.export({type:"spki",format:"pem"}).toString();
const fingerprint=createHash("sha256").update(publicKey.export({format:"der",type:"spki"})).digest("hex");
const trust={reviewerId:id(3),enabled:true,keySource:"INDEPENDENT_APPROVED_SERVER_REGISTRY",
 publicKeyPem,publicKeyFingerprint:fingerprint};
const expected={ownerId:id(1),candidateId:id(2),teamId:id(4),cityId:id(5),nonce:id(6)};
const payload={schema:"qf.vox.first-tl-independent-attestation.v1",
 ownerId:id(1),candidateId:id(2),teamId:id(4),cityId:id(5),reviewerId:id(3),
 nonce:id(6),issuedAt:new Date(now-300000).toISOString(),
 expiresAt:new Date(now+600000).toISOString(),
 decision:"APPROVE_TEAM_LEADER_NOMINATION",
 rationaleHash:createHash("sha256").update("independent-reviewed-synthetic-reason").digest("hex")};
const packet=(p=payload,key=privateKey)=>{
 const signed=Buffer.from(JSON.stringify(Object.fromEntries(FIELDS.map(k=>[k,p[k]]))));
 return {payload:p,signatureBase64Url:sign(null,signed,key).toString("base64url")};
};
const run=(p=packet(),t=trust,e=expected)=>check({packet:p,trust:t,expected:e,now});
test("genuine independent synthetic review signature verified but grants NO bootstrap",()=>{
 const r=run();
 assert.equal(r.valid,true);assert.equal(r.bootstrapAuthorized,false);
 assert.equal(r.requiresRealSupabaseAal2,true);
 assert.equal(r.requiresIndependentDbaApprovedNonceConsumption,true);
 assert.equal(r.requiresProtectedStagingReview,true);
});
test("single Admin self-review and target self-review rejected even if cryptographically signed",()=>{
 for(const change of [{reviewerId:id(1)},{reviewerId:id(2)},
   {candidateId:id(1)},{ownerId:id(2)}]){
  const p={...payload,...change};
  assert.equal(run(packet(p),{...trust,reviewerId:p.reviewerId}).valid,false,JSON.stringify(change));
 }
});
test("replay/foreign team/city/nonce, stale lease, missing/revoked key fail closed",()=>{
 for(const change of [{nonce:id(99)},{cityId:id(99)},{teamId:id(99)},
  {expiresAt:new Date(now-1000).toISOString()},
  {issuedAt:new Date(now-90000000).toISOString()},
  {decision:"SELF_APPROVED"}])
  assert.equal(run(packet({...payload,...change})).valid,false,JSON.stringify(change));
 assert.equal(run(packet(),{...trust,enabled:false}).valid,false);
 assert.equal(run(packet(),{...trust,publicKeyFingerprint:"0".repeat(64)}).valid,false);
});
test("tampering after signature, wrong signing key, unknown fields are rejected",()=>{
 assert.equal(run({...packet(),payload:{...payload,teamId:id(42)}}).valid,false);
 const keys=generateKeyPairSync("ed25519");
 assert.equal(run(packet(payload,keys.privateKey)).valid,false);
 assert.equal(run({...packet(),role:"admin"}).valid,false);
 assert.equal(run(packet({...payload,grantAdmin:true})).valid,false);
});
test("verifier cannot create Supabase Staff or write a privileged approval",()=>{
 const src=readFileSync(new URL("../../../contracts/vox/firstTlAttestation.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/\.rpc\(|\b(?:db|client)\.from\(|\.auth\.admin\.|inviteUserByEmail|createUser\(/);
 assert.match(src,/bootstrapAuthorized:false/);
 assert.match(src,/INDEPENDENT_APPROVED_SERVER_REGISTRY/);
});
