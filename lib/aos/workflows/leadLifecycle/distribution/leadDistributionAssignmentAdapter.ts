import { assignLeadToMatchedVendors } from "../../../../../services/leadDeliveryService";
import type {
  AssignApprovedVendorsInput,
  LeadAssignmentExecutionResult,
  LeadDistributionAssignmentPort,
} from "./leadDistributionAssignmentTypes";

/**
 * QuickFurno Distribution Control — standard-route assignment adapter (Phase 3B).
 *
 * Wraps the EXISTING credit-safe assignment boundary `assignLeadToMatchedVendors`
 * (RPC `assign_lead_to_paid_vendors_phase26a`). It reuses that function's credit
 * math, package decrement, assignment insert, and lead-lock logic verbatim — the
 * AOS layer performs none of that. It calls NO delivery-log / preview / WhatsApp /
 * n8n function, and never reruns matching.
 *
 * A failed (`ok:false`) result — including MIGRATION_NOT_APPLIED, connectivity, or
 * RPC execution errors — is thrown so it fails loudly into the workflow retry /
 * dead-letter path and is NEVER reported as a successful distribution.
 */
export class SupabaseLeadDistributionAssignmentPort implements LeadDistributionAssignmentPort {
  async assignApprovedVendors(input: AssignApprovedVendorsInput): Promise<LeadAssignmentExecutionResult> {
    const result = await assignLeadToMatchedVendors(input.leadId, [...input.approvedVendorIds]);
    if (!result.ok) {
      throw new Error(`ASSIGNMENT_EXECUTION_FAILED:${result.code}`);
    }
    return {
      status: result.data.status,
      leadId: result.data.lead_id,
      assigned: result.data.assigned.map((vendor) => ({
        vendorId: vendor.vendor_id,
        assignmentId: vendor.assignment_id,
      })),
    };
  }
}
