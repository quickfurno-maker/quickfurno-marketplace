import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=path=>readFileSync(resolve(root,path),"utf8");
const sql=read("ops/vox/rc7-review-candidates/20261030040000_vox_rc11_payment_attempt_audit_review_only.sql");
const harness=read("scripts/mvp/vox/validate-vox-rc11-real-pg-finance-attempts.mjs");
test("canonical legacy TEST and modern TEST/LIVE are distinct, with no inferred LIVE",()=>{
 const payment=read("services/vendorPackagePaymentService.ts");
 const legacy=read("supabase/migrations/20260912010000_qf_vendor_package_razorpay_testmode.sql");
 assert.match(legacy,/payment_provider = 'razorpay_test'/);
 assert.match(payment,/provider_mode/);
 assert.match(sql,/to_jsonb\(o\)->>'provider_mode'/);
 assert.match(sql,/parent_order\.payment_provider='razorpay_test'/);
 assert.match(sql,/parent_order\.payment_provider='razorpay' AND parent_order\.provider_mode='test'/);
 assert.match(sql,/parent_order\.payment_provider='razorpay'\s+AND parent_order\.provider_mode='live'/);
 assert.doesNotMatch(sql,/payment_provider='razorpay_live'/);
});
test("PostgreSQL three-valued provider mode never treats UNKNOWN as authorized",()=>{
 const triggerStart=sql.indexOf("CREATE OR REPLACE FUNCTION public.qf_vox_rc11_payment_attempt_append_guard_candidate_v1()");
 const triggerEnd=sql.indexOf("CREATE TRIGGER vox_rc11_payment_attempt_append_guard",triggerStart);
 assert.ok(triggerStart>=0&&triggerEnd>triggerStart);
 const trigger=sql.slice(triggerStart,triggerEnd);
 // SQL IF NOT (nullable predicate) silently skips the rejection for NULL.
 assert.doesNotMatch(trigger,/IF NOT \(/);
 assert.match(trigger,/\) IS DISTINCT FROM TRUE\s+THEN RAISE EXCEPTION 'RC11_PAYMENT_ATTEMPT_PROVIDER_MODE_MISMATCH'/);
 assert.match(trigger,/parent_order\.provider_mode='live'/);
 assert.match(trigger,/parent_order\.provider_mode='test'/);
 for(const denied of ["MODERN_LIVE_WITHOUT_EXPLICIT_MODE_DENIED",
  "LEGACY_TEST_WITH_CONTRADICTORY_LIVE_MODE_DENIED",
  "MODERN_TEST_CANNOT_BECOME_LIVE"])
  assert.ok(harness.includes(denied),denied);
});
test("genuine local PG harness denies mixed/missing-mode and replay cases",()=>{
 for(const marker of [
  "MODERN_LIVE_WITHOUT_EXPLICIT_MODE_DENIED",
  "LEGACY_TEST_WITH_CONTRADICTORY_LIVE_MODE_DENIED",
  "MODERN_TEST_CANNOT_BECOME_LIVE",
  "SAME_ATTEMPT_SEQ_REPLAY",
  "AUTHENTICATED_CANNOT_WRITE",
  "NO_PAYMENT_MUTATION"
 ]) assert.ok(harness.includes(marker),marker);
 assert.match(harness,/events=4 attempts=3 append_only=true/);
});
test("Finance evidence never becomes payment, refund or credit authority",()=>{
 assert.match(sql,/REVIEW ONLY\. UNINSTALLED/);
 assert.match(sql,/FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/CREATE TRIGGER vox_rc11_payment_attempt_immutable/);
 assert.match(sql,/REVOKE ALL ON TABLE/);
 assert.match(sql,/GRANT SELECT ON TABLE [^\n]+ TO service_role/);
 assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE|DELETE|ALL) ON TABLE/);
 const route=read("app/api/vox/v1/finance/order/[orderId]/attempts/route.ts");
 assert.match(route,/VOX_FINANCE_ATTEMPTS_READ_ENABLED/);
 assert.match(route,/verifyVoxOwnerBearer/);
 assert.match(route,/projectRc11PaymentAttemptTimeline/);
 const workflow=read(".github/workflows/vox-rc14-finance-mode-pg17-hold.yml");
 assert.match(workflow,/npm ci --ignore-scripts/);
 assert.match(workflow,/RELEASE HOLD/);
 assert.doesNotMatch(workflow,/continue-on-error: true|npm test \|\| true/);
});
