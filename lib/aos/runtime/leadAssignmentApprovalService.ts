// ============================================================================
// QuickFurno AOS — Phase 13: Lead Assignment Approval Workflow (Preview Only)
//
// Server-only service for the Superadmin lead -> vendor assignment APPROVAL
// PREVIEW. Two responsibilities:
//   1. getLeadAssignmentPreview(leadId): read the lead + suggested vendors with
//      admin-only match context (city/locality, category match, paid status,
//      credits, match reason).
//   2. createLeadAssignmentApprovalPreview(input): validate (max 3), write a
//      PREVIEW approval record, emit the safe `lead.assignment_approved` AOS
//      event through the two-lock gate, and persist the emit outcome.
//
// SAFETY CONTRACT:
//   - SERVER ONLY. Uses the Supabase service-role client; never reaches the
//     browser. The service-role key is never returned to any caller.
//   - PREVIEW ONLY. This NEVER assigns leads (public.assign_lead_to_vendors and
//     lead_assignments are untouched), NEVER notifies vendors, NEVER sends
//     WhatsApp, and NEVER deducts credits.
//   - Hard cap of 3 vendors, enforced here AND by a DB CHECK constraint.
//   - The only database write is the preview approval record itself.
// ============================================================================
import { adminClient } from "@/lib/supabase";
import { maskPhoneNumber } from "@/lib/aos/tools/whatsappTool";
import { evaluateVendorEligibility } from "@/lib/vendors/vendorEligibility";
import {
  ASSIGNMENT_APPROVAL_AGENTS,
  emitLeadAssignmentApprovedEvent,
  type LeadAssignmentApprovedEmitResult,
} from "@/lib/aos/events/emitLeadAssignmentApprovedEvent";
import type { AosRuntimeMode } from "@/lib/aos/runtime/aosRuntimeSettings";

export const MAX_APPROVAL_VENDORS = 3;

export interface AssignmentApprovalSideEffects {
  whatsappSent: false;
  vendorNotified: false;
  creditsDeducted: false;
  leadAutoAssigned: false;
  n8nWebhookCalled: boolean;
  /** The ONLY write performed: the preview approval record. */
  databaseWritten: "preview_approval_record_only";
}

export interface AssignmentPreviewLead {
  id: string;
  name: string | null;
  maskedPhone: string | null;
  city: string | null;
  area: string | null;
  category: string | null;
  budget: string | null;
  propertyType: string | null;
  timeline: string | null;
  status: string | null;
  message: string | null;
  currentAssignmentCount: number;
  assignmentStatusLabel: string;
}

export interface AssignmentPreviewVendor {
  id: string;
  businessName: string;
  city: string | null;
  areasCovered: string[];
  coversFullCity: boolean;
  serviceCategories: string[];
  categoryMatch: boolean;
  localityMatch: boolean;
  paidStatus: string | null;
  priority: boolean;
  remainingCredits: number;
  totalCredits: number;
  rating: number;
  completedProjects: number;
  matchReason: string;
  /** Phase 13B: shared eligibility (same helper as the Vendors admin page). */
  eligible: boolean;
  eligibilityReasons: string[];
  packageStatus: string;
}

export interface LeadAssignmentPreview {
  lead: AssignmentPreviewLead;
  suggestedVendors: AssignmentPreviewVendor[];
  maxSelectableVendors: number;
  agents: string[];
}

export type LeadAssignmentPreviewResult =
  | { ok: true; preview: LeadAssignmentPreview }
  | { ok: false; error: string; code: "LEAD_NOT_FOUND" | "PREVIEW_FAILED" };

export interface CreateAssignmentApprovalInput {
  leadId: string;
  selectedVendorIds: string[];
  approvalNote?: string | null;
  approvedBy: string;
}

