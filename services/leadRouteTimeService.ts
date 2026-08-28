// ============================================================================
// QuickFurno — services/leadRouteTimeService.ts
//
// QF-MVP-75.03 — the orchestration seam between the automatic matcher and the
// route-time provider. It builds the SAFE ROUTE CANDIDATE DOMAIN, plans bounded
// deterministic batches, calls the provider, and returns a typed outcome plus the
// non-secret evidence the matching snapshot records.
//
// THE SAFE CANDIDATE DOMAIN — the load-bearing design decision of this phase.
//
//   QF-MVP-75.02 refused to let a nearest-N PostGIS shortlist narrow anything,
//   because under the tier-first comparator a category-blind distance bound could
//   drop a far Tier-0 vendor that would have won. That refusal is discharged here
//   by CHOOSING THE DOMAIN CORRECTLY rather than by measuring nothing:
//
//     the routing domain is EXACTLY the hard-eligible set the matcher already
//     produced — commercially eligible AND city-matched AND category-compatible —
//     restricted to those holding a canonical coordinate.
//
//   That set is, by construction, every vendor current business rules permit to
//   win this lead. Nothing is filtered by distance, by tier, by package or by
//   PostGIS before routing. A category-blind bound is therefore impossible: the
//   category gate has already run, upstream, unchanged.
//
//   Bounds still exist, because provider elements cost money. But they are
//   applied as DETERMINISTIC PROGRESSIVE EXPANSION over an explicit ascending
//   straight-line order, never as silent truncation: whatever a bound excludes is
//   reported as NOT_ROUTED_DUE_TO_BOUND, and the frontier is applied only if the
//   domain can be PROVEN CLOSED — that is, only if no excluded vendor could have
//   been inside the frontier. Otherwise the run keeps its pre-75.03 order.
//
// NO PROVIDER CALL UNLESS EVERY PRECONDITION HOLDS
//   Provider explicitly enabled, server credential present and not the public
//   browser key, lead holds a canonical coordinate, and at least two distinct
//   routable destinations exist. Any of these missing means ZERO provider calls
//   and zero spend.
//
// NOT AN AUTHORITY
//   It writes nothing, assigns nothing, debits nothing and never reaches
//   public.qf_assign_lead_vendors_v2.
// ============================================================================

import {
  deduplicateRouteDomain,
  planRouteBatches,
  routeCoordinateKey,
  ROUTE_TIME_CONTRACT_VERSION,
  ROUTE_TIME_METRIC,
  type RouteDestination,
  type RouteMeasurement,
} from "../lib/geo/routeTimeContract";
import {
  decideRouteFrontier,
  GEO_FRONTIER_CONTRACT_VERSION,
  type GeoFrontierPlacement,
  type RouteFrontierDecision,
  type RouteFrontierOutcome,
} from "../lib/matchcore/geoFrontierDecision";
import { resolveRouteTimePolicy, type RouteTimePolicy } from "../lib/geo/routeTimePolicy";
import type { HttpTransport } from "../lib/communication/httpTransport";
import {
  createRouteTimeProvider,
  type RouteProviderCredentialStatus,
  type RouteTimeProvider,
} from "./routeTimeProviderService";

type EnvLike = Record<string, string | undefined>;

/** The minimum a candidate must expose for the routing domain to be built. */
export interface RouteCandidateInput {
  readonly id: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** Haversine km from the lead, or null. Ordering + closure-proof input ONLY. */
  readonly distance_km: number | null;
}

export interface RouteTimeRunInput {
  readonly leadOrigin: { latitude: number; longitude: number } | null;
  /** Hard-eligible candidates in canonical MatchCore order. */
  readonly candidates: readonly RouteCandidateInput[];
  readonly policy?: RouteTimePolicy;
  readonly env?: EnvLike;
  /** Injected in tests. Production uses the repository's FetchHttpTransport. */
  readonly transport?: HttpTransport;
  /** Injected in tests to drive the provider contract without any transport. */
  readonly provider?: RouteTimeProvider | null;
}

