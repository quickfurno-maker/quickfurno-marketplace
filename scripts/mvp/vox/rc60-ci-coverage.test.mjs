import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("RC60 source and disposable PostgreSQL proof are both mandatory in CI",()=>{
 const ci=read(".github/workflows/vox-rc41-functional-proofs.yml");
 for(const item of ["rc60-*.test.mjs","rc60-credit-ledger-proof.test.mjs",
  "rc60-ci-coverage.test.mjs","credit-only-real-pg17:","canonical-credit-real-pg17:",
  "validate-vox-rc42-credit-only-pg17.ps1","rc39-protected-features-off-gate.mjs"])
  assert.ok(ci.includes(item),"required CI gate absent: "+item);
});
test("review-only Finance replay fails closed before recording a new restoration",()=>{
 const sql=read("ops/vox/rc42-review-candidates/20261101020000_vox_rc42_bad_lead_credit_only_atomic_REVIEW_ONLY.sql");
 const harness=read("scripts/mvp/vox/validate-vox-rc42-credit-only-pg17.ps1");
 assert.match(sql,/RC60_CANONICAL_CREDIT_NOT_NEWLY_APPLIED/);
 assert.match(sql,/RC60_CANONICAL_LEDGER_RECEIPT_MISMATCH/);
 assert.match(harness,/canonical already_applied response/);
 assert.match(harness,/replay aborts new approval/);
 assert.match(harness,/replay cannot increment wallet again/);
 assert.match(read("services/badLeadRecoveryService.ts"),
  /RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/);
});
test("Core and official EOD writers remain deliberately uninstalled",()=>{
 assert.match(read("app/api/vox/v1/core/conversation-operator/route.ts"),
  /RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=false as const/);
 assert.match(read("app/api/vox/v1/eod-atomic-review/route.ts"),
  /RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED=false as const/);
});