export interface AssignmentApprovalSuccess {
  ok: true;
  status: "preview_approved" | "preview_sent_to_aos";
  assignmentApprovalId: string;
  selectedVendorCount: number;
  aosEventEmitted: boolean;
  n8nWebhookCalled: boolean;
  mockMode: boolean;
  runtimeAutomationEnabled: boolean;
  runtimeAutomationMode: AosRuntimeMode;
  sideEffects: AssignmentApprovalSideEffects;
  reason: string;
  message: string;
}

export interface AssignmentApprovalFailure {
  ok: false;
  error: string;
  code: "VALIDATION" | "MAX_VENDORS_EXCEEDED" | "LEAD_NOT_FOUND" | "SAVE_FAILED";
}

export type CreateAssignmentApprovalResult = AssignmentApprovalSuccess | AssignmentApprovalFailure;

// ----------------------------------------------------------------------------
// PREVIEW: lead details + suggested vendors (admin match context)
// ----------------------------------------------------------------------------
export async function getLeadAssignmentPreview(leadId: string): Promise<LeadAssignmentPreviewResult> {
  const id = (leadId ?? "").trim();
  if (!id) return { ok: false, error: "A leadId is required.", code: "LEAD_NOT_FOUND" };

  try {
    const db = adminClient();

    const { data: leadRow, error: leadErr } = await db
      .from("leads")
      .select("id, name, phone, city, area, service_required, budget, property_type, timeline, status, message")
      .eq("id", id)
      .maybeSingle();

    if (leadErr || !leadRow) {
      return { ok: false, error: "Lead not found.", code: "LEAD_NOT_FOUND" };
    }

    const lead = leadRow as Record<string, unknown>;
    const leadCity = asText(lead.city);
    const leadArea = asText(lead.area);
    const leadCategory = asText(lead.service_required);

    const currentAssignmentCount = await countLeadAssignments(id);

    const previewLead: AssignmentPreviewLead = {
      id: asText(lead.id) ?? id,
      name: asText(lead.name),
      maskedPhone: lead.phone ? maskPhoneNumber(String(lead.phone)) : null,
      city: leadCity,
      area: leadArea,
      category: leadCategory,
      budget: asText(lead.budget),
      propertyType: asText(lead.property_type),
      timeline: asText(lead.timeline),
      status: asText(lead.status),
      message: asText(lead.message),
      currentAssignmentCount,
      assignmentStatusLabel:
        currentAssignmentCount > 0 ? `${currentAssignmentCount} vendor(s) already assigned` : "Not assigned",
    };

    const suggestedVendors = await loadSuggestedVendors(leadCity, leadArea, leadCategory);

    return {
      ok: true,
      preview: {
        lead: previewLead,
        suggestedVendors,
        maxSelectableVendors: MAX_APPROVAL_VENDORS,
        agents: [...ASSIGNMENT_APPROVAL_AGENTS],
      },
    };
  } catch {
    return { ok: false, error: "Could not build the assignment preview.", code: "PREVIEW_FAILED" };
  }
}

async function loadSuggestedVendors(
  city: string | null,
  area: string | null,
  category: string | null,
): Promise<AssignmentPreviewVendor[]> {
  if (!city) return [];

  try {
    const db = adminClient();
    // Fetch approved vendors in the lead's city. Eligibility (active, package,
    // credits, category match) is computed via the SHARED helper so this list
    // agrees with the Vendors admin page exactly.
    const { data, error } = await db
      .from("vendors")
      .select(
        "id, business_name, city, areas_covered, covers_full_city, service_categories, paid_status, package_status, package_name, status, remaining_credits, total_credits, rating, completed_projects, is_active, public_visibility",
      )
      .eq("city", city)
      .eq("status", "Approved")
      .limit(50);
    if (error || !Array.isArray(data)) return [];

    const vendors = data
      .map((row) => mapVendor(row as Record<string, unknown>, city, area, category))
      .filter((vendor): vendor is AssignmentPreviewVendor => vendor !== null)
      // Only show vendors whose service category matches the lead.
      .filter((vendor) => vendor.categoryMatch);

    // Order: eligible first, then locality match, then paid/priority, then
    // rating, then remaining credits. Purely a display ordering; no assignment.
    return vendors.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (a.localityMatch !== b.localityMatch) return a.localityMatch ? -1 : 1;
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      if (b.rating !== a.rating) return b.rating - a.rating;
      return b.remainingCredits - a.remainingCredits;
    });
  } catch {
    return [];
  }
}

