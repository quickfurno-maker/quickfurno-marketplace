import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("RC17 critical money and signer DDL remains uninstalled and review-only",()=>{
 const candidateDir=resolve(root,"ops/vox/rc17-review-candidates");
 const candidates=readdirSync(candidateDir);
 assert.ok(candidates.includes("20261031001000_rc17_razorpay_v2_authority_REVIEW_ONLY.sql"));
 assert.ok(candidates.includes("20261031002000_rc17_eod_publication_authority_REVIEW_ONLY.sql"));
 const migrations=readdirSync(resolve(root,"supabase/migrations"));
 assert.ok(!migrations.some(n=>n.includes("rc17_razorpay")||n.includes("rc17_eod")));
 for(const f of candidates){
  const content=read("ops/vox/rc17-review-candidates/"+f);
  assert.match(content,/REVIEW ONLY \/ UNINSTALLED/);
  assert.doesNotMatch(content,/db push|deploy --prod|RAZORPAY_LIVE_KEY_SECRET/);
 }
});
test("protected routes remain off without actual signed proof, staff AAL2 and human review",()=>{
 const official=read("app/api/vox/v1/official-eod-publish/route.ts");
 const core=read("services/vox/rc8PgVendorConversationOperator.ts");
 const signed=read("scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs");
 assert.match(official,/VERIFIED_APPROVAL_WRITER_INSTALLED=false/);
 assert.match(core,/RC8_CORE_WRITER_INSTALLED=false/);
 assert.match(core,/allConsentMutationPathsSerialized:false/);
 assert.match(signed,/RC8_APPROVAL_WRITER_INSTALLED=false/);
 assert.match(signed,/independentDbaAppsecApproved:false/);
 assert.match(signed,/humanKeyCeremonyComplete:false/);
});
test("Finance view filters bounded read-only Core records without credit or settlement actions",()=>{
 const ui=read("apps/vox-web/app/finance/page.tsx");
 assert.match(ui,/STATES=\["all","paid","pending","failed","refunded"\]/);
 assert.match(ui,/fetchOwnerFinancePreview\(\)/);
 assert.match(ui,/Filter recent payment records/);
 assert.match(ui,/visible=result\.orders\.filter/);
 assert.match(ui,/aria-current=\{selected===state/);
 assert.match(ui,/not complete payment history/);
 assert.match(ui,/This page cannot refund, capture, reconcile, grant credits or activate packages/);
 assert.doesNotMatch(ui,/fetch\(["']https?:\/\//);
});
