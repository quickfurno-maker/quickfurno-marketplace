import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const ci=readFileSync(resolve(root,".github/workflows/vox-rc41-functional-proofs.yml"),"utf8");
const script=readFileSync(resolve(root,"scripts/mvp/vox/rc39-protected-features-off-gate.mjs"),"utf8");
test("RC53 functional tests are included in protected PR-triggered CI",()=>{
 assert.match(ci,/pull_request:/);
 for(const name of [
  "rc50-conversation-candidates.test.mjs",
  "rc42-bad-lead-credit-only-service.test.mjs",
  "rc47-eod-actual-supabase-transport.test.mjs",
  "rc52-private-managed-sql-assessment.test.mjs"
 ])assert.ok(ci.includes(name),"CI missing real regression "+name);
 assert.match(ci,/scripts\/mvp\/vox\/rc53-\*\.test\.mjs/);
 assert.match(ci,/node --test/);
});
test("CI keeps finance, EOD, Core and deployment paths gated",()=>{
 for(const job of ["finance-and-db-source:","core-real-pg17:","credit-only-real-pg17:","eod-real-pg17:"])
  assert.ok(ci.includes(job),"required CI job missing: "+job);
 assert.match(ci,/release HOLD/i);
 assert.match(ci,/rc39-protected-features-off-gate\.mjs/);
 assert.ok(script.includes("checkEnvTemplate")&&
  script.includes("RC38_SIGNED_EOD_REVIEW_READER_INSTALLED"),
  "protected feature gate must remain present");
});
