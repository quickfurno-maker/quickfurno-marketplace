import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("Web timeout exceeds atomic Core timeout; UI preserves nonce on an uncertain result",()=>{
 const core=read("services/vox/rc42AtomicConversationHandler.ts");
 const bff=read("apps/vox-web/lib/conversationControl.ts");
 const ui=read("apps/vox-web/app/team/conversation-control/ConversationControl.tsx");
 assert.match(core,/Number\(configured\):3500/);
 assert.match(bff,/signal:AbortSignal\.timeout\(6500\)/);
 assert.match(bff,/retrySameNonceOnly:true/);
 assert.match(ui,/setUncertain\(true\)/);
 assert.match(ui,/pending\.current\.nonce/);
 assert.match(ui,/disabled=\{busy\|\|uncertain\}/);
 assert.match(ui,/if\(uncertain\)return;pending\.current=null/);
 assert.match(ui,/pending\.current=null;setUncertain\(false\)/);
});
test("one-credit UI blocks repeated operator decisions after unresolved canonical outcome",()=>{
 const ui=read("components/admin/LeadMatchingAuditPanels.tsx");
 assert.match(ui,/recoveryNeedsReview=useRef\(new Set<string>\(\)\)/);
 assert.match(ui,/recoveryNeedsReview\.current\.has\(report\.id\)/);
 assert.match(ui,/result\.code==="CREDIT_OUTCOME_UNKNOWN"/);
 assert.match(ui,/recoveryNeedsReview\.current\.add\(report\.id\)/);
 assert.match(ui,/finally\{recoveryPending\.current\.delete\(report\.id\);\}/);
 const fn=read("services/badLeadRecoveryService.ts");
 assert.match(fn,/RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/);
 assert.match(fn,/CREDIT_OUTCOME_UNKNOWN/);
});
test("RC59 protected real source workflow retains PostgreSQL and immutable release HOLD",()=>{
 const ci=read(".github/workflows/vox-rc41-functional-proofs.yml");
 assert.match(ci,/rc59-ui-outcome\.test\.mjs/);
 assert.match(ci,/rc59-\*\.test\.mjs/);
 for(const job of ["core-real-pg17:","credit-only-real-pg17:","canonical-credit-real-pg17:","eod-real-pg17:"])
  assert.ok(ci.includes(job),job);
 assert.match(ci,/rc39-protected-features-off-gate\.mjs/);
 assert.match(read("app/api/vox/v1/core/conversation-operator/route.ts"),/RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=false as const/);
 assert.match(read("app/api/vox/v1/eod-atomic-review/route.ts"),/RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED=false as const/);
});