function mapVendor(
  row: Record<string, unknown>,
  leadCity: string | null,
  leadArea: string | null,
  leadCategory: string | null,
): AssignmentPreviewVendor | null {
  const id = asText(row.id);
  const businessName = asText(row.business_name);
  if (!id || !businessName) return null;

  const areasCovered = asStringArray(row.areas_covered);
  const serviceCategories = asStringArray(row.service_categories);
  const coversFullCity = row.covers_full_city === true;
  const paidStatus = asText(row.paid_status);
  const priority = isPaid(paidStatus);

  // Shared eligibility helper — identical logic to the Vendors admin page.
  const eligibility = evaluateVendorEligibility(row, { leadCity, leadCategory });
  const categoryMatch = eligibility.categoryMatch;
  const localityMatch = coversFullCity || (leadArea ? areasCovered.includes(leadArea) : false);

  return {
    id,
    businessName,
    city: asText(row.city),
    areasCovered,
    coversFullCity,
    serviceCategories,
    categoryMatch,
    localityMatch,
    paidStatus,
    priority,
    remainingCredits: asNumber(row.remaining_credits),
    totalCredits: asNumber(row.total_credits),
    rating: asNumber(row.rating),
    completedProjects: asNumber(row.completed_projects),
    eligible: eligibility.eligible,
    eligibilityReasons: eligibility.reasons,
    packageStatus: eligibility.packageStatus,
    matchReason: buildMatchReason({
      eligible: eligibility.eligible,
      reasons: eligibility.reasons,
      localityMatch,
      coversFullCity,
      priority,
      packageStatus: eligibility.packageStatus,
      leadCategory,
      leadArea,
    }),
  };
}

function buildMatchReason(input: {
  eligible: boolean;
  reasons: string[];
  localityMatch: boolean;
  coversFullCity: boolean;
  priority: boolean;
  packageStatus: string;
  leadCategory: string | null;
  leadArea: string | null;
}): string {
  if (!input.eligible) {
    return `Matches category but not yet eligible: ${input.reasons.join(", ")}.`;
  }
  const parts: string[] = ["Approved, active, with an active package and remaining credits"];
  if (input.leadCategory) parts.push(`matches category "${input.leadCategory}"`);
  if (input.coversFullCity) parts.push("covers the full city");
  else if (input.localityMatch && input.leadArea) parts.push(`covers locality "${input.leadArea}"`);
  if (input.priority) parts.push("paid / priority vendor");
  return parts.join("; ") + ".";
}