export interface RouteTimeEvidence {
  readonly route_contract_version: number;
  readonly geo_frontier_contract_version: number;
  readonly route_policy_version: number;
  readonly route_provider_id: string;
  readonly route_travel_mode: string;
  readonly route_routing_preference: string;
  readonly route_departure_time_used: false;
  readonly route_time_metric: string;
  readonly route_authority_engaged: boolean;
  readonly route_fallback_reason: RouteFrontierOutcome;
  readonly route_credential_status: RouteProviderCredentialStatus;
  readonly provider_call_count: number;
  readonly requested_destination_count: number;
  readonly successful_route_count: number;
  readonly failed_route_count: number;
  readonly arbitrary_failure_count: number;
  readonly protocol_violation_count: number;
  readonly deduplicated_destination_count: number;
  readonly not_routed_due_to_bound_count: number;
  readonly missing_coordinate_count: number;
  readonly hard_eligible_count: number;
  readonly coverage_ratio: number;
  readonly tmin_seconds: number | null;
  readonly frontier_threshold_seconds: number | null;
  readonly max_geo_regret_seconds: number;
  readonly route_domain_closed: boolean;
  readonly max_route_elements_per_run: number;
  readonly max_route_destinations_per_call: number;
  readonly max_provider_calls_per_lead: number;
  readonly provider_timeout_ms: number;
  readonly placements: GeoFrontierPlacement[];
  readonly inside_frontier_vendor_ids: string[];
  readonly outside_frontier_vendor_ids: string[];
  readonly unmeasured_vendor_ids: string[];
  readonly route_ordered_vendor_ids: string[];
  /** Load-bearing negative assertions, mirrored from QF-MVP-75.02's style. */
  readonly route_is_assignment_authority: false;
  readonly route_is_eligibility_authority: false;
  readonly route_provider_payload_persisted: false;
  readonly route_package_weighted: false;
}

export interface RouteTimeRunOutcome {
  readonly decision: RouteFrontierDecision;
  readonly placements: Map<string, GeoFrontierPlacement>;
  readonly evidence: Omit<RouteTimeEvidence, "route_ordered_vendor_ids">;
}

/**
 * Build the deterministic routing domain.
 *
 * Order is (straight-line km ASC, vendor id ASC). Straight-line distance is used
 * ONLY to decide the order in which vendors are offered to the provider and to
 * support the closure proof — it never ranks a vendor and never excludes one on
 * its own. A candidate with no coordinate is not routable and is reported
 * separately as MISSING_COORDINATE.
 */
export function buildRouteDomain(candidates: readonly RouteCandidateInput[]): {
  destinations: RouteDestination[];
  missingCoordinateVendorIds: string[];
} {
  const destinations: RouteDestination[] = [];
  const missingCoordinateVendorIds: string[] = [];

  for (const candidate of candidates) {
    if (
      typeof candidate.latitude !== "number" ||
      typeof candidate.longitude !== "number" ||
      !Number.isFinite(candidate.latitude) ||
      !Number.isFinite(candidate.longitude)
    ) {
      missingCoordinateVendorIds.push(candidate.id);
      continue;
    }
    destinations.push({
      vendor_id: candidate.id,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      // A coordinate-known vendor whose haversine is somehow absent sorts last
      // among the routable set rather than being dropped from it.
      straight_line_km: Number.isFinite(candidate.distance_km as number)
        ? (candidate.distance_km as number)
        : Number.POSITIVE_INFINITY,
    });
  }

  destinations.sort((a, b) =>
    a.straight_line_km !== b.straight_line_km
      ? a.straight_line_km - b.straight_line_km
      : a.vendor_id.localeCompare(b.vendor_id),
  );

  return { destinations, missingCoordinateVendorIds };
}

function emptyEvidence(
  policy: RouteTimePolicy,
  credentialStatus: RouteProviderCredentialStatus,
  reason: RouteFrontierOutcome,
  hardEligibleCount: number,
  missingCoordinateCount: number,
  notRoutedCount: number,
): Omit<RouteTimeEvidence, "route_ordered_vendor_ids"> {
  return {
    route_contract_version: ROUTE_TIME_CONTRACT_VERSION,
    geo_frontier_contract_version: GEO_FRONTIER_CONTRACT_VERSION,
    route_policy_version: policy.version,
    route_provider_id: policy.providerId,
    route_travel_mode: policy.travelMode,
    route_routing_preference: policy.routingPreference,
    route_departure_time_used: false,
    route_time_metric: ROUTE_TIME_METRIC,
    route_authority_engaged: false,
    route_fallback_reason: reason,
    route_credential_status: credentialStatus,
    provider_call_count: 0,
    requested_destination_count: 0,
    successful_route_count: 0,
    failed_route_count: 0,
    arbitrary_failure_count: 0,
    protocol_violation_count: 0,
    deduplicated_destination_count: 0,
    not_routed_due_to_bound_count: notRoutedCount,
    missing_coordinate_count: missingCoordinateCount,
    hard_eligible_count: hardEligibleCount,
    coverage_ratio: 0,
    tmin_seconds: null,
    frontier_threshold_seconds: null,
    max_geo_regret_seconds: policy.maxGeoRegretSeconds,
    route_domain_closed: false,
    max_route_elements_per_run: policy.maxRouteElementsPerRun,
    max_route_destinations_per_call: policy.maxRouteDestinationsPerCall,
    max_provider_calls_per_lead: policy.maxProviderCallsPerLead,
    provider_timeout_ms: policy.providerTimeoutMs,
    placements: [],
    inside_frontier_vendor_ids: [],
    outside_frontier_vendor_ids: [],
    unmeasured_vendor_ids: [],
    route_is_assignment_authority: false,
    route_is_eligibility_authority: false,
    route_provider_payload_persisted: false,
    route_package_weighted: false,
  };
}

