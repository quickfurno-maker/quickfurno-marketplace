// ============================================================================
// QuickFurno - services/leadMatchingEngine.ts
// Consent-gated paid/trial vendor matching for dashboard delivery.
// ============================================================================
import { evaluateVendorLeadAssignmentEligibility } from "../lib/vendors/vendorEligibility";
import { adminClient } from "../lib/supabase";
import { fail, ok, type Result } from "../lib/errors";
import {
  assignLeadToMatchedVendors,
  createClientAssignedVendorsPreview,
  createVendorLeadWhatsappPreview,
  deliverLeadToVendorDashboard,
  type DeliveredVendor,
} from "./leadDeliveryService";

export type LeadForMatching = {
  id: string;
  name?: string | null;
  phone?: string | null;
  city?: string | null;
  area?: string | null;
  service_required?: string | null;
  category?: string | null;
  subcategory?: string | null;
  budget?: string | null;
  timeline?: string | null;
  message?: string | null;
  share_consent?: boolean | null;
  is_duplicate?: boolean | null;
};

export type EligibleMatchedVendor = {
  id: string;
  score: number;
  credits: number;
  packageStatus: string;
  visibilityType: string;
  business_name?: string | null;
};

export type AutoLeadMatchingResult = {
  leadId: string;
  status: "matched" | "waiting" | "skipped" | "failed";
  eligibleVendorCount: number;
  selectedVendorIds: string[];
  assignedVendors: DeliveredVendor[];
  failureReason?: string;
};

export type SkippedVendorAudit = {
  vendor_id: string;
  business_name?: string | null;
  reasons: string[];
};

export type VendorMatchEvaluation = {
  eligible: EligibleMatchedVendor[];
  skipped: SkippedVendorAudit[];
  skippedReasonCounts: Record<string, number>;
};

const MAX_VENDOR_MATCHES = 3;
const VENDOR_PAGE_SIZE = 500;
const MAX_VENDOR_SCAN = 5000;
// Audit snapshots list per-vendor skip reasons up to this cap; reason counts
// always cover every evaluated vendor.
const MAX_SKIPPED_AUDIT_ENTRIES = 40;

