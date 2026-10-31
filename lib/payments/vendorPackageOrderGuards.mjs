// Pure checkout-boundary checks. No provider calls, database changes or credit authority.
// A historical razorpay_test order is always TEST, including when provider_mode
// predates the column. Modern razorpay orders require an explicit matching mode.
export function storedRazorpayOrderModeError(order, requestedMode) {
  if (requestedMode !== "test" && requestedMode !== "live") return "PACKAGE_ORDER_MODE_MISMATCH";
  if (!order || typeof order !== "object") return "PACKAGE_ORDER_PROVIDER_MISMATCH";
  if (order.payment_provider === "razorpay_test") {
    return requestedMode === "test" && (order.provider_mode == null || order.provider_mode === "test")
      ? null : "PACKAGE_ORDER_MODE_MISMATCH";
  }
  if (order.payment_provider === "razorpay") {
    return order.provider_mode === requestedMode ? null : "PACKAGE_ORDER_MODE_MISMATCH";
  }
  return "PACKAGE_ORDER_PROVIDER_MISMATCH";
}

// Do not invoke Razorpay unless the atomic DB claim returns a complete,
// expected result. Unknown statuses and malformed already-bound claims fail closed.
export function inspectRazorpayOrderClaim(claim, expected) {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) return "invalid";
  if (claim.status === "already_bound") {
    return typeof claim.provider_order_id === "string" && claim.provider_order_id.trim().length > 0
      ? "already_bound" : "invalid";
  }
  if (claim.status !== "claimed") return "invalid";
  if (claim.order_id !== expected.orderId ||
      !Number.isSafeInteger(Number(claim.amount_subunits)) ||
      Number(claim.amount_subunits) !== expected.amountSubunits ||
      claim.receipt !== expected.receipt ||
      claim.currency !== "INR") return "invalid";
  return "claimed";
}

// Only well-defined validation/authentication rejections can release a POST
// /orders claim. 408, 409, 429, all 5xx and unknown statuses are uncertain:
// the provider might have created an order despite the HTTP response.
export function isDefiniteRazorpayOrderRejection(status) {
  return status === 400 || status === 401 || status === 403 ||
    status === 404 || status === 422;
}

/** Already-bound checkout details are NOT safe solely because a provider
 * order ID exists. Never return a payable checkout for a closed, activated,
 * captured, refunded, uncertain, or inconsistent local order. */
export function storedRazorpayCheckoutLifecycleError(order) {
  if (!order || typeof order !== "object" || Array.isArray(order)) return "PACKAGE_ORDER_NOT_PAYABLE";
  if (order.order_status !== "created" || order.activation_status !== "not_activated" ||
      (order.payment_status !== "pending" && order.payment_status !== "failed") ||
      order.provider_payment_id !== null) return "PACKAGE_ORDER_NOT_PAYABLE";
  return null;
}
