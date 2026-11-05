import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const workflows=[
 ".github/workflows/qf-launch-phase1-source-integration.yml",
 ".github/workflows/vendor-registration-consent-gst.yml",
 ".github/workflows/vox-owner-v1-integration.yml",
 ".github/workflows/vox-staging-predeploy-gate.yml",
];
const uses=text=>[...text.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)\s*$/gm)].map(m=>m[1]);
const forbidden=/^\s*(?:pull_request_target|workflow_run):|^\s*(?:permissions:\s*write-all|id-token:\s*write|contents:\s*write|actions:\s*write|environment:\s*production)\s*$/m;
test("P1-S1 all four launch-critical workflows pin every action to immutable 40-char commit",()=>{
 for(const name of workflows){
  const code=readFileSync(resolve(root,name),"utf8");
  const actions=uses(code);
  assert.ok(actions.length>=2,name+": missing actions");
  for(const action of actions){
   assert.match(action,/^(?:[A-Za-z0-9_.-]+\/){1,2}[A-Za-z0-9_.-]+@[a-f0-9]{40}$/,name+": "+action);
  }
 }
});
test("P1-S2 critical workflows preserve read-only job token and no privileged untrusted trigger",()=>{
 for(const name of workflows){
  const code=readFileSync(resolve(root,name),"utf8");
  assert.match(code,/^permissions:\s*\n\s*contents:\s*read\s*$/m,name);
  assert.doesNotMatch(code,forbidden,name);
  assert.doesNotMatch(code,/^\s*secrets:\s*inherit\s*$/m,name);
 }
});
test("P1-S3 vendor source workflow still runs full PG17, Google, OTP and held scanner QA",()=>{
 const code=readFileSync(resolve(root,workflows[1]),"utf8");
 for(const needle of [
  "Private PostgreSQL 17 acceptance",
  "Phase 2 actual-byte",
  "Phase 4 real read-only Staging",
  "Phase 5 Google Places",
  "Phase 4 isolated PostgreSQL 17 synthetic backup and restore",
  "Launch-critical GitHub Action pinning and safe triggers",
 ]){
  assert.ok(code.includes(needle),needle);
 }
 assert.match(code,/^\s*run:\s*node --test scripts\/mvp\/launch\/launch-source-workflow-hardening\.test\.mjs/m);
});
test("P1-S4 source checks must stay source-only even when action pins pass",()=>{
 const code=readFileSync(resolve(root,workflows[0]),"utf8");
 assert.match(code,/Hard release HOLD and no operational authorization/);
 assert.match(code,/No managed Staging\/Production DB/);
 const vendor=readFileSync(resolve(root,workflows[1]),"utf8");
 assert.doesNotMatch(vendor,/^\s*environment:\s*(?:staging|production)\s*$/mi);
 assert.doesNotMatch(vendor,/^\s*uses:\s*\.{1,2}\/.*$/m);
});
