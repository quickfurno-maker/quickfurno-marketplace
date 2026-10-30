import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { storedRazorpayOrderModeError, inspectRazorpayOrderClaim } from "../../../lib/payments/vendorPackageOrderGuards.mjs";

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
