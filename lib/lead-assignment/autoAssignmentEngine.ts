import { runSafeAgentEventPipeline } from "@/lib/aos/events/safeAgentEventPipeline";
import { ok, fail, type Result } from "@/lib/errors";
import { adminClient } from "@/lib/supabase";
import { evaluateVendorLeadAssignmentEligibility } from "@/lib/vendors/vendorEligibility";
import { queueLeadForAssignment } from "@/lib/lead-assignment/leadQueueService";
import {
  DEFAULT_MARKETPLACE_RUNTIME_SETTINGS,
  loadMarketplaceRuntimeSettings,
  type MarketplaceRuntimeSettings,
} from "@/lib/lead-assignment/runtimeSettings";

export interface AutoAssignmentPreviewOptions {
  createdBy?: string;
  source?: "admin_preview" | "queue_recheck" | "lead_created_preview";
}

export interface AutoAssignmentPreviewSuccess {
  status: "auto_suggested" | "queued";
  leadId: string;
  mode: "preview" | "auto_suggest" | "off";
  selectedVendorIds: string[];
  eligibleVendorCount: number;
  requiredVendorCount: number;
  queueReason?: string;
  rejectedVendorReasons: Record<string, string[]>;
  scoringSnapshot: Record<string, unknown>;
  logId?: string | null;
}

export type AutoAssignmentPreviewResult = Result<AutoAssignmentPreviewSuccess>;

type LeadRow = Record<string, unknown>;
type VendorRow = Record<string, unknown>;

export async function runAutoAssignmentPreviewForLead(
  leadId: string,
  options: AutoAssignmentPreviewOptions = {},
): Promise<AutoAssignmentPreviewResult> {
  try {
    const id = (leadId ?? "").trim();
    if (!id) return { ok: false, code: "VALIDATION", error: "A lead id is required." };

    const db = adminClient();
    const [leadResult, vendorsResult, settings] = await Promise.all([
      db.from("leads").select("*").eq("id", id).maybeSingle(),
      db.from("vendors").select("*").limit(250),
      loadMarketplaceRuntimeSettings(),
    ]);

    if (leadResult.error || !leadResult.data) {
      return { ok: false, code: "LEAD_NOT_FOUND", error: "Lead not found." };
    }
    if (vendorsResult.error || !Array.isArray(vendorsResult.data)) {
      throw vendorsResult.error ?? new Error("Could not load vendors.");
    }

    const lead = leadResult.data as LeadRow;
    const vendors = vendorsResult.data as VendorRow[];
    const leadSummary = summarizeLead(lead);
    const requiredVendorCount = Math.max(1, settings.minimum_paid_vendors_required_for_auto_assignment);
    const maxVendorsPerLead = Math.max(1, Math.min(3, settings.max_vendors_per_lead));
    const rejectedVendorReasons: Record<string, string[]> = {};

    const scored = vendors.flatMap((vendor) => {
      const vendorId = asText(vendor.id);
      if (!vendorId) return [];

      const eligibility = evaluateVendorLeadAssignmentEligibility(vendor, lead, settings);
      if (!eligibility.eligible) {
        rejectedVendorReasons[vendorId] = eligibility.reasons;
        return [];
      }

      const score = scoreVendorForLead(vendor, lead, eligibility.visibilityType);
      return [{
        vendorId,
        score,
        visibilityType: eligibility.visibilityType ?? "paid",
        credits: eligibility.credits,
        packageStatus: eligibility.packageStatus,
      }];
    });

    const sorted = scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.credits !== a.credits) return b.credits - a.credits;
      return a.vendorId.localeCompare(b.vendorId);
    });
    const selectedVendorIds = sorted.slice(0, maxVendorsPerLead).map((vendor) => vendor.vendorId);
    const scoringSnapshot = {
      source: options.source ?? "admin_preview",
      lead: leadSummary,
      selected: sorted.slice(0, maxVendorsPerLead),
      eligiblePool: sorted,
      safety: {
        previewOnly: true,
        finalAssignment: false,
        creditsDeducted: false,
        vendorNotified: false,
        whatsappSent: false,
      },
    };

    const mode = normalizeMode(settings.auto_assignment_mode);
    if (mode === "off") {
      const queueReason = "auto_assignment_off";
      const queue = await queueLeadForAssignment({
        leadId: id,
        city: leadSummary.city,
        category: leadSummary.category,
        subcategory: leadSummary.subcategory,
        queueReason,
        requiredVendorCount,
        eligibleVendorCount: sorted.length,
        selectedVendorIds,
        rejectedVendorReasons,
      });
      const logId = await saveAutoAssignmentLog({
        leadId: id,
        mode,
        status: "queued",
        lead: leadSummary,
        eligibleVendorCount: sorted.length,
        selectedVendorIds,
        rejectedVendorReasons,
        scoringSnapshot,
        queueReason,
        createdBy: options.createdBy,
      });
      await emitQueueEvent(id, queueReason, sorted.length, selectedVendorIds);
      if (!queue.ok) return { ok: false, code: queue.code, error: queue.error };
      return ok({
        status: "queued",
        leadId: id,
        mode,
        selectedVendorIds,
        eligibleVendorCount: sorted.length,
        requiredVendorCount,
        queueReason,
        rejectedVendorReasons,
        scoringSnapshot,
        logId,
      });
    }

    if (sorted.length >= requiredVendorCount) {
      const logId = await saveAutoAssignmentLog({
        leadId: id,
        mode,
        status: "auto_suggested",
        lead: leadSummary,
        eligibleVendorCount: sorted.length,
        selectedVendorIds,
        rejectedVendorReasons,
        scoringSnapshot,
        createdBy: options.createdBy,
      });

      return ok({
        status: "auto_suggested",
        leadId: id,
        mode,
        selectedVendorIds,
        eligibleVendorCount: sorted.length,
        requiredVendorCount,
        rejectedVendorReasons,
        scoringSnapshot,
        logId,
      });
    }

    const queueReason = sorted.length === 0 ? "no_paid_or_trial_vendors_available" : "not_enough_paid_or_trial_vendors";
    const queue = await queueLeadForAssignment({
      leadId: id,
      city: leadSummary.city,
      category: leadSummary.category,
      subcategory: leadSummary.subcategory,
      queueReason,
      requiredVendorCount,
      eligibleVendorCount: sorted.length,
      selectedVendorIds,
      rejectedVendorReasons,
    });
    const logId = await saveAutoAssignmentLog({
      leadId: id,
      mode,
      status: "queued",
      lead: leadSummary,
      eligibleVendorCount: sorted.length,
      selectedVendorIds,
      rejectedVendorReasons,
      scoringSnapshot,
      queueReason,
      createdBy: options.createdBy,
    });
    await emitQueueEvent(id, queueReason, sorted.length, selectedVendorIds);
    if (!queue.ok) return { ok: false, code: queue.code, error: queue.error };

    return ok({
      status: "queued",
      leadId: id,
      mode,
      selectedVendorIds,
      eligibleVendorCount: sorted.length,
      requiredVendorCount,
      queueReason,
      rejectedVendorReasons,
      scoringSnapshot,
      logId,
    });
  } catch (error) {
    return fail(error);
  }
}

