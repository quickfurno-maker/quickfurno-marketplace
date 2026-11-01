import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const ui=readFileSync(join(root,"components/admin/LeadMatchingAuditPanels.tsx"),"utf8");
const service=readFileSync(join(root,"services/badLeadRecoveryService.ts"),"utf8");
test("human-reviewed credit action remains one LEAD credit, never money or automatic replacement",()=>{
 assert.match(ui,/adminApplyBadLeadRecovery\(report\.id,action\)/);
 assert.match(ui,/1 LEAD credit restored, no money or replacement/);
 assert.match(ui,/0 additional credits/);
 assert.doesNotMatch(ui,/adminApplyBadLeadRecovery\(report\.id,["']replace["']/);
 assert.match(service,/RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/);
});
test("same-report UI submissions are serialized and release the guard even after failures",()=>{
 assert.match(ui,/recoveryPending=useRef\(new Set<string>\(\)\)/);
 assert.match(ui,/recoveryPending\.current\.has\(report\.id\)/);
 assert.match(ui,/recoveryPending\.current\.add\(report\.id\)/);
 assert.match(ui,/finally\{recoveryPending\.current\.delete\(report\.id\);\}/);
});
test("ambiguous credit RPCs remain locked against another in-session submission",()=>{
 assert.match(ui,/recoveryNeedsReview=useRef\(new Set<string>\(\)\)/);
 assert.match(ui,/recoveryNeedsReview.current.has\(report.id\)/);
 assert.match(ui,/result.code==="CREDIT_OUTCOME_UNKNOWN"/);
 assert.match(ui,/recoveryNeedsReview.current.add\(report.id\)/);
 assert.match(ui,/Reconcile its original assignment and canonical ledger before ANY repeat grant/);
 assert.match(ui,/finally\{recoveryPending.current.delete\(report.id\);\}/);
});
test("missing canonical receipt never surfaces as a confirmed credit restoration",()=>{
 assert.match(ui,/Canonical credit receipt unavailable\. Verify the ledger before retrying/);
 assert.match(ui,/data\.creditRestorationApprovalId&&data\.originalAssignmentId/);
 assert.match(ui,/data\.restorationStatus==="already_applied"&&data\.leadCreditsRestored===0/);
});
