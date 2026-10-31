export const REFUND_INTAKE_EVENTS: readonly ["refund.created", "refund.processed", "refund.failed"];
export const REFUND_REVIEW_REQUIRED_CODE: "REFUND_REVIEW_REQUIRED";
export function isRefundIntakeEventType(type: unknown): boolean;
export type VendorRefundIntakeCandidate =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "invalid"; reason: string }>
  | Readonly<{ kind: "refund"; eventName: string; refundId: string; paymentId: string; providerOrderId: string }>;
export function classifyVendorPackageRefundIntake(event: unknown): VendorRefundIntakeCandidate;
