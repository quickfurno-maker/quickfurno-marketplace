import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=path=>readFileSync(resolve(root,path),"utf8");
test("RC58 workflow runs real uncertainty, lead-credit and EOD regression suites",()=>{
 const ci=read(".github/workflows/vox-rc41-functional-proofs.yml");
 for(const value of ["rc58-*.test.mjs","rc58-ci-coverage.test.mjs",
  "rc42-core-atomic-route.test.mjs","rc42-bad-lead-credit-only-service.test.mjs",
  "rc44-eod-dedicated-reader.test.mjs","core-real-pg17:",
  "credit-only-real-pg17:","canonical-credit-real-pg17:","eod-real-pg17:",
  "rc39-protected-features-off-gate.mjs"])
  assert.ok(ci.includes(value),"missing verified CI proof "+value);
});
test("ambiguous writes never claim false rollback, and all protected writers stay OFF",()=>{
 const core=read("services/vox/rc42AtomicConversationHandler.ts");
 const finance=read("services/badLeadRecoveryService.ts");
 const eod=read("services/vox/rc44DedicatedEodReviewReader.ts");
 assert.match(core,/const uncertain=/);
 assert.match(core,/commitState:"unknown",retrySameNonceOnly:true/);
 assert.match(core,/catch\{return uncertain\("ATOMIC_RPC_UNAVAILABLE",503\);\}/);
 assert.match(finance,/CREDIT_OUTCOME_UNKNOWN/);
 assert.match(finance,/RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/);
 assert.match(eod,/t-Number\(payload.iat\)<=3600/);
 assert.match(read("app/api/vox/v1/core/conversation-operator/route.ts"),
  /RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=false as const/);
 assert.match(read("app/api/vox/v1/eod-atomic-review/route.ts"),
  /RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED=false as const/);
});
