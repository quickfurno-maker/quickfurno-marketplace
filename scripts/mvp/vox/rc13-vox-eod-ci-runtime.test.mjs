// RC13 — cloud-only CI stability. Keep ALL original VOX security and EOD tests.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const workflows=[
 ".github/workflows/vox-integrated-candidate.yml",
 ".github/workflows/vox-to04b-unified-integration.yml",
 ".github/workflows/vox-to08i-staff-eod-web.yml"
];
const read=path=>readFileSync(resolve(root,path),"utf8");
test("EOD-sensitive integrated VOX workflows run on supported Node 24",()=>{
 for(const path of workflows){
  const workflow=read(path);
  assert.match(workflow,/node-version: '24'/,path);
  assert.doesNotMatch(workflow,/node-version: '20\.20\.2'/,path);
  assert.match(workflow,/Release HOLD/,path);
 }
});
test("EOD-sensitive workflows preserve real web test, typecheck and production build",()=>{
 for(const path of workflows){
  const workflow=read(path);
  assert.match(workflow,/npm test/,path);
  assert.match(workflow,/npm run build/,path);
  assert.match(workflow,/npm run typecheck/,path);
  assert.doesNotMatch(workflow,/continue-on-error: true|npm test \|\| true|SKIP_TESTS/i,path);
 }
});
test("original EOD, signed-workflow and Staff notification VM test commands remain enabled",()=>{
 const pkg=JSON.parse(read("apps/vox-web/package.json"));
 const script=pkg.scripts?.test??"";
 for(const name of [
  "validate-eod-attention-08i.spec.mjs",
  "validate-governed-workflows-08k.spec.mjs",
  "validate-staff-notifications-08m.spec.mjs",
  "validate-voxL4-atomic-work-actions.spec.mjs"
 ])assert.ok(script.includes("--experimental-vm-modules --test scripts/"+name),name);
 assert.doesNotMatch(script,/SKIP_TESTS|--test-skip-pattern/, "no test bypass");
});
