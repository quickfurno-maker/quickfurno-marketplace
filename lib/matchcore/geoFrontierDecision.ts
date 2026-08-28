// ============================================================================
// QuickFurno — lib/matchcore/geoFrontierDecision.ts
//
// QF-MVP-75.03 — the PURE MatchCore decision contract for the GEOGRAPHIC
// FRONTIER on the canonical AUTOMATIC lead-matching path.
//
// THE ARCHITECTURAL CHANGE THIS FILE MAKES, STATED PLAINLY
//   QF-MVP-75.01 ordered candidates `match_tier ASC` FIRST, so a Tier-0
//   exact-category vendor outranked every Tier-1 parent-group vendor at ANY
//   distance. That is precisely why QF-MVP-75.02 refused to let a category-blind
//   nearest-N shortlist narrow anything: under a tier-first order, dropping a far
//   Tier-0 vendor could drop the winner.
//
//   The locked geography rule reverses that priority. Geography is
//   lexicographically ahead of the secondary signals, so the order becomes:
//
//     1. hard eligibility  (commercial + city + category COMPATIBILITY)
//     2. geographic frontier  (GeoRegret <= maxGeoRegretSeconds)
//     3. secondary ranking  (exact-category tier, area affinity, then the
//        pre-75.03 canonical MatchCore rank, which already encodes fairness,
//        rating and vendor id)
//
//   A Tier-0 vendor OUTSIDE the frontier therefore now loses to a Tier-1 vendor
//   INSIDE it. That is a deliberate, versioned business change, and it is safe
//   for the reason 75.02's blanket refusal was not available: category
//   COMPATIBILITY is still a HARD GATE upstream. Both Tier 0 and Tier 1 are
//   compatible; an incompatible vendor is rejected before it ever reaches here.
//   The frontier reorders compatible vendors, it never admits an incompatible one.
//
// PURITY CONTRACT — load-bearing.
//   No I/O, no Supabase client, no network, no clock, no randomness, no global
//   state, no process.env read. Every function is a total function of its
//   arguments, so the offline MVP suite exercises the real production code.
//
// WHAT THIS MODULE IS NOT
//   It is not an eligibility authority and it is not an assignment authority. It
//   produces an ORDER and a set of labels. public.qf_assign_lead_vendors_v2 still
//   decides every outcome, still enforces the active cap of 3 and the lifetime
//   cap of 6, and still rechecks every candidate transactionally.
//   It contains NO package, paid-status, credit or commercial key of any kind.
// ============================================================================

import {
  computeGeoRegretSeconds,
  computeTminSeconds,
  isArbitraryRouteStatus,
  isRouteDomainClosed,
  type RouteDestination,
  type RouteElementStatus,
  type RouteMeasurement,
} from "../geo/routeTimeContract";
import type { RouteTimePolicy } from "../geo/routeTimePolicy";

/**
 * Contract version for the geographic-frontier decision SHAPE and ORDER. Bump
 * when the lexicographic order or the band definitions change. Mirrored into
 * every matching_snapshot as `route.geo_frontier_contract_version`.
 */
export const GEO_FRONTIER_CONTRACT_VERSION = 1;

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

/**
 * Where a candidate sits relative to the geographic frontier.
 *
 *   inside_frontier  — measured, and GeoRegret <= maxGeoRegretSeconds. Every
 *                      member is GEOGRAPHICALLY COMPARABLE with every other, so
 *                      route time stops discriminating inside this band and the
 *                      secondary signals decide.
 *   outside_frontier — measured, and demonstrably further than the frontier.
 *                      Ordered by GeoRegret ASC so the nearest miss ranks first.
 *   unmeasured       — no successful measurement (no coordinate, no route, or
 *                      proven outside by the closure bound). Ranked last, which
 *                      is CONTINUOUS with pre-75.03 behaviour: the existing
 *                      comparator already ordered `has_coordinates DESC`, so a
 *                      coordinate-unknown vendor already ranked behind a
 *                      coordinate-known one.
 */
export type GeoFrontierBand = "inside_frontier" | "outside_frontier" | "unmeasured";

const BAND_RANK: Record<GeoFrontierBand, number> = {
  inside_frontier: 0,
  outside_frontier: 1,
  unmeasured: 2,
};

