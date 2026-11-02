import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const ci=read(".github/workflows/vox-rc41-functional-proofs.yml");
test("RC55 source-only workflow executes real Core, Finance, EOD and DB tests",()=>{
 assert.match(ci,/rc55-\*\.test\.mjs/);
 for(const file of ["rc55-private-baseline-containment.test.mjs",
   "rc55-finance-recommendation-aal2.test.mjs",
   "rc55-ci-coverage.test.mjs",
   "rc42-core-atomic-route.test.mjs",
   "rc44-eod-dedicated-reader.test.mjs"])
  assert.ok(ci.includes(file),"missing test: "+file);
 assert.match(ci,/rc39-protected-features-off-gate\.mjs/);
});
test("RC55 preserves all hard-off launch constraints",()=>{
 for(const [path,expr] of [
  ["app/api/vox/v1/core/conversation-operator/route.ts",/RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=false as const/],
  ["services/badLeadRecoveryService.ts",/RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/],
  ["app/api/vox/v1/eod-atomic-review/route.ts",/RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED=false as const/]
 ])assert.match(read(path),expr);
 assert.match(ci,/release HOLD/i);
});
