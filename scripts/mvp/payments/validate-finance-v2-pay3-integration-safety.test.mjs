import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"../../..");
const read=x=>readFileSync(resolve(root,x),"utf8");
test("PAY3 Final A receipt feature defaults OFF and retains original exact-once wallet route",()=>{
 const route=read("app/api/webhooks/razorpay/vendor-package/route.ts");
 const journal=read("services/financeV2WebhookJournal.ts");
 const worker=read("services/financeV2InboxWorker.ts");
 assert.match(route,/FINANCE_V2_PAY3_WEBHOOK_RECEIPT_ENABLED==="staging"/);
 assert.ok(route.indexOf("journalRazorpayFinanceV2Receipt(rawBody,signature,eventId)")<
  route.indexOf("handleVendorPackageRazorpayWebhook(rawBody, signature)"));
 assert.match(journal,/prepareVerifiedRazorpayFinanceEvent/);
 assert.match(journal,/qf_finance_v2_record_webhook_v1/);
 assert.match(worker,/FINANCE_V2_PAY3_INBOX_WORKER_ENABLED!=="staging"/);
 assert.match(worker,/RAZORPAY_VENDOR_PACKAGE_MODE!=="test"/);
 assert.match(worker,/method:"GET"/);
 assert.doesNotMatch(worker,/qf_activate_vendor_package_order_v2|qf_credit_wallet|refunds\/|method:"POST"/);
});
test("PAY3 Final B Finance UI never sends browser wallet or financial approvals",()=>{
 const page=read("apps/vox-web/app/finance/page.tsx");
 const timeline=read("apps/vox-web/app/finance/FinanceTimeline.tsx");
 assert.match(page,/fetchOwnerFinanceHistory/);
 assert.match(timeline,/aria-pressed/);
 assert.match(page,/Refund execution remains disabled/);
 assert.doesNotMatch(page,/service_role|window\.localStorage|fetch\(.*POST/);
});
test("PAY3 Final C signed event and bank proofs remain isolated SQL candidates",()=>{
 const journal=read("ops/finance/sql-candidates/20261022141000_finance_v2_pay3_webhook_receipt_candidate.sql");
 const bank=read("ops/finance/sql-candidates/20261022142000_finance_v2_pay3_bank_proof_candidate.sql");
 assert.match(journal,/on conflict\(provider,provider_mode,merchant_account_id,provider_event_id\) do nothing/);
 assert.match(journal,/FINANCE_WEBHOOK_REPLAY_CONFLICT/);
 assert.match(journal,/qf_finance_v2_enqueue_verified_event/);
 assert.match(bank,/BANK_EVIDENCE_NOT_VERIFIED/);
 assert.match(bank,/THREE_WAY_DISCREPANCY/);
 assert.match(bank,/force row level security/);
 for(const s of ["20261022141000_finance_v2_pay3_webhook_receipt_candidate.sql",
  "20261022142000_finance_v2_pay3_bank_proof_candidate.sql"])
  assert.equal(existsSync(resolve(root,"supabase/migrations",s)),false);
});
