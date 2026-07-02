// ============================================================================
// QuickFurno — services/manualLeadAssignmentService.ts
// Phase 26A-2B/2C: admin manual lead-assignment fallback, primary top-up,
// interior fallback, and recovery assignment.
//
// Assignment counts are computed from DISTINCT lead_assignments.vendor_id — not
// from lead/run status. Modes:
//   primary  (total < 3)  → top up remaining primary slots (max 3 total)
//   recovery (3 ≤ total < 9) → recovery assign extra vendors (max 9 total)
//   max      (total ≥ 9)  → locked
//
// Credit logic is never reimplemented here: assignment + deduction run through
// admin_smart_assign_lead_to_vendors, which reuses the existing atomic
// deduct_vendor_credit / restore_vendor_credit primitives, relaxes only soft
// category/area matching (city + approved + active + package + credits stay
// HARD), and clamps the total to 9. Auto matching is untouched (max 3).
// WhatsApp stays preview/log only. No live sends.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { fail, ok, type Result } from "../lib/errors";
import { NORMAL_PRIMARY_VENDOR_LIMIT, ADMIN_MANUAL_TOTAL_VENDOR_LIMIT, MANUAL_INTERIOR_FALLBACK_ENABLED } from "../lib/config";
import {
  createClientAssignedVendorsPreview,
  createVendorLeadWhatsappPreview,
  deliverLeadToVendorDashboard,
  type DeliveredVendor,
} from "./leadDeliveryService";
import { createVendorNotification } from "./vendorNotificationService";
import { evaluateVendorLeadAssignmentEligibility } from "../lib/vendors/vendorEligibility";
import {
  isExactLeadVendorSubcategoryMatch,
  isInteriorFallbackCompatible,
  isInteriorParentCategory,
} from "../lib/vendors/categoryMatching";

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
  share_consent: boolean | null;
};

export type LeadAssignmentState =
  | "unassigned"
  | "needs_top_up"
  | "primary_full"
  | "recovery_active"
  | "max_manual_assignment_reached";

export type LeadAssignmentCounts = {
  total: number;
  primary: number;
  recovery: number;
  pending_primary_slots: number;
  recovery_used: number;
  recovery_slots_remaining: number;
  state: LeadAssignmentState;
};

export type ManualAssignmentMode = "primary" | "recovery" | "max";
export type ManualMatchType = "best_match" | "interior_fallback" | "recovery_eligible" | "not_eligible";

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
  already_assigned: boolean;
  match_type: ManualMatchType;
  match_score: number;
  match_reason: string;
  assignable: boolean;
  hard_block_reasons: string[];
  soft_block_reasons: string[];
};

export type ManualAssignmentPreview = {
  lead: ManualLeadSummary | null;
  auto_matching_status: string | null;
  counts: LeadAssignmentCounts;
  mode: ManualAssignmentMode;
  max_selectable: number;
  consent_ok: boolean;
  fallback_enabled: boolean;
  exact_match_count: number;
  primary_limit: number;
  total_limit: number;
  candidates: ManualCandidateVendor[];
};

