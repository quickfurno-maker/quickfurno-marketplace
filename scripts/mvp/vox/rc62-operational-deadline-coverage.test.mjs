import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("actual Core route and SQL handler bound preflight identity before any mutation",()=>{
 const route=read("app/api/vox/v1/core/conversation-operator/route.ts");
 const handler=read("services/vox/rc42AtomicConversationHandler.ts");
 assert.match(route,/CURRENT_STAFF_AUTH_TIMEOUT/);
 // The actual awaited verifier must be visible to the protected portal/Core
 // route-surface security scanner, not merely an imported or mocked symbol.
 assert.match(route,/await verifyVoxOperationsStaffBearer\(/);
 assert.match(route,/setTimeout\(\(\)=>resolve\(\{timeout:true\}\),1500\)/);
 assert.match(handler,/STAFF_AUTH_PREFLIGHT_TIMEOUT/);
 assert.match(handler,/authTimeoutMs\?:number/);
 assert.match(handler,/return status\("STAFF_AUTH_PREFLIGHT_TIMEOUT",503\)/);
 assert.match(handler,/STAFF_AUTH_RECHECK_TIMEOUT/);
 assert.match(handler,/retrySameNonceOnly:true/);
 assert.match(route,/RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=false as const/);
 const web=read("apps/vox-web/lib/conversationControl.ts");
 assert.match(web,/signal:AbortSignal\.timeout\(10000\)/);
 assert.match(web,/Core may use up to 1\.5s boundary AAL2/);
});
test("EOD first-hop Owner identity and dual-review both fail closed",()=>{
 const route=read("app/api/vox/v1/eod-atomic-review/route.ts");
 const reviewer=read("services/vox/rc42SignedEodDataApiReviewHandler.ts");
 assert.match(route,/OWNER_AUTH_TIMEOUT/);
 assert.match(route,/setTimeout\(\(\)=>resolve\(\{timedOut:true\}\),1500\)/);
 assert.match(route,/publicationAuthorized:false,providerMessagesSent:0/);
 assert.match(reviewer,/EOD_REVIEW_TIMEOUT/);
 assert.match(route,/RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED=false as const/);
});
test("credit writer is hard OFF and any ambiguous/hung RPC refuses a new grant",()=>{
 const svc=read("services/badLeadRecoveryService.ts");
 assert.match(svc,/RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/);
 assert.match(svc,/CREDIT_RPC_TIMEOUT_MS=4000/);
 assert.match(svc,/CREDIT_OUTCOME_UNKNOWN/);
 assert.match(svc,/return uncertainCredit\(\)/);
 assert.match(svc,/Promise\.race\(\[/);
 assert.doesNotMatch(svc,/cash_refund.*=\s*true/i);
});
test("all real compiled regression and disposable PG17 jobs remain enforced",()=>{
 const ci=read(".github/workflows/vox-rc41-functional-proofs.yml");
 for(const value of ["rc62-operational-deadline-coverage.test.mjs",
  "rc43-core-route-integration.test.mjs","rc43-eod-route-integration.test.mjs",
  "rc42-bad-lead-credit-only-service.test.mjs","rc42-core-atomic-route.test.mjs",
  "core-real-pg17:","canonical-credit-real-pg17:","credit-only-real-pg17:",
  "eod-real-pg17:","rc39-protected-features-off-gate.mjs"])
  assert.ok(ci.includes(value),"missing actual CI gate "+value);
});
