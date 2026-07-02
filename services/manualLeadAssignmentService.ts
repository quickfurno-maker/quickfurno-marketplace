// ============================================================================
// QuickFurno — services/manualLeadAssignmentService.ts
// Phase 26A-2B: admin manual lead-assignment fallback.
//
// This is a FALLBACK for when auto matching fails, queues, or the admin wants
// to override. It REUSES the existing safe assignment path — it does not invent
// new credit logic:
//   - Assignment + credit deduction go through leadService.assignLeadToVendors,
//     which calls the existing assign_lead_to_vendors RPC (atomic, guards
//     against double-assign / double-deduct, deducts exactly one credit each).
//   - After a successful assignment it writes the SAME audit/preview logs the
//     auto path writes (leadDeliveryService), plus a manual_assigned matching
//     run and a vendor notification. All logging is best-effort and never
//     blocks or reverses the assignment.
// WhatsApp remains preview/log only. No live sends here.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { fail, ok, type Result } from "../lib/errors";
import { MAX_VENDORS_PER_LEAD } from "../lib/config";
import { assignLeadToVendors } from "./leadService";
import {
  createClientAssignedVendorsPreview,
  createVendorLeadWhatsappPreview,
  deliverLeadToVendorDashboard,
  type DeliveredVendor,
} from "./leadDeliveryService";
import { createVendorNotification } from "./vendorNotificationService";
import { evaluateVendorLeadAssignmentEligibility } from "../lib/vendors/vendorEligibility";

export type ManualLeadSummary = {
  id: string;
  name: string | null;
  phone: string | null;
  city: string | null;
  area: string | null;
  service_required: string | null;
  category: string | null;
  subcategory: string | null;
  budget: string | null;
  timeline: string | null;
  status: string | null;
  is_duplicate: boolean | null;
};

export type ManualCandidateVendor = {
  id: string;
  business_name: string | null;
  city: string | null;
  service_categories: string[];
  areas_covered: string[];
  covers_full_city: boolean;
  status: string | null;
  paid_status: string | null;
  package_status: string | null;
  remaining_credits: number;
  visibility_type: string;
  eligible: boolean;
  already_assigned: boolean;
  reasons: string[];
};

export type ManualAssignmentPreview = {
  lead: ManualLeadSummary | null;
  existing_assignment_count: number;
  auto_matching_status: string | null;
  max_vendors: number;
  candidates: ManualCandidateVendor[];
};

export type ManualAssignmentResult = {
  status: string;
  lead_id: string;
  selected_vendor_ids: string[];
  assigned_vendor_ids: string[];
  skipped_vendor_ids: string[];
  assigned_count: number;
  delivered_count: number;
  preview_logs_created: boolean;
  log_warnings: string[];
};

const VENDOR_PAGE_SIZE = 500;
const MAX_VENDOR_SCAN = 5000;

