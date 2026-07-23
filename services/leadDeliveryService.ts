// ============================================================================
// QuickFurno - services/leadDeliveryService.ts
// Dashboard delivery and preview/log creation for auto-matched leads.
// No live WhatsApp sends are performed here.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, fail, ok, type Result } from "../lib/errors";
import {
  executeCanonicalAssignment,
  MAX_CANONICAL_CANDIDATE_POOL,
  type CanonicalAssignmentOutcome,
} from "./canonicalAssignmentAuthority";

export type DeliveredVendor = {
  vendor_id: string;
  assignment_id: string;
  credits_before?: number | null;
  credits_after?: number | null;
};

export type LeadAssignmentDeliveryResult = {
  /** Canonical authority status: applied | partial | rejected | already_applied | unauthorized. */
  status: string;
  lead_id: string;
  assigned: DeliveredVendor[];
  skipped: string[];
  assigned_count: number;
  /** Whole-operation reason, or the first per-vendor skip reason on a rejection. */
  reason_code: string | null;
  /** `assignment_operations.id` — the audit anchor for this operation. */
  operation_id: string | null;
  /** True when the authority replayed an already-committed operation. */
  already_applied: boolean;
};

type LeadPreviewRow = {
  id: string;
  name: string | null;
  phone: string | null;
  city: string | null;
  area: string | null;
  service_required: string | null;
  budget: string | null;
  timeline: string | null;
};

type VendorPreviewRow = {
  id: string;
  business_name: string | null;
  city: string | null;
  service_categories: string[] | null;
  rating: number | null;
  completed_projects: number | null;
};

// Phase 4: the matcher passes a bounded RANKED candidate POOL (not just 3) so the
// authority can fill until 3 SUCCESSFUL assignments. This is a sanity bound only —
// the authority remains the one that caps SUCCESSFUL assignments at max-3. Must
// agree with MAX_ASSIGNMENT_CANDIDATE_POOL in services/leadMatchingEngine.ts.
const MAX_ASSIGNMENT_CANDIDATE_POOL = MAX_CANONICAL_CANDIDATE_POOL;

/**
 * Deterministic operation scope for the automatic auto-match of a lead.
 * One logical automatic operation per lead: a retry with the same ranked pool
 * REPLAYS through the authority instead of assigning again.
 */
const AUTO_MATCH_OPERATION_SCOPE = "auto_match";

/**
 * QF-MVP-20.3R1 — automatic auto-match assignment.
 *
 * Migrated from the legacy `assign_lead_to_paid_vendors_phase26a` RPC to the sole
 * canonical authority `qf_assign_lead_vendors_v2` (mode `automatic`, actor
 * `system`). There is deliberately NO fallback to the legacy RPC and no direct
 * credit mutation: if the authority rejects or is unavailable, this fails closed.
 */
export async function assignLeadToMatchedVendors(leadId: string, vendorIds: string[]): Promise<Result<LeadAssignmentDeliveryResult>> {
  try {
    if (!leadId || vendorIds.length > MAX_ASSIGNMENT_CANDIDATE_POOL) throw appError("VALIDATION");

    const outcome = await executeCanonicalAssignment({
      leadId,
      mode: "automatic",
      candidateVendorIds: vendorIds,
      operationScope: AUTO_MATCH_OPERATION_SCOPE,
      actorKind: "system",
      actorId: null,
      reasonCode: "automatic_match",
    });
    if (!outcome.ok) return outcome;

    return ok(toDeliveryResult(outcome.data));
  } catch (e) {
    return fail(e);
  }
}

/**
 * Project the canonical outcome onto this service's delivery shape.
 *
 * `credits_before` / `credits_after` are intentionally absent: the canonical
 * authority never returns wallet balances, and this service must not read or
 * infer them. Only the wallet ledger is the debit authority.
 */
function toDeliveryResult(outcome: CanonicalAssignmentOutcome): LeadAssignmentDeliveryResult {
  return {
    status: outcome.status,
    lead_id: outcome.lead_id,
    assigned: outcome.assigned.map((row) => ({ vendor_id: row.vendor_id, assignment_id: row.assignment_id })),
    skipped: outcome.skipped.map((row) => row.vendor_id),
    assigned_count: outcome.assigned.length,
    reason_code: outcome.reason_code,
    operation_id: outcome.operation_id,
    already_applied: outcome.already_applied,
  };
}

