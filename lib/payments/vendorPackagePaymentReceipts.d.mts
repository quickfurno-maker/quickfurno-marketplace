export interface ExpectedActivationReceipt {
  orderId: string;
  creditsIncluded: number;
}
export function inspectRazorpayActivationReceipt(
  receipt: unknown, expected: ExpectedActivationReceipt
): "applied" | "already_applied" | "invalid";
export function inspectRazorpayFailureReceipt(
  receipt: unknown, orderId: string
): "marked_failed" | "ignored" | "invalid";
