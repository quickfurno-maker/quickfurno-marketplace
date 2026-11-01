import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=s=>readFileSync(resolve(root,s),"utf8");
const ci=read(".github/workflows/vox-rc41-functional-proofs.yml");
test("RC57 diagnostic, transactional and QA tests run under protected CI",()=>{
 for(const s of ["rc57-*.test.mjs","rc57-private-lexical-reconciliation.mjs",
  "rc57-private-lexical-reconciliation.test.mjs","rc57-finance-index-identity.test.mjs",
  "rc57-ci-coverage.test.mjs","rc42-core-atomic-route.test.mjs",
  "rc44-eod-dedicated-reader.test.mjs","credit-only-real-pg17:","canonical-credit-real-pg17:"])
  assert.ok(ci.includes(s),"missing CI item "+s);
});
test("RC57 preserves all independent hard-OFF launch boundaries",()=>{
 for(const [file,re] of [
  ["app/api/vox/v1/core/conversation-operator/route.ts",/RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=false as const/],
  ["services/badLeadRecoveryService.ts",/RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/],
  ["app/api/vox/v1/eod-atomic-review/route.ts",/RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED=false as const/]])
  assert.match(read(file),re);
 assert.match(ci,/rc39-protected-features-off-gate\.mjs/);
});