// ----------------------------------------------------------------------------
// APPROVAL: validate, write preview record, emit safe AOS event
// ----------------------------------------------------------------------------
export async function createLeadAssignmentApprovalPreview(
  input: CreateAssignmentApprovalInput,
): Promise<CreateAssignmentApprovalResult> {
  const leadId = (input.leadId ?? "").trim();
  if (!leadId) return { ok: false, error: "A leadId is required.", code: "VALIDATION" };

  const selectedVendorIds = dedupeNonEmpty(input.selectedVendorIds);
  if (selectedVendorIds.length === 0) {
    return { ok: false, error: "Select at least one vendor to approve.", code: "VALIDATION" };
  }
  if (selectedVendorIds.length > MAX_APPROVAL_VENDORS) {
    return {
      ok: false,
      error: `You can select at most ${MAX_APPROVAL_VENDORS} vendors for one lead.`,
      code: "MAX_VENDORS_EXCEEDED",
    };
  }

  const approvedBy = (input.approvedBy ?? "").trim() || "Superadmin";
  const approvalNote = typeof input.approvalNote === "string" ? input.approvalNote.trim() || null : null;
  const selectedVendorCount = selectedVendorIds.length;

  try {
    const db = adminClient();

    // Confirm the lead exists and capture a readable snapshot for the ledger.
    const { data: leadRow } = await db
      .from("leads")
      .select("id, name, city, area, service_required, budget")
      .eq("id", leadId)
      .maybeSingle();
    if (!leadRow) {
      return { ok: false, error: "Lead not found.", code: "LEAD_NOT_FOUND" };
    }

    const leadSnapshot = buildLeadSnapshot(leadRow as Record<string, unknown>);
    const vendorSnapshot = await buildVendorSnapshot(selectedVendorIds);

    // 1) Save the PREVIEW approval record first (marked preview/draft).
    const initialSideEffects = buildSideEffects(false);
    const baseRecord = {
      lead_id: leadId,
      selected_vendor_ids: selectedVendorIds,
      selected_vendor_count: selectedVendorCount,
      status: "preview_approved",
      mode: "preview",
      approval_note: approvalNote,
      approved_by: approvedBy,
      aos_event_emitted: false,
      n8n_webhook_called: false,
      side_effects: initialSideEffects,
      updated_at: new Date().toISOString(),
    };
    // Phase 14 ledger snapshot columns (migration 019). If they are not present
    // yet, fall back to the base record so Phase 13 approval never breaks.
    const ledgerRecord = {
      ...baseRecord,
      lead_snapshot: leadSnapshot,
      vendor_snapshot: vendorSnapshot,
      approval_source: "admin_preview",
    };

    const insertRow = (payload: Record<string, unknown>) =>
      db.from("lead_assignment_approvals").insert(payload).select("id").single();

    let { data: inserted, error: insertErr } = await insertRow(ledgerRecord);
    if (insertErr && isMissingColumnError(insertErr)) {
      ({ data: inserted, error: insertErr } = await insertRow(baseRecord));
    }

    if (insertErr || !inserted?.id) {
      return {
        ok: false,
        error: "Could not save the assignment approval preview. Ensure migration 017 has been applied.",
        code: "SAVE_FAILED",
      };
    }

    const assignmentApprovalId = String(inserted.id);

    // 2) Emit the safe AOS event through the existing two-lock gate.
    const emit = await emitLeadAssignmentApprovedEvent({
      leadId,
      selectedVendorIds,
      selectedVendorCount,
      approvedBy,
      approvalMode: "preview",
      assignmentApprovalId,
    });

    // 3) Persist the emit outcome on the preview record (best-effort).
    const finalStatus: AssignmentApprovalSuccess["status"] = emit.n8nWebhookCalled
      ? "preview_sent_to_aos"
      : "preview_approved";
    const finalSideEffects = buildSideEffects(emit.n8nWebhookCalled);

    // Core update — only columns guaranteed by migration 017.
    await db
      .from("lead_assignment_approvals")
      .update({
        status: finalStatus,
        aos_event_emitted: emit.ok,
        n8n_webhook_called: emit.n8nWebhookCalled,
        side_effects: finalSideEffects,
        updated_at: new Date().toISOString(),
      })
      .eq("id", assignmentApprovalId);

    // Best-effort: store the safe AOS emit summary on the ledger (migration 019).
    // No secrets are included. Failure here never affects the approval result.
    try {
      await db
        .from("lead_assignment_approvals")
        .update({
          event_response: {
            status: emit.status,
            workflowName: emit.workflowName,
            n8nWebhookCalled: emit.n8nWebhookCalled,
            mockMode: emit.mockMode,
            runtimeAutomationEnabled: emit.runtimeAutomationEnabled,
            runtimeAutomationMode: emit.runtimeAutomationMode,
            reason: emit.reason,
            message: emit.message,
          },
        })
        .eq("id", assignmentApprovalId);
    } catch {
      /* event_response column not present yet — safe to ignore. */
    }

    return {
      ok: true,
      status: finalStatus,
      assignmentApprovalId,
      selectedVendorCount,
      aosEventEmitted: emit.ok,
      n8nWebhookCalled: emit.n8nWebhookCalled,
      mockMode: emit.mockMode,
      runtimeAutomationEnabled: emit.runtimeAutomationEnabled,
      runtimeAutomationMode: emit.runtimeAutomationMode,
      sideEffects: finalSideEffects,
      reason: emit.reason,
      message: emit.message,
    };
  } catch {
    return {
      ok: false,
      error: "Could not save the assignment approval preview.",
      code: "SAVE_FAILED",
    };
  }
}