function notEngaged(
  policy: RouteTimePolicy,
  credentialStatus: RouteProviderCredentialStatus,
  reason: RouteFrontierOutcome,
  candidates: readonly RouteCandidateInput[],
  missingCoordinateCount: number,
  notRoutedCount: number,
): RouteTimeRunOutcome {
  return {
    decision: {
      outcome: reason,
      engaged: false,
      tmin_seconds: null,
      frontier_threshold_seconds: null,
      domain_closed: false,
      successful_count: 0,
      failed_count: 0,
      arbitrary_failure_count: 0,
      coverage_ratio: 0,
      placements: [],
      inside_frontier_vendor_ids: [],
      outside_frontier_vendor_ids: [],
      unmeasured_vendor_ids: [],
    },
    placements: new Map(),
    evidence: emptyEvidence(
      policy, credentialStatus, reason, candidates.length, missingCoordinateCount, notRoutedCount,
    ),
  };
}

/**
 * Measure route times for one lead and decide the geographic frontier.
 *
 * NEVER THROWS. Every abnormal path — provider off, no credential, no lead
 * coordinate, too small a domain, a provider failure, a malformed payload —
 * returns a typed outcome whose `engaged` is false, and the caller then takes the
 * deterministic pre-75.03 path it would have taken anyway. No outcome of this
 * module can block a lead, shrink supply, debit a credit or assign a vendor.
 */
export async function measureLeadRouteTimes(input: RouteTimeRunInput): Promise<RouteTimeRunOutcome> {
  const policy = input.policy ?? resolveRouteTimePolicy();
  try {
    return await runRouteTimeMeasurement(input, policy);
  } catch (e) {
    // Load-bearing. Route time is an ENHANCEMENT to matching, never a
    // precondition for it: an unexpected defect anywhere in this seam must cost
    // the lead its route evidence, never its assignment. The run continues on
    // the deterministic pre-75.03 order.
    console.warn("[route time] measurement threw", {
      message: e instanceof Error ? e.message : "Unknown error",
    });
    return notEngaged(policy, "disabled", "route_provider_incomplete", input.candidates, 0, 0);
  }
}

