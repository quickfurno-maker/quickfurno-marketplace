import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {ownerPhase3LocalImagePrecheck,localHead} from "./owner-phase3-image-precheck.mjs";
const commit="25d9fc3aad3ae7e3eada57b211df2562f0c0b651";
const refA="qf-vox-web:review-20261105";
const refB="qf-core:review-20261105";
const valid=ref=>({
 Id:"sha256:"+"1".repeat(64),RepoTags:[ref],
 RepoDigests:["registry.invalid/"+ref.split(":")[0]+"@sha256:"+"a".repeat(64)],
 Config:{Labels:{"org.opencontainers.image.revision":commit}},
});
test("P3-I1 exact local source/image matching never certifies deployed host or turns GO on",()=>{
 const out=ownerPhase3LocalImagePrecheck({
  sourceCommit:commit,webImage:refA,coreImage:refB,inspect:valid,
 });
 assert.equal(out.localPairSourceVerified,true);
 for(const k of ["deployedHostVerified","realOwnerMfaVerified","realCoreCaseVerified",
  "managedDbInspected","rollbackVerified","providerUsed",
  "publicRegistrationEnabled","decisionsEnabled","canDeploy","canEnableReview","canEnableDecisions"])
  assert.equal(out[k],false,k);
 assert.equal(out.releaseDecision,"HOLD");
 assert.ok(out.blockedReasons.includes("PROTECTED_STAGING_SQL_LEDGER_NOT_RECONCILED"));
 assert.ok(out.blockedReasons.includes("SIGNED_RECOVERY_AND_ROLLBACK_NOT_PROVEN"));
});
test("P3-I2 no image and mismatched source remains fail-closed, never deploy",()=>{
 const missing=ownerPhase3LocalImagePrecheck({
  sourceCommit:commit,webImage:"not-present:tag",coreImage:refB,
  inspect:ref=>ref===refB?valid(ref):null,
 });
 assert.equal(missing.localPairSourceVerified,false);
 assert.ok(missing.blockedReasons.includes("VOX_WEB:LOCAL_IMAGE_NOT_AVAILABLE"));
 const wrong=ownerPhase3LocalImagePrecheck({
  sourceCommit:"e".repeat(40),webImage:refA,coreImage:refB,inspect:valid,
 });
 assert.equal(wrong.localPairSourceVerified,false);
 assert.ok(wrong.blockedReasons.some(x=>x.includes("OCI_SOURCE_REVISION_MISMATCH")));
});
test("P3-I3 missing immutable registry digest, tag mismatch and source SHA denied",()=>{
 const noDigest=ref=>({...valid(ref),RepoDigests:[]});
 const x=ownerPhase3LocalImagePrecheck({
  sourceCommit:commit,webImage:refA,coreImage:refB,inspect:noDigest,
 });
 assert.equal(x.localPairSourceVerified,false);
 assert.ok(x.blockedReasons.some(x=>x.includes("NO_CONTENT_ADDRESSABLE_REPOSITORY_DIGEST")));
 const unknown=ownerPhase3LocalImagePrecheck({
  sourceCommit:"not-a-commit",webImage:refA,coreImage:refB,
  inspect:()=>{throw Error("inspector must not execute")},
 });
 assert.equal(unknown.localPairSourceVerified,false);
 assert.ok(unknown.blockedReasons.includes("EXACT_SOURCE_SHA_NOT_VERIFIED"));
});
test("P3-I4 source contract only reads Git HEAD and local docker images, no deploy/remote",()=>{
 const code=readFileSync(resolve(import.meta.dirname,"owner-phase3-image-precheck.mjs"),"utf8");
 assert.match(code,/spawnSync\("git",\["rev-parse","HEAD"\]/);
 assert.match(code,/verifyLocalImage\(webImage,sourceCommit,inspect\)/);
 assert.match(code,/mode:"LOCAL_DOCKER_INSPECT_ONLY"/);
 assert.doesNotMatch(code,/supabase\.from\(|fetch\(|spawnSync\("docker",\["(?:pull|build|run|push|tag|compose)"|ssh\s|docker\s+run/);
 assert.equal(localHead()?.length,40);
});
