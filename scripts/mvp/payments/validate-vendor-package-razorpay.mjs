import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import {
  assertCapturedPayment,
  inrToSubunits,
  packageOrderReceipt,
  packageSnapshotMatches,
  requireRazorpayTestKeyId,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "../../../lib/payments/vendorPackageRazorpay.ts";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}
function rejects(name, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(name, threw);
}
check("P01 INR converts to paise", inrToSubunits(123.45) === 12345);
check("P02 integer INR converts to paise", inrToSubunits(499) === 49900);
rejects("P03 zero amount refused", () => inrToSubunits(0));
rejects("P04 negative amount refused", () => inrToSubunits(-1));
rejects("P05 non-number amount refused", () => inrToSubunits("not-a-number"));

const localOrderId = "123e4567-e89b-12d3-a456-426614174000";
check(
  "P06 deterministic bounded receipt",
  packageOrderReceipt(localOrderId) === "qfvp_123e4567e89b12d3a456426614174000"
);
rejects("P07 malformed local order id refused", () => packageOrderReceipt("bad"));

check("P08 TEST key accepted", requireRazorpayTestKeyId("rzp_test_example") === "rzp_test_example");
rejects("P09 live key refused", () => requireRazorpayTestKeyId("rzp_live_example"));
rejects("P10 blank key refused", () => requireRazorpayTestKeyId(""));

const secret = "unit-test-secret";
const providerOrderId = "order_test_123";
const paymentId = "pay_test_456";
const checkoutSig = createHmac("sha256", secret)
  .update(`${providerOrderId}|${paymentId}`).digest("hex");
check("P11 checkout HMAC accepted", verifyCheckoutSignature({
  storedOrderId: providerOrderId, paymentId, signature: checkoutSig, keySecret: secret,
}));
check("P12 checkout HMAC rejects tamper", !verifyCheckoutSignature({
  storedOrderId: providerOrderId, paymentId: `${paymentId}x`, signature: checkoutSig, keySecret: secret,
}));

const rawWebhook = JSON.stringify({ event: "payment.captured", payload: { id: 1 } });
const webhookSig = createHmac("sha256", secret).update(rawWebhook).digest("hex");
check("P13 webhook HMAC accepted", verifyWebhookSignature(rawWebhook, webhookSig, secret));
check("P14 webhook HMAC rejects body tamper", !verifyWebhookSignature(`${rawWebhook}x`, webhookSig, secret));

const captured = {
  id: paymentId,
  order_id: providerOrderId,
  amount: 250000,
  currency: "INR",
  status: "captured",
  captured: true,
};
assertCapturedPayment(captured, {
  paymentId, providerOrderId, amount: 250000, currency: "INR",
});
check("P15 captured payment accepted", true);
rejects("P16 authorized payment refused", () => assertCapturedPayment(
  { ...captured, status: "authorized" },
  { paymentId, providerOrderId, amount: 250000, currency: "INR" }
));
rejects("P17 amount mismatch refused", () => assertCapturedPayment(
  captured,
  { paymentId, providerOrderId, amount: 1, currency: "INR" }
));
rejects("P18 provider order mismatch refused", () => assertCapturedPayment(
  captured,
  { paymentId, providerOrderId: "order_other", amount: 250000, currency: "INR" }
));

const snapshot = { package_name: "Starter", package_price: 2500, credits_included: 10, validity_days: 30 };
const pkg = { name: "Starter", total_price: 2500, lead_count: 10, validity_days: 30 };
check("P19 package snapshot exact match", packageSnapshotMatches(snapshot, pkg));
check("P20 package price drift rejected", !packageSnapshotMatches(snapshot, { ...pkg, total_price: 2600 }));
check("P21 package credit drift rejected", !packageSnapshotMatches(snapshot, { ...pkg, lead_count: 11 }));