export type ManualAssignmentResult = {
  status: string;
  lead_id: string;
  assignment_source: string;
  mode: ManualAssignmentMode;
  fallback_used: boolean;
  recovery_used: boolean;
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

const HARD_REASONS = new Set([
  "vendor_pending_approval",
  "vendor_suspended",
  "vendor_inactive",
  "free_unpaid_vendor_not_eligible_for_assignment",
  "package_expired",
  "no_credits",
  "city_mismatch",
  "already_assigned",
]);

/** Distinct assigned vendor count + derived slot/state model for a lead. */
export async function getLeadAssignmentCounts(leadId: string): Promise<Result<LeadAssignmentCounts>> {
  try {
    const { data, error } = await adminClient().from("lead_assignments").select("vendor_id").eq("lead_id", leadId);
    if (error) throw error;
    const distinct = new Set((data ?? []).map((row: { vendor_id?: string | null }) => String(row.vendor_id ?? "")).filter(Boolean));
    return ok(deriveCounts(distinct.size));
  } catch (e) {
    return fail(e);
  }
}

function deriveCounts(total: number): LeadAssignmentCounts {
  const primary = Math.min(total, NORMAL_PRIMARY_VENDOR_LIMIT);
  const recovery = Math.max(total - NORMAL_PRIMARY_VENDOR_LIMIT, 0);
  const pendingPrimary = NORMAL_PRIMARY_VENDOR_LIMIT - primary;
  const recoverySlotsRemaining = Math.max(ADMIN_MANUAL_TOTAL_VENDOR_LIMIT - total, 0);
  let state: LeadAssignmentState;
  if (total <= 0) state = "unassigned";
  else if (total < NORMAL_PRIMARY_VENDOR_LIMIT) state = "needs_top_up";
  else if (total === NORMAL_PRIMARY_VENDOR_LIMIT) state = "primary_full";
  else if (total < ADMIN_MANUAL_TOTAL_VENDOR_LIMIT) state = "recovery_active";
  else state = "max_manual_assignment_reached";
  return {
    total,
    primary,
    recovery,
    pending_primary_slots: pendingPrimary,
    recovery_used: recovery,
    recovery_slots_remaining: recoverySlotsRemaining,
    state,
  };
}

function modeForTotal(total: number): ManualAssignmentMode {
  if (total >= ADMIN_MANUAL_TOTAL_VENDOR_LIMIT) return "max";
  if (total >= NORMAL_PRIMARY_VENDOR_LIMIT) return "recovery";
  return "primary";
}

function maxSelectableFor(mode: ManualAssignmentMode, counts: LeadAssignmentCounts): number {
  if (mode === "max") return 0;
  if (mode === "recovery") return counts.recovery_slots_remaining;
  return counts.pending_primary_slots;
}

/** Lead detail + counts/mode + grouped candidate vendor list. */
export async function getManualAssignmentPreview(leadId: string): Promise<Result<ManualAssignmentPreview>> {
  try {
    if (!leadId?.trim()) return fail(new Error("VALIDATION"));
    const db = adminClient();

    const { data: leadRow, error: leadError } = await db
      .from("leads")
      .select("id, name, phone, city, area, service_required, category, subcategory, budget, timeline, status, is_duplicate, share_consent")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) throw leadError;
    const lead = (leadRow as ManualLeadSummary | null) ?? null;

    const [assignmentRows, latestRun, vendorRows] = await Promise.all([
      db.from("lead_assignments").select("vendor_id").eq("lead_id", leadId),
      db.from("lead_matching_runs").select("run_status").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1),
      loadVendors(),
    ]);

    const assignedVendorIds = new Set(
      (assignmentRows.data ?? []).map((row: { vendor_id?: string | null }) => String(row.vendor_id ?? "")).filter(Boolean),
    );
    const autoMatchingStatus = assignmentRows.error ? null : (latestRun.error ? null : (latestRun.data?.[0]?.run_status ?? null));

    const counts = deriveCounts(assignedVendorIds.size);
    const mode = modeForTotal(counts.total);
    const consentOk = lead?.share_consent === true;

    const candidates = vendorRows.map((vendor) => classifyCandidate(vendor, lead, assignedVendorIds, mode));
    // Exact-match availability (mode-independent) drives the admin fallback note.
    const leadForMatch = (lead ?? {}) as Record<string, unknown>;
    const exactMatchCount = vendorRows.filter((vendor) => {
      const id = String(vendor.id);
      if (assignedVendorIds.has(id)) return false;
      const eligible = evaluateVendorLeadAssignmentEligibility(vendor, leadForMatch, { allow_trial_vendors_for_assignment: true });
      if (eligible.reasons.some((r) => HARD_REASONS.has(r))) return false;
      return isExactLeadVendorSubcategoryMatch(leadForMatch, vendor);
    }).length;

    candidates.sort((a, b) => {
      if (a.assignable !== b.assignable) return a.assignable ? -1 : 1;
      if (b.match_score !== a.match_score) return b.match_score - a.match_score;
      if (b.remaining_credits !== a.remaining_credits) return b.remaining_credits - a.remaining_credits;
      return (a.business_name ?? a.id).localeCompare(b.business_name ?? b.id);
    });

    return ok({
      lead,
      auto_matching_status: autoMatchingStatus,
      counts,
      mode,
      max_selectable: maxSelectableFor(mode, counts),
      consent_ok: consentOk,
      fallback_enabled: MANUAL_INTERIOR_FALLBACK_ENABLED,
      exact_match_count: exactMatchCount,
      primary_limit: NORMAL_PRIMARY_VENDOR_LIMIT,
      total_limit: ADMIN_MANUAL_TOTAL_VENDOR_LIMIT,
      candidates,
    });
  } catch (e) {
    return fail(e);
  }
}