function buildSideEffects(n8nWebhookCalled: boolean): AssignmentApprovalSideEffects {
  return {
    whatsappSent: false,
    vendorNotified: false,
    creditsDeducted: false,
    leadAutoAssigned: false,
    n8nWebhookCalled,
    databaseWritten: "preview_approval_record_only",
  };
}

/** Phase 14: readable lead snapshot saved on the approval ledger record. */
function buildLeadSnapshot(row: Record<string, unknown>): Record<string, unknown> {
  return {
    name: asText(row.name),
    city: asText(row.city),
    area: asText(row.area),
    category: asText(row.service_required),
    budget: asText(row.budget),
  };
}

/**
 * Phase 14: readable snapshot of the selected vendors (name/city/package/credits
 * at approval time), preserving selection order. Falls back gracefully if the
 * Phase 13B package_status column is not present yet.
 */
async function buildVendorSnapshot(vendorIds: string[]): Promise<Array<Record<string, unknown>>> {
  if (vendorIds.length === 0) return [];

  const minimal = () =>
    vendorIds.map((id) => ({ id, businessName: null, city: null, packageStatus: "none", credits: 0, paidStatus: null }));

  try {
    const db = adminClient();
    const fullColumns = "id, business_name, city, package_status, remaining_credits, paid_status";
    const baseColumns = "id, business_name, city, remaining_credits, paid_status";

    const primary = await db.from("vendors").select(fullColumns).in("id", vendorIds);
    let rowsData: unknown = primary.data;
    let queryError = primary.error;
    if (queryError && isMissingColumnError(queryError)) {
      const fallback = await db.from("vendors").select(baseColumns).in("id", vendorIds);
      rowsData = fallback.data;
      queryError = fallback.error;
    }
    if (queryError || !Array.isArray(rowsData)) return minimal();

    const rows = rowsData as Array<Record<string, unknown>>;
    return vendorIds.map((id) => {
      const row = rows.find((candidate) => String(candidate.id) === id);
      if (!row) return { id, businessName: null, city: null, packageStatus: "none", credits: 0, paidStatus: null };
      const pkg = typeof row.package_status === "string" && row.package_status.trim() ? row.package_status.trim().toLowerCase() : "none";
      return {
        id,
        businessName: asText(row.business_name),
        city: asText(row.city),
        packageStatus: pkg,
        credits: asNumber(row.remaining_credits),
        paidStatus: asText(row.paid_status),
      };
    });
  } catch {
    return minimal();
  }
}

/** Postgres/PostgREST "column does not exist" — migration not applied yet. */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || (message.includes("column") && message.includes("does not exist"));
}

async function countLeadAssignments(leadId: string): Promise<number> {
  try {
    const { count, error } = await adminClient()
      .from("lead_assignments")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId);
    if (error || typeof count !== "number") return 0;
    return count;
  } catch {
    return 0;
  }
}

function isPaid(paidStatus: string | null): boolean {
  if (!paidStatus) return false;
  const normalized = paidStatus.trim().toLowerCase();
  return normalized === "paid" || normalized === "priority" || normalized === "premium";
}

function dedupeNonEmpty(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((s) => s.trim());
}