async function runRouteTimeMeasurement(
  input: RouteTimeRunInput,
  policy: RouteTimePolicy,
): Promise<RouteTimeRunOutcome> {
  const env = input.env ?? (process.env as EnvLike);
  const candidates = input.candidates;


  const { destinations, missingCoordinateVendorIds } = buildRouteDomain(candidates);

  if (!input.leadOrigin) {
    return notEngaged(
      policy, "disabled", "no_lead_coordinate", candidates,
      missingCoordinateVendorIds.length, destinations.length,
    );
  }

  // Resolve the provider BEFORE any work that costs anything.
  let provider = input.provider ?? null;
  let credentialStatus: RouteProviderCredentialStatus = "configured";
  if (!provider) {
    const created = createRouteTimeProvider({ policy, env, transport: input.transport });
    provider = created.provider;
    credentialStatus = created.credentialStatus;
  }
  if (!provider) {
    const reason: RouteFrontierOutcome =
      credentialStatus === "disabled" ? "route_provider_disabled" : "route_provider_not_configured";
    return notEngaged(
      policy, credentialStatus, reason, candidates,
      missingCoordinateVendorIds.length, destinations.length,
    );
  }

  // MANDATORY per-run de-duplication: one element per distinct coordinate.
  const deduplicated = deduplicateRouteDomain(destinations);
  const plan = planRouteBatches(deduplicated.unique, policy);

  if (plan.batches.length === 0) {
    return notEngaged(
      policy, credentialStatus, "insufficient_route_domain", candidates,
      missingCoordinateVendorIds.length, destinations.length,
    );
  }

  // -- bounded, deterministic, sequential batches ----------------------------
  // Sequential, not concurrent: the total provider budget is a WALL-CLOCK bound,
  // and a concurrent fan-out would make it unenforceable while multiplying the
  // instantaneous rate against the provider's quota.
  const measurements: RouteMeasurement[] = [];
  let protocolViolationCount = 0;
  let providerCallCount = 0;
  let budgetRemainingMs = policy.totalProviderBudgetMs;

  for (const batch of plan.batches) {
    if (budgetRemainingMs <= 0) {
      // Budget exhausted mid-plan. The remaining batches are NOT sent, and their
      // destinations are reported explicitly rather than silently omitted.
      for (const destination of batch) {
        measurements.push({
          vendor_id: destination.vendor_id,
          status: "NOT_ROUTED_DUE_TO_BOUND",
          travel_time_seconds: null,
          distance_meters: null,
        });
      }
      continue;
    }

    const startedAt = Date.now();
    let result;
    try {
      // The remaining budget is a CEILING on this call: it can only shorten the
      // configured timeout, and it still drives a real AbortController.
      result = await provider.routeMatrix({
        origin: input.leadOrigin,
        destinations: batch,
        timeoutCeilingMs: budgetRemainingMs,
      });
    } catch {
      // The adapter is written not to throw; this is the belt-and-braces path.
      // An unexpected throw is INFRASTRUCTURE, so it must never look like "no route".
      result = {
        measurements: batch.map((d) => ({
          vendor_id: d.vendor_id,
          status: "PROVIDER_5XX" as const,
          travel_time_seconds: null,
          distance_meters: null,
        })),
        protocolViolationCount: 0,
        providerRequestId: null,
      };
    }
    providerCallCount += 1;
    protocolViolationCount += result.protocolViolationCount;
    measurements.push(...result.measurements);
    budgetRemainingMs -= Math.max(0, Date.now() - startedAt);
  }

  // Fan each measurement back out to every vendor sharing that coordinate. One
  // element was paid for; every vendor at that exact point gets that same trip.
  const keyByRepresentative = new Map<string, string>();
  for (const destination of deduplicated.unique) {
    keyByRepresentative.set(destination.vendor_id, routeCoordinateKey(destination.latitude, destination.longitude));
  }
  const fanned: RouteMeasurement[] = [];
  for (const measurement of measurements) {
    const key = keyByRepresentative.get(measurement.vendor_id);
    const shared = (key ? deduplicated.vendorIdsByKey.get(key) : undefined) ?? [measurement.vendor_id];
    for (const vendorId of shared) {
      fanned.push({ ...measurement, vendor_id: vendorId });
    }
  }

  const decision = decideRouteFrontier({
    eligibleVendorIds: candidates.map((c) => c.id),
    measurements: fanned,
    deferred: plan.deferred,
    missingCoordinateVendorIds,
    policy,
  });

  const notRoutedCount =
    plan.deferred.length + fanned.filter((m) => m.status === "NOT_ROUTED_DUE_TO_BOUND").length;

  const placements = new Map<string, GeoFrontierPlacement>();
  for (const placement of decision.placements) placements.set(placement.vendor_id, placement);

  return {
    decision,
    placements,
    evidence: {
      route_contract_version: ROUTE_TIME_CONTRACT_VERSION,
      geo_frontier_contract_version: GEO_FRONTIER_CONTRACT_VERSION,
      route_policy_version: policy.version,
      route_provider_id: policy.providerId,
      route_travel_mode: policy.travelMode,
      route_routing_preference: policy.routingPreference,
      route_departure_time_used: false,
      route_time_metric: ROUTE_TIME_METRIC,
      route_authority_engaged: decision.engaged,
      route_fallback_reason: decision.outcome,
      route_credential_status: credentialStatus,
      provider_call_count: providerCallCount,
      requested_destination_count: plan.elementCount,
      successful_route_count: decision.successful_count,
      failed_route_count: decision.failed_count,
      arbitrary_failure_count: decision.arbitrary_failure_count,
      protocol_violation_count: protocolViolationCount,
      deduplicated_destination_count: deduplicated.duplicateCount,
      not_routed_due_to_bound_count: notRoutedCount,
      missing_coordinate_count: missingCoordinateVendorIds.length,
      hard_eligible_count: candidates.length,
      coverage_ratio: decision.coverage_ratio,
      tmin_seconds: decision.tmin_seconds,
      frontier_threshold_seconds: decision.frontier_threshold_seconds,
      max_geo_regret_seconds: policy.maxGeoRegretSeconds,
      route_domain_closed: decision.domain_closed,
      max_route_elements_per_run: policy.maxRouteElementsPerRun,
      max_route_destinations_per_call: policy.maxRouteDestinationsPerCall,
      max_provider_calls_per_lead: policy.maxProviderCallsPerLead,
      provider_timeout_ms: policy.providerTimeoutMs,
      placements: decision.placements,
      inside_frontier_vendor_ids: decision.inside_frontier_vendor_ids,
      outside_frontier_vendor_ids: decision.outside_frontier_vendor_ids,
      unmeasured_vendor_ids: decision.unmeasured_vendor_ids,
      route_is_assignment_authority: false,
      route_is_eligibility_authority: false,
      route_provider_payload_persisted: false,
      route_package_weighted: false,
    },
  };
}