/** Manually assign selected vendors (top-up / fallback / recovery), then log. */
export async function assignLeadManually(
  leadId: string,
  vendorIds: string[],
  adminId: string,
): Promise<Result<ManualAssignmentResult>> {
  const selected = dedupe(vendorIds);
  let mode: ManualAssignmentMode = "primary";
  let assignmentSource = "manual_primary_assignment";
  let fallbackUsed = false;
  let recoveryUsed = false;
  try {
    if (!leadId?.trim() || selected.length === 0) return fail(new Error("VALIDATION"));

    const db = adminClient();
    const { data: leadRow, error: leadError } = await db
      .from("leads")
      .select("id, city, area, service_required, category, subcategory, is_duplicate, share_consent")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) throw leadError;
    const lead = (leadRow as ManualLeadSummary | null) ?? null;
    if (!lead) return { ok: false, code: "LEAD_NOT_FOUND", error: "Lead not found." };
    if (lead.share_consent !== true) {
      return { ok: false, code: "CONSENT_REQUIRED", error: "Client consent is required before assigning vendors to this lead." };
    }

    const { data: assignmentRows, error: assignError } = await db.from("lead_assignments").select("vendor_id").eq("lead_id", leadId);
    if (assignError) throw assignError;
    const assignedVendorIds = new Set((assignmentRows ?? []).map((row: { vendor_id?: string | null }) => String(row.vendor_id ?? "")).filter(Boolean));
    const counts = deriveCounts(assignedVendorIds.size);
    mode = modeForTotal(counts.total);

    if (mode === "max") {
      return { ok: false, code: "MAX_MANUAL_REACHED", error: "Maximum manual assignment limit reached for this lead." };
    }
    const slots = maxSelectableFor(mode, counts);
    if (selected.length > slots) {
      return { ok: false, code: "MAX_VENDORS_EXCEEDED", error: `You can assign at most ${slots} more vendor(s) to this lead right now.` };
    }
    recoveryUsed = mode === "recovery";

    // Re-validate every selected vendor server-side (never trust the frontend).
    const { data: vendorRows, error: vendorError } = await db.from("vendors").select("*").in("id", selected);
    if (vendorError) throw vendorError;
    const vendorById = new Map((vendorRows ?? []).map((row: Record<string, unknown>) => [String(row.id), row]));
    for (const vendorId of selected) {
      const vendor = vendorById.get(vendorId);
      if (!vendor) return { ok: false, code: "VALIDATION", error: `Selected vendor ${vendorId} was not found.` };
      const candidate = classifyCandidate(vendor, lead, assignedVendorIds, mode);
      if (!candidate.assignable) {
        const blocker = candidate.hard_block_reasons[0] ?? "category not compatible";
        return { ok: false, code: "VALIDATION", error: `${candidate.business_name ?? vendorId} cannot be assigned: ${reasonLabel(blocker)}.` };
      }
      if (candidate.match_type === "interior_fallback") fallbackUsed = true;
      if (mode !== "recovery" && !isExactLeadVendorSubcategoryMatch(lead as Record<string, unknown>, vendor)) fallbackUsed = true;
    }

    assignmentSource = mode === "recovery"
      ? "manual_recovery_assignment"
      : fallbackUsed
        ? "manual_interior_fallback"
        : counts.total > 0
          ? "manual_primary_top_up"
          : "manual_primary_assignment";

    const totalLimit = mode === "recovery" ? ADMIN_MANUAL_TOTAL_VENDOR_LIMIT : NORMAL_PRIMARY_VENDOR_LIMIT;
    const assignment = await callSmartAssignRpc(leadId, selected, totalLimit);
    if (!assignment.ok) {
      await recordManualRun(leadId, adminId, {
        run_status: `${assignmentSource}_failed`,
        assignment_source: assignmentSource,
        counts_before: counts,
        assigned_vendor_ids: [],
        selected_vendor_ids: selected,
        fallback_used: fallbackUsed,
        recovery_used: recoveryUsed,
        lead,
        failure_reason: assignment.code,
      });
      return { ok: false, code: assignment.code, error: assignment.error };
    }

    const assignedVendorIdsOut = dedupe(assignment.data.assigned ?? []);
    const skippedVendorIds = dedupe(assignment.data.skipped ?? []);
    const delivered = await resolveDeliveredVendors(leadId, assignedVendorIdsOut);

    const logWarnings: string[] = [];
    let deliveredCount = 0;
    for (const vendor of delivered) {
      const dash = await deliverLeadToVendorDashboard(leadId, vendor.vendor_id, vendor.assignment_id, { assignmentSource });
      if (dash.ok) deliveredCount += 1; else logWarnings.push(`delivery_log:${dash.code}`);
      const preview = await createVendorLeadWhatsappPreview(leadId, vendor.vendor_id, vendor.assignment_id, { assignmentSource });
      if (!preview.ok) logWarnings.push(`vendor_preview:${preview.code}`);
      const notify = await createVendorNotification(vendor.vendor_id, {
        title: recoveryUsed ? "New recovery lead assigned" : "New lead assigned",
        message: "An admin assigned a client lead to you. Open your dashboard to view the client details.",
        type: "lead_assigned",
        priority: "high",
        cta_label: "View lead",
        cta_url: "/vendor/dashboard/leads",
      });
      if (!notify.ok) logWarnings.push(`vendor_notification:${notify.code}`);
    }
    const clientPreview = await createClientAssignedVendorsPreview(leadId, delivered);
    if (!clientPreview.ok) logWarnings.push(`client_preview:${clientPreview.code}`);

    const countsAfter = deriveCounts(counts.total + assignedVendorIdsOut.length);
    await recordManualRun(leadId, adminId, {
      run_status: assignmentSource,
      assignment_source: assignmentSource,
      counts_before: counts,
      counts_after: countsAfter,
      assigned_vendor_ids: assignedVendorIdsOut,
      selected_vendor_ids: selected,
      fallback_used: fallbackUsed,
      recovery_used: recoveryUsed,
      lead,
      failure_reason: null,
      extra: { skipped: skippedVendorIds, delivered_count: deliveredCount, log_warnings: logWarnings },
    });

    return ok({
      status: assignment.data.status ?? "ok",
      lead_id: leadId,
      assignment_source: assignmentSource,
      mode,
      fallback_used: fallbackUsed,
      recovery_used: recoveryUsed,
      selected_vendor_ids: selected,
      assigned_vendor_ids: assignedVendorIdsOut,
      skipped_vendor_ids: skippedVendorIds,
      assigned_count: assignment.data.assigned_count ?? assignedVendorIdsOut.length,
      delivered_count: deliveredCount,
      preview_logs_created: clientPreview.ok,
      log_warnings: logWarnings,
    });
  } catch (e) {
    return fail(e);
  }
}