export interface GeoFrontierPlacement {
  readonly vendor_id: string;
  readonly band: GeoFrontierBand;
  readonly route_status: RouteElementStatus;
  readonly travel_time_seconds: number | null;
  readonly distance_meters: number | null;
  readonly geo_regret_seconds: number | null;
}

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

/**
 * Why route time did or did not decide this run.
 *
 * `route_authority_engaged` is the only value that means the frontier was
 * applied. Every other value is a FALLBACK REASON, and on all of them the run
 * keeps the exact deterministic pre-75.03 order — nothing is reordered, nothing
 * is demoted, and no vendor loses a slot to an outage.
 */
export const ROUTE_FRONTIER_OUTCOMES = [
  "route_authority_engaged",
  /** The operator has not switched the provider on. Default state. */
  "route_provider_disabled",
  /** No server-side credential, or one that failed the browser-key reuse guard. */
  "route_provider_not_configured",
  /** The lead holds no canonical coordinate, so there is no origin to route from. */
  "no_lead_coordinate",
  /** Fewer routable destinations than the provider's two-destination minimum. */
  "insufficient_route_domain",
  /** Too few successful measurements for Tmin to be trustworthy. */
  "insufficient_route_results",
  /** Too small a share of the hard-eligible pool was successfully measured. */
  "insufficient_route_coverage",
  /** An ARBITRARY (infrastructure) status touched the domain. */
  "route_provider_incomplete",
  /** A bound left a vendor unmeasured that could still have been inside. */
  "route_domain_not_closed",
] as const;

export type RouteFrontierOutcome = (typeof ROUTE_FRONTIER_OUTCOMES)[number];

export function isRouteFrontierOutcome(value: unknown): value is RouteFrontierOutcome {
  return typeof value === "string" && (ROUTE_FRONTIER_OUTCOMES as readonly string[]).includes(value);
}

export interface RouteFrontierDecisionInput {
  /** Every hard-eligible candidate this run ranked, in canonical MatchCore order. */
  readonly eligibleVendorIds: readonly string[];
  /** One measurement per routed destination. */
  readonly measurements: readonly RouteMeasurement[];
  /** Destinations a bound excluded, ascending by straight-line distance. */
  readonly deferred: readonly RouteDestination[];
  /** Hard-eligible candidates holding no canonical coordinate. */
  readonly missingCoordinateVendorIds: readonly string[];
  readonly policy: RouteTimePolicy;
}

export interface RouteFrontierDecision {
  readonly outcome: RouteFrontierOutcome;
  readonly engaged: boolean;
  readonly tmin_seconds: number | null;
  readonly frontier_threshold_seconds: number | null;
  readonly domain_closed: boolean;
  readonly successful_count: number;
  readonly failed_count: number;
  readonly arbitrary_failure_count: number;
  readonly coverage_ratio: number;
  readonly placements: GeoFrontierPlacement[];
  readonly inside_frontier_vendor_ids: string[];
  readonly outside_frontier_vendor_ids: string[];
  readonly unmeasured_vendor_ids: string[];
}

/**
 * Decide whether route time may reorder this run, and place every hard-eligible
 * candidate in a band.
 *
 * THE ACTIVATION PREDICATE — all of these must hold, and each has a distinct
 * reason code so a snapshot always explains itself:
 *
 *   1. no ARBITRARY status touched the domain. A provider timeout, a 429, a 401,
 *      a 5xx, a malformed body or an unexplainable element means the evidence is
 *      incomplete BY ACCIDENT. Applying the frontier then would let luck decide
 *      which vendor wins a lead, and that is the one thing the phase brief
 *      forbids absolutely.
 *   2. at least `minSuccessfulRouteResults` successes, so Tmin rests on more
 *      than a single reading.
 *   3. at least `minRoutedCoverageRatio` of the hard-eligible pool measured. This
 *      is what stops a thin-coordinate market from handing the top three slots to
 *      whichever two vendors happen to have coordinates filled in.
 *   4. the domain is CLOSED, i.e. every unrouted vendor is provably outside the
 *      frontier. Otherwise a vendor the current business rules permit to win was
 *      never measured, and ranking it last would be the exact silent exclusion
 *      QF-MVP-75.02 refused to make.
 *
 * On any failure the returned placements are still computed and still recorded
 * as EVIDENCE — the caller simply does not reorder by them.
 */
