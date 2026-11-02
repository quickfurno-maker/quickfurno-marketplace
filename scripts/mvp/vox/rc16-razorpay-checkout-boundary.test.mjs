import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { storedRazorpayOrderModeError, storedRazorpayCheckoutLifecycleError, inspectRazorpayOrderClaim, isDefiniteRazorpayOrderRejection } from "../../../lib/payments/vendorPackageOrderGuards.mjs";

test("historical Razorpay TEST is never accepted in LIVE", () => {
  for (const storedMode of [null, "test"]) {
    assert.equal(storedRazorpayOrderModeError({ payment_provider: "razorpay_test", provider_mode: storedMode }, "test"), null);
    assert.equal(storedRazorpayOrderModeError({ payment_provider: "razorpay_test", provider_mode: storedMode }, "live"), "PACKAGE_ORDER_MODE_MISMATCH");
  }
  assert.equal(storedRazorpayOrderModeError({ payment_provider: "razorpay_test", provider_mode: "live" }, "test"), "PACKAGE_ORDER_MODE_MISMATCH");
});

test("modern orders require matching explicit mode; missing mode never authorizes LIVE or TEST", () => {
  for (const mode of ["test", "live"]) {
    assert.equal(storedRazorpayOrderModeError({ payment_provider: "razorpay", provider_mode: mode }, mode), null);
    assert.equal(storedRazorpayOrderModeError({ payment_provider: "razorpay", provider_mode: mode }, mode === "test" ? "live" : "test"), "PACKAGE_ORDER_MODE_MISMATCH");
    assert.equal(storedRazorpayOrderModeError({ payment_provider: "razorpay", provider_mode: null }, mode), "PACKAGE_ORDER_MODE_MISMATCH");
  }
  for (const provider of [null, "not_connected", "razorpay_live", "manual"]) {
    assert.equal(storedRazorpayOrderModeError({ payment_provider: provider, provider_mode: "live" }, "live"), "PACKAGE_ORDER_PROVIDER_MISMATCH");
  }
});

test("checkout proceeds only with an unambiguous atomic DB claim", () => {
  const expected = { orderId: "00000000-0000-0000-0000-000000000001", amountSubunits: 7900000, receipt: "qfvp_00000000000000000000000000000001" };
  const good = { status: "claimed", order_id: expected.orderId, amount_subunits: expected.amountSubunits, receipt: expected.receipt, currency: "INR" };
  assert.equal(inspectRazorpayOrderClaim(good, expected), "claimed");
  assert.equal(inspectRazorpayOrderClaim({ status: "already_bound", provider_order_id: "order_123" }, expected), "already_bound");
  for (const bad of [
    null, {}, { status: "claimed" }, { ...good, status: "ok" },
    { ...good, order_id: "wrong" }, { ...good, amount_subunits: 1 },
    { ...good, amount_subunits: null }, { ...good, receipt: "other" },
    { ...good, currency: "USD" }, { status: "already_bound" },
    { status: "already_bound", provider_order_id: "" }
  ]) assert.equal(inspectRazorpayOrderClaim(bad, expected), "invalid");
});

test("actual payment service calls guards before provider order creation and checks release failures", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const service = readFileSync(resolve(root, "services/vendorPackagePaymentService.ts"), "utf8");
  assert.match(service, /storedRazorpayOrderModeError\(order, cfg\.mode\)/);
  assert.match(service, /inspectRazorpayOrderClaim\(claim, \{/);
  assert.match(service, /if \(claimStatus === "invalid"\)/);
  assert.match(service, /if \(releaseError\)/);
  assert.match(service, /PACKAGE_ORDER_CLAIM_RELEASE_FAILED/);
});

test("ambiguous provider HTTP never releases an order creation claim", () => {
  for (const definite of [400, 401, 403, 404, 422])
    assert.equal(isDefiniteRazorpayOrderRejection(definite), true);
  for (const uncertain of [200, 408, 409, 429, 500, 502, 503, 504, 599])
    assert.equal(isDefiniteRazorpayOrderRejection(uncertain), false);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const service = readFileSync(resolve(root, "services/vendorPackagePaymentService.ts"), "utf8");
  assert.match(service, /definitiveOrderRejection \? "RAZORPAY_HTTP_REJECTED" : "RAZORPAY_HTTP_UNCERTAIN"/);
  assert.match(service, /path === "\/orders"/);
  assert.match(service, /init\.method\?\.toUpperCase\(\) === "POST"/);
  assert.match(service, /if \(error instanceof AppError && error\.code === "RAZORPAY_HTTP_REJECTED"\)/);
  assert.match(service, /PACKAGE_ORDER_CREATION_UNCERTAIN/);
});

test("bound checkout never revives paid, refunded, cancelled or unknown lifecycle", () => {
  const unpaid = {
    order_status: "created", activation_status: "not_activated",
    payment_status: "pending", provider_payment_id: null,
  };
  assert.equal(storedRazorpayCheckoutLifecycleError(unpaid), null);
  assert.equal(storedRazorpayCheckoutLifecycleError({...unpaid, payment_status: "failed"}), null);
  for (const changed of [
    {order_status: "cancelled"}, {order_status: "expired"},
    {order_status: "completed"}, {order_status: null},
    {activation_status: "activated"}, {activation_status: null},
    {payment_status: "paid"}, {payment_status: "refunded"},
    {payment_status: "refund_pending"}, {payment_status: null},
    {payment_status: "not_started"}, {provider_payment_id: "pay_captured"},
  ]) {
    assert.equal(storedRazorpayCheckoutLifecycleError({...unpaid,...changed}),
      "PACKAGE_ORDER_NOT_PAYABLE", JSON.stringify(changed));
  }
  assert.equal(storedRazorpayCheckoutLifecycleError(null), "PACKAGE_ORDER_NOT_PAYABLE");
  assert.equal(storedRazorpayCheckoutLifecycleError([]), "PACKAGE_ORDER_NOT_PAYABLE");
});
test("bound checkout revalidates actual ledger through read-only claim before returning details", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const service = readFileSync(resolve(root, "services/vendorPackagePaymentService.ts"), "utf8");
  const boundStart = service.indexOf("if (order.provider_order_id) {");
  const boundEnd = service.indexOf("let providerOrder:",boundStart);
  assert.ok(boundStart>=0&&boundEnd>boundStart);
  const bound = service.slice(boundStart,boundEnd);
  assert.match(bound,/qf_claim_vendor_package_razorpay_order_v2/);
  assert.match(bound,/inspectRazorpayOrderClaim\(boundClaim, \{/);
  assert.match(bound,/!== "already_bound"/);
  assert.match(bound,/order = await loadOrder\(order\.id, access\.data\.vendorId\)/);
  assert.match(service,/storedRazorpayCheckoutLifecycleError\(order\)/);
  assert.match(service,/order\.activation_status !== "not_activated"/);
});