export async function deliverLeadToVendorDashboard(
  leadId: string,
  vendorId: string,
  assignmentId: string,
  opts: { assignmentSource?: string } = {},
): Promise<Result<null>> {
  try {
    const { error } = await adminClient().from("lead_delivery_logs").insert({
      lead_id: leadId,
      vendor_id: vendorId,
      assignment_id: assignmentId,
      delivery_channel: "vendor_dashboard",
      delivery_status: "delivered",
      contact_shared: true,
      credit_deducted: true,
      whatsapp_status: "preview_only",
      ...(opts.assignmentSource ? { assignment_source: opts.assignmentSource } : {}),
    });
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function createVendorLeadWhatsappPreview(
  leadId: string,
  vendorId: string,
  assignmentId: string,
  opts: { assignmentSource?: string } = {},
): Promise<Result<null>> {
  try {
    const [leadResult, vendorResult] = await Promise.all([
      adminClient()
        .from("leads")
        .select("id, name, phone, city, area, service_required, budget, timeline")
        .eq("id", leadId)
        .maybeSingle(),
      adminClient().from("vendors").select("id, business_name").eq("id", vendorId).maybeSingle(),
    ]);
    if (leadResult.error) throw leadResult.error;
    if (vendorResult.error) throw vendorResult.error;
    if (!leadResult.data) throw appError("LEAD_NOT_FOUND");

    const lead = leadResult.data as LeadPreviewRow;
    const vendorName = String((vendorResult.data as { business_name?: string | null } | null)?.business_name ?? "vendor");
    const message = [
      `Preview only: New QuickFurno lead for ${vendorName}.`,
      `${lead.name ?? "Client"} needs ${lead.service_required ?? "a service"} in ${[lead.area, lead.city].filter(Boolean).join(", ") || "their city"}.`,
      `Phone: ${lead.phone ?? "available in dashboard"}.`,
      "No live WhatsApp was sent. Open /vendor/dashboard/leads to respond.",
    ].join(" ");

    const { error } = await adminClient().from("lead_delivery_logs").insert({
      lead_id: leadId,
      vendor_id: vendorId,
      assignment_id: assignmentId,
      delivery_channel: "whatsapp_preview",
      delivery_status: "preview_created",
      contact_shared: true,
      credit_deducted: false,
      whatsapp_preview_message: message,
      whatsapp_status: "preview_only",
      ...(opts.assignmentSource ? { assignment_source: opts.assignmentSource } : {}),
    });
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function createClientAssignedVendorsPreview(
  leadId: string,
  deliveredVendors: DeliveredVendor[],
): Promise<Result<null>> {
  try {
    const vendorIds = deliveredVendors.map((vendor) => vendor.vendor_id).filter(Boolean);
    let vendorSnapshot: VendorPreviewRow[] = [];

    if (vendorIds.length > 0) {
      const { data, error } = await adminClient()
        .from("vendors")
        .select("id, business_name, city, service_categories, rating, completed_projects")
        .in("id", vendorIds);
      if (error) throw error;
      vendorSnapshot = (data ?? []) as VendorPreviewRow[];
    }

    const message = vendorSnapshot.length > 0
      ? `Preview only: ${vendorSnapshot.length} verified QuickFurno vendor${vendorSnapshot.length === 1 ? "" : "s"} assigned to this enquiry. No live WhatsApp was sent.`
      : "Preview only: Your enquiry is received. QuickFurno is waiting for eligible verified vendors before sharing your contact details.";

    const { error } = await adminClient().from("client_notification_logs").insert({
      lead_id: leadId,
      notification_type: vendorSnapshot.length > 0 ? "assigned_vendors_preview" : "waiting_for_vendors_preview",
      channel: "dashboard_preview",
      status: "preview_created",
      message,
      vendor_snapshot: vendorSnapshot,
      whatsapp_status: "preview_only",
    });
    if (error) throw error;
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}