export function decideRouteFrontier(input: RouteFrontierDecisionInput): RouteFrontierDecision {
  const { eligibleVendorIds, measurements, deferred, missingCoordinateVendorIds, policy } = input;

  const byVendor = new Map<string, RouteMeasurement>();
  for (const m of measurements) {
    if (!byVendor.has(m.vendor_id)) byVendor.set(m.vendor_id, m);
  }
  const missing = new Set(missingCoordinateVendorIds);

  let successfulCount = 0;
  let failedCount = 0;
  let arbitraryFailureCount = 0;
  for (const m of measurements) {
    if (m.status === "SUCCESS") successfulCount += 1;
    else failedCount += 1;
    if (isArbitraryRouteStatus(m.status)) arbitraryFailureCount += 1;
  }

  const tmin = computeTminSeconds(measurements);
  const threshold = tmin === null ? null : tmin + policy.maxGeoRegretSeconds;
  const domainClosed = tmin === null ? deferred.length === 0 : isRouteDomainClosed(deferred, tmin, policy);
  const coverageRatio = eligibleVendorIds.length === 0 ? 0 : successfulCount / eligibleVendorIds.length;

  // -- place every hard-eligible candidate ----------------------------------
  const placements: GeoFrontierPlacement[] = eligibleVendorIds.map((vendorId) => {
    const measurement = byVendor.get(vendorId);
    if (!measurement) {
      // Never measured. Either the vendor holds no canonical coordinate, or a
      // bound deferred it. Both are unmeasured; only the label differs.
      const status: RouteElementStatus = missing.has(vendorId) ? "MISSING_COORDINATE" : "NOT_ROUTED_DUE_TO_BOUND";
      return {
        vendor_id: vendorId,
        band: "unmeasured" as const,
        route_status: status,
        travel_time_seconds: null,
        distance_meters: null,
        geo_regret_seconds: null,
      };
    }
    if (measurement.status !== "SUCCESS" || measurement.travel_time_seconds === null || tmin === null) {
      return {
        vendor_id: vendorId,
        band: "unmeasured" as const,
        route_status: measurement.status,
        travel_time_seconds: measurement.travel_time_seconds,
        distance_meters: measurement.distance_meters,
        geo_regret_seconds: null,
      };
    }
    const regret = computeGeoRegretSeconds(measurement.travel_time_seconds, tmin);
    return {
      vendor_id: vendorId,
      band: (regret <= policy.maxGeoRegretSeconds ? "inside_frontier" : "outside_frontier") as GeoFrontierBand,
      route_status: measurement.status,
      travel_time_seconds: measurement.travel_time_seconds,
      distance_meters: measurement.distance_meters,
      geo_regret_seconds: regret,
    };
  });

  // -- the activation predicate ---------------------------------------------
  let outcome: RouteFrontierOutcome = "route_authority_engaged";
  if (arbitraryFailureCount > 0) outcome = "route_provider_incomplete";
  else if (successfulCount < policy.minSuccessfulRouteResults) outcome = "insufficient_route_results";
  else if (coverageRatio < policy.minRoutedCoverageRatio) outcome = "insufficient_route_coverage";
  else if (!domainClosed) outcome = "route_domain_not_closed";

  const engaged = outcome === "route_authority_engaged";

  return {
    outcome,
    engaged,
    tmin_seconds: tmin,
    frontier_threshold_seconds: threshold,
    domain_closed: domainClosed,
    successful_count: successfulCount,
    failed_count: failedCount,
    arbitrary_failure_count: arbitraryFailureCount,
    coverage_ratio: coverageRatio,
    placements,
    inside_frontier_vendor_ids: placements.filter((p) => p.band === "inside_frontier").map((p) => p.vendor_id),
    outside_frontier_vendor_ids: placements.filter((p) => p.band === "outside_frontier").map((p) => p.vendor_id),
    unmeasured_vendor_ids: placements.filter((p) => p.band === "unmeasured").map((p) => p.vendor_id),
  };
}

// ---------------------------------------------------------------------------
// The geo-aware order
// ---------------------------------------------------------------------------