/** Lead detail + candidate vendor list (eligible first, ineligible with reasons). */
export async function getManualAssignmentPreview(leadId: string): Promise<Result<ManualAssignmentPreview>> {
  try {
    if (!leadId?.trim()) return fail(new Error("VALIDATION"));
    const db = adminClient();

    const { data: leadRow, error: leadError } = await db
      .from("leads")
      .select("id, name, phone, city, area, service_required, category, subcategory, budget, timeline, status, is_duplicate")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) throw leadError;
    const lead = (leadRow as ManualLeadSummary | null) ?? null;

    const [assignmentRows, latestRun, vendorRows] = await Promise.all([
      db.from("lead_assignments").select("vendor_id").eq("lead_id", leadId),
      // Best-effort: matching run status is optional context.
      db.from("lead_matching_runs").select("run_status").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1),
      loadVendors(),
    ]);

    const assignedVendorIds = new Set(
      (assignmentRows.data ?? []).map((row: { vendor_id?: string | null }) => String(row.vendor_id ?? "")).filter(Boolean),
    );
    const autoMatchingStatus = assignmentRows.error
      ? null
      : (latestRun.error ? null : (latestRun.data?.[0]?.run_status ?? null));

    const leadForEligibility = (lead ?? {}) as Record<string, unknown>;
    const candidates: ManualCandidateVendor[] = vendorRows.map((vendor) => {
      const eligibility = evaluateVendorLeadAssignmentEligibility(vendor, leadForEligibility, {
        allow_trial_vendors_for_assignment: true,
      });
      const alreadyAssigned = assignedVendorIds.has(String(vendor.id));
      const reasons = eligibility.reasons.slice();
      if (alreadyAssigned) reasons.push("already_assigned");
      return {
        id: String(vendor.id),
        business_name: asText(vendor.business_name),
        city: asText(vendor.city),
        service_categories: toStringArray(vendor.service_categories),
        areas_covered: toStringArray(vendor.areas_covered),
        covers_full_city: vendor.covers_full_city === true,
        status: asText(vendor.status),
        paid_status: asText(vendor.paid_status),
        package_status: asText((vendor as Record<string, unknown>).package_status),
        remaining_credits: eligibility.credits,
        visibility_type: eligibility.visibilityType ?? "free",
        eligible: eligibility.eligible && !alreadyAssigned,
        already_assigned: alreadyAssigned,
        reasons,
      };
    });

    candidates.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (b.remaining_credits !== a.remaining_credits) return b.remaining_credits - a.remaining_credits;
      return (a.business_name ?? a.id).localeCompare(b.business_name ?? b.id);
    });

    return ok({
      lead,
      existing_assignment_count: assignedVendorIds.size,
      auto_matching_status: autoMatchingStatus,
      max_vendors: MAX_VENDORS_PER_LEAD,
      candidates,
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Manually assign a lead to admin-selected vendors via the existing safe RPC,
 * then write audit + preview logs. Credit deduction is entirely the RPC's job.
 */
export async function assignLeadManually(
  leadId: string,
  vendorIds: string[],
  adminId: string,
): Promise<Result<ManualAssignmentResult>> {
  const selected = dedupe(vendorIds);
  try {
    if (!leadId?.trim() || selected.length === 0) return fail(new Error("VALIDATION"));
    if (selected.length > MAX_VENDORS_PER_LEAD) return fail(new Error("MAX_VENDORS_EXCEEDED"));

    // Reuse the existing safe assignment path (assign_lead_to_vendors RPC).
    const assignment = await assignLeadToVendors(leadId, selected, {
      allowDuplicate: false,
      assignmentType: "admin_assigned",
    });
    if (!assignment.ok) {
      await recordManualRun(leadId, adminId, {
        run_status: "manual_failed",
        selected_vendor_ids: selected,
        assigned_vendor_ids: [],
        failure_reason: assignment.code,
      });
      return { ok: false, code: assignment.code, error: assignment.error };
    }

    const assignedVendorIds = dedupe(assignment.data.assigned ?? []);
    const skippedVendorIds = dedupe(assignment.data.skipped ?? []);

    // Map assigned vendor ids -> their assignment ids for delivery logging.
    const delivered = await resolveDeliveredVendors(leadId, assignedVendorIds);

    const logWarnings: string[] = [];
    let deliveredCount = 0;
    for (const vendor of delivered) {
      const dash = await deliverLeadToVendorDashboard(leadId, vendor.vendor_id, vendor.assignment_id);
      if (dash.ok) deliveredCount += 1; else logWarnings.push(`delivery_log:${dash.code}`);

      const preview = await createVendorLeadWhatsappPreview(leadId, vendor.vendor_id, vendor.assignment_id);
      if (!preview.ok) logWarnings.push(`vendor_preview:${preview.code}`);

      const notify = await createVendorNotification(vendor.vendor_id, {
        title: "New lead assigned",
        message: "An admin manually assigned a new client lead to you. Open your dashboard to view the client details.",
        type: "lead_assigned",
        priority: "high",
        cta_label: "View lead",
        cta_url: "/vendor/dashboard/leads",
      });
      if (!notify.ok) logWarnings.push(`vendor_notification:${notify.code}`);
    }

    const clientPreview = await createClientAssignedVendorsPreview(leadId, delivered);
    if (!clientPreview.ok) logWarnings.push(`client_preview:${clientPreview.code}`);

    await recordManualRun(leadId, adminId, {
      run_status: "manual_assigned",
      selected_vendor_ids: selected,
      assigned_vendor_ids: assignedVendorIds,
      failure_reason: null,
      extra_snapshot: { skipped: skippedVendorIds, delivered_count: deliveredCount, log_warnings: logWarnings },
    });

    return ok({
      status: assignment.data.status ?? "ok",
      lead_id: leadId,
      selected_vendor_ids: selected,
      assigned_vendor_ids: assignedVendorIds,
      skipped_vendor_ids: skippedVendorIds,
      assigned_count: assignment.data.assigned_count ?? assignedVendorIds.length,
      delivered_count: deliveredCount,
      preview_logs_created: clientPreview.ok,
      log_warnings: logWarnings,
    });
  } catch (e) {
    await recordManualRun(leadId, adminId, {
      run_status: "manual_failed",
      selected_vendor_ids: selected,
      assigned_vendor_ids: [],
      failure_reason: e instanceof Error ? e.message : "unknown_error",
    });
    return fail(e);
  }
}

async function loadVendors(): Promise<Array<Record<string, unknown>>> {
  const db = adminClient();
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; from < MAX_VENDOR_SCAN; from += VENDOR_PAGE_SIZE) {
    const { data, error } = await db
      .from("vendors")
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + VENDOR_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < VENDOR_PAGE_SIZE) break;
  }
  return rows;
}

