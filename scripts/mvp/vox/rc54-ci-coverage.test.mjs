import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=f=>readFileSync(resolve(root,f),"utf8");
const ci=read(".github/workflows/vox-rc41-functional-proofs.yml");
test("RC54 changes trigger source tests and preserve all protected proof jobs",()=>{
 assert.match(ci,/scripts\/mvp\/vox\/rc54-\*\.test\.mjs/);
 assert.match(ci,/rc54-ci-coverage\.test\.mjs/);
 for(const job of ["finance-and-db-source:","core-real-pg17:",
  "credit-only-real-pg17:","canonical-credit-real-pg17:","eod-real-pg17:"])
   assert.ok(ci.includes(job),"missing executable proof job "+job);
 assert.match(ci,/rc39-protected-features-off-gate\.mjs/);
});
test("RC54 remains release-HOLD and never enables unauthorized credit, EOD or migration execution",()=>{
 const finance=read("services/badLeadRecoveryService.ts");
 const eod=read("lib/supabase.ts");
 const db=read("scripts/mvp/vox/rc52-private-managed-sql-assessment.mjs");
 assert.match(finance,/RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/);
 assert.match(eod,/EOD_REVIEW_BEARER_INVALID/);
 assert.match(db,/PRIVATE_DIR_MUST_BE_OUTSIDE_REPOSITORY/);
 assert.match(ci,/release HOLD/i);
});
