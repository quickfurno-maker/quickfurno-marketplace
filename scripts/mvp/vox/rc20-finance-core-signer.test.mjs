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
  "EOD_DIGEST_DRIFT_DENIED","EOD_ALREADY_PUBLISHED_DENIED",
  "EOD_MISSING_STAFF_ID_DENIED"])
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

test("genuine PG17 runner uses host TCP readiness, not initdb temporary socket",()=>{
 const run=read("scripts/mvp/vox/validate-vox-rc17-razorpay-v2-real-pg17.mjs");
 assert.match(run,/const probe=new Pool\(\{host:"127\.0\.0\.1",port/);
 assert.match(run,/await probe\.query\("SELECT 1 AS ready"\)/);
 assert.match(run,/await pool\.query\("SELECT 1 AS ready"\)/);
 assert.match(run,/PG17_HOST_TCP_NOT_READY/);
 assert.match(run,/spawnSync\("docker",\["logs","--tail","35",name\]/);
 assert.doesNotMatch(run,/ready=docker\(\["exec",name,"psql"/);
});
test("review-only Core bridge rejects caller actor claims and unverifiable Auth",()=>{
 const source=read("services/vox/rc19VerifiedConversationWriter.ts");
 assert.match(source,/Object\.keys\(value\)\.sort\(\)/);
 assert.match(source,/COMMAND_KEYS=\["action","conversationId","expectedRevision","nonce"\]/);
 assert.match(source,/if\(!validCommand\(command\)/);
 assert.match(source,/RC19_COMMAND_INVALID/);
 assert.match(source,/RC19_CURRENT_STAFF_AUTH_UNAVAILABLE/);
 assert.match(source,/RC19_VERIFIED_CORE_WRITER_INSTALLED=false/);
 assert.match(source,/verifyVoxOperationsStaffBearer\(authorization\)/);
 assert.doesNotMatch(source,/process\.env\.|DISPOSABLE_RC12_AB7B_PROOF/);
});
test("signed EOD requires exact current Staff and report identities",()=>{
 const source=read("scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs");
 assert.match(source,/!UUID\.test\(row\.id\?\?""\)/);
 assert.match(source,/!UUID\.test\(row\.staff_id\?\?""\)/);
 assert.match(source,/row\.id!==request\.subjectId/);
 assert.match(source,/row\.reviewer_id!==teamLeaderAuth\?\.userId/);
 assert.match(source,/Number\(row\.source_count\)!==4/);
 assert.match(source,/row\.published!==false/);
 assert.match(source,/RC8_APPROVAL_WRITER_INSTALLED=false/);
});

// RC20 A-D mutation safety constraints and genuine PG17 exercise markers.
test("RC20 A-D mutation safety constraints persist in same branch",()=>{
 const sql=read("ops/vox/rc17-review-candidates/20261031001000_rc17_razorpay_v2_authority_REVIEW_ONLY.sql");
 const start=sql.indexOf("create or replace function public.qf_activate_vendor_package_order_v2(");
 const end=sql.indexOf("revoke all on function public.qf_activate_vendor_package_order_v2(",start);
 assert.ok(start>=0&&end>start);
 const activation=sql.slice(start,end);
 assert.match(activation,/v_order\.activation_status is distinct from 'not_activated'/);
 assert.match(activation,/v_payment\.payment_status not in \('Pending','Failed'\)/);
 assert.match(activation,/v_payment\.transaction_id is not null/);
 assert.match(activation,/PACKAGE_PAYMENT_LEDGER_NOT_ACTIVATABLE/);
 const pg=read("scripts/mvp/vox/validate-vox-rc17-razorpay-v2-real-pg17.mjs");
 for(const marker of ["PAID_LEDGER_CANNOT_MINT_CREDITS","NULL_ACTIVATION_MUST_DENY_CREDIT",
   "CONCURRENT_EXACT_ONCE_CREDIT"])assert.ok(pg.includes(marker),marker);
 const core=read("services/vox/rc8PgVendorConversationOperator.ts");
 assert.match(core,/FOR UPDATE OF c FOR SHARE OF v,z,geo_city/);
 const cpg=read("scripts/mvp/vox/validate-vox-rc8-real-pg-vendor-core.mjs");
 assert.match(cpg,/CONCURRENT_ZONE_REVOCATION_DENIED/);
 assert.match(cpg,/REVOCATION_NO_EVENT/);
 const writer=read("scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs");
 assert.match(writer,/EOD_REQUEST_SCOPE_INVALID/);
 assert.match(writer,/EOD_SUBJECT_STAFF_REVOKED/);
 assert.match(writer,/FOR SHARE OF m,t,p,a/);
 const signed=read("scripts/mvp/vox/validate-vox-rc8-real-pg-signed-intent.mjs");
 for(const marker of ["NON_EOD_SCOPE_DENIED","INVALID_EOD_SUBJECT_DENIED",
   "EOD_REVOKED_STAFF_SUBJECT_DENIED","EOD_MISSING_STAFF_AUTH_DENIED"])
   assert.ok(signed.includes(marker),marker);
 const view=read("apps/vox-web/app/finance/page.tsx");
 assert.match(view,/const attention=monthScoped\.reduce/);
 assert.match(view,/attention\+" of "\+monthScoped\.length/);
});
test("Core and EOD disposable PG17 suites verify actual mapped TCP endpoint",()=>{
 for(const path of ["scripts/mvp/vox/validate-vox-rc8-real-pg-vendor-core.mjs",
  "scripts/mvp/vox/validate-vox-rc8-real-pg-signed-intent.mjs"]){
  const script=read(path);
  assert.match(script,/connectionTimeoutMillis:1200/);
  assert.match(script,/SELECT 1 AS ready/);
  assert.doesNotMatch(script,/ready=docker\(\["exec"/);
 }
});

test("V2 release only resets a pristine pending claim, and bound checkout checks financial truth",()=>{
 const sql=read("ops/vox/rc17-review-candidates/20261031001000_rc17_razorpay_v2_authority_REVIEW_ONLY.sql");
 const release=sql.slice(sql.indexOf("create or replace function public.qf_release_vendor_package_razorpay_order_claim_v2("),
  sql.indexOf("revoke all on function public.qf_release_vendor_package_razorpay_order_claim_v2("));
 const claim=sql.slice(sql.indexOf("create or replace function public.qf_claim_vendor_package_razorpay_order_v2("),
  sql.indexOf("revoke all on function public.qf_claim_vendor_package_razorpay_order_v2("));
 const bind=sql.slice(sql.indexOf("create or replace function public.qf_bind_vendor_package_razorpay_order_v2("),
  sql.indexOf("revoke all on function public.qf_bind_vendor_package_razorpay_order_v2("));
 for(const field of ["order_status='created'","activation_status='not_activated'",
    "payment_status='pending'","provider_order_request_token = p_request_token"])
   assert.ok(release.includes(field),field);
 assert.match(claim,/RAZORPAY_V2_BOUND_LEDGER_UNVERIFIED/);
 assert.match(claim,/v_payment\.transaction_id is not null/);
 assert.match(claim,/for share/);
 assert.match(bind,/v_payment\.transaction_id is not null/);
 const pg=read("scripts/mvp/vox/validate-vox-rc17-razorpay-v2-real-pg17.mjs");
 for(const marker of ["CANCELLED_CLAIM_RELEASE_DENIED","REFUNDED_CLAIM_RELEASE_DENIED",
  "NULL_ACTIVATION_CLAIM_RELEASE_DENIED","CAPTURED_TXID_BOUND_CHECKOUT_DENIED",
  "CAPTURED_TXID_BIND_DENIED","PAID_BOUND_CHECKOUT_DENIED"])
   assert.ok(pg.includes(marker),marker);
 const core=read("services/vendorPackagePaymentService.ts");
 assert.match(core,/inspectRazorpayOrderClaim\(boundClaim, \{/);
 assert.match(core,/storedRazorpayCheckoutLifecycleError\(order\)/);
});

test("Core refuses in-flight expired Staff before commit and keeps rollback evidence",()=>{
 const core=read("services/vox/rc8PgVendorConversationOperator.ts");
 const harness=read("scripts/mvp/vox/validate-vox-rc8-real-pg-vendor-core.mjs");
 const guard=core.indexOf("STAFF_AAL2_EXPIRED_DURING_TRANSACTION");
 const commit=core.indexOf('db.query("COMMIT")',guard);
 assert.ok(guard>0&&commit>guard);
 assert.match(core,/if\(input\.verifiedStaff\.expiresAtMs<=Date\.now\(\)\)\{/);
 assert.match(harness,/EXPIRED_AAL2_NO_EVENT/);
 assert.match(harness,/EXPIRED_AAL2_NO_RECEIPT/);
 assert.match(harness,/EXPIRED_AAL2_NO_TAKEOVER/);
 assert.match(harness,/EXPIRED_AAL2_NO_REVISION/);
});
test("EOD approvals require exact named independent gates, not four arbitrary truths",()=>{
 const source=read("scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs");
 const harness=read("scripts/mvp/vox/validate-vox-rc8-real-pg-signed-intent.mjs");
 assert.match(source,/APPROVAL_KEYS=Object\.freeze/);
 assert.match(source,/keys\.every\(\(k,i\)=>k===APPROVAL_KEYS\[i\]\)/);
 assert.match(source,/APPROVAL_KEYS\.every\(k=>g\[k\]===true\)/);
 assert.match(harness,/WRONG_APPROVAL_KEYS_DENIED/);
 assert.match(harness,/EXTRA_APPROVAL_KEY_DENIED/);
 assert.match(source,/RC8_APPROVAL_WRITER_INSTALLED=false/);
});
test("Finance UI directs unavailable Core to operations, MFA failure to actual login",()=>{
 const ui=read("apps/vox-web/app/finance/page.tsx");
 assert.match(ui,/needsLogin=result\.error==="MFA_REQUIRED"/);
 assert.match(ui,/needsLogin\?"\/login":"\/operations"/);
 assert.match(ui,/No payment actions can be performed from this screen/);
});
