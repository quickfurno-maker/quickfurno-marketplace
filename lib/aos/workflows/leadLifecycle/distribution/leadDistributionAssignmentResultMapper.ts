import type { DistributionValidationResult } from "./leadDistributionTypes";
import {
  DistributionAssignmentManualReviewReason,
  type LeadAssignmentExecutionResult,
  type LeadDistributionAssignmentOutcome,
} from "./leadDistributionAssignmentTypes";
import { validateAssignmentExecutionResult } from "./leadDistributionAssignmentValidation";

/**
 * QuickFurno Distribution Control — canonical assignment result mapper (Phase 3B).
 *
 * Derives a deterministic outcome from the authoritative assignment result and
 * the immutable approved snapshot:
 *
 *   - structural corruption               → { ok:false } (executor fails loudly)
 *   - assigned vendor outside approved    → manual_review (outside-scope)
 *   - zero assigned                       → manual_review (no longer assignable)
 *   - 1..3 approved subset assigned       → completed (canonical distributed/skipped)
 *
 * Canonicalization is by APPROVED ORDER, so the outcome is identical for a fresh
 * assignment and an `already_assigned` replay regardless of DB row ordering.
 */
export function mapAssignmentResultToOutcome(
  raw: LeadAssignmentExecutionResult,
  snapshot: { leadId: string; approvedVendorIds: readonly string[] },
): DistributionValidationResult<LeadDistributionAssignmentOutcome> {
  const validated = validateAssignmentExecutionResult(raw, { leadId: snapshot.leadId });
  if (!validated.ok) return validated;

  const approved = snapshot.approvedVendorIds;
  const approvedSet = new Set(approved);
  const assignedSet = new Set(validated.value.assignedVendorIds);

  // Any assigned vendor outside the approved subset → deterministic manual review.
  for (const vendorId of validated.value.assignedVendorIds) {
    if (!approvedSet.has(vendorId)) {
      const reason =
        validated.value.status === "already_assigned"
          ? DistributionAssignmentManualReviewReason.EXISTING_OUTSIDE_SCOPE
          : DistributionAssignmentManualReviewReason.OUTSIDE_SCOPE;
      return { ok: true, value: { kind: "manual_review", reason } };
    }
  }

  // Zero successful assignments → no approved vendor is currently assignable.
  if (assignedSet.size === 0) {
    return {
      ok: true,
      value: { kind: "manual_review", reason: DistributionAssignmentManualReviewReason.ZERO_ASSIGNABLE },
    };
  }

  // Canonical partition, ordered by the approved snapshot.
  const distributedVendorIds = approved.filter((id) => assignedSet.has(id));
  const skippedVendorIds = approved.filter((id) => !assignedSet.has(id));

  return {
    ok: true,
    value: {
      kind: "completed",
      distributedVendorIds: [...distributedVendorIds],
      skippedVendorIds: [...skippedVendorIds],
    },
  };
}