/** Classify a vendor into best_match / interior_fallback / recovery_eligible / not_eligible. */
function classifyCandidate(
  vendor: Record<string, unknown>,
  lead: ManualLeadSummary | null,
  assignedVendorIds: Set<string>,
  mode: ManualAssignmentMode,
): ManualCandidateVendor {
  const leadForEligibility = (lead ?? {}) as Record<string, unknown>;
  const eligibility = evaluateVendorLeadAssignmentEligibility(vendor, leadForEligibility, {
    allow_trial_vendors_for_assignment: true,
  });
  const id = String(vendor.id);
  const alreadyAssigned = assignedVendorIds.has(id);
  const reasons = eligibility.reasons.slice();
  if (alreadyAssigned) reasons.push("already_assigned");

  const hardBlocks = reasons.filter((reason) => HARD_REASONS.has(reason));
  const softBlocks = reasons.filter((reason) => !HARD_REASONS.has(reason));

  const exact = isExactLeadVendorSubcategoryMatch(leadForEligibility, vendor);
  const fallback = isInteriorFallbackCompatible(leadForEligibility, vendor);
  const fallbackOk = MANUAL_INTERIOR_FALLBACK_ENABLED && fallback.compatible;
  const categoryOk = exact || fallbackOk;

  let matchType: ManualMatchType;
  let matchScore: number;
  let matchReason: string;
  let assignable: boolean;

  if (hardBlocks.length > 0 || !categoryOk) {
    matchType = "not_eligible";
    matchScore = 0;
    assignable = false;
    matchReason = hardBlocks.length > 0
      ? reasonLabel(hardBlocks[0])
      : isInteriorParentCategory(vendor.service_categories) || isInteriorParentCategory(vendor.selected_category)
        ? "Interior fallback unavailable"
        : "Category outside interior group";
  } else if (mode === "recovery") {
    matchType = "recovery_eligible";
    matchScore = exact ? 55 : 50;
    assignable = true;
    matchReason = exact ? "Recovery eligible (exact category)" : "Recovery eligible (interior fallback)";
  } else if (exact) {
    matchType = "best_match";
    matchScore = 100;
    assignable = true;
    matchReason = "Exact category match";
  } else {
    matchType = "interior_fallback";
    matchScore = 60;
    assignable = true;
    matchReason = fallback.reason || "Same interior parent category (exact vendors unavailable)";
  }

  return {
    id,
    business_name: asText(vendor.business_name),
    city: asText(vendor.city),
    service_categories: toStringArray(vendor.service_categories),
    areas_covered: toStringArray(vendor.areas_covered),
    covers_full_city: vendor.covers_full_city === true,
    status: asText(vendor.status),
    paid_status: asText(vendor.paid_status),
    package_status: asText(vendor.package_status),
    remaining_credits: eligibility.credits,
    visibility_type: eligibility.visibilityType ?? "free",
    already_assigned: alreadyAssigned,
    match_type: matchType,
    match_score: matchScore,
    match_reason: matchReason,
    assignable,
    hard_block_reasons: hardBlocks,
    soft_block_reasons: softBlocks,
  };
}

