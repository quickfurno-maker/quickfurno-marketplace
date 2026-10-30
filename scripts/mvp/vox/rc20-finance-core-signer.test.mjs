import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("Core does not return Razorpay checkout or activate credits for unpayable lifecycle",()=>{
 const service=read("services/vendorPackagePaymentService.ts");
 assert.match(service,/if \(order\.order_status !== "created" \|\|/);
 assert.match(service,/!\["not_started", "pending", "failed"\]\.includes\(order\.payment_status \?\? ""\)/);
 assert.match(service,/PACKAGE_ORDER_NOT_PAYABLE/);
 assert.match(service,/order\.payment_status === "refunded" \|\| order\.payment_status === "refund_pending"/);
 assert.match(service,/PACKAGE_ORDER_REFUND_LOCKED/);
 assert.match(service,/order\.provider_payment_id !== payment\.id/);
 assert.match(service,/PACKAGE_ORDER_PAYMENT_ID_DRIFT/);
 assert.match(service,/assertCapturedPayment\(payment, \{/);
 assert.match(service,/inspectRazorpayActivationReceipt\(data, \{/);
});
test("real V2 SQL enforces explicit lifecycle after already-applied idempotent branch",()=>{
 const sql=read("ops/vox/rc17-review-candidates/20261031001000_rc17_razorpay_v2_authority_REVIEW_ONLY.sql");
 const start=sql.indexOf("create or replace function public.qf_activate_vendor_package_order_v2(");
 const end=sql.indexOf("revoke all on function public.qf_activate_vendor_package_order_v2(",start);
 assert.ok(start>=0&&end>start);
 const activate=sql.slice(start,end);
 const replay=activate.indexOf("'already_applied'");
 const lifecycle=activate.indexOf("PACKAGE_ORDER_LIFECYCLE_NOT_ACTIVATABLE");
 const credit=activate.indexOf("qf_apply_vendor_credit_delta");
 assert.ok(replay>=0&&lifecycle>replay&&credit>lifecycle,"lifecycle must follow exact-once replay and precede credit");
 assert.match(activate,/v_order\.order_status is distinct from 'created'/);
 assert.match(activate,/v_order\.payment_status is null/);
 assert.match(activate,/v_order\.payment_status not in \('pending','failed'\)/);
 assert.match(activate,/provider_mode is distinct from p_provider_mode/);
});
test("real PG17 scripts test cancelled/refunded activation and current Staff DB role",()=>{
 const pay=read("scripts/mvp/vox/validate-vox-rc17-razorpay-v2-real-pg17.mjs");
 for(const item of ["CANCELLED_ORDER_NO_CREDITS","REFUNDED_ORDER_NO_CREDITS",
  "CONCURRENT_EXACT_ONCE_CREDIT","NULL_PROVIDER_CANNOT_CLAIM"])
  assert.ok(pay.includes(item),item);
 const core=read("services/vox/rc8PgVendorConversationOperator.ts");
 const harness=read("scripts/mvp/vox/validate-vox-rc8-real-pg-vendor-core.mjs");
 assert.match(core,/u\.raw_app_meta_data->>'vox_role'='operations_manager'/);
 assert.match(harness,/MISMATCHED_OPERATIONS_ROLE_DENIED/);
 assert.match(harness,/CURRENT_STAFF_GRANT_OR_AAL2_DENIED/);
});
test("signed EOD current real Owner/TL identities match verified cryptographic receipt",()=>{
 const core=read("scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs");
 assert.match(core,/signed\.ownerId!==ownerAuth\?\.userId/);
 assert.match(core,/signed\.teamLeaderId!==teamLeaderAuth\?\.userId/);
 assert.match(core,/EOD_CURRENT_FOUR_SOURCE_REVIEW_REQUIRED/);
 const harness=read("scripts/mvp/vox/validate-vox-rc8-real-pg-signed-intent.mjs");
 for(const item of ["EOD_THREE_SOURCE_DENIED","EOD_WRONG_TL_DENIED",
  "EOD_DIGEST_DRIFT_DENIED","EOD_ALREADY_PUBLISHED_DENIED"])
  assert.ok(harness.includes(item),item);
 assert.match(core,/RC8_APPROVAL_WRITER_INSTALLED=false/);
});

test("VOX Finance attention only filters bounded Core records, never performs refunds",()=>{
 const ui=read("apps/vox-web/app/finance/page.tsx");
 assert.match(ui,/const monthScoped=result\.orders\.filter/);
 assert.match(ui,/indiaOrderMonth\(o\.createdAt\)===selectedMonth/);
 assert.match(ui,/const pendingCount=monthScoped\.filter/);
 assert.match(ui,/const failedCount=monthScoped\.filter/);
 assert.match(ui,/Recent payment attention shortcuts/);
 assert.match(ui,/financeHref\("pending",selectedMonth\)/);
 assert.match(ui,/financeHref\("failed",selectedMonth\)/);
 assert.match(ui,/Filters apply only to the bounded Core preview/);
 assert.match(ui,/This page cannot refund, capture, reconcile, grant credits or activate packages/);
});

test("claim/bind NULL values and paid prior ledger entries never gain V2 authority",()=>{
 const sql=read("ops/vox/rc17-review-candidates/20261031001000_rc17_razorpay_v2_authority_REVIEW_ONLY.sql");
 const claim=sql.slice(sql.indexOf("create or replace function public.qf_claim_vendor_package_razorpay_order_v2("),
  sql.indexOf("revoke all on function public.qf_claim_vendor_package_razorpay_order_v2("));
 const bind=sql.slice(sql.indexOf("create or replace function public.qf_bind_vendor_package_razorpay_order_v2("),
  sql.indexOf("revoke all on function public.qf_bind_vendor_package_razorpay_order_v2("));
 const failed=sql.slice(sql.indexOf("create or replace function public.qf_mark_vendor_package_payment_failed_v2("),
  sql.indexOf("revoke all on function public.qf_mark_vendor_package_payment_failed_v2("));
 for(const part of [claim,bind]){
  assert.match(part,/v_order\.order_status is distinct from 'created'/);
  assert.match(part,/v_order\.activation_status is distinct from 'not_activated'/);
  assert.match(part,/v_order\.payment_status is null/);
 }
 assert.match(bind,/v_payment\.payment_status is null/);
 assert.match(bind,/v_payment\.payment_status not in \('Pending', 'Failed'\)/);
 assert.doesNotMatch(bind,/v_payment\.payment_status not in \('Pending', 'Failed', 'Paid'\)/);
 assert.match(failed,/v_order\.payment_status = 'refunded'/);
 assert.match(failed,/status','ignored_refunded'/);
 assert.match(failed,/v_order\.order_status is distinct from 'created'/);
 assert.match(failed,/status','ignored_closed'/);
 const fixture=read("scripts/mvp/vox/validate-vox-rc17-razorpay-v2-real-pg17.mjs");
 for(const marker of ["NULL_ORDER_STATUS_DENIED","NULL_ACTIVATION_STATUS_DENIED",
 "NULL_PAYMENT_STATUS_DENIED","NULL_BIND_PAYMENT_STATUS_DENIED","NULL_LEDGER_STATUS_DENIED",
 "PAID_UNACTIVATED_LEDGER_BIND_DENIED","CANCELLED_FAILURE_MUST_NOT_DOWNGRADE",
 "REFUNDED_FAILURE_MUST_NOT_DOWNGRADE","REFUNDED_STATE_OVERWRITTEN"])
  assert.ok(fixture.includes(marker),marker);
});
