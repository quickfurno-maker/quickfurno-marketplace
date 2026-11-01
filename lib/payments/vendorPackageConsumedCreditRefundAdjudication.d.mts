export type ConsumedCreditAdjudicationEvidence = Readonly<{
  reviewerId: string; providerMode: "test" | "live"; orderId: string; vendorId: string;
  refundId: string; paymentId: string; providerOrderId: string;
  creditsGranted: number; creditsRemaining: number; consumedCredits: number; verifiedDebitCount: number;
  ledgerReason: string; identityVerified: true; policyApprovalPresent: false;
}>;
export type ConsumedCreditAdjudicationResult = Readonly<{
  ok: false;
  decision: "DENIED" | "POLICY_APPROVAL_MISSING";
  reason: string;
  refundAllowed: false; creditGrantAllowed: false; creditRevocationAllowed: false;
  providerCallAllowed: false; requiresHumanReview: true;
  evidence: ConsumedCreditAdjudicationEvidence | null;
}>;
export function adjudicateConsumedCreditRefundEvidence(input: {
  identityRow: unknown; macKey: string | Uint8Array;
  expected: { orderId: string; vendorId: string; providerOrderId: string; providerMode: "test" | "live"; bodySha256: string };
  requesterVendorId: string; ledger: unknown; reviewer: unknown;
  approvedRoles?: readonly string[]; now?: number;
}): ConsumedCreditAdjudicationResult;
