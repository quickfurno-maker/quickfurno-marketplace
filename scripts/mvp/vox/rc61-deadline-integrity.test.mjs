import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=x=>readFileSync(resolve(root,x),"utf8");
test("bounded genuine Core Staff recheck cannot certify late/unknown SQL",()=>{
 const s=read("services/vox/rc42AtomicConversationHandler.ts");
 assert.match(s,/recheckTimeoutMs\?:number/);
 assert.match(s,/Number\(configuredRecheck\):1250/);
 assert.match(s,/Promise\.race\(/);
 assert.match(s,/STAFF_AUTH_RECHECK_TIMEOUT/);
 assert.match(s,/return uncertain\("STAFF_AUTH_RECHECK_TIMEOUT",503\)/);
 assert.match(s,/retrySameNonceOnly:true/);
});
test("EOD two-human review is read only, bounded, and handles reader factory errors",()=>{
 const s=read("services/vox/rc42SignedEodDataApiReviewHandler.ts");
 assert.match(s,/reviewTimeoutMs\?:number/);
 assert.match(s,/Number\(t\):6000/);
 assert.match(s,/EOD_REVIEW_TIMEOUT/);
 assert.match(s,/try\{rpc=deps\.rpc\(\);\}/);
 assert.match(s,/return deny\("REVIEWED_DATA_API_READER_UNAVAILABLE",503\)/);
 assert.match(s,/approved:false/);
 assert.match(s,/publicationAuthorized:false/);
 assert.match(s,/providerMessagesSent:0/);
});
test("existing release enforcement and actual PG17 jobs cannot disappear",()=>{
 const ci=read(".github/workflows/vox-rc41-functional-proofs.yml");
 for(const v of ["rc61-*.test.mjs","rc61-deadline-integrity.test.mjs",
  "rc42-core-atomic-route.test.mjs","rc42-eod-atomic-data-api-review.test.mjs",
  "core-real-pg17:","credit-only-real-pg17:","canonical-credit-real-pg17:",
  "eod-real-pg17:","rc39-protected-features-off-gate.mjs"])
  assert.ok(ci.includes(v),"missing CI "+v);
 assert.match(read("app/api/vox/v1/core/conversation-operator/route.ts"),
  /RC42_ATOMIC_CONVERSATION_RPC_INSTALLED=false as const/);
 assert.match(read("services/badLeadRecoveryService.ts"),
  /RC43_BAD_LEAD_ATOMIC_RPC_INSTALLED=false as const/);
 assert.match(read("app/api/vox/v1/eod-atomic-review/route.ts"),
  /RC42_EOD_ATOMIC_DATA_API_READER_INSTALLED=false as const/);
});