export async function runAutoLeadMatchingForLead(leadId: string): Promise<Result<AutoLeadMatchingResult>> {
  let runId: string | null = null;
  try {
    const db = adminClient();
    const { data: lead, error: leadError } = await db
      .from("leads")
      .select("id, name, phone, city, area, service_required, category, subcategory, budget, timeline, message, share_consent, is_duplicate")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) throw leadError;
    if (!lead) {
      return ok({
        leadId,
        status: "failed",
        eligibleVendorCount: 0,
        selectedVendorIds: [],
        assignedVendors: [],
        failureReason: "lead_not_found",
      });
    }

    const leadRow = lead as LeadForMatching;
    runId = await createMatchingRun(leadRow);

    if (!leadRow.share_consent) {
      await updateMatchingRun(runId, {
        run_status: "skipped",
        failure_reason: "missing_share_consent",
      });
      return ok({
        leadId,
        status: "skipped",
        eligibleVendorCount: 0,
        selectedVendorIds: [],
        assignedVendors: [],
        failureReason: "missing_share_consent",
      });
    }

    if (leadRow.is_duplicate) {
      await updateMatchingRun(runId, {
        run_status: "skipped",
        failure_reason: "duplicate_lead",
      });
      return ok({
        leadId,
        status: "skipped",
        eligibleVendorCount: 0,
        selectedVendorIds: [],
        assignedVendors: [],
        failureReason: "duplicate_lead",
      });
    }

    const evaluation = await evaluateVendorsForLead(leadRow);
    if (!evaluation.ok) return { ok: false, code: evaluation.code, error: evaluation.error };
    const { eligible, skipped, skippedReasonCounts } = evaluation.data;

    const selectedVendorIds = eligible.slice(0, MAX_VENDOR_MATCHES).map((vendor) => vendor.id);
    // Audit-only: who was evaluated and why they were not selected. Eligible
    // vendors beyond the cap of 3 are recorded as max_vendor_cap_reached.
    const matchAudit = {
      skipped,
      skipped_reason_counts: skippedReasonCounts,
      max_vendor_cap_reached_vendor_ids: eligible.slice(MAX_VENDOR_MATCHES).map((vendor) => vendor.id),
    };
    if (selectedVendorIds.length === 0) {
      await createClientAssignedVendorsPreview(leadId, []);
      await updateMatchingRun(runId, {
        run_status: "waiting",
        eligible_vendor_count: 0,
        selected_vendor_ids: [],
        assigned_vendor_ids: [],
        failure_reason: "no_eligible_paid_or_trial_vendors",
        matching_snapshot: { lead: summarizeLead(leadRow), selected: [], eligible: [], ...matchAudit },
      });
      return ok({
        leadId,
        status: "waiting",
        eligibleVendorCount: 0,
        selectedVendorIds: [],
        assignedVendors: [],
        failureReason: "no_eligible_paid_or_trial_vendors",
      });
    }

    const assignment = await assignLeadToMatchedVendors(leadId, selectedVendorIds);
    if (!assignment.ok) {
      await updateMatchingRun(runId, {
        run_status: "failed",
        eligible_vendor_count: eligible.length,
        selected_vendor_ids: selectedVendorIds,
        failure_reason: assignment.code,
        matching_snapshot: { lead: summarizeLead(leadRow), selected: selectedVendorIds, eligible, ...matchAudit },
      });
      return { ok: false, code: assignment.code, error: assignment.error };
    }

    const assigned = assignment.data.assigned.slice(0, MAX_VENDOR_MATCHES);
    if (assigned.length === 0) {
      await createClientAssignedVendorsPreview(leadId, []);
      await updateMatchingRun(runId, {
        run_status: "waiting",
        eligible_vendor_count: eligible.length,
        selected_vendor_ids: selectedVendorIds,
        assigned_vendor_ids: [],
        failure_reason: assignment.data.status,
        matching_snapshot: { lead: summarizeLead(leadRow), selected: selectedVendorIds, eligible, ...matchAudit, assignment: assignment.data },
      });
      return ok({
        leadId,
        status: "waiting",
        eligibleVendorCount: eligible.length,
        selectedVendorIds,
        assignedVendors: [],
        failureReason: assignment.data.status,
      });
    }

    for (const vendor of assigned) {
      await deliverLeadToVendorDashboard(leadId, vendor.vendor_id, vendor.assignment_id);
      await createVendorLeadWhatsappPreview(leadId, vendor.vendor_id, vendor.assignment_id);
    }
    await createClientAssignedVendorsPreview(leadId, assigned);

    await updateMatchingRun(runId, {
      run_status: "matched",
      eligible_vendor_count: eligible.length,
      selected_vendor_ids: selectedVendorIds,
      assigned_vendor_ids: assigned.map((vendor) => vendor.vendor_id),
      failure_reason: null,
      matching_snapshot: { lead: summarizeLead(leadRow), selected: selectedVendorIds, eligible, ...matchAudit, assignment: assignment.data },
    });

    return ok({
      leadId,
      status: "matched",
      eligibleVendorCount: eligible.length,
      selectedVendorIds,
      assignedVendors: assigned,
    });
  } catch (e) {
    await updateMatchingRun(runId, {
      run_status: "failed",
      failure_reason: e instanceof Error ? e.message : "unknown_error",
    });
    return fail(e);
  }
}

export async function getEligibleVendorsForLead(lead: LeadForMatching): Promise<Result<EligibleMatchedVendor[]>> {
  const evaluation = await evaluateVendorsForLead(lead);
  if (!evaluation.ok) return evaluation;
  return ok(evaluation.data.eligible);
}

