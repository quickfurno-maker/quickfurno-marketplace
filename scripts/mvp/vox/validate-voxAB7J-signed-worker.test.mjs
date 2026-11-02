import test from "node:test";import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {runAb7jSignedInternalOnce as run} from "../../../worker/voxAb7jSignedInternalOnce.mjs";
import {canonicalAb7gManifest} from "../../../contracts/vox/ab7gSignedStagingManifest.mjs";
import {candidateRpcNames as rpcNames} from "../../../contracts/vox/notificationOutboxWorker.mjs";
const key=generateKeyPairSync("ed25519"),now=Date.now();
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const sha="a".repeat(40);
const manifest={schema:"qf.vox.ab7g.independent-review.v1",environment:"staging",
 coreCommit:sha,jarvisCommit:"b".repeat(40),agniCommit:"c".repeat(40),
 migrationSha256:"d".repeat(64),rollbackSha256:"e".repeat(64),
 ownerId:id(1),reviewerId:id(2),issuedAtMs:now-1000,
 expiresAtMs:now+120000,reviewScope:"DBA_APPSEC_STAGING_ONLY"};
const signed=()=>sign(null,Buffer.from(canonicalAb7gManifest(manifest)),
 key.privateKey).toString("base64url");
const spec=()=>{let rpcCalls=0;const emissions=[];
 return {emissions,get calls(){return rpcCalls},args:{
  environment:"staging",enabled:true,workerId:id(3),now,manifest,signature:signed(),
  pinnedReviewerPublicKey:key.publicKey.export({type:"spki",format:"pem"}),
  expectedCoreCommit:sha,
  verifyCurrentOwnerAal2:async()=>true,
  verifyInstalledSchema:async()=>true,
  verifyNoOutboundProviders:async()=>true,
  emitSanitizedAgniObservation:async event=>emissions.push(event),
  coreRpc:async name=>{rpcCalls++;
   if(name===rpcNames.claim)return {data:[]};
   throw Error("EMPTY_QUEUE_HAS_NO_OTHER_RPC");
  }
 }};
};
test("AB7J genuinely pinned independent signing + live gates call one bounded internal-only cycle",async()=>{
 const s=spec(),r=await run(s.args);
 assert.equal(r.ok,true,r.reason);
 assert.equal(r.cycles,1);assert.equal(s.calls,1);
 assert.equal(r.externalMessagesSent,0);assert.equal(r.productionCertified,false);
 assert.equal(s.emissions.length,1);assert.equal(s.emissions[0].advisoryOnly,true);
});
test("AB7J forged signature/old SHA/owner revoked/schema not installed/provider connected denies before RPC",async()=>{
 const mutations=[{signature:"a".repeat(86)},
  {expectedCoreCommit:"f".repeat(40)},
  {verifyCurrentOwnerAal2:async()=>false},
  {verifyInstalledSchema:async()=>false},
  {verifyNoOutboundProviders:async()=>false},{environment:"production"},{enabled:false}];
 for(const bad of mutations){
  const s=spec(),x=await run({...s.args,...bad});
  assert.equal(x.ok,false);assert.equal(s.calls,0);
 }
});
