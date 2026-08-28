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
import { evaluateVendorAutomaticLeadEligibility, normalizePackageStatus } from "../lib/vendors/vendorEligibility";
import {
  getParentCategoryGroup,
  isLeadVendorCategoryCompatible,
  vendorMatchesParentGroup,
} from "../lib/vendors/categoryMatching";
import { haversineKm, isValidCoordinate } from "../lib/geo/distance";
// QF-MVP-75.02 — the ONE canonical WGS84 coordinate contract. The vendor
// office-then-legacy priority and the "is this pair usable?" rule live there so
// this matcher, the PostGIS generated columns (migration 20260816000000) and the
// offline suite cannot drift apart on which rows hold a coordinate.
import {
  resolveLeadCanonicalCoordinate,
  resolveVendorCanonicalCoordinate,
} from "../lib/geo/canonicalCoordinate";
import { buildGeoMatchEvidence } from "../lib/geo/geoShortlistContract";
import { fetchGeoVendorShortlist } from "./geoVendorShortlistService";
// QF-MVP-75.03 — route travel time is the PRIMARY geography measure. The
// provider seam, the bounded candidate domain and the Tmin/GeoRegret frontier
// live outside this file; what happens here is exactly two things: the ranked
// list is reordered by the frontier when route-time authority engages, and the
// non-secret evidence is recorded. Neither can widen or narrow `eligible`.
import { measureLeadRouteTimes } from "./leadRouteTimeService";
import { reorderByGeoFrontier } from "../lib/matchcore/geoFrontierDecision";
// QF-MVP-75.04 — the GeoFair secondary contract and the PRIMARY/RESERVES plan.
// Both are PURE. Neither can widen or narrow `eligible`, neither writes anything
// and neither is an assignment authority; what happens here is one more
// membership-preserving in-place ordering pass plus one sanitized evidence
// block. Fairness is resolved NEUTRAL — see the call site for the source proof.
import {
  buildGeoFairEvidence,
  neutralGeoFairness,
  reorderByGeoFairSecondary,
  resolveGeoFairnessScope,
} from "../lib/matchcore/geoFairSecondaryDecision";
import { buildSelectionPlan } from "../lib/matchcore/selectionPlan";
import { adminClient } from "../lib/supabase";
import { fail, ok, type Result } from "../lib/errors";
import { MAX_CANONICAL_CANDIDATE_POOL } from "../lib/marketplace/canonicalAssignmentContract";
// QF-MVP-75.01 — the pure MatchCore decision contract. The comparator, the
// ranked-candidate normalization rule and the cap accounting live there so the
// authority, this matcher and the offline suite all describe ONE order.
import {
  CANONICAL_REQUEST_FINGERPRINT_VERSION,
  MATCHCORE_AUTOMATIC_CONTRACT_VERSION,
  classifyCapDeferred,
  compareAutomaticMatchDecisions,
  splitRankedPool,
  type AutomaticMatchDecision,
  type AutomaticMatchRejectReason,
} from "../lib/matchcore/automaticMatchDecision";
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
  // QF-MVP-75.02 provenance ONLY. Neither is a distance input and neither is a
  // matching authority; they are recorded as non-sensitive coordinate
  // provenance in the matching snapshot.
  location_source?: string | null;
  google_place_id?: string | null;
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
  /**
   * QF-MVP-75.01: explicit MatchCore reject reasons, never a collapsed
   * `vendor_not_eligible`. See lib/matchcore/automaticMatchDecision.
   */
  reasons: AutomaticMatchRejectReason[];
};

/**
 * QF-MVP-75.03: the canonical coordinate of each ELIGIBLE vendor, carried
 * alongside the evaluation so the route-time seam does not have to re-read the
 * vendor table. It is computed from the rows already in hand by the SAME shared
 * primitive the matcher and the PostGIS generated columns use.
 *
 * DELIBERATELY NOT PART OF `eligible`: only `eligible`, `skipped` and
 * `skippedReasonCounts` reach `matching_snapshot`, so keeping coordinates in a
 * sibling field means no vendor office coordinate is added to the persisted
 * snapshot shape by this phase.
 */
export type EligibleVendorCoordinate = {
  vendor_id: string;
  latitude: number | null;
  longitude: number | null;
};

export type VendorMatchEvaluation = {
  eligible: EligibleMatchedVendor[];
  skipped: SkippedVendorAudit[];
  skippedReasonCounts: Record<string, number>;
  eligibleCoordinates: EligibleVendorCoordinate[];
};