type RpcAssignmentData = { status?: string; assigned?: string[]; skipped?: string[]; assigned_count?: number };

async function callSmartAssignRpc(leadId: string, vendorIds: string[], totalLimit: number): Promise<Result<RpcAssignmentData>> {
  try {
    const { data, error } = await adminClient().rpc("admin_smart_assign_lead_to_vendors", {
      p_lead_id: leadId,
      p_vendor_ids: vendorIds,
      p_allow_duplicate: false,
      p_total_limit: totalLimit,
    });
    if (error) {
      const missing = (error as { code?: string }).code === "42883" || /schema cache|could not find the function/i.test(error.message ?? "");
      if (missing) {
        return { ok: false, code: "MIGRATION_NOT_APPLIED", error: "admin_smart_assign_lead_to_vendors is missing. Apply migration 20260701000031_phase26a2c_recovery_fallback_reporting.sql." };
      }
      return { ok: false, code: error.message ?? "RPC_ERROR", error: error.message ?? "Assignment failed." };
    }
    const record = (data ?? {}) as Record<string, unknown>;
    return ok({
      status: typeof record.status === "string" ? record.status : "ok",
      assigned: Array.isArray(record.assigned) ? record.assigned.map(String) : [],
      skipped: Array.isArray(record.skipped) ? record.skipped.map(String) : [],
      assigned_count: Number(record.assigned_count ?? 0),
    });
  } catch (e) {
    return fail(e);
  }
}

