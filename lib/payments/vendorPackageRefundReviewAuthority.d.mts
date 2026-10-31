import type {RefundIntakeReviewResult} from "./vendorPackageRefundIntakeReview.mjs";
export const FINANCE_REFUND_REVIEW_ROLES: readonly string[];
export type VerifiedFinanceReviewer = Readonly<{
  userId: string; staffRole: string; aal: "aal2"; expiresAtMs: number; teamId: string; cityId: string;
}>;
export function issueVerifiedFinanceReviewer(
  v: { userId: string; staffRole: string; aal: string; expiresAtMs: number; teamId: string; cityId: string },
  now?: number,
): VerifiedFinanceReviewer | null;
export function authorizeRefundReviewer(
  principal: unknown, approvedRoles?: readonly string[], now?: number,
): Readonly<{ ok: true; reviewerId: string }> | Readonly<{ ok: false; reason: string }>;
export function createFinanceRefundReviewService(o: {
  callRpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error?: unknown }>;
  approvedRoles?: readonly string[]; now?: () => number;
}): { review(principal: unknown, input: Record<string, unknown>): Promise<RefundIntakeReviewResult> };
export function projectRefundIntakePreview(rows: unknown): ReadonlyArray<Readonly<{
  eventId: string; providerMode: "test" | "live"; eventType: string; paymentId: string; providerOrderId: string;
}>> | null;
export function isProviderRefundId(v: unknown): boolean;
