/**
 * AOS V2 bad-lead recovery recommendation.
 *
 * Advisory only: this module reads a reason code and proposes a bounded action.
 * It has no database access and cannot restore credits, invalidate assignments,
 * approve replacement, or call MatchCore.
 */
export type AosBadLeadRecoveryRecommendation =
  | "none"
  | "restore_credit"
  | "replace"
  | "restore_credit_and_replace";

export function deriveAosBadLeadRecoveryRecommendation(
  reasonCode: string | null | undefined,
): AosBadLeadRecoveryRecommendation {
  const reason = String(reasonCode ?? "").trim().toLowerCase();
  if (["invalid_wrong_phone", "service_mismatch", "outside_service_area"].includes(reason)) {
    return "restore_credit_and_replace";
  }
  if (["requirement_already_closed", "client_not_reachable"].includes(reason)) {
    return "restore_credit";
  }
  return "none";
}