const migration = read("supabase/migrations/20260912010000_qf_vendor_package_razorpay_testmode.sql");
const service = read("services/vendorPackagePaymentService.ts");
const checkoutRoute = read("app/api/vendor/package-payment/checkout/route.ts");
const verifyRoute = read("app/api/vendor/package-payment/verify/route.ts");
const webhookRoute = read("app/api/webhooks/razorpay/vendor-package/route.ts");
const payButton = read("components/vendor-dashboard-v2/package/VendorPackagePayButton.tsx");

check("S01 browser write grants revoked", /revoke all on table public\.vendor_package_orders from public, anon, authenticated/.test(migration));
check("S02 financial RPCs service-role only", [
  "qf_claim_vendor_package_razorpay_order_v1",
  "qf_bind_vendor_package_razorpay_order_v1",
  "qf_activate_vendor_package_order_v1",
  "qf_mark_vendor_package_payment_failed_v1",
].every((name) => migration.includes(`grant execute on function public.${name}`)));
check("S03 canonical wallet primitive reused", migration.includes("qf_apply_vendor_credit_delta"));
check("S04 no legacy direct credit helper", !migration.includes("increment_vendor_credits"));
check("S05 same-order exact-once reference", migration.includes("'package_purchase',\n    p_order_id::text"));
check("S06 order row locks before financial mutation", /where id = p_order_id\s+for update/i.test(migration));
check("S07 vendor row locks renewals", /from public\.vendors where id = v_order\.vendor_id for update/i.test(migration));
check("S08 renewal preserves future validity", migration.includes("greatest(now(), coalesce(v_vendor.package_expires_at, now()))"));
check("S09 payment identity is local order id", /insert into public\.payments[\s\S]*p_order_id, v_order\.vendor_id/.test(migration));
check("S10 provider order/payment unique", migration.includes("uq_vendor_package_orders_provider_order") && migration.includes("uq_vendor_package_orders_provider_payment"));
check("S11 ambiguous order creation claim exists", migration.includes("PROVIDER_ORDER_CREATION_UNCERTAIN") && migration.includes("provider_order_request_token"));
check("S12 package snapshot checked before provider order", migration.includes("PACKAGE_SNAPSHOT_DRIFT"));

check("A01 vendor identity from canonical access guard", service.includes("requireVendorAccess()"));
check("A02 service never accepts vendor id from checkout route", !/vendorId/.test(checkoutRoute));
check("A03 client never supplies amount to checkout API", !/amount/.test(checkoutRoute));
check("A04 checkout signature uses stored provider order", service.includes("storedOrderId: order.provider_order_id"));
check("A05 canonical payment is fetched server-side", service.includes('/payments/${encodeURIComponent(response.razorpay_payment_id)}') || service.includes('"/payments/" + encodeURIComponent(response.razorpay_payment_id)'));
check("A06 webhook uses raw body", webhookRoute.includes("await request.text()"));
check("A07 webhook reads Razorpay signature header", webhookRoute.includes('x-razorpay-signature'));
check("A08 live key prefix absent from server implementation", !service.includes("rzp_live_") && !payButton.includes("rzp_live_"));
check("A09 secret never exposed as NEXT_PUBLIC", !/NEXT_PUBLIC_RAZORPAY/.test(service + payButton + checkoutRoute + verifyRoute));
check("A10 browser receives key id only through authenticated checkout response", payButton.includes("checkout.keyId") && !payButton.includes("KEY_SECRET"));
check("U01 UI is explicitly TEST MODE", payButton.includes("TEST MODE"));
check("U02 checkout script is official Razorpay checkout", payButton.includes("https://checkout.razorpay.com/v1/checkout.js"));
check("U03 customer lead services are not imported", !/leadService|submitLead|ClientEnquiry|LeadFunnel/.test(service + checkoutRoute + verifyRoute + webhookRoute + payButton));
check("U04 unrelated projects absent", !/Jarvis|OneDecore/i.test(service + checkoutRoute + verifyRoute + webhookRoute + payButton + migration));

console.log(`SUMMARY assertions=${passed + failed} passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
