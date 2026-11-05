import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {EXPECTED_CANDIDATE,evaluateLocalOwnerImagePair,verifyLocalImage} from "./owner-vendor-image-provenance.mjs";

const digest="sha256:"+"a".repeat(64);
const repoDigest="registry.example.invalid/vox-web@"+digest;
const imageId="sha256:"+"b".repeat(64);
const webRef="vox-web:review-candidate";
const coreRef="core:review-candidate";
const valid=ref=>({
  Id:imageId,RepoTags:[ref],
  RepoDigests:[ref.startsWith("vox")?repoDigest:"registry.example.invalid/core@"+digest],
  Config:{Labels:{"org.opencontainers.image.revision":EXPECTED_CANDIDATE}}
});
test("valid local source identity remains HOLD without deployed host, MFA and rollback proof",()=>{
 const result=evaluateLocalOwnerImagePair({webRef,coreRef,inspect:valid});
 assert.equal(result.sourcePairMatchesLocally,true);
 assert.equal(result.deployedHostVerified,false);
 assert.equal(result.ownerAal2Verified,false);
 assert.equal(result.rollbackVerified,false);
 assert.equal(result.canEnableReview,false);
 assert.equal(result.canEnableDecisions,false);
 assert.equal(result.releaseDecision,"HOLD");
 assert.ok(result.blockers.includes("SEVEN_VENDOR_SQL_NOT_IN_VOX_SOURCE_CANDIDATE"));
 assert.ok(result.blockers.includes("NO_AUTHENTICATED_DEPLOYED_VOX_IMAGE_DIGEST"));
});
test("local missing Owner image never upgrades an unrelated Core image into deployment proof",()=>{
 const result=evaluateLocalOwnerImagePair({
  webRef:"qf-vox-owner-studio:mfa-ui-20261102",
  coreRef,inspect:ref=>ref===coreRef?valid(ref):null
 });
 assert.equal(result.sourcePairMatchesLocally,false);
 assert.ok(result.blockers.includes("VOX_WEB:LOCAL_IMAGE_NOT_AVAILABLE"));
 assert.equal(result.releaseDecision,"HOLD");
});
test("wrong OCI source commit, absent pinned repo digest, tag mismatch and unsafe refs fail closed",()=>{
 const old=valid(webRef);old.Config.Labels["org.opencontainers.image.revision"]="0".repeat(40);
 assert.ok(verifyLocalImage(webRef,EXPECTED_CANDIDATE,()=>old).blockedReasons.includes("OCI_SOURCE_REVISION_MISMATCH"));
 const floating=valid(webRef);floating.RepoDigests=[];
 assert.ok(verifyLocalImage(webRef,EXPECTED_CANDIDATE,()=>floating).blockedReasons.includes("NO_CONTENT_ADDRESSABLE_REPOSITORY_DIGEST"));
 const switched=valid(coreRef);switched.RepoTags=["another:tag"];
 assert.ok(verifyLocalImage(coreRef,EXPECTED_CANDIDATE,()=>switched).blockedReasons.includes("REQUESTED_IMAGE_REF_NOT_IN_INSPECTED_ARTIFACT"));
 assert.ok(verifyLocalImage("web; rm -rf /",EXPECTED_CANDIDATE,()=>{throw Error("must not run");}).blockedReasons.includes("IMAGE_REFERENCE_INVALID"));
});
test("a local inspector never pulls, builds, runs, tags or deploys images",()=>{
 const code=readFileSync(resolve(import.meta.dirname,"owner-vendor-image-provenance.mjs"),"utf8");
 assert.match(code,/spawnSync\("docker",\["image","inspect",ref,"--format"/);
 assert.doesNotMatch(code,/spawnSync\("docker",\["(?:run|build|pull|push|tag|compose)"/);
 assert.match(code,/canEnableReview:false,canEnableDecisions:false,releaseDecision:"HOLD"/);
});
