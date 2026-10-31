import type {RazorpayProviderEventEnvelope} from "./vendorPackageProviderEventLedger.mjs";
export const REFUND_REVIEW_DECISIONS: readonly ["escalated_for_policy_decision", "evidence_matched_for_human_authorization"];
export type RefundIntakeReviewResult =
  | Readonly<{ ok: true; reason: "REFUND_REVIEW_RECORDED"; decision: string; reviewableCredits: number | null; creditMutation: false; refundAllowed: false }>
  | Readonly<{ ok: false; reason: string; retrySafe: boolean; creditMutation: false; refundAllowed: false }>;
export function createRefundIntakeReviewer(
  callRpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error?: unknown }>,
): {
  review(input: {
    envelope: RazorpayProviderEventEnvelope;
    reviewerId: string;
    decision: string;
    vendorId?: string;
    creditLedger?: unknown;
    refundEvidence?: unknown;
  }): Promise<RefundIntakeReviewResult>;
};
