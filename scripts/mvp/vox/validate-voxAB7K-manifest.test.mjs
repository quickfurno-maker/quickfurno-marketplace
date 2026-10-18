import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";import {dirname,resolve} from "node:path";
import {inspectAb7kFullVoxSources} from "../../../contracts/vox/ab7kFullMigrationManifest.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
test("AB7K exact quarantined 7 + 23 candidate sources fingerprinted fail-closed",()=>{
 const a=inspectAb7kFullVoxSources(root),b=inspectAb7kFullVoxSources(root);
 assert.equal(a.ok,true,a.reason);assert.equal(a.totalFiles,30);
 assert.equal(a.quarantinedFoundationCount,7);assert.equal(a.uninstalledCandidateCount,23);
 assert.equal(a.manifestDigest,b.manifestDigest);assert.equal(a.files.length,30);
 assert.equal(a.files.every(x=>/^[a-f0-9]{64}$/.test(x.sha256)),true);
 assert.equal(a.releaseReady,false);assert.equal(a.canApply,false);
});
test("AB7K committed release fingerprint pins all 30 exact SQL bytes",()=>{
 const current=inspectAb7kFullVoxSources(root);
 const pinned=JSON.parse(readFileSync(resolve(root,
  "docs/vox/VOX-AB7K-REVIEWED-SOURCE-FINGERPRINT.json"),"utf8"));
 assert.equal(current.manifestDigest,pinned.manifestDigest);
 assert.deepEqual(current.files,pinned.files);
 assert.equal(pinned.canApply,false);assert.equal(pinned.releaseReady,false);
});
test("AB7K untrusted layout cannot authorize deploy",()=>{
 const x=inspectAb7kFullVoxSources("/not-mounted-external-root");
 assert.equal(x.ok,false);assert.equal(x.canApply,false);
});
