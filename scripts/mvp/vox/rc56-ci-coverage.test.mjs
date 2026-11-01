import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=f=>readFileSync(resolve(root,f),"utf8");
const workflow=read(".github/workflows/vox-rc41-functional-proofs.yml");
test("RC56 PR triggers, source validation, and disposable PostgreSQL proof jobs remain enabled",()=>{
 for(const item of ["rc56-*.test.mjs","rc56-private-statement-evidence.mjs",
  "rc56-private-statement-evidence.test.mjs","rc56-cross-evidence-once.test.mjs",
  "rc56-ci-coverage.test.mjs","rc42-core-atomic-route.test.mjs",
  "rc44-eod-dedicated-reader.test.mjs",
  "core-real-pg17:","credit-only-real-pg17:","canonical-credit-real-pg17:",
  "eod-real-pg17:","rc39-protected-features-off-gate.mjs"])
  assert.ok(workflow.includes(item),"missing CI gate: "+item);
});
test("RC56 cannot switch on protected Core, credit or official EOD",()=>{
 for(const [file,re] of [
  ["app/api/vox/v1/core/conversation-operator/route.ts",/RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=false as const/],
  ["services/badLeadRecoveryService.ts",/RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/],
  ["app/api/vox/v1/eod-atomic-review/route.ts",/RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED=false as const/]
 ])assert.match(read(file),re);
});