const MAX_VENDOR_MATCHES = 3;
// Phase 4 fill-until-3: pass a bounded RANKED candidate pool to the atomic RPC,
// which skips any candidate that fails a transactional recheck and stops after
// MAX_VENDOR_MATCHES SUCCESSFUL assignments (never more) even if higher-ranked
// candidates lose their last credit concurrently. The RPC — never this layer —
// enforces the max-3-successful cap atomically.
//
// QF-MVP-75.01: the RPC now consumes this pool in RANK ORDER. Before 75.01 it
// re-ordered the pool by ascending vendor uuid, so this ranking decided nothing
// once more than MAX_VENDOR_MATCHES pool members were eligible. See migration
// 20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql.
//
// The pool bound is imported rather than re-declared, so the matcher and the
// transport seam cannot drift apart on the value.
const MAX_ASSIGNMENT_CANDIDATE_POOL = MAX_CANONICAL_CANDIDATE_POOL;
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
      .select("id, name, phone, city, area, service_required, category, subcategory, budget, timeline, message, latitude, longitude, location_source, google_place_id, share_consent, is_duplicate")
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
    const { eligible, skipped, skippedReasonCounts, eligibleCoordinates } = evaluation.data;

    // QF-MVP-75.02 — bounded read-only PostGIS geo DISCOVERY, recorded as
    // evidence and nothing else.
    //
    // Read this ordering carefully, because it is the whole safety argument:
    // the shortlist runs AFTER `eligible` is already final, and its result is
    // never fed back into `eligible`, into `rankedPool`, into the candidate
    // pool submitted to the authority, or into the comparator. It therefore
    // CANNOT exclude a vendor the existing 20-candidate contract could have
    // selected, cannot narrow supply, cannot debit a credit and cannot assign.
    //
    // Every abnormal geo outcome — no lead coordinate, no vendor with a
    // coordinate, migration not applied, infrastructure error — is a TYPED
    // outcome that resolves to an explicit city-fallback label. None of them can
    // make a lead look unsupplied: only `eligible` can say that, and `eligible`
    // is computed above without any geo input at all.
    const leadPoint = resolveLeadCanonicalCoordinate(leadRow);
    const geoOutcome = await fetchGeoVendorShortlist(leadRow);
    const geoEvidence = buildGeoMatchEvidence({
      outcome: geoOutcome,
      leadCoordinateSource: leadPoint.source,
      leadHasValidCoordinate: leadPoint.source !== "none",
      leadLocationSource: asText(leadRow.location_source),
      leadGooglePlaceIdPresent: Boolean(asText(leadRow.google_place_id)),
      cityEligibleVendorCount: eligible.length,
    });

    // QF-MVP-75.03 — ROUTE TRAVEL TIME, the primary geography measure.
    //
    // Read this ordering as carefully as the QF-MVP-75.02 block above, because
    // it is the whole safety argument for making geography lexicographically
    // primary:
    //
    //   The routing domain is EXACTLY `eligible` — the hard-eligible set already
    //   gated by commercial eligibility, the city hard gate and CATEGORY
    //   COMPATIBILITY. Nothing is filtered by distance, tier, package or PostGIS
    //   before routing, so the category-blind exclusion QF-MVP-75.02 refused to
    //   risk cannot occur: the category gate ran upstream and is untouched.
    //
    //   What the frontier changes is the ORDER of that set, never its MEMBERSHIP.
    //   `eligible` is reordered in place; not one candidate is added or removed,
    //   so the bounded pool below is still built from exactly the same vendors,
    //   the same 20-candidate transport ceiling applies, and the authority still
    //   decides every outcome under the same active cap of 3.
    //
    //   Every abnormal outcome — provider off, no server credential, no lead
    //   coordinate, too small a domain, too few results, too little coverage, any
    //   infrastructure failure, or a bound that leaves the domain unproven —
    //   leaves `route.route_authority_engaged` false and the pre-75.03 order
    //   completely untouched. A provider outage can never reorder a lead.
    const routeOutcome = await measureLeadRouteTimes({
      leadOrigin:
        leadPoint.latitude !== null && leadPoint.longitude !== null
          ? { latitude: leadPoint.latitude, longitude: leadPoint.longitude }
          : null,
      candidates: eligible.map((vendor) => {
        const point = eligibleCoordinates.find((entry) => entry.vendor_id === vendor.id);
        return {
          id: vendor.id,
          latitude: point?.latitude ?? null,
          longitude: point?.longitude ?? null,
          distance_km: vendor.distance_km,
        };
      }),
    });
    const routeOrderedVendorIds = routeOutcome.decision.engaged
      ? reorderByGeoFrontier(eligible, routeOutcome.placements)
      : eligible.map((vendor) => vendor.id);
    const routeEvidence = { ...routeOutcome.evidence, route_ordered_vendor_ids: routeOrderedVendorIds };

    // QF-MVP-75.04 — GEOFAIR SECONDARY ORDER + PRIMARY/RESERVES SELECTION PLAN.
    //
    // Read this the same way as the two blocks above, because the safety
    // argument is the same shape:
    //
    //   The input is `eligible` AFTER the 75.03 frontier has spoken. Membership
    //   is untouched — this pass sorts the same array and adds nothing and
    //   removes nothing — so the bounded pool below is still built from exactly
    //   the same vendors under the same 20-candidate transport ceiling, and the
    //   authority still decides every outcome under the same active cap of 3.
    //
    //   Fairness resolves NEUTRAL, with the explicit reason
    //   DELIVERY_EXPOSURE_UNAVAILABLE: this database has no canonical DELIVERED
    //   fact to count. The lifecycle vocabulary has 'delivered' but nothing ever
    //   writes it; the authority writes 'assigned'; the WhatsApp intent it
    //   queues is never dispatched or reconciled; and lead_delivery_logs carries
    //   a hardcoded 'delivered' literal that can never be false. Counting any of
    //   those would charge fairness on SELECTION, which the locked rule forbids.
    //   A NEUTRAL decision gives every candidate the same fairness key, so this
    //   pass is order-preserving by construction and 75.04 changes no assignment
    //   outcome. See lib/matchcore/geoFairSecondaryDecision.
    //
    //   The geography gate is passed through unchanged: on a run where route
    //   authority did NOT engage, the geography and secondary keys are suppressed
    //   entirely, so a provider outage still cannot reorder a lead.
    //
    //   The selection plan is a PURE naming of the first three ranked positions.
    //   A role is NOT a delivery fact, consumes no fairness, mutates nothing, and
    //   is never submitted in place of the ranked pool.
    const fairness = neutralGeoFairness(resolveGeoFairnessScope(leadRow), "DELIVERY_EXPOSURE_UNAVAILABLE");
    const geoFairOrderedVendorIds = reorderByGeoFairSecondary(eligible, {
      geographyEngaged: routeOutcome.decision.engaged,
      placements: routeOutcome.placements,
      fairness,
    });
    const selectionPlan = buildSelectionPlan(geoFairOrderedVendorIds);
    const geoFairEvidence = buildGeoFairEvidence({
      geographyEngaged: routeOutcome.decision.engaged,
      fairness,
      orderedVendorIds: geoFairOrderedVendorIds,
      selectionPlan,
    });

    // Ranked candidate POOL. Recorded as selected_vendor_ids so diagnostics keep
    // `assigned ⊆ selected`; the authority caps SUCCESSFUL at 3.
    //
    // QF-MVP-75.01: this order is now BINDING. The authority consumes exactly
    // this list, in exactly this order, and fills the remaining active slots
    // with the first eligible entries by rank.
    const rankedPool = splitRankedPool(
      eligible.map((vendor) => vendor.id),
      MAX_ASSIGNMENT_CANDIDATE_POOL,
    );
    const selectedVendorIds = rankedPool.pool;
    // Audit-only: who was evaluated and why they were not selected.
    const matchAudit = {
      // Phase 3A metadata (top-level in every snapshot via the spreads below).
      matching_model_version: MATCHING_MODEL_VERSION,
      // QF-MVP-75.01 evidence. `ranked_candidate_order` is the exact ordered
      // list submitted to the authority, so a reader can prove after the fact
      // WHICH order decided the outcome rather than inferring it.
      matchcore_contract_version: MATCHCORE_AUTOMATIC_CONTRACT_VERSION,
      request_fingerprint_version: CANONICAL_REQUEST_FINGERPRINT_VERSION,
      candidate_order_is_binding: true,
      ranked_candidate_order: selectedVendorIds,
      skipped,
      skipped_reason_counts: skippedReasonCounts,
      // Eligible and ranked, but beyond the bounded transport pool, so never
      // submitted at all. Distinct from `cap_deferred_vendor_ids` below.
      max_vendor_cap_reached_vendor_ids: rankedPool.beyondPool,
      // QF-MVP-75.02 geo evidence. Straight-line discovery only — see
      // lib/geo/geoShortlistContract. Never route distance, never route time,
      // never an authority.
      geo: geoEvidence,
      // QF-MVP-75.03 route evidence. Travel time is the PRIMARY measure and the
      // one this block records; the straight-line numbers above remain
      // supporting discovery evidence. Carries no API key, no auth header, no
      // raw provider body and no lead coordinate.
      route: routeEvidence,
      // QF-MVP-75.04 GeoFair evidence: the secondary decision components, the
      // fairness MODE and REASON (never a per-vendor exposure map), the geo
      // scope identifier, and the PRIMARY/RESERVES selection plan. Carries no
      // provider payload, no credential, no coordinate and no PII, and states
      // its own standing negatives — not an assignment authority, not an
      // eligibility authority, not package-weighted, and not delivery evidence.
      geofair: geoFairEvidence,
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

    // QF-MVP-75.01 evidence — did an eligible ranked candidate lose ONLY to the
    // active cap?
    //
    // The authority records a per-vendor skip for every candidate it actually
    // evaluated, and stops the moment the cap is reached. A submitted pool member
    // in neither the assigned nor the skipped list was therefore never reached:
    // it lost to the cap alone, not to an eligibility failure. Derived, so no new
    // column and no new table is needed to prove it.
    const outcomeAudit = {
      cap_deferred_vendor_ids: classifyCapDeferred(
        selectedVendorIds,
        assignment.data.assigned.map((vendor) => vendor.vendor_id),
        assignment.data.skipped,
      ),
    };

    // Concurrent-retry safety (Phase 3B correction): the assignment boundary
    // reports a replay when this lead's assignments already exist (its idempotent
    // short-circuit / a race with another retry). Those assignments — and their
    // delivery/preview logs — were already created by the original run, so DO NOT
    // recreate delivery side effects (dashboard / whatsapp_preview / client
    // preview). Record a truthful terminal run and return the EXISTING assigned
    // vendors. Ranking, selection, max-3 and credits are unchanged.
    //
    // QF-MVP-20.3R1: the canonical authority reports a replay as
    // status = "already_applied" (plus already_applied = true). The legacy
    // "already_assigned" literal is still accepted so an injected test boundary
    // and any in-flight legacy payload keep the same safe behaviour.
    if (assignment.data.status === "already_assigned" || assignment.data.already_applied === true) {
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
          ...outcomeAudit,
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
        matching_snapshot: { lead: summarizeLead(leadRow), selected: selectedVendorIds, eligible, ...matchAudit, ...outcomeAudit, assignment: assignment.data },
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
      matching_snapshot: { lead: summarizeLead(leadRow), selected: selectedVendorIds, eligible, ...matchAudit, ...outcomeAudit, assignment: assignment.data },
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
 * approved order and fill (the caller applies max-3). No I/O — unit-testable, and
 * deterministic for a fixed instant: the ONE clock read below is taken once per
 * run and injected, so no two vendors in the same run are judged against
 * different instants. Returns the SAME shape as evaluateVendorsForLead.
 */
export function rankVendorsForLead(
  lead: LeadForMatching,
  rows: Array<Record<string, unknown>>,
): VendorMatchEvaluation {
  const eligible: RankableCandidate[] = [];
  const skipped: SkippedVendorAudit[] = [];
  const skippedReasonCounts: Record<string, number> = {};
  // QF-MVP-75.03: captured here because the vendor rows are already in hand.
  // Ranking never reads it — it is an output for the route-time seam only.
  const eligibleCoordinates: EligibleVendorCoordinate[] = [];

  // Lead-level context computed once. Distance is only computable when the LEAD
  // has coordinates; manual leads rank by tier + soft area affinity + fairness.
  const leadHasCoords = isValidCoordinate(lead.latitude, lead.longitude);
  const leadParentGroup = getParentCategoryGroup([lead.subcategory, lead.service_required, lead.category]);
  // QF-MVP-75.01: ONE clock read for the whole run, injected into every
  // eligibility evaluation. The assignment-suspension window is the only
  // clock-sensitive gate, and since this ranking is now BINDING on the
  // authority, every vendor in a single run must be judged against the SAME
  // instant rather than each against its own Date.now().
  const nowMs = Date.now();

  for (const vendor of rows) {
    const id = asText(vendor.id);
    if (!id) continue;

    // Phase 4 canonical commercial eligibility ONLY: approved + active +
    // accepting_leads + NOT assignment-suspended + remaining_credits >=
    // LEAD_CREDIT_COST. Package/paid_status are NOT eligibility inputs. City and
    // category are gated below so we can still distinguish Tier 0 vs Tier 1
    // fallback. Must match the RPC gate.
    //
    // QF-MVP-75.01: the helper now also mirrors the assignment-suspension window
    // that public.qf_vendor_assignment_eligible has always enforced. Before this
    // slice the matcher could rank a suspended vendor into the bounded pool,
    // consume one of its slots, and learn nothing more than the authority's
    // coarse `vendor_not_eligible`. Every reason below is now an explicit
    // AutomaticMatchRejectReason, so a skipped candidate is explainable HERE.
    const wallet = evaluateVendorAutomaticLeadEligibility(vendor, { nowMs });
    const reasons: AutomaticMatchRejectReason[] = [...wallet.reasons];

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
    eligibleCoordinates.push({ vendor_id: id, latitude: coords.lat, longitude: coords.lng });

    eligible.push({
      id,
      business_name: asText(vendor.business_name),
      // Informational only (NOT used for ranking); ranking uses the comparator below.
      score: scoreVendor(vendor, lead, "credit_wallet"),
      credits: wallet.credits,
      packageStatus: normalizePackageStatus(vendor), // display/history only (deprecated for eligibility)
      visibilityType: "credit_wallet",
      match_tier: tier,
      match_type: matchType,
      distance_km: distanceKm,
      has_coordinates: hasCoordinates,
      coordinate_source: coords.source,
      area_affinity: areaAffinity,
      rank_reason: "",
      // QF-MVP-75.01: the pure MatchCore decision record this candidate is
      // ranked by. Kept alongside the public row so the comparator has exactly
      // the contract's fields and nothing else.
      __decision: {
        vendor_id: id,
        eligible: true,
        reason_codes: [],
        match_tier: tier,
        match_type: matchType,
        has_coordinates: hasCoordinates,
        coordinate_source: coords.source,
        distance_km: distanceKm,
        area_affinity: areaAffinity,
        last_assigned_at: asText(vendor.last_assigned_at),
        rating: Number.isFinite(Number(vendor.rating)) ? Number(vendor.rating) : 0,
        rank_position: null,
      },
    });
  }

  // Rank: category tier first (0 before 1), then distance-aware ordering, then
  // soft area affinity, fairness (last_assigned_at asc, nulls first), rating, id.
  //
  // QF-MVP-75.01: the comparator is now the shared MatchCore contract
  // (lib/matchcore/automaticMatchDecision). The order is unchanged; what changed
  // is that the persistence authority is bound by it, so this is no longer an
  // advisory ordering. The contract also hardens the fairness key: an
  // unparseable last_assigned_at previously produced NaN, which made the
  // comparator non-total and let the same input sort differently.
  eligible.sort((a, b) => compareAutomaticMatchDecisions(a.__decision, b.__decision, leadHasCoords));

  // Finalize audit: rank position + human reason; strip internal sort-only fields.
  eligible.forEach((vendor, index) => {
    vendor.rank_position = index + 1;
    vendor.rank_reason = buildRankReason(vendor, leadHasCoords);
    delete (vendor as Record<string, unknown>).__decision;
  });

  return { eligible, skipped, skippedReasonCounts, eligibleCoordinates };
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
//
// QF-MVP-75.02: the rule itself now lives in lib/geo/canonicalCoordinate, which
// migration 20260816000000 mirrors as the two-branch CASE of
// public.vendors.geo_point. This wrapper keeps the matcher's local shape and
// adds no rule of its own, so there is exactly ONE definition of the vendor
// coordinate source. base_latitude/base_longitude remain deliberately unused.
function resolveVendorCoordinates(vendor: Record<string, unknown>): {
  lat: number | null;
  lng: number | null;
  source: CoordinateSource;
} {
  const resolved = resolveVendorCanonicalCoordinate(vendor);
  return { lat: resolved.latitude, lng: resolved.longitude, source: resolved.source };
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

/**
 * A ranked row carries the public audit shape plus the pure MatchCore decision
 * record it is ordered by. `__decision` is stripped before the row is returned,
 * so the persisted snapshot shape is unchanged.
 *
 * QF-MVP-75.01: the comparator itself moved to
 * lib/matchcore/automaticMatchDecision.compareAutomaticMatchDecisions. The
 * approved order is unchanged — category_tier ASC, has_coordinates DESC,
 * distance_km ASC, area_affinity DESC, last_assigned_at ASC (nulls first),
 * rating DESC, id ASC, with the coordinate/distance keys applying only when the
 * LEAD has coordinates — but it now has ONE definition that the authority is
 * bound by and the offline suite can exercise directly.
 */
type RankableCandidate = EligibleMatchedVendor & { __decision: AutomaticMatchDecision };

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
