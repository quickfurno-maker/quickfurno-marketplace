import { createHmac, timingSafeEqual } from "node:crypto";

export const RAZORPAY_TEST_PROVIDER = "razorpay_test";
export const RAZORPAY_TEST_CURRENCY = "INR";

export type RazorpayCheckoutResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

export type RazorpayPaymentEntity = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  captured?: boolean;
};

export function requireRazorpayTestKeyId(value: string | undefined): string {
  const key = (value ?? "").trim();
  if (!key.startsWith("rzp_test_") || key.length <= "rzp_test_".length) {
    throw new Error("RAZORPAY_TEST_KEY_ID must be a Razorpay TEST key.");
  }
  return key;
}
export function requireSecret(name: string, value: string | undefined): string {
  const secret = (value ?? "").trim();
  if (!secret) throw new Error(`${name} is missing.`);
  return secret;
}

export function inrToSubunits(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("PACKAGE_PRICE_INVALID");
  }
  const subunits = Math.round(amount * 100);
  if (!Number.isSafeInteger(subunits) || subunits <= 0) {
    throw new Error("PACKAGE_PRICE_INVALID");
  }
  return subunits;
}

export function packageOrderReceipt(orderId: string): string {
  const compact = orderId.replace(/-/g, "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(compact)) throw new Error("ORDER_ID_INVALID");
  const receipt = `qfvp_${compact}`;
  if (receipt.length > 40) throw new Error("RECEIPT_TOO_LONG");
  return receipt;
}

function safeEqualHex(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]+$/i.test(actual) || actual.length !== expected.length) return false;  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function verifyCheckoutSignature(input: {
  storedOrderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): boolean {
  const expected = createHmac("sha256", input.keySecret)
    .update(`${input.storedOrderId}|${input.paymentId}`)
    .digest("hex");
  return safeEqualHex(input.signature, expected);
}

export function verifyWebhookSignature(rawBody: string, signature: string, webhookSecret: string): boolean {
  const expected = createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");
  return safeEqualHex(signature, expected);
}

export function assertCapturedPayment(payment: RazorpayPaymentEntity, expected: {
  paymentId: string;
  providerOrderId: string;
  amount: number;
  currency?: string;
}): void {  if (payment.id !== expected.paymentId) throw new Error("PAYMENT_ID_MISMATCH");
  if (payment.order_id !== expected.providerOrderId) throw new Error("PAYMENT_ORDER_MISMATCH");
  if (payment.amount !== expected.amount) throw new Error("PAYMENT_AMOUNT_MISMATCH");
  if (payment.currency !== (expected.currency ?? RAZORPAY_TEST_CURRENCY)) {
    throw new Error("PAYMENT_CURRENCY_MISMATCH");
  }
  if (payment.status !== "captured" || payment.captured === false) {
    throw new Error("PAYMENT_NOT_CAPTURED");
  }
}

export function packageSnapshotMatches(
  order: { package_name: string | null; package_price: number | null; credits_included: number | null; validity_days: number | null },
  pkg: { name: string; total_price: number; lead_count: number; validity_days: number }
): boolean {
  return order.package_name === pkg.name
    && Number(order.package_price) === Number(pkg.total_price)
    && Number(order.credits_included) === Number(pkg.lead_count)
    && Number(order.validity_days) === Number(pkg.validity_days);
}
