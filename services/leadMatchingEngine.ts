// ============================================================================
// QuickFurno - services/leadMatchingEngine.ts
// Consent-gated paid/trial vendor matching for dashboard delivery.
//
// Phase 2: category-tier + distance-aware ranking.
//   Quality gate (external) → commercial eligibility → city hard gate →
//   category tier (0 exact/best, 1 same-parent fallback) → distance ranking →
//   soft area affinity → fill max 3 (tier 0 before tier 1) → atomic RPC.
// Distance/area are RANKING signals only — never eligibility cutoffs. Legacy
// exact-area membership is NOT a hard filter here (or in the RPC).
// ============================================================================
import { evaluateVendorContactAccessEligibility } from "../lib/vendors/vendorEligibility";
import {
  getParentCategoryGroup,
  isLeadVendorCategoryCompatible,
  vendorMatchesParentGroup,
} from "../lib/vendors/categoryMatching";
import { haversineKm, isValidCoordinate } from "../lib/geo/distance";
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
  latitude?: number | null;
  longitude?: number | null;
  share_consent?: boolean | null;
  is_duplicate?: boolean | null;
};

export type CoordinateSource = "office_coordinates" | "legacy_coordinates" | "none";

export type EligibleMatchedVendor = {
  id: string;
  score: number;
  credits: number;
  packageStatus: string;
  visibilityType: string;
  business_name?: string | null;
  // Phase 2 ranking + audit fields.
  match_tier: 0 | 1;
  match_type: string;
  distance_km: number | null;
  has_coordinates: boolean;
  coordinate_source: CoordinateSource;
  area_affinity: number;
  rank_reason: string;
  rank_position?: number;
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
// Phase 3A observability tag stamped into every matching_snapshot so read-only
// diagnostics can tell current-system runs apart from legacy/untagged ones.
// METADATA ONLY — it never affects ranking, filtering, tiers, distance, area
// affinity, selection order, max-3, or the RPC call. Must mirror
// EXPECTED_MATCHING_MODEL_VERSION in services/leadProcessingDiagnosticsCore.ts.
const MATCHING_MODEL_VERSION = "distance_category_matching_phase2";

export async function runAutoLeadMatchingForLead(leadId: string): Promise<Result<AutoLeadMatchingResult>> {
  let runId: string | null = null;
  try {
    const db = adminClient();
    const { data: lead, error: leadError } = await db
      .from("leads")
      .select("id, name, phone, city, area, service_required, category, subcategory, budget, timeline, message, latitude, longitude, share_consent, is_duplicate")
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
      // Phase 3A metadata (top-level in every snapshot via the spreads below).
      matching_model_version: MATCHING_MODEL_VERSION,
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

    // Concurrent-retry safety (Phase 3B correction): the RPC returns
    // status = "already_assigned" when this lead's assignments already exist (its
    // idempotent short-circuit / a race with another retry). Those assignments —
    // and their delivery/preview logs — were already created by the original run,
    // so DO NOT recreate delivery side effects (dashboard / whatsapp_preview /
    // client preview). Record a truthful terminal run and return the EXISTING
    // assigned vendors. Ranking, selection, max-3, the RPC, and credits are unchanged.
    if (assignment.data.status === "already_assigned") {
      await updateMatchingRun(runId, {
        run_status: "matched",
        eligible_vendor_count: eligible.length,
        selected_vendor_ids: selectedVendorIds,
        assigned_vendor_ids: assigned.map((vendor) => vendor.vendor_id),
        failure_reason: null,
        matching_snapshot: {
          lead: summarizeLead(leadRow),
          selected: selectedVendorIds,
          eligible,
          ...matchAudit,
          assignment: assignment.data,
          assignment_reused: true,
        },
      });
      return ok({
        leadId,
        status: "matched",
        eligibleVendorCount: eligible.length,
        selectedVendorIds,
        assignedVendors: assigned,
      });
    }

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

    return ok(rankVendorsForLead(lead, rows));
  } catch (e) {
    return fail(e);
  }
}

/**
 * PURE ranking: given a lead and a set of vendor rows, classify commercial
 * eligibility → city hard gate → category tier → distance/area, then rank per the
 * approved order and fill (the caller applies max-3). No I/O — deterministic and
 * unit-testable. Returns the SAME shape as evaluateVendorsForLead.
 */
export function rankVendorsForLead(
  lead: LeadForMatching,
  rows: Array<Record<string, unknown>>,
): VendorMatchEvaluation {
  const eligible: RankableCandidate[] = [];
  const skipped: SkippedVendorAudit[] = [];
  const skippedReasonCounts: Record<string, number> = {};

  // Lead-level context computed once. Distance is only computable when the LEAD
  // has coordinates; manual leads rank by tier + soft area affinity + fairness.
  const leadHasCoords = isValidCoordinate(lead.latitude, lead.longitude);
  const leadParentGroup = getParentCategoryGroup([lead.subcategory, lead.service_required, lead.category]);

  for (const vendor of rows) {
    const id = asText(vendor.id);
    if (!id) continue;

    // Commercial eligibility ONLY (status/active/paid-or-trial/credits). City and
    // category are gated below so we can distinguish Tier 0 vs Tier 1 fallback.
    const commercial = evaluateVendorContactAccessEligibility(vendor, {
      allow_trial_vendors_for_assignment: true,
    });
    const reasons = [...commercial.reasons];

    // City HARD gate — normalized text comparison (not exact-case).
    if (!cityMatches(vendor, lead)) reasons.push("city_mismatch");

    // Category tier: 0 = exact/synonym/subcategory (best), 1 = same parent group
    // fallback. Neither → not category compatible (hard reject).
    const tierResult = classifyCategoryTier(lead, vendor, leadParentGroup);
    if (tierResult === null) reasons.push("category_mismatch");

    if (reasons.length > 0) {
      for (const reason of reasons) {
        skippedReasonCounts[reason] = (skippedReasonCounts[reason] ?? 0) + 1;
      }
      if (skipped.length < MAX_SKIPPED_AUDIT_ENTRIES) {
        skipped.push({ vendor_id: id, business_name: asText(vendor.business_name), reasons });
      }
      continue;
    }

    const { tier, matchType } = tierResult!;
    const coords = resolveVendorCoordinates(vendor);
    const hasCoordinates = coords.source !== "none";
    const distanceKm = leadHasCoords && hasCoordinates
      ? haversineKm(lead.latitude, lead.longitude, coords.lat, coords.lng)
      : null;
    const areaAffinity = computeAreaAffinity(vendor, lead);

    eligible.push({
      id,
      business_name: asText(vendor.business_name),
      // Informational only (NOT used for ranking); ranking uses the comparator below.
      score: scoreVendor(vendor, lead, commercial.visibilityType),
      credits: commercial.credits,
      packageStatus: commercial.packageStatus,
      visibilityType: commercial.visibilityType ?? "paid",
      match_tier: tier,
      match_type: matchType,
      distance_km: distanceKm,
      has_coordinates: hasCoordinates,
      coordinate_source: coords.source,
      area_affinity: areaAffinity,
      rank_reason: "",
      __lastAssignedAt: asText(vendor.last_assigned_at),
      __rating: Number.isFinite(Number(vendor.rating)) ? Number(vendor.rating) : 0,
    });
  }

  // Rank: category tier first (0 before 1), then distance-aware ordering, then
  // soft area affinity, fairness (last_assigned_at asc, nulls first), rating, id.
  eligible.sort((a, b) => compareCandidates(a, b, leadHasCoords));

  // Finalize audit: rank position + human reason; strip internal sort-only fields.
  eligible.forEach((vendor, index) => {
    vendor.rank_position = index + 1;
    vendor.rank_reason = buildRankReason(vendor, leadHasCoords);
    delete (vendor as Record<string, unknown>).__lastAssignedAt;
    delete (vendor as Record<string, unknown>).__rating;
  });

  return { eligible, skipped, skippedReasonCounts };
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
        matching_snapshot: { matching_model_version: MATCHING_MODEL_VERSION, lead: summarizeLead(lead) },
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

// City HARD gate — normalized comparison across the city/office_city aliases. A
// vendor with no city cannot confirm a match, so it is rejected defensively.
function cityMatches(vendor: Record<string, unknown>, lead: LeadForMatching): boolean {
  const leadCity = normalize(lead.city);
  const vendorCity = normalize(vendor.city) || normalize(vendor.office_city);
  if (!leadCity) return true; // no lead city to gate on (never happens for real leads)
  return Boolean(vendorCity) && vendorCity === leadCity;
}

// Category tier classification (reuses the shared canonical/parent-group contract):
//   Tier 0 — exact / synonym / subcategory (isLeadVendorCategoryCompatible)
//   Tier 1 — same parent category group fallback (getParentCategoryGroup)
// Returns null when the vendor is NOT category-compatible at all.
function classifyCategoryTier(
  lead: LeadForMatching,
  vendor: Record<string, unknown>,
  leadParentGroup: string,
): { tier: 0 | 1; matchType: string } | null {
  const compat = isLeadVendorCategoryCompatible(lead as Record<string, unknown>, vendor);
  if (compat.compatible) return { tier: 0, matchType: compat.matchType };
  if (vendorMatchesParentGroup(vendor, leadParentGroup)) {
    return { tier: 1, matchType: "parent_group_fallback" };
  }
  return null;
}

// Vendor coordinate priority: office_latitude/longitude → legacy latitude/longitude.
function resolveVendorCoordinates(vendor: Record<string, unknown>): {
  lat: number | null;
  lng: number | null;
  source: CoordinateSource;
} {
  const oLat = Number(vendor.office_latitude);
  const oLng = Number(vendor.office_longitude);
  if (isValidCoordinate(oLat, oLng)) return { lat: oLat, lng: oLng, source: "office_coordinates" };
  const lLat = Number(vendor.latitude);
  const lLng = Number(vendor.longitude);
  if (isValidCoordinate(lLat, lLng)) return { lat: lLat, lng: lLng, source: "legacy_coordinates" };
  return { lat: null, lng: null, source: "none" };
}

// SOFT area affinity (ranking only, never eligibility): exact listed-area match = 1,
// covers_full_city = 0.5, otherwise 0. Legacy areas_covered is compatibility data.
function computeAreaAffinity(vendor: Record<string, unknown>, lead: LeadForMatching): number {
  const leadArea = normalize(lead.area);
  if (!leadArea) return 0;
  const areas = Array.isArray(vendor.areas_covered) ? vendor.areas_covered.map(normalize).filter(Boolean) : [];
  if (areas.includes(leadArea)) return 1;
  if (vendor.covers_full_city === true) return 0.5;
  return 0;
}

type RankableCandidate = EligibleMatchedVendor & { __lastAssignedAt: string | null; __rating: number };

// Approved order: category_tier ASC, has_coordinates DESC, distance_km ASC,
// area_affinity DESC, last_assigned_at ASC (nulls first), rating DESC, id ASC.
// Coordinate/distance keys apply only when the LEAD has coordinates.
function compareCandidates(a: RankableCandidate, b: RankableCandidate, leadHasCoords: boolean): number {
  if (a.match_tier !== b.match_tier) return a.match_tier - b.match_tier;
  if (leadHasCoords) {
    if (a.has_coordinates !== b.has_coordinates) return a.has_coordinates ? -1 : 1;
    const ad = a.distance_km ?? Number.POSITIVE_INFINITY;
    const bd = b.distance_km ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
  }
  if (a.area_affinity !== b.area_affinity) return b.area_affinity - a.area_affinity;
  const at = a.__lastAssignedAt ? Date.parse(a.__lastAssignedAt) : Number.NEGATIVE_INFINITY;
  const bt = b.__lastAssignedAt ? Date.parse(b.__lastAssignedAt) : Number.NEGATIVE_INFINITY;
  if (at !== bt) return at - bt; // never-assigned (nulls) first for fairness
  if (a.__rating !== b.__rating) return b.__rating - a.__rating;
  return a.id.localeCompare(b.id);
}

function buildRankReason(vendor: EligibleMatchedVendor, leadHasCoords: boolean): string {
  const parts = [`tier${vendor.match_tier}:${vendor.match_type}`];
  if (leadHasCoords && vendor.distance_km != null) parts.push(`${vendor.distance_km}km`);
  else if (leadHasCoords && !vendor.has_coordinates) parts.push("no_vendor_coords");
  else if (!leadHasCoords) parts.push("no_lead_coords");
  if (vendor.area_affinity > 0) parts.push(`area_affinity:${vendor.area_affinity}`);
  return parts.join(" | ");
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
