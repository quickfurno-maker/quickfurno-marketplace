// ============================================================================
// QuickFurno — services/clientRequirementGroupService.ts
// Phase 26A-2D: per-parent-category requirement groups, client-selected vendor
// priority, and the 1-hour auto-fill foundation.
//
// A "requirement group" is one client (normalised phone) + city +
// parent_category_group inside a 3-day window. A client may connect with up to
// NORMAL_PRIMARY_VENDOR_LIMIT (3) vendors PER GROUP — Interior 3/3 is separate
// from Sofa 3/3 etc. Auto matching / auto-fill never exceed 3; only admin
// recovery may go above 3 (up to 9), and that is handled elsewhere.
//
// Credits are NEVER touched here directly. Assignment + deduction run through
// the DB RPC assign_vendor_to_requirement_group, which reuses the existing
// atomic deduct_vendor_credit / restore_vendor_credit primitives. WhatsApp
// stays preview/log only. No live sends.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { fail, ok, isMissingRelationError, type Result } from "../lib/errors";
import {
  NORMAL_PRIMARY_VENDOR_LIMIT,
  REQUIREMENT_GROUP_WINDOW_DAYS,
  CLIENT_SELECTION_WINDOW_MINUTES,
} from "../lib/config";
import {
  getParentCategoryGroup,
  vendorMatchesParentGroup,
} from "../lib/vendors/categoryMatching";
import {
  evaluateVendorLeadAssignmentEligibility,
  evaluateClientSelectedVendorEligibility,
} from "../lib/vendors/vendorEligibility";
import {
  createClientAssignedVendorsPreview,
  createVendorLeadWhatsappPreview,
  deliverLeadToVendorDashboard,
  type DeliveredVendor,
} from "./leadDeliveryService";
import { createVendorNotification } from "./vendorNotificationService";

export const MIGRATION_HINT =
  "Apply migration 20260701000032_phase26a2d_client_requirement_groups.sql on the live database.";
export const MIGRATION_HINT_2E =
  "Apply migration 20260701000033_phase26a2e_preferred_vendor_recharge_window.sql on the live database.";

// Assignment sources used across the requirement-group flow.
export const ASSIGNMENT_SOURCE = {
  clientSelected: "client_selected_vendor",
  autoFill: "auto_fill",
} as const;

