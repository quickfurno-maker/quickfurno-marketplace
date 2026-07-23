import { adminClient } from "../../../../supabase";
import { assignLeadToMatchedVendors } from "../../../../../services/leadDeliveryService";
import { validateAssignmentTruthRows } from "./leadDistributionAssignmentValidation";
import type {
  AssignApprovedVendorsInput,
  AssignmentTruthRow,
  LeadAssignmentExecutionResult,
  LeadDistributionAssignmentPort,
  LeadDistributionAssignmentTruthPort,
} from "./leadDistributionAssignmentTypes";

/**
 * QuickFurno Distribution Control — standard-route assignment adapter (Phase 3B,
 * authoritative-truth corrected).
 *
 * The credit-affecting boundary is UNCHANGED in shape: `assignLeadToMatchedVendors`
 * remains the ONLY assignment / credit mutation this adapter can reach. Since
 * QF-MVP-20.3R1 that boundary calls the canonical authority
 * `qf_assign_lead_vendors_v2` (mode `automatic`, actor `system`) instead of the
 * legacy `assign_lead_to_paid_vendors_phase26a` RPC. After it returns successfully, lifecycle assignment truth is derived
 * from an AUTHORITATIVE read-back of committed `public.lead_assignments` rows — NOT
 * from the lossily-normalized service response (which may silently drop malformed
 * entries or substitute a fallback lead id). The service `status` is preserved only
 * for diagnostics / replay classification.
 *
 * The adapter is dependency-injectable (boundary fn + truth port) so the harness can
 * prove the real orchestration without a database; defaults are the production
 * implementations. It calls NO delivery-log / preview / WhatsApp / n8n function and
 * never reruns matching.
 */

type AssignmentBoundaryFn = typeof assignLeadToMatchedVendors;

export interface LeadDistributionAssignmentAdapterDeps {
  boundary?: AssignmentBoundaryFn;
  truthPort?: LeadDistributionAssignmentTruthPort;
}

/** Reads committed lead_assignments truth rows for a lead. Read-only. */
export class SupabaseLeadDistributionAssignmentTruthPort
  implements LeadDistributionAssignmentTruthPort
{
  async readAssignmentsForLead(leadId: string): Promise<AssignmentTruthRow[]> {
    const { data, error } = await adminClient()
      .from("lead_assignments")
      .select("id, vendor_id")
      .eq("lead_id", leadId);

    if (error) throw error;
    const rows = (data ?? []) as Array<{ id: string | null; vendor_id: string | null }>;
    return rows.map((row) => ({ id: row.id ?? null, vendorId: row.vendor_id ?? null }));
  }
}

export class SupabaseLeadDistributionAssignmentPort implements LeadDistributionAssignmentPort {
  private readonly boundary: AssignmentBoundaryFn;
  private readonly truthPort: LeadDistributionAssignmentTruthPort;

  constructor(deps: LeadDistributionAssignmentAdapterDeps = {}) {
    this.boundary = deps.boundary ?? assignLeadToMatchedVendors;
    this.truthPort = deps.truthPort ?? new SupabaseLeadDistributionAssignmentTruthPort();
  }

  async assignApprovedVendors(input: AssignApprovedVendorsInput): Promise<LeadAssignmentExecutionResult> {
    // 1. Credit-affecting boundary (unchanged). Fail loudly on any ok:false result.
    const result = await this.boundary(input.leadId, [...input.approvedVendorIds]);
    if (!result.ok) {
      throw new Error(`ASSIGNMENT_EXECUTION_FAILED:${result.code}`);
    }

    // 2. Boundary status is diagnostic only, but must be a real status.
    const status = typeof result.data.status === "string" ? result.data.status.trim() : "";
    if (!status || status === "unknown") {
      throw new Error("ASSIGNMENT_BOUNDARY_STATUS_INVALID");
    }

    // 3. Lead identity: a non-empty boundary lead id must match the expected lead.
    const boundaryLeadId = typeof result.data.lead_id === "string" ? result.data.lead_id.trim() : "";
    if (boundaryLeadId && boundaryLeadId !== input.leadId) {
      throw new Error("ASSIGNMENT_BOUNDARY_LEAD_MISMATCH");
    }

    // 4. AUTHORITATIVE truth read-back. If it throws, propagate (the assignment
    // transaction may already have committed → the task must retry). NEVER fall
    // back to result.data.assigned.
    const rows = await this.truthPort.readAssignmentsForLead(input.leadId);
    const validated = validateAssignmentTruthRows(rows);
    if (!validated.ok) {
      throw new Error(validated.message);
    }

    // 5. Lifecycle assignment truth comes from committed lead_assignments rows.
    return { status, leadId: input.leadId, assigned: validated.value };
  }
}