/**
 * The minimum a candidate must expose to be ordered by the frontier.
 *
 * `base_rank` is the 1-based `rank_position` the pre-75.03 canonical MatchCore
 * comparator already stamped. Using it as the FINAL key is what makes this
 * comparator total and deterministic WITHOUT re-deriving fairness, rating and
 * vendor id: that order is already total over a de-duplicated candidate set, so
 * no two candidates share a base rank. It also means the pre-75.03 MatchCore
 * authority is PRESERVED as the tiebreak rather than replaced.
 */
export interface GeoRankableCandidate {
  readonly id: string;
  readonly match_tier: 0 | 1;
  readonly area_affinity: number;
  readonly base_rank: number;
}

/**
 * The QF-MVP-75.03 lexicographic order, in full:
 *
 *   band                    ASC   inside -> outside -> unmeasured  (GEOGRAPHY)
 *   geo_regret_seconds      ASC   outside band ONLY
 *   match_tier              ASC   0 exact/synonym/subcategory before 1 fallback
 *   area_affinity           DESC  1 listed area, 0.5 covers_full_city, 0 neither
 *   base_rank               ASC   the pre-75.03 canonical MatchCore rank
 *
 * Two properties worth stating because they are the point of the phase:
 *
 *   - Regret does NOT discriminate INSIDE the frontier. Every inside member is
 *     geographically comparable by definition, so a vendor 3 minutes closer
 *     cannot outrank a better-matched one. Making regret a continuous key inside
 *     the band would quietly restore distance-first ranking and defeat the
 *     frontier.
 *   - There is no package, paid-status, credit, visibility or commercial key
 *     ANYWHERE in this comparator, and none in the pre-75.03 comparator it falls
 *     back to. Package therefore cannot promote an outside-frontier vendor over
 *     an inside-frontier one, because package cannot move a candidate at all.
 *
 * Deterministic and total: `base_rank` is unique per candidate, so the
 * comparator returns 0 only when both sides are the same candidate. Provider
 * response order cannot reach it — placements are keyed by vendor id.
 */
export function compareGeoFrontierCandidates(
  a: GeoRankableCandidate,
  b: GeoRankableCandidate,
  placements: ReadonlyMap<string, GeoFrontierPlacement>,
): number {
  const pa = placements.get(a.id);
  const pb = placements.get(b.id);
  const bandA = pa ? BAND_RANK[pa.band] : BAND_RANK.unmeasured;
  const bandB = pb ? BAND_RANK[pb.band] : BAND_RANK.unmeasured;
  if (bandA !== bandB) return bandA - bandB;

  if (bandA === BAND_RANK.outside_frontier) {
    const ra = pa?.geo_regret_seconds ?? Number.POSITIVE_INFINITY;
    const rb = pb?.geo_regret_seconds ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra < rb ? -1 : 1;
  }

  if (a.match_tier !== b.match_tier) return a.match_tier - b.match_tier;
  if (a.area_affinity !== b.area_affinity) return b.area_affinity - a.area_affinity;
  return a.base_rank - b.base_rank;
}

/**
 * Reorder an already-canonically-ranked candidate list IN PLACE by the geo
 * frontier, and re-stamp `rank_position`.
 *
 * In place, and mutating the same array the caller already holds, so the
 * submitted candidate pool is still built from exactly the binding `eligible`
 * list the QF-MVP-75.01 contract requires — the pool construction line is
 * untouched and the authority still receives exactly one ordered list.
 *
 * Returns the ordered vendor ids for evidence.
 */
export function reorderByGeoFrontier<T extends { id: string; match_tier: 0 | 1; area_affinity: number; rank_position?: number }>(
  candidates: T[],
  placements: ReadonlyMap<string, GeoFrontierPlacement>,
): string[] {
  const baseRank = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    baseRank.set(candidate.id, typeof candidate.rank_position === "number" ? candidate.rank_position : index + 1);
  });

  const key = (candidate: T): GeoRankableCandidate => ({
    id: candidate.id,
    match_tier: candidate.match_tier,
    area_affinity: candidate.area_affinity,
    base_rank: baseRank.get(candidate.id) ?? Number.MAX_SAFE_INTEGER,
  });

  candidates.sort((a, b) => compareGeoFrontierCandidates(key(a), key(b), placements));
  candidates.forEach((candidate, index) => {
    candidate.rank_position = index + 1;
  });
  return candidates.map((candidate) => candidate.id);
}