async function resolveDeliveredVendors(leadId: string, vendorIds: string[]): Promise<DeliveredVendor[]> {
  if (vendorIds.length === 0) return [];
  const { data, error } = await adminClient()
    .from("lead_assignments")
    .select("id, vendor_id")
    .eq("lead_id", leadId)
    .in("vendor_id", vendorIds);
  if (error || !data) {
    console.warn("[manual assign] could not resolve assignment ids for delivery logs", { message: error?.message });
    return [];
  }
  const byVendor = new Map<string, string>();
  for (const row of data as Array<{ id?: string; vendor_id?: string }>) {
    if (row.vendor_id && row.id) byVendor.set(String(row.vendor_id), String(row.id));
  }
  return vendorIds.flatMap((vendorId) => {
    const assignmentId = byVendor.get(vendorId);
    return assignmentId ? [{ vendor_id: vendorId, assignment_id: assignmentId }] : [];
  });
}

async function recordManualRun(
  leadId: string,
  adminId: string,
  input: {
    run_status: string;
    selected_vendor_ids: string[];
    assigned_vendor_ids: string[];
    failure_reason: string | null;
    extra_snapshot?: Record<string, unknown>;
  },
) {
  try {
    await adminClient().from("lead_matching_runs").insert({
      lead_id: leadId,
      run_status: input.run_status,
      consent_confirmed: true,
      max_vendors: MAX_VENDORS_PER_LEAD,
      eligible_vendor_count: input.assigned_vendor_ids.length,
      selected_vendor_ids: input.selected_vendor_ids,
      assigned_vendor_ids: input.assigned_vendor_ids,
      failure_reason: input.failure_reason,
      matching_snapshot: {
        mode: "manual",
        assigned_by: adminId,
        selected: input.selected_vendor_ids,
        assigned: input.assigned_vendor_ids,
        ...(input.extra_snapshot ?? {}),
      },
    });
  } catch (error) {
    console.warn("[manual assign] matching run log skipped", { message: error instanceof Error ? error.message : "Unknown error" });
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}