export type RequirementGroupRow = {
  id: string;
  client_phone: string | null;
  client_phone_normalized: string | null;
  client_name: string | null;
  city: string | null;
  parent_category_group: string | null;
  primary_service: string | null;
  first_lead_id: string | null;
  first_enquiry_at: string | null;
  first_selection_at: string | null;
  client_selection_deadline_at: string | null;
  normal_assignment_expires_at: string | null;
  client_selected_vendor_count: number | null;
  auto_assigned_vendor_count: number | null;
  manual_assigned_vendor_count: number | null;
  primary_assigned_count: number | null;
  recovery_assigned_count: number | null;
  total_assigned_count: number | null;
  pending_primary_slots: number | null;
  auto_fill_enabled: boolean | null;
  auto_fill_status: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  // Phase 26A-2E preferred-vendor recharge window.
  preferred_vendor_id: string | null;
  preferred_vendor_name: string | null;
  preferred_vendor_status: string | null;
  preferred_vendor_status_reason: string | null;
  preferred_vendor_recharge_deadline_at: string | null;
  preferred_vendor_processed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type RequirementGroupState =
  | "waiting_for_client_selection"
  | "waiting_preferred_vendor_recharge"
  | "auto_fill_due"
  | "auto_fill_completed"
  | "auto_fill_failed"
  | "fully_assigned"
  | "admin_attention_needed"
  | "recovery_active"
  | "max_manual_assignment_reached";

export type RequirementGroupCounts = {
  total: number;
  client_selected: number;
  auto_assigned: number;
  manual_assigned: number;
  primary: number;
  recovery: number;
  pending_primary_slots: number;
  state: RequirementGroupState;
};

export type FindOrCreateGroupInput = {
  phone: string;
  city: string;
  categoryOrService: string;
  name?: string | null;
  leadId?: string | null;
};

export type RecordClientSelectedResult = {
  status: string;
  assigned: boolean;
  group_id: string;
  vendor_id: string;
  lead_id: string;
  counts: RequirementGroupCounts;
  client_selection_deadline_at: string | null;
  message: string;
  preferred_vendor_status?: string;
  preferred_vendor_not_eligible?: boolean;
  ineligible_reason?: string | null;
};

export type PreferredVendorWindowResult = {
  group_id: string;
  preferred_vendor_id: string | null;
  status: string;
  assigned: boolean;
  auto_fill: AutoFillGroupResult | null;
  message: string;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** India-first phone normalisation: keep the last 10 digits. */
export function normalizePhone(phone: unknown): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export { getParentCategoryGroup };

/** Derive counts + state for a group from its (already loaded) row + deadline. */
export function deriveGroupCounts(group: RequirementGroupRow): RequirementGroupCounts {
  const total = num(group.total_assigned_count);
  const clientSelected = num(group.client_selected_vendor_count);
  const autoAssigned = num(group.auto_assigned_vendor_count);
  const manual = Math.max(total - clientSelected - autoAssigned, 0);
  const primary = Math.min(total, NORMAL_PRIMARY_VENDOR_LIMIT);
  const recovery = Math.max(total - NORMAL_PRIMARY_VENDOR_LIMIT, 0);
  const pending = Math.max(NORMAL_PRIMARY_VENDOR_LIMIT - primary, 0);

  const now = Date.now();
  const deadline = group.client_selection_deadline_at ? Date.parse(group.client_selection_deadline_at) : null;
  const autoFillStatus = group.auto_fill_status ?? "not_started";

  let state: RequirementGroupState;
  if (total >= 9) state = "max_manual_assignment_reached";
  else if (recovery > 0) state = "recovery_active";
  else if (primary >= NORMAL_PRIMARY_VENDOR_LIMIT) state = "fully_assigned";
  else if (group.preferred_vendor_status === "waiting_for_recharge") state = "waiting_preferred_vendor_recharge";
  else if (autoFillStatus === "failed") state = "auto_fill_failed";
  else if (autoFillStatus === "completed") state = "auto_fill_completed";
  else if (group.auto_fill_enabled && deadline !== null && deadline <= now) state = "auto_fill_due";
  else if (group.auto_fill_enabled) state = "waiting_for_client_selection";
  else state = "admin_attention_needed";

  return {
    total,
    client_selected: clientSelected,
    auto_assigned: autoAssigned,
    manual_assigned: manual,
    primary,
    recovery,
    pending_primary_slots: pending,
    state,
  };
}

// ---------------------------------------------------------------------------
// Group identity
// ---------------------------------------------------------------------------

/**
 * Find the active requirement group for (phone, city, parent group) inside the
 * 3-day window, or create one. Never throws on a missing table — returns a
 * MIGRATION_NOT_APPLIED Result so callers can degrade gracefully.
 */
export async function findOrCreateRequirementGroup(
  input: FindOrCreateGroupInput,
): Promise<Result<RequirementGroupRow>> {
  try {
    const db = adminClient();
    const phoneNormalized = normalizePhone(input.phone);
    const city = (input.city ?? "").trim();
    const parentGroup = getParentCategoryGroup(input.categoryOrService);
    if (!phoneNormalized || !city || !parentGroup) return fail(new Error("VALIDATION"));

    const windowStart = new Date(Date.now() - REQUIREMENT_GROUP_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: existing, error: findError } = await db
      .from("client_requirement_groups")
      .select("*")
      .eq("client_phone_normalized", phoneNormalized)
      .eq("city", city)
      .eq("parent_category_group", parentGroup)
      .eq("status", "active")
      .gte("first_enquiry_at", windowStart)
      .order("first_enquiry_at", { ascending: false })
      .limit(1);
    if (findError) {
      if (isMissingRelationError(findError)) return migrationNotApplied();
      throw findError;
    }
    if (existing && existing.length > 0) {
      return ok(existing[0] as RequirementGroupRow);
    }

    const expiresAt = new Date(Date.now() + REQUIREMENT_GROUP_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: created, error: createError } = await db
      .from("client_requirement_groups")
      .insert({
        client_phone: String(input.phone ?? "").trim() || phoneNormalized,
        client_phone_normalized: phoneNormalized,
        client_name: input.name ?? null,
        city,
        parent_category_group: parentGroup,
        primary_service: String(input.categoryOrService ?? "").trim() || null,
        first_lead_id: input.leadId ?? null,
        normal_assignment_expires_at: expiresAt,
        auto_fill_status: "not_started",
        status: "active",
      })
      .select("*")
      .single();
    if (createError) {
      if (isMissingRelationError(createError)) return migrationNotApplied();
      throw createError;
    }
    return ok(created as RequirementGroupRow);
  } catch (e) {
    return fail(e);
  }
}

/** Reload a single group row. */
export async function getRequirementGroup(groupId: string): Promise<Result<RequirementGroupRow>> {
  try {
    const { data, error } = await adminClient()
      .from("client_requirement_groups")
      .select("*")
      .eq("id", groupId)
      .maybeSingle();
    if (error) {
      if (isMissingRelationError(error)) return migrationNotApplied();
      throw error;
    }
    if (!data) return { ok: false, code: "GROUP_NOT_FOUND", error: "Requirement group not found." };
    return ok(data as RequirementGroupRow);
  } catch (e) {
    return fail(e);
  }
}

/** Live counts for a group, computed from lead_assignments (authoritative). */
export async function getRequirementGroupAssignmentCounts(groupId: string): Promise<Result<RequirementGroupCounts>> {
  const groupResult = await getRequirementGroup(groupId);
  if (!groupResult.ok) return groupResult;
  return ok(deriveGroupCounts(groupResult.data));
}

// ---------------------------------------------------------------------------
// Eligibility (server-side re-validation — never trust the client)
// ---------------------------------------------------------------------------
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

export type CanAssignResult = {
  eligible: boolean;
  reason: string | null;
  hard_block_reasons: string[];
  parent_category_ok: boolean;
  already_in_group: boolean;
};

/** Re-validate a vendor against a group's hard gates before assigning. */
export async function canAssignVendorToRequirementGroup(
  groupId: string,
  vendorId: string,
): Promise<Result<CanAssignResult>> {
  try {
    const db = adminClient();
    const groupResult = await getRequirementGroup(groupId);
    if (!groupResult.ok) return groupResult;
    const group = groupResult.data;

    const { data: vendor, error: vendorError } = await db.from("vendors").select("*").eq("id", vendorId).maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor) return { ok: false, code: "VENDOR_NOT_FOUND", error: "Vendor not found." };

    const leadLike = {
      city: group.city,
      service_required: group.primary_service,
      category: group.parent_category_group,
    } as Record<string, unknown>;

    const eligibility = evaluateVendorLeadAssignmentEligibility(vendor as Record<string, unknown>, leadLike, {
      allow_trial_vendors_for_assignment: true,
    });
    const hardBlocks = eligibility.reasons.filter((reason) => HARD_REASONS.has(reason));
    const parentOk = vendorMatchesParentGroup(vendor as Record<string, unknown>, group.parent_category_group ?? "");

    const { data: existing, error: existingError } = await db
      .from("lead_assignments")
      .select("vendor_id")
      .eq("requirement_group_id", groupId)
      .eq("vendor_id", vendorId)
      .limit(1);
    if (existingError && !isMissingRelationError(existingError)) throw existingError;
    const alreadyInGroup = Boolean(existing && existing.length > 0);

    const eligible = hardBlocks.length === 0 && parentOk && !alreadyInGroup;
    const reason = !eligible
      ? alreadyInGroup
        ? "already_in_group"
        : hardBlocks[0] ?? (!parentOk ? "parent_category_mismatch" : null)
      : null;

    return ok({
      eligible,
      reason,
      hard_block_reasons: hardBlocks,
      parent_category_ok: parentOk,
      already_in_group: alreadyInGroup,
    });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Assignment via the credit-safe RPC + delivery/preview logs
// ---------------------------------------------------------------------------
type RpcAssignResult = { status: string; assigned: boolean; vendor_id?: string; group_id?: string; assigned_count?: number };

async function callGroupAssignRpc(
  groupId: string,
  leadId: string,
  vendorId: string,
  source: string,
  assignmentType: "client_selected" | "auto_assigned" | "admin_assigned",
): Promise<Result<RpcAssignResult>> {
  try {
    const { data, error } = await adminClient().rpc("assign_vendor_to_requirement_group", {
      p_group_id: groupId,
      p_lead_id: leadId,
      p_vendor_id: vendorId,
      p_assignment_source: source,
      p_total_limit: NORMAL_PRIMARY_VENDOR_LIMIT,
      p_assignment_type: assignmentType,
    });
    if (error) {
      const missing = (error as { code?: string }).code === "42883" || /schema cache|could not find the function/i.test(error.message ?? "");
      if (missing) return { ok: false, code: "MIGRATION_NOT_APPLIED", error: `assign_vendor_to_requirement_group is missing. ${MIGRATION_HINT}` };
      return { ok: false, code: error.message ?? "RPC_ERROR", error: error.message ?? "Assignment failed." };
    }
    const record = (data ?? {}) as Record<string, unknown>;
    return ok({
      status: typeof record.status === "string" ? record.status : "unknown",
      assigned: record.assigned === true,
      vendor_id: typeof record.vendor_id === "string" ? record.vendor_id : vendorId,
      group_id: typeof record.group_id === "string" ? record.group_id : groupId,
      assigned_count: Number(record.assigned_count ?? 0),
    });
  } catch (e) {
    return fail(e);
  }
}

/** Best-effort dashboard + WhatsApp-preview + notification logs after an assign. */
async function deliverAssignment(leadId: string, vendorId: string, source: string, notifyTitle: string): Promise<string[]> {
  const warnings: string[] = [];
  const assignmentId = await resolveAssignmentId(leadId, vendorId);
  if (assignmentId) {
    const dash = await deliverLeadToVendorDashboard(leadId, vendorId, assignmentId, { assignmentSource: source });
    if (!dash.ok) warnings.push(`delivery_log:${dash.code}`);
    const preview = await createVendorLeadWhatsappPreview(leadId, vendorId, assignmentId, { assignmentSource: source });
    if (!preview.ok) warnings.push(`vendor_preview:${preview.code}`);
  } else {
    warnings.push("delivery_log:assignment_id_unresolved");
  }
  const notify = await createVendorNotification(vendorId, {
    title: notifyTitle,
    message: "Open your dashboard to view the client details for this QuickFurno lead.",
    type: "lead_assigned",
    priority: "high",
    cta_label: "View lead",
    cta_url: "/vendor/dashboard/leads",
  });
  if (!notify.ok) warnings.push(`vendor_notification:${notify.code}`);
  return warnings;
}

// ---------------------------------------------------------------------------
// Client-selected vendor priority
// ---------------------------------------------------------------------------

/**
 * Phase 26A-2E — record a client-selected vendor. Eligibility for the SELECTED
 * vendor is credit-based (active package NOT required; remaining_credits > 0 is
 * the paid signal). If eligible → assign immediately (one credit via the safe
 * relaxed RPC) + start the 1-hour window for the remaining slots. If the vendor
 * is offline/no-credits → assign nothing, deduct nothing, share no contact, and
 * open a 1-hour preferred-vendor recharge window (admin/processor resolves it).
 */
export async function recordClientSelectedVendor(
  groupId: string,
  vendorId: string,
  leadId: string,
): Promise<Result<RecordClientSelectedResult>> {
  try {
    const db = adminClient();
    const groupResult = await getRequirementGroup(groupId);
    if (!groupResult.ok) return groupResult;
    const group = groupResult.data;

    const nowIso = new Date().toISOString();
    const deadlineIso = new Date(Date.now() + CLIENT_SELECTION_WINDOW_MINUTES * 60 * 1000).toISOString();
    const isFirstSelection = !group.first_selection_at;
    const effectiveSelectionDeadline = group.client_selection_deadline_at ?? deadlineIso;

    // Group already full (3/3) — never assign a 4th normal vendor.
    const preCounts = deriveGroupCounts(group);
    if (preCounts.primary >= NORMAL_PRIMARY_VENDOR_LIMIT) {
      return ok({
        status: "group_full",
        assigned: false,
        group_id: groupId,
        vendor_id: vendorId,
        lead_id: leadId,
        counts: preCounts,
        client_selection_deadline_at: effectiveSelectionDeadline,
        message: "You are already connected with 3 verified vendors for this requirement. Our team will help if you need more support.",
      });
    }

    // Load the selected vendor + credit-based (relaxed) eligibility.
    const { data: vendorRow, error: vendorError } = await db.from("vendors").select("*").eq("id", vendorId).maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendorRow) return { ok: false, code: "VENDOR_NOT_FOUND", error: "Vendor not found." };
    const vendor = vendorRow as Record<string, unknown>;
    const vendorName = asText(vendor.business_name);
    const elig = evaluateClientSelectedVendorEligibility(vendor);
    const parentOk = vendorMatchesParentGroup(vendor, group.parent_category_group ?? "");
    const alreadyInGroup = (await loadGroupVendorIds(groupId)).has(vendorId);

    const eligibleNow = elig.eligible && parentOk && !alreadyInGroup;

    if (eligibleNow) {
      // Immediate assignment — first selected vendor never waits 1 hour.
      if (isFirstSelection) {
        await db.from("client_requirement_groups").update({
          first_selection_at: nowIso,
          client_selection_deadline_at: deadlineIso,
          auto_fill_enabled: true,
          updated_at: nowIso,
        }).eq("id", groupId);
        await db.from("leads").update({ client_selection_deadline_at: deadlineIso }).eq("id", leadId);
      }

      const assign = await callClientSelectedAssignRpc(groupId, leadId, vendorId);
      if (!assign.ok) return assign;

      if (assign.data.assigned) {
        await db.from("leads").update({
          selected_vendor_id: vendorId,
          selected_vendor_name: vendorName,
          assignment_intent: "client_selected_vendor",
          preferred_vendor_id: vendorId,
          preferred_vendor_status: "assigned_immediately",
          preferred_vendor_status_reason: null,
        }).eq("id", leadId);
        // Only the FIRST selected vendor owns the group-level preferred slot, so
        // a later eligible pick never clobbers an earlier preferred-recharge window.
        if (isFirstSelection || !group.preferred_vendor_id) {
          await db.from("client_requirement_groups").update({
            preferred_vendor_id: vendorId,
            preferred_vendor_name: vendorName,
            preferred_vendor_status: "assigned_immediately",
            preferred_vendor_status_reason: null,
            preferred_vendor_processed_at: nowIso,
            auto_fill_status: "waiting_for_client_selection",
            updated_at: nowIso,
          }).eq("id", groupId);
        }
        await deliverAssignment(leadId, vendorId, ASSIGNMENT_SOURCE.clientSelected, "A client selected your profile");
        await createClientAssignedVendorsPreview(leadId, await loadGroupDeliveredVendors(leadId));
        // Admin audit warning when the vendor is Paid + credits but no package row.
        if (elig.packageMissingButCredits) {
          await mergeGroupMetadata(groupId, {
            package_audit_warning: {
              vendor_id: vendorId,
              vendor_name: vendorName,
              message: "Package status missing or inactive, but vendor has credits. Please audit vendor package record.",
              at: nowIso,
            },
          });
        }
      }

      const counts = await reloadCounts(groupId);
      const message = counts.pending_primary_slots > 0
        ? `Your enquiry has been sent to this vendor. You can select ${counts.pending_primary_slots} more verified vendor(s) within 1 hour, or QuickFurno will auto-connect you with suitable vendors.`
        : "You are already connected with 3 verified vendors for this requirement. Our team will help if you need more support.";

      return ok({
        status: assign.data.status,
        assigned: assign.data.assigned,
        group_id: groupId,
        vendor_id: vendorId,
        lead_id: leadId,
        counts,
        client_selection_deadline_at: effectiveSelectionDeadline,
        message,
        preferred_vendor_status: "assigned_immediately",
      });
    }

    // Offline / no-credits / inactive / suspended / not-approved (or category
    // mismatch): open a 1-hour preferred-vendor recharge window. No assignment,
    // no credit deducted, no client contact shared.
    const reasonCode = !parentOk ? "parent_category_mismatch" : (elig.reasonCode ?? "not_eligible");
    const rechargeDeadline = new Date(Date.now() + CLIENT_SELECTION_WINDOW_MINUTES * 60 * 1000).toISOString();

    await db.from("leads").update({
      selected_vendor_id: vendorId,
      selected_vendor_name: vendorName,
      assignment_intent: "client_selected_vendor",
      preferred_vendor_id: vendorId,
      preferred_vendor_status: "waiting_for_recharge",
      preferred_vendor_status_reason: reasonCode,
      client_selection_deadline_at: effectiveSelectionDeadline,
    }).eq("id", leadId);

    await db.from("client_requirement_groups").update({
      preferred_vendor_id: vendorId,
      preferred_vendor_name: vendorName,
      preferred_vendor_status: "waiting_for_recharge",
      preferred_vendor_status_reason: reasonCode,
      preferred_vendor_recharge_deadline_at: rechargeDeadline,
      first_selection_at: group.first_selection_at ?? nowIso,
      client_selection_deadline_at: effectiveSelectionDeadline,
      auto_fill_enabled: true,
      auto_fill_status: "waiting_preferred_vendor_recharge",
      updated_at: nowIso,
    }).eq("id", groupId);

    await mergeGroupMetadata(groupId, {
      preferred_vendor_offline: {
        vendor_id: vendorId,
        vendor_name: vendorName,
        reason: reasonCode,
        recharge_deadline_at: rechargeDeadline,
        at: nowIso,
      },
    });

    // Vendor notification / preview log only — never live WhatsApp, no contact.
    await createVendorNotification(vendorId, {
      title: "A client selected your profile",
      message: "A client selected your profile, but your lead access is inactive or credits are unavailable. Recharge within 1 hour to receive this enquiry.",
      type: "lead_selected_recharge",
      priority: "high",
      cta_label: "Recharge now",
      cta_url: "/vendor/dashboard/package",
    });

    const counts = await reloadCounts(groupId);
    return ok({
      status: "preferred_vendor_waiting",
      assigned: false,
      group_id: groupId,
      vendor_id: vendorId,
      lead_id: leadId,
      counts,
      client_selection_deadline_at: rechargeDeadline,
      preferred_vendor_status: "waiting_for_recharge",
      preferred_vendor_not_eligible: true,
      ineligible_reason: reasonCode,
      message: "This vendor is offline right now. Your enquiry is safe with QuickFurno. Our team will connect you with suitable verified vendors within 1 hour.",
    });
  } catch (e) {
    return fail(e);
  }
}

type RpcAssignResult2E = { status: string; assigned: boolean; assigned_count?: number };

/** Credit-based client-selected assignment RPC (active package not required). */
async function callClientSelectedAssignRpc(groupId: string, leadId: string, vendorId: string): Promise<Result<RpcAssignResult2E>> {
  try {
    const { data, error } = await adminClient().rpc("assign_client_selected_vendor_to_group", {
      p_group_id: groupId,
      p_lead_id: leadId,
      p_vendor_id: vendorId,
      p_total_limit: NORMAL_PRIMARY_VENDOR_LIMIT,
    });
    if (error) {
      const missing = (error as { code?: string }).code === "42883" || /schema cache|could not find the function/i.test(error.message ?? "");
      if (missing) return { ok: false, code: "MIGRATION_NOT_APPLIED", error: `assign_client_selected_vendor_to_group is missing. ${MIGRATION_HINT_2E}` };
      return { ok: false, code: error.message ?? "RPC_ERROR", error: error.message ?? "Assignment failed." };
    }
    const record = (data ?? {}) as Record<string, unknown>;
    return ok({
      status: typeof record.status === "string" ? record.status : "unknown",
      assigned: record.assigned === true,
      assigned_count: Number(record.assigned_count ?? 0),
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Phase 26A-2E preferred-vendor recharge processor for one group.
 *  - preferred vendor now eligible → assign it (credit-based RPC).
 *  - still ineligible + window open → do nothing.
 *  - still ineligible + window lapsed → mark expired + auto-fill other vendors.
 */
export async function processPreferredVendorWindow(groupId: string): Promise<Result<PreferredVendorWindowResult>> {
  try {
    const db = adminClient();
    const groupResult = await getRequirementGroup(groupId);
    if (!groupResult.ok) return groupResult;
    const group = groupResult.data;

    const base: PreferredVendorWindowResult = {
      group_id: groupId,
      preferred_vendor_id: group.preferred_vendor_id,
      status: "skipped",
      assigned: false,
      auto_fill: null,
      message: "",
    };

    if (!group.preferred_vendor_id || group.preferred_vendor_status !== "waiting_for_recharge") {
      return ok({ ...base, message: "No preferred vendor waiting for this group." });
    }
    const leadId = group.first_lead_id;
    if (!leadId) {
      return ok({ ...base, status: "failed", message: "No lead is linked to this group." });
    }

    const now = Date.now();
    const deadline = group.preferred_vendor_recharge_deadline_at ? Date.parse(group.preferred_vendor_recharge_deadline_at) : now;

    const { data: vendorRow } = await db.from("vendors").select("*").eq("id", group.preferred_vendor_id).maybeSingle();
    const vendor = (vendorRow as Record<string, unknown> | null) ?? null;
    const elig = vendor ? evaluateClientSelectedVendorEligibility(vendor) : null;
    const parentOk = vendor ? vendorMatchesParentGroup(vendor, group.parent_category_group ?? "") : false;
    const vendorName = asText(vendor?.business_name);

    // Recharged → assign the preferred vendor now (whether or not the window lapsed).
    if (vendor && elig?.eligible && parentOk) {
      const assign = await callClientSelectedAssignRpc(groupId, leadId, group.preferred_vendor_id);
      if (!assign.ok) return assign;
      if (assign.data.assigned) {
        const ts = new Date().toISOString();
        await db.from("client_requirement_groups").update({
          preferred_vendor_status: "assigned_after_recharge",
          preferred_vendor_processed_at: ts,
          auto_fill_status: "waiting_for_client_selection",
          updated_at: ts,
        }).eq("id", groupId);
        await db.from("leads").update({ preferred_vendor_status: "assigned_after_recharge" }).eq("id", leadId);
        await deliverAssignment(leadId, group.preferred_vendor_id, ASSIGNMENT_SOURCE.clientSelected, "A client selected your profile");
        await createClientAssignedVendorsPreview(leadId, await loadGroupDeliveredVendors(leadId));
        return ok({ ...base, status: "assigned_after_recharge", assigned: true, message: `Preferred vendor ${vendorName ?? ""} recharged and was assigned.` });
      }
      await setPreferredStatus(groupId, "not_eligible");
      return ok({ ...base, status: assign.data.status, message: `Preferred vendor could not be assigned (${assign.data.status}).` });
    }

    // Not recharged, window still open → wait.
    if (now < deadline) {
      return ok({ ...base, status: "waiting_for_recharge", message: "Recharge window still open; no action taken." });
    }

    // Window lapsed → expire the preferred vendor + auto-fill the remaining slots.
    const ts = new Date().toISOString();
    await db.from("client_requirement_groups").update({
      preferred_vendor_status: "expired",
      preferred_vendor_processed_at: ts,
      auto_fill_status: "auto_fill_due",
      updated_at: ts,
    }).eq("id", groupId);
    await db.from("leads").update({ preferred_vendor_status: "expired" }).eq("id", leadId);

    const autoFill = await processRequirementAutoFill(groupId);
    return ok({
      ...base,
      status: "expired_auto_fill_started",
      assigned: false,
      auto_fill: autoFill.ok ? autoFill.data : null,
      message: autoFill.ok ? `Preferred vendor expired. ${autoFill.data.message}` : "Preferred vendor expired; auto-fill could not run.",
    });
  } catch (e) {
    return fail(e);
  }
}

/** Process every preferred-vendor window whose recharge deadline has lapsed. */
export async function processDuePreferredVendorRechargeWindows(limit = 25): Promise<Result<{ processed: PreferredVendorWindowResult[] }>> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await adminClient()
      .from("client_requirement_groups")
      .select("id")
      .eq("status", "active")
      .eq("preferred_vendor_status", "waiting_for_recharge")
      .lte("preferred_vendor_recharge_deadline_at", nowIso)
      .order("preferred_vendor_recharge_deadline_at", { ascending: true })
      .limit(limit);
    if (error) {
      if (isMissingRelationError(error)) return migrationNotApplied();
      throw error;
    }

    const processed: PreferredVendorWindowResult[] = [];
    for (const row of (data ?? []) as Array<{ id: string }>) {
      const result = await processPreferredVendorWindow(String(row.id));
      if (result.ok) processed.push(result.data);
      else if (result.code === "MIGRATION_NOT_APPLIED") return result;
    }
    return ok({ processed });
  } catch (e) {
    return fail(e);
  }
}

/** Enable auto-fill for a group + (re)start its 1-hour window if needed. */
export async function scheduleAutoFillForRequirementGroup(groupId: string): Promise<Result<{ deadline: string | null }>> {
  try {
    const groupResult = await getRequirementGroup(groupId);
    if (!groupResult.ok) return groupResult;
    const nowIso = new Date().toISOString();
    const deadlineIso = groupResult.data.client_selection_deadline_at
      ?? new Date(Date.now() + CLIENT_SELECTION_WINDOW_MINUTES * 60 * 1000).toISOString();
    await adminClient()
      .from("client_requirement_groups")
      .update({
        auto_fill_enabled: true,
        auto_fill_status: groupResult.data.auto_fill_status === "not_started" ? "waiting_for_client_selection" : groupResult.data.auto_fill_status,
        client_selection_deadline_at: deadlineIso,
        first_selection_at: groupResult.data.first_selection_at ?? nowIso,
        updated_at: nowIso,
      })
      .eq("id", groupId);
    return ok({ deadline: deadlineIso });
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Auto-fill processor (foundation — manual trigger, no cron this phase)
// ---------------------------------------------------------------------------
export type AutoFillGroupResult = {
  group_id: string;
  parent_category_group: string | null;
  status: string;
  assigned_vendor_ids: string[];
  filled: number;
  pending_before: number;
  message: string;
};

const VENDOR_PAGE_SIZE = 500;
const MAX_VENDOR_SCAN = 5000;

/** Run auto-fill for one due group: top up pending primary slots (never > 3). */
export async function processRequirementAutoFill(groupId: string): Promise<Result<AutoFillGroupResult>> {
  try {
    const db = adminClient();
    const groupResult = await getRequirementGroup(groupId);
    if (!groupResult.ok) return groupResult;
    const group = groupResult.data;
    const counts = deriveGroupCounts(group);

    const base: AutoFillGroupResult = {
      group_id: groupId,
      parent_category_group: group.parent_category_group,
      status: "skipped",
      assigned_vendor_ids: [],
      filled: 0,
      pending_before: counts.pending_primary_slots,
      message: "",
    };

    if (group.status !== "active" || !group.auto_fill_enabled) {
      return ok({ ...base, message: "Auto-fill not enabled for this group." });
    }
    if (counts.pending_primary_slots <= 0) {
      await setAutoFillStatus(groupId, "completed");
      return ok({ ...base, status: "completed", message: "Group already has 3 primary vendors." });
    }
    const leadId = group.first_lead_id;
    if (!leadId) {
      await setAutoFillStatus(groupId, "failed");
      return ok({ ...base, status: "failed", message: "No lead is linked to this group." });
    }

    // Candidate vendors: same city + same parent group + hard-clean + not in group.
    const alreadyInGroup = await loadGroupVendorIds(groupId);
    const leadLike = {
      city: group.city,
      service_required: group.primary_service,
      category: group.parent_category_group,
    } as Record<string, unknown>;

    const candidates = (await loadVendors())
      .filter((vendor) => {
        const id = String(vendor.id);
        if (alreadyInGroup.has(id)) return false;
        if (!vendorMatchesParentGroup(vendor, group.parent_category_group ?? "")) return false;
        const eligibility = evaluateVendorLeadAssignmentEligibility(vendor, leadLike, { allow_trial_vendors_for_assignment: true });
        if (eligibility.reasons.some((r) => HARD_REASONS.has(r))) return false;
        return true;
      })
      .sort((a, b) => Number(b.remaining_credits ?? 0) - Number(a.remaining_credits ?? 0));

    const assigned: string[] = [];
    let slots = counts.pending_primary_slots;
    for (const vendor of candidates) {
      if (slots <= 0) break;
      const assign = await callGroupAssignRpc(groupId, leadId, String(vendor.id), ASSIGNMENT_SOURCE.autoFill, "auto_assigned");
      if (!assign.ok) {
        if (assign.code === "MIGRATION_NOT_APPLIED") return assign;
        continue; // transient per-vendor failure — try the next candidate
      }
      if (assign.data.assigned) {
        assigned.push(String(vendor.id));
        slots -= 1;
        await deliverAssignment(leadId, String(vendor.id), ASSIGNMENT_SOURCE.autoFill, "QuickFurno matched a new lead to you");
      } else if (assign.data.status === "group_full") {
        break;
      }
    }

    const after = await reloadCounts(groupId);
    const finalStatus = after.pending_primary_slots <= 0 ? "completed" : assigned.length > 0 ? "completed" : "failed";
    await setAutoFillStatus(groupId, finalStatus);
    if (assigned.length > 0) {
      const delivered = await loadGroupDeliveredVendors(leadId);
      await createClientAssignedVendorsPreview(leadId, delivered);
    }

    return ok({
      group_id: groupId,
      parent_category_group: group.parent_category_group,
      status: finalStatus,
      assigned_vendor_ids: assigned,
      filled: assigned.length,
      pending_before: counts.pending_primary_slots,
      message:
        assigned.length > 0
          ? `Auto-fill assigned ${assigned.length} vendor(s).`
          : "No eligible vendors were available to auto-fill this group.",
    });
  } catch (e) {
    return fail(e);
  }
}

/** Process every group whose 1-hour window has lapsed with pending slots. */
export async function processDueRequirementAutoFills(limit = 25): Promise<Result<{ processed: AutoFillGroupResult[] }>> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await adminClient()
      .from("client_requirement_groups")
      .select("id")
      .eq("status", "active")
      .eq("auto_fill_enabled", true)
      .in("auto_fill_status", ["waiting_for_client_selection", "auto_fill_due", "not_started"])
      .lte("client_selection_deadline_at", nowIso)
      .gt("pending_primary_slots", 0)
      .order("client_selection_deadline_at", { ascending: true })
      .limit(limit);
    if (error) {
      if (isMissingRelationError(error)) return migrationNotApplied();
      throw error;
    }

    const processed: AutoFillGroupResult[] = [];
    for (const row of (data ?? []) as Array<{ id: string }>) {
      const result = await processRequirementAutoFill(String(row.id));
      if (result.ok) processed.push(result.data);
      else if (result.code === "MIGRATION_NOT_APPLIED") return result;
    }
    return ok({ processed });
  } catch (e) {
    return fail(e);
  }
}

/** Admin/read: list requirement groups (most recent first) with derived counts. */
export async function listRequirementGroups(limit = 100): Promise<Result<Array<RequirementGroupRow & { derived: RequirementGroupCounts }>>> {
  try {
    const { data, error } = await adminClient()
      .from("client_requirement_groups")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      if (isMissingRelationError(error)) return ok([]);
      throw error;
    }
    const rows = (data ?? []) as RequirementGroupRow[];
    return ok(rows.map((row) => ({ ...row, derived: deriveGroupCounts(row) })));
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function migrationNotApplied(): Result<never> {
  return { ok: false, code: "MIGRATION_NOT_APPLIED", error: MIGRATION_HINT };
}

async function reloadCounts(groupId: string): Promise<RequirementGroupCounts> {
  const reloaded = await getRequirementGroup(groupId);
  return reloaded.ok ? deriveGroupCounts(reloaded.data) : emptyCounts();
}

function emptyCounts(): RequirementGroupCounts {
  return {
    total: 0,
    client_selected: 0,
    auto_assigned: 0,
    manual_assigned: 0,
    primary: 0,
    recovery: 0,
    pending_primary_slots: NORMAL_PRIMARY_VENDOR_LIMIT,
    state: "waiting_for_client_selection",
  };
}

async function setAutoFillStatus(groupId: string, status: string): Promise<void> {
  await adminClient()
    .from("client_requirement_groups")
    .update({ auto_fill_status: status, updated_at: new Date().toISOString() })
    .eq("id", groupId);
}

async function setPreferredStatus(groupId: string, status: string): Promise<void> {
  await adminClient()
    .from("client_requirement_groups")
    .update({ preferred_vendor_status: status, preferred_vendor_processed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", groupId);
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function mergeGroupMetadata(groupId: string, patch: Record<string, unknown>): Promise<void> {
  const { data } = await adminClient().from("client_requirement_groups").select("metadata").eq("id", groupId).maybeSingle();
  const current = ((data as { metadata?: Record<string, unknown> } | null)?.metadata) ?? {};
  await adminClient()
    .from("client_requirement_groups")
    .update({ metadata: { ...current, ...patch }, updated_at: new Date().toISOString() })
    .eq("id", groupId);
}

async function loadGroupVendorIds(groupId: string): Promise<Set<string>> {
  const { data, error } = await adminClient().from("lead_assignments").select("vendor_id").eq("requirement_group_id", groupId);
  if (error || !data) return new Set();
  return new Set((data as Array<{ vendor_id?: string }>).map((row) => String(row.vendor_id ?? "")).filter(Boolean));
}

async function resolveAssignmentId(leadId: string, vendorId: string): Promise<string | null> {
  const { data, error } = await adminClient()
    .from("lead_assignments")
    .select("id")
    .eq("lead_id", leadId)
    .eq("vendor_id", vendorId)
    .order("assigned_at", { ascending: false })
    .limit(1);
  if (error || !data || !data[0]) return null;
  const id = (data[0] as { id?: string }).id;
  return id ? String(id) : null;
}

async function loadGroupDeliveredVendors(leadId: string): Promise<DeliveredVendor[]> {
  const { data, error } = await adminClient().from("lead_assignments").select("id, vendor_id").eq("lead_id", leadId);
  if (error || !data) return [];
  return (data as Array<{ id?: string; vendor_id?: string }>)
    .map((row) => ({ vendor_id: String(row.vendor_id ?? ""), assignment_id: String(row.id ?? "") }))
    .filter((v) => v.vendor_id);
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
