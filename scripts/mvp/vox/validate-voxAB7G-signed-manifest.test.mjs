import test from "node:test";import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {canonicalAb7gManifest,verifyAb7gIndependentManifest as run}
 from "../../../contracts/vox/ab7gSignedStagingManifest.mjs";
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const pub=publicKey.export({type:"spki",format:"pem"});
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-18T06:30:00Z"),core="a".repeat(40);
const manifest={schema:"qf.vox.ab7g.independent-review.v1",
 environment:"staging",coreCommit:core,jarvisCommit:"b".repeat(40),
 agniCommit:"c".repeat(40),migrationSha256:"d".repeat(64),
 rollbackSha256:"e".repeat(64),ownerId:id(1),reviewerId:id(2),
 issuedAtMs:now-1000,expiresAtMs:now+60000,
 reviewScope:"DBA_APPSEC_STAGING_ONLY"};
const proof=(m=manifest)=>sign(null,Buffer.from(canonicalAb7gManifest(m)),
 privateKey).toString("base64url");
const args=()=>({manifest,signature:proof(),pinnedReviewerPublicKey:pub,
 expectedCoreCommit:core,now});
test("pinned independent Ed25519 review evidence is verifiable but NOT GO",()=>{
 const r=run(args());assert.equal(r.ok,true);assert.equal(r.canDeploy,false);
 assert.equal(r.productionAuthorized,false);assert.equal(r.requiresSeparateOwnerGo,true);
});
test("wrong commit, forged owner, production, expired or stale review all deny",()=>{
 for(const patch of [{expectedCoreCommit:"f".repeat(40)},
  {manifest:{...manifest,ownerId:manifest.reviewerId}},
  {manifest:{...manifest,environment:"production"}},
  {manifest:{...manifest,expiresAtMs:now-1}},
  {manifest:{...manifest,issuedAtMs:now-60*60*1000}},
  {manifest:{...manifest,reviewScope:"OWNER_OVERRIDE"}}]){
  assert.equal(run({...args(),...patch}).ok,false);
 }
});
test("signature must be real and pinned; no unsigned magic metadata",()=>{
 assert.equal(run({...args(),signature:"f".repeat(86)}).ok,false);
 const other=generateKeyPairSync("ed25519");
 const otherPub=other.publicKey.export({type:"spki",format:"pem"});
 assert.equal(run({...args(),pinnedReviewerPublicKey:otherPub}).ok,false);
 assert.equal(run({...args(),manifest:{...manifest,approved:true}}).ok,false);
});
