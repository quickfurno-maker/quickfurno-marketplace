/**
 * QuickFurno Distribution Control — assignment execution contracts (Phase 3B).
 *
 * Phase 3B executes ONLY the exact approved standard-route vendor subset through
 * the existing credit-safe assignment boundary, then derives canonical assignment
 * truth. It never reruns matching, never reranks, never appends replacement
 * vendors, and never performs credit math in the AOS layer.
 */

/** Input to the assignment boundary: the approved vendor subset ONLY. */
export interface AssignApprovedVendorsInput {
  leadId: string;
  approvedVendorIds: string[];
}

/** A single vendor the authoritative assignment boundary reports as assigned. */
export interface AssignedVendorRecord {
  vendorId: string;
  assignmentId: string;
}

/**
 * The normalized *success* shape returned by the assignment port. `status` is the
 * authoritative RPC status (`ok` | `already_assigned` | `no_eligible_vendors` |
 * `skipped_duplicate` | …). Infrastructure / schema-not-ready failures must be
 * thrown by the port (fail loudly), never returned here.
 */
export interface LeadAssignmentExecutionResult {
  status: string;
  leadId: string;
  assigned: AssignedVendorRecord[];
}

/**
 * The standard-route assignment execution port. The real adapter wraps the
 * existing `assignLeadToMatchedVendors` (canonical authority `qf_assign_lead_vendors_v2`)
 * and reuses its credit / package / assignment-insert / lead-lock logic verbatim.
 */
export interface LeadDistributionAssignmentPort {
  assignApprovedVendors(input: AssignApprovedVendorsInput): Promise<LeadAssignmentExecutionResult>;
}

/**
 * A raw `public.lead_assignments` truth row read back AFTER the credit-affecting
 * boundary commits. `id` is the assignment id, `vendorId` the vendor. Fields are
 * loosely typed so a strict validator (not the DB adapter) fails loudly on any
 * malformed row rather than silently discarding it.
 */
export interface AssignmentTruthRow {
  id: string | null;
  vendorId: string | null;
}

/**
 * Read-only authoritative assignment-truth port. Reads the committed
 * `lead_assignments` rows for a lead — the lifecycle assignment truth — after the
 * assignment boundary returns. No mutation. DB row order is NOT lifecycle
 * authoritative (the canonical mapper reorders by approved order).
 */
export interface LeadDistributionAssignmentTruthPort {
  readAssignmentsForLead(leadId: string): Promise<AssignmentTruthRow[]>;
}

/**
 * Canonical, deterministic assignment outcome derived from the authoritative
 * result + the immutable approved snapshot. `completed` distributes 1..3 approved
 * vendors; `manual_review` is a safe deterministic escape (zero assignable,
 * outside-approval-scope, or route changed).
 */
export type LeadDistributionAssignmentOutcome =
  | {
      kind: "completed";
      /** approved-order intersection of approved and actually-assigned vendors */
      distributedVendorIds: string[];
      /** approved-order complement (approved minus distributed) */
      skippedVendorIds: string[];
    }
  | {
      kind: "manual_review";
      reason: string;
    };

/** Deterministic manual-review reasons emitted by Phase 3B. */
export const DistributionAssignmentManualReviewReason = {
  ZERO_ASSIGNABLE: "approved_vendors_no_longer_assignable",
  OUTSIDE_SCOPE: "assignment_outside_approval_scope",
  EXISTING_OUTSIDE_SCOPE: "existing_assignment_outside_approval_scope",
  ROUTE_CHANGED: "distribution_route_changed_after_approval",
} as const;
