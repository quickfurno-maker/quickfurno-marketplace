import {
  MAX_DISTRIBUTION_VENDORS,
  type DistributionValidationResult,
} from "./leadDistributionTypes";
import type { LeadAssignmentExecutionResult } from "./leadDistributionAssignmentTypes";

/**
 * QuickFurno Distribution Control — assignment result structural validation (3B).
 *
 * Never trusts a malformed authoritative assignment result. This validates only
 * structural integrity (identity, id shapes, uniqueness, bounded count). The
 * approval-scope check and canonicalization live in the result mapper, because an
 * out-of-scope vendor is a deterministic manual-review outcome — not a crash.
 */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface ValidatedAssignmentResult {
  status: string;
  assignedVendorIds: string[];
}

export function validateAssignmentExecutionResult(
  raw: LeadAssignmentExecutionResult,
  expected: { leadId: string },
): DistributionValidationResult<ValidatedAssignmentResult> {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: "ASSIGNMENT_RESULT_REQUIRED" };
  }
  if (raw.leadId !== expected.leadId) {
    return { ok: false, message: "ASSIGNMENT_RESULT_LEAD_MISMATCH" };
  }
  if (!Array.isArray(raw.assigned)) {
    return { ok: false, message: "ASSIGNMENT_RESULT_ASSIGNED_MUST_BE_ARRAY" };
  }
  if (raw.assigned.length > MAX_DISTRIBUTION_VENDORS) {
    return { ok: false, message: "ASSIGNMENT_RESULT_COUNT_INVALID" };
  }

  const assignedVendorIds: string[] = [];
  const seenVendors = new Set<string>();
  for (const record of raw.assigned) {
    if (!record || typeof record !== "object") {
      return { ok: false, message: "ASSIGNMENT_RECORD_INVALID" };
    }
    if (!isNonEmptyString(record.vendorId)) {
      return { ok: false, message: "ASSIGNMENT_VENDOR_ID_INVALID" };
    }
    if (!isNonEmptyString(record.assignmentId)) {
      return { ok: false, message: "ASSIGNMENT_ID_INVALID" };
    }
    const vendorId = record.vendorId.trim();
    if (seenVendors.has(vendorId)) {
      return { ok: false, message: "ASSIGNMENT_VENDOR_IDS_NOT_UNIQUE" };
    }
    seenVendors.add(vendorId);
    assignedVendorIds.push(vendorId);
  }

  return {
    ok: true,
    value: { status: typeof raw.status === "string" ? raw.status : "unknown", assignedVendorIds },
  };
}