async function loadVendors(): Promise<Array<Record<string, unknown>>> {
  const db = adminClient();
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; from < MAX_VENDOR_SCAN; from += VENDOR_PAGE_SIZE) {
    const { data, error } = await db.from("vendors").select("*").order("id", { ascending: true }).range(from, from + VENDOR_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < VENDOR_PAGE_SIZE) break;
  }
  return rows;
}

async function resolveDeliveredVendors(leadId: string, vendorIds: string[]): Promise<DeliveredVendor[]> {
  if (vendorIds.length === 0) return [];
  const { data, error } = await adminClient().from("lead_assignments").select("id, vendor_id").eq("lead_id", leadId).in("vendor_id", vendorIds);
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
    assignment_source: string;
    counts_before: LeadAssignmentCounts;
    counts_after?: LeadAssignmentCounts;
    assigned_vendor_ids: string[];
    selected_vendor_ids: string[];
    fallback_used: boolean;
    recovery_used: boolean;
    lead: ManualLeadSummary | null;
    failure_reason: string | null;
    extra?: Record<string, unknown>;
  },
) {
  try {
    await adminClient().from("lead_matching_runs").insert({
      lead_id: leadId,
      run_status: input.run_status,
      consent_confirmed: input.lead?.share_consent === true,
      max_vendors: ADMIN_MANUAL_TOTAL_VENDOR_LIMIT,
      eligible_vendor_count: input.assigned_vendor_ids.length,
      selected_vendor_ids: input.selected_vendor_ids,
      assigned_vendor_ids: input.assigned_vendor_ids,
      failure_reason: input.failure_reason,
      matching_snapshot: {
        mode: "manual",
        assignment_source: input.assignment_source,
        assigned_by: adminId,
        selected_by_admin: true,
        fallback_used: input.fallback_used,
        recovery_used: input.recovery_used,
        assigned_count_before: input.counts_before.total,
        assigned_count_after: input.counts_after?.total ?? input.counts_before.total,
        pending_primary_slots_before: input.counts_before.pending_primary_slots,
        pending_primary_slots_after: input.counts_after?.pending_primary_slots ?? input.counts_before.pending_primary_slots,
        recovery_slots_used: input.counts_after ? input.counts_after.recovery_used : input.counts_before.recovery_used,
        recovery_slots_remaining: input.counts_after?.recovery_slots_remaining ?? input.counts_before.recovery_slots_remaining,
        lead_subcategory: input.lead?.subcategory ?? input.lead?.service_required ?? input.lead?.category ?? null,
        ...(input.extra ?? {}),
      },
    });
  } catch (error) {
    console.warn("[manual assign] matching run log skipped", { message: error instanceof Error ? error.message : "Unknown error" });
  }
}

const REASON_LABELS: Record<string, string> = {
  vendor_pending_approval: "pending approval",
  vendor_suspended: "suspended",
  vendor_inactive: "inactive",
  free_unpaid_vendor_not_eligible_for_assignment: "free/unpaid — not eligible",
  package_expired: "package expired",
  no_credits: "no credits",
  city_mismatch: "city mismatch",
  already_assigned: "already assigned",
  category_mismatch: "category label mismatch",
  subcategory_mismatch: "subcategory mismatch",
};
function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
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