function scoreVendorForLead(vendor: VendorRow, lead: LeadRow, visibilityType?: string): number {
  const leadArea = asText(lead.area) || asText(lead.locality);
  const areasCovered = Array.isArray(vendor.areas_covered) ? vendor.areas_covered.map(String) : [];
  const coversFullCity = vendor.covers_full_city === true;
  const rating = Number(vendor.rating ?? 0);
  const completedProjects = Number(vendor.completed_projects ?? 0);
  const credits = Number(vendor.remaining_credits ?? 0);

  let score = 50;
  if (visibilityType === "paid") score += 25;
  if (visibilityType === "trial") score += 12;
  if (coversFullCity) score += 10;
  else if (leadArea && areasCovered.some((area) => textEquals(area, leadArea))) score += 12;
  if (Number.isFinite(rating)) score += Math.min(15, Math.max(0, rating * 3));
  if (Number.isFinite(completedProjects)) score += Math.min(10, completedProjects / 10);
  if (Number.isFinite(credits)) score += Math.min(8, credits);
  return Math.round(score * 100) / 100;
}

async function saveAutoAssignmentLog(input: {
  leadId: string;
  mode: string;
  status: string;
  lead: ReturnType<typeof summarizeLead>;
  eligibleVendorCount: number;
  selectedVendorIds: string[];
  rejectedVendorReasons: Record<string, string[]>;
  scoringSnapshot: Record<string, unknown>;
  queueReason?: string;
  createdBy?: string;
}): Promise<string | null> {
  try {
    const { data, error } = await adminClient()
      .from("lead_auto_assignment_logs")
      .insert({
        lead_id: input.leadId,
        mode: input.mode,
        status: input.status,
        city: input.lead.city,
        category: input.lead.category,
        subcategory: input.lead.subcategory,
        eligible_vendor_count: input.eligibleVendorCount,
        selected_vendor_ids: input.selectedVendorIds,
        rejected_vendor_reasons: input.rejectedVendorReasons,
        scoring_snapshot: input.scoringSnapshot,
        queue_reason: input.queueReason ?? null,
        created_by: input.createdBy ?? null,
      })
      .select("id")
      .single();
    if (error) {
      console.warn("[auto assignment] log insert skipped", { message: error.message });
      return null;
    }
    return data?.id ? String(data.id) : null;
  } catch (error) {
    console.warn("[auto assignment] log insert skipped", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

async function emitQueueEvent(
  leadId: string,
  queueReason: string,
  eligibleVendorCount: number,
  selectedVendorIds: string[],
): Promise<void> {
  await runSafeAgentEventPipeline({
    eventType: "lead.assignment_queued",
    leadId,
    source: "phase-25a-auto-assignment-preview",
    data: {
      queueReason,
      eligibleVendorCount,
      selectedVendorIds,
    },
  });
}

function summarizeLead(lead: LeadRow) {
  return {
    id: asText(lead.id),
    city: asText(lead.city),
    category: asText(lead.category) || asText(lead.service_required) || asText(lead.service_category),
    subcategory: asText(lead.subcategory),
    area: asText(lead.area) || asText(lead.locality),
  };
}

function normalizeMode(value: unknown): MarketplaceRuntimeSettings["auto_assignment_mode"] {
  if (value === "off" || value === "preview" || value === "auto_suggest") return value;
  return DEFAULT_MARKETPLACE_RUNTIME_SETTINGS.auto_assignment_mode;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function textEquals(a: unknown, b: unknown): boolean {
  const left = typeof a === "string" ? a.trim().toLowerCase() : "";
  const right = typeof b === "string" ? b.trim().toLowerCase() : "";
  return left.length > 0 && left === right;
}
