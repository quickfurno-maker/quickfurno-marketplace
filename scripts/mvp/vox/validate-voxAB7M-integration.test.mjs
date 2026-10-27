import test from "node:test";import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {canonicalAb7gManifest} from "../../../contracts/vox/ab7gSignedStagingManifest.mjs";
import {inspectAb7mCrossServiceCandidate as check,ab7mPinnedServiceHeads as heads}
 from "../../../contracts/vox/ab7mCrossServiceCandidate.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.now(),key=generateKeyPairSync("ed25519");
const manifest={schema:"qf.vox.ab7g.independent-review.v1",environment:"staging",
 coreCommit:heads.core,jarvisCommit:heads.jarvis,agniCommit:heads.agni,
 migrationSha256:"a".repeat(64),rollbackSha256:"b".repeat(64),
 ownerId:id(1),reviewerId:id(2),issuedAtMs:now-1000,
 expiresAtMs:now+100000,reviewScope:"DBA_APPSEC_STAGING_ONLY"};
const flags={voxPortal:"staging",staffWork:"staging",operatorAtomic:"staging",
 whatsappOutbound:"disabled",notificationProvider:"disabled",
 agentAutonomy:"disabled",productionActions:"disabled"};
const spec=()=>({coreCommit:heads.core,jarvisCommit:heads.jarvis,agniCommit:heads.agni,environment:"staging",signedManifest:manifest,now,
 reviewSignature:sign(null,Buffer.from(canonicalAb7gManifest(manifest)),
 key.privateKey).toString("base64url"),
 pinnedReviewerPublicKey:key.publicKey.export({type:"spki",format:"pem"}),
 flags,installedSchemaDigest:manifest.migrationSha256,
 providerIsolationVerified:true});
test("AB7M pinned independent signature + exact cross-service digest permits source review, never deploy",()=>{
 const r=check(spec());assert.equal(r.ok,true,r.reason);
 assert.equal(r.candidateLocked,true);assert.equal(r.canDeploy,false);
 assert.equal(r.productionAuthorized,false);assert.equal(r.outboundProviderAuthorized,false);
});
test("RC1 independently re-signed newer Core commit is reviewed but NEVER deployed",()=>{
 const coreCommit="e".repeat(40);
 const refreshed={...manifest,coreCommit};
 const reviewSignature=sign(null,Buffer.from(canonicalAb7gManifest(refreshed)),
  key.privateKey).toString("base64url");
 const r=check({...spec(),coreCommit,signedManifest:refreshed,reviewSignature});
 assert.equal(r.ok,true,r.reason);
 assert.equal(r.exactCommits.core,coreCommit);
 assert.equal(r.canDeploy,false);
 const stale=check({...spec(),coreCommit,signedManifest:manifest});
 assert.equal(stale.ok,false);
});
test("AB7M stale Jarvis/AGNI SHA, fake signature, no-send flag, schema drift deny",()=>{
 for(const patch of [
 {jarvisCommit:"f".repeat(40)},
 {agniCommit:"f".repeat(40)},{environment:"production"},
 {reviewSignature:"abc"},{installedSchemaDigest:"f".repeat(64)},
 {providerIsolationVerified:false},{flags:{...flags,whatsappOutbound:"enabled"}},
 {flags:{...flags,agentAutonomy:"staging"}}
 ]){const r=check({...spec(),...patch});assert.equal(r.ok,false,r.reason);
 assert.equal(r.canDeploy,false);}
});