/** Full eligible + skipped-with-reasons evaluation, used for audit snapshots. */
export async function evaluateVendorsForLead(lead: LeadForMatching): Promise<Result<VendorMatchEvaluation>> {
  try {
    // Eligibility rules read loosely-aliased columns (city/office_city, several
    // credit/package aliases), so filtering happens in JS via the shared helper.
    // Page through the full table instead of capping at one arbitrary batch.
    const rows: Array<Record<string, unknown>> = [];
    for (let from = 0; from < MAX_VENDOR_SCAN; from += VENDOR_PAGE_SIZE) {
      const { data, error } = await adminClient()
        .from("vendors")
        .select("*")
        .order("id", { ascending: true })
        .range(from, from + VENDOR_PAGE_SIZE - 1);
      if (error) throw error;

      const page = (data ?? []) as Array<Record<string, unknown>>;
      rows.push(...page);
      if (page.length < VENDOR_PAGE_SIZE) break;
      if (rows.length >= MAX_VENDOR_SCAN) {
        console.warn("[lead matching] vendor scan hit safety cap", { scanned: rows.length, cap: MAX_VENDOR_SCAN });
      }
    }

    const eligible: EligibleMatchedVendor[] = [];
    const skipped: SkippedVendorAudit[] = [];
    const skippedReasonCounts: Record<string, number> = {};

    for (const vendor of rows) {
      const id = asText(vendor.id);
      if (!id) continue;

      const eligibility = evaluateVendorLeadAssignmentEligibility(vendor, lead as Record<string, unknown>, {
        allow_trial_vendors_for_assignment: true,
      });
      const reasons = [...eligibility.reasons];
      if (eligibility.eligible && !serviceAreaMatches(vendor, lead)) reasons.push("service_area_mismatch");

      if (reasons.length > 0) {
        for (const reason of reasons) {
          skippedReasonCounts[reason] = (skippedReasonCounts[reason] ?? 0) + 1;
        }
        if (skipped.length < MAX_SKIPPED_AUDIT_ENTRIES) {
          skipped.push({ vendor_id: id, business_name: asText(vendor.business_name), reasons });
        }
        continue;
      }

      eligible.push({
        id,
        business_name: asText(vendor.business_name),
        score: scoreVendor(vendor, lead, eligibility.visibilityType),
        credits: eligibility.credits,
        packageStatus: eligibility.packageStatus,
        visibilityType: eligibility.visibilityType ?? "paid",
      });
    }

    eligible.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.credits !== a.credits) return b.credits - a.credits;
      return a.id.localeCompare(b.id);
    });

    return ok({ eligible, skipped, skippedReasonCounts });
  } catch (e) {
    return fail(e);
  }
}

export { assignLeadToMatchedVendors } from "./leadDeliveryService";

async function createMatchingRun(lead: LeadForMatching): Promise<string | null> {
  try {
    const { data, error } = await adminClient()
      .from("lead_matching_runs")
      .insert({
        lead_id: lead.id,
        run_status: "started",
        consent_confirmed: Boolean(lead.share_consent),
        max_vendors: MAX_VENDOR_MATCHES,
        matching_snapshot: { lead: summarizeLead(lead) },
      })
      .select("id")
      .single();
    if (error) throw error;
    return data?.id ? String(data.id) : null;
  } catch (error) {
    console.warn("[lead matching] run log skipped", { message: error instanceof Error ? error.message : "Unknown error" });
    return null;
  }
}

async function updateMatchingRun(runId: string | null, update: Record<string, unknown>) {
  if (!runId) return;
  try {
    await adminClient()
      .from("lead_matching_runs")
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq("id", runId);
  } catch (error) {
    console.warn("[lead matching] run update skipped", { message: error instanceof Error ? error.message : "Unknown error" });
  }
}

function summarizeLead(lead: LeadForMatching) {
  return {
    id: lead.id,
    city: lead.city ?? null,
    area: lead.area ?? null,
    category: lead.service_required ?? lead.category ?? null,
    subcategory: lead.subcategory ?? null,
    consent: Boolean(lead.share_consent),
  };
}

function serviceAreaMatches(vendor: Record<string, unknown>, lead: LeadForMatching) {
  if (vendor.covers_full_city === true) return true;
  const leadArea = normalize(lead.area);
  const areas = Array.isArray(vendor.areas_covered)
    ? vendor.areas_covered.map(normalize).filter(Boolean)
    : [];
  if (!leadArea || areas.length === 0) return true;
  return areas.includes(leadArea);
}

function scoreVendor(vendor: Record<string, unknown>, lead: LeadForMatching, visibilityType?: string) {
  const leadArea = normalize(lead.area);
  const areas = Array.isArray(vendor.areas_covered) ? vendor.areas_covered.map(normalize) : [];
  const rating = Number(vendor.rating ?? 0);
  const completedProjects = Number(vendor.completed_projects ?? 0);
  const credits = Number(vendor.remaining_credits ?? 0);
  let score = 50;
  if (visibilityType === "paid") score += 25;
  if (visibilityType === "trial") score += 12;
  if (vendor.covers_full_city === true) score += 10;
  if (leadArea && areas.includes(leadArea)) score += 14;
  if (Number.isFinite(rating)) score += Math.min(15, Math.max(0, rating * 3));
  if (Number.isFinite(completedProjects)) score += Math.min(10, completedProjects / 10);
  if (Number.isFinite(credits)) score += Math.min(8, credits);
  return Math.round(score * 100) / 100;
}

function normalize(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
