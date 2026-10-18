import test from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {readAb7jSourceManifest} from "../../../contracts/vox/ab7jNativeReleaseManifest.mjs";
const repo=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
test("AB7J 6 exact native SQL source files have deterministic digest and no apply",()=>{
 const a=readAb7jSourceManifest(repo),b=readAb7jSourceManifest(repo);
 assert.equal(a.ok,true);assert.equal(a.exactCandidateCount,6);
 assert.equal(a.candidateDigest,b.candidateDigest);
 assert.equal(a.releaseReady,false);assert.equal(a.canApply,false);
 assert.equal(a.noDatabaseChanges,true);
 assert.equal(a.candidates.every(x=>x.managedInstalled===false),true);
});
test("AB7J wrong/missing repo never claims readiness",()=>{
 const a=readAb7jSourceManifest("/missing-quickfurno-directory");
 assert.equal(a.ok,false);assert.equal(a.canApply,false);
});
