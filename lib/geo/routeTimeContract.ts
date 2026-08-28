// ============================================================================
// QuickFurno — lib/geo/routeTimeContract.ts
//
// QF-MVP-75.03 — the PURE, PROVIDER-NEUTRAL route-time contract: element status
// normalization, deterministic batching, per-run de-duplication, Tmin, GeoRegret
// and the geographic frontier.
//
// WHY THIS MODULE EXISTS
//   QF-MVP-75.02 could only measure straight-line kilometres, and said so in
//   every field name. The locked geography rule makes ROUTE TRAVEL TIME the
//   primary measure, so the system needs one statement of what a route
//   measurement is, what its failure modes are, and how a set of them becomes a
//   business frontier. Google specifics live in lib/geo/googleRouteMatrixProtocol
//   and the I/O lives in services/routeTimeProviderService; nothing here knows
//   either exists.
//
// PURITY CONTRACT — load-bearing.
//   No I/O, no Supabase client, no network, no clock, no randomness, no global
//   state, no process.env read. Every function is a total function of its
//   arguments, so the offline MVP suite exercises the real production code
//   rather than a copy of it.
//
// WHAT THIS MODULE IS NOT
//   It is not an eligibility authority, it performs no assignment, it debits no
//   credit and it never reaches public.qf_assign_lead_vendors_v2. It decides an
//   ORDER; the canonical authority still decides every outcome.
// ============================================================================

import type { RouteTimePolicy } from "./routeTimePolicy";

/**
 * Contract version for the route measurement + evidence SHAPE. Bump only when a
 * reader must notice a change. Mirrored into every matching_snapshot as
 * `route.route_contract_version`.
 */
export const ROUTE_TIME_CONTRACT_VERSION = 1;

/**
 * How the reported travel time was produced. Recorded verbatim in every snapshot
 * so a reader can never mistake it for a straight-line number, and so the
 * QF-MVP-75.02 metric label and this one can never be confused.
 */
export const ROUTE_TIME_METRIC = "google_routes_compute_route_matrix_drive_traffic_unaware_duration_seconds";

// ---------------------------------------------------------------------------
// Element status
// ---------------------------------------------------------------------------

/**
 * The normalized per-destination outcome. Every provider-specific condition,
 * HTTP status and transport failure collapses into exactly one of these, so no
 * downstream rule ever reads a Google-shaped value.
 */
export const ROUTE_ELEMENT_STATUSES = [
  /** A route was found and a usable duration was parsed. */
  "SUCCESS",
  /** The provider positively reported that no route exists. A geography fact. */
  "NO_ROUTE",
  /** The provider returned an element we cannot trust: bad/duplicate/absent index, non-OK element status. */
  "INVALID_PROVIDER_ELEMENT",
  /** The request was cancelled by our own AbortController. */
  "PROVIDER_TIMEOUT",
  /** HTTP 429. */
  "PROVIDER_RATE_LIMIT",
  /** HTTP 401 / 403. */
  "PROVIDER_AUTH",
  /** HTTP 5xx, or a transport-level network failure. */
  "PROVIDER_5XX",
  /** The body was not parseable, not an array, or a duration was unreadable. */
  "MALFORMED_RESPONSE",
  /** The vendor holds no canonical coordinate, so it was never routable. */
  "MISSING_COORDINATE",
  /** Not sent to the provider because a configured bound was reached. */
  "NOT_ROUTED_DUE_TO_BOUND",
] as const;

export type RouteElementStatus = (typeof ROUTE_ELEMENT_STATUSES)[number];

export function isRouteElementStatus(value: unknown): value is RouteElementStatus {
  return typeof value === "string" && (ROUTE_ELEMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * THE distinction the whole failure contract turns on.
 *
 * An ARBITRARY status is one whose occurrence depends on infrastructure luck
 * rather than on the data: the same lead, the same vendors and the same
 * coordinates could produce it on one run and not the next. If such a status
 * touches even one hard-eligible candidate, applying the frontier would let an
 * outage decide which vendor wins a lead — so the run falls back to the
 * deterministic pre-75.03 order instead.
 *
 * SUCCESS, NO_ROUTE and MISSING_COORDINATE are NOT arbitrary: they are stable
 * facts about the data and the map, and pre-75.03 MatchCore already ranked on
 * exactly such a fact (`has_coordinates DESC`).
 *
 * NOT_ROUTED_DUE_TO_BOUND is not listed either, because on its own it means
 * nothing: it is safe precisely when the domain was proven CLOSED
 * (isRouteDomainClosed) and unsafe otherwise, and that is decided separately.
 */
export const ARBITRARY_ROUTE_STATUSES: readonly RouteElementStatus[] = Object.freeze([
  "INVALID_PROVIDER_ELEMENT",
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_AUTH",
  "PROVIDER_5XX",
  "MALFORMED_RESPONSE",
]);

export function isArbitraryRouteStatus(status: RouteElementStatus): boolean {
  return ARBITRARY_ROUTE_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Measurement shapes
// ---------------------------------------------------------------------------

/** One vendor destination offered to the provider. */
export interface RouteDestination {
  readonly vendor_id: string;
  readonly latitude: number;
  readonly longitude: number;
  /** Great-circle km from the lead. Ordering + admissible-pruning input ONLY. */
  readonly straight_line_km: number;
}

/** One normalized measurement. `travel_time_seconds` is set only on SUCCESS. */
export interface RouteMeasurement {
  readonly vendor_id: string;
  readonly status: RouteElementStatus;
  /** Integer seconds. Never fractional, so the frontier cannot round-trip a tie. */
  readonly travel_time_seconds: number | null;
  /** Supporting evidence only. Travel time is the primary measure. */
  readonly distance_meters: number | null;
}

/** Non-sensitive provider metadata. Never a key, never a raw body. */
export interface RouteProviderMetadata {
  readonly provider_id: string;
  readonly travel_mode: string;
  readonly routing_preference: string;
  readonly provider_call_count: number;
  readonly requested_destination_count: number;
  /** Provider-side request identifier when the transport exposes one; else null. */
  readonly provider_request_ids: string[];
}

// ---------------------------------------------------------------------------
// Duration parsing
// ---------------------------------------------------------------------------

/**
 * Parse a protobuf Duration string ("123s", "3.5s") into INTEGER seconds.
 *
 * Rounds UP. A fractional duration is rounded away from zero so a measurement
 * can never be reported as faster than it was, which keeps the frontier from
 * promoting a vendor on a rounding artefact. Equal inputs still produce equal
 * outputs, so the "equal route time => equal regret" property survives.
 *
 * Returns null for anything that is not a finite, non-negative, `s`-suffixed
 * numeric string — including numbers, null, "", "123", "abc" and "-5s".
 */
export function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?s$/.test(trimmed)) return null;
  const parsed = Number(trimmed.slice(0, -1));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.ceil(parsed);
}

/** A non-negative integer metre count, or null. */
export function parseDistanceMeters(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

// ---------------------------------------------------------------------------
// Per-run de-duplication
// ---------------------------------------------------------------------------

/** 6 decimal places ~ 0.11 m. Two vendors inside that are the same trip. */
const COORDINATE_KEY_PRECISION = 6;

/** The de-duplication key for one lead/vendor coordinate pair within one run. */
export function routeCoordinateKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(COORDINATE_KEY_PRECISION)},${longitude.toFixed(COORDINATE_KEY_PRECISION)}`;
}

export interface DeduplicatedRouteDomain {
  /** One representative destination per distinct coordinate, order preserved. */
  readonly unique: RouteDestination[];
  /** Coordinate key -> every vendor id sharing it, in the input order. */
  readonly vendorIdsByKey: Map<string, string[]>;
  /** How many provider elements the de-duplication avoided paying for. */
  readonly duplicateCount: number;
}

/**
 * MANDATORY per-matching-run de-duplication (phase brief, section 14): the same
 * lead/vendor coordinate pair is never routed twice in one run. Two vendors that
 * share an office building share one element and one measurement.
 *
 * The FIRST vendor at a coordinate is the representative, and the input order is
 * the deterministic (straight_line_km ASC, vendor_id ASC) order, so the choice of
 * representative is deterministic too.
 */
export function deduplicateRouteDomain(destinations: readonly RouteDestination[]): DeduplicatedRouteDomain {
  const unique: RouteDestination[] = [];
  const vendorIdsByKey = new Map<string, string[]>();
  let duplicateCount = 0;

  for (const destination of destinations) {
    const key = routeCoordinateKey(destination.latitude, destination.longitude);
    const existing = vendorIdsByKey.get(key);
    if (existing) {
      existing.push(destination.vendor_id);
      duplicateCount += 1;
      continue;
    }
    vendorIdsByKey.set(key, [destination.vendor_id]);
    unique.push(destination);
  }

  return { unique, vendorIdsByKey, duplicateCount };
}

// ---------------------------------------------------------------------------
// Deterministic batching
// ---------------------------------------------------------------------------

export interface RouteBatchPlan {
  /** The batches actually sent, in order. Never empty batches. */
  readonly batches: RouteDestination[][];
  /** Destinations that will be measured. */
  readonly routed: RouteDestination[];
  /** Destinations a bound excluded. NOT_ROUTED_DUE_TO_BOUND. */
  readonly deferred: RouteDestination[];
  /** Billable elements this plan will consume (1 origin x N destinations). */
  readonly elementCount: number;
  /** Provider requests this plan will make. */
  readonly callCount: number;
}

/**
 * Plan the provider calls for one lead, deterministically.
 *
 * There is no sampling, no truncation-by-luck and no randomness: the input order
 * is fixed, the prefix that fits every bound is routed, and the remainder is
 * reported EXPLICITLY as deferred so a reader can see exactly what was not
 * measured. Silent truncation is the failure this function exists to prevent.
 *
 * The effective routed count is the minimum of three independent bounds:
 *   - the domain itself,
 *   - `maxRouteElementsPerRun` (the per-lead billable ceiling),
 *   - `maxProviderCallsPerLead * maxRouteDestinationsPerCall`.
 *
 * Compute Route Matrix requires two or more destinations, so a domain smaller
 * than `minRouteDestinations` produces NO call at all — the provider is never
 * asked a question it is documented to reject.
 */
export function planRouteBatches(
  destinations: readonly RouteDestination[],
  policy: RouteTimePolicy,
): RouteBatchPlan {
  const perCall = policy.maxRouteDestinationsPerCall;
  const capacity = Math.min(
    destinations.length,
    policy.maxRouteElementsPerRun,
    policy.maxProviderCallsPerLead * perCall,
  );

  if (capacity < policy.minRouteDestinations) {
    return {
      batches: [],
      routed: [],
      deferred: [...destinations],
      elementCount: 0,
      callCount: 0,
    };
  }

  const routed = destinations.slice(0, capacity);
  const deferred = destinations.slice(capacity);
  const batches: RouteDestination[][] = [];
  for (let i = 0; i < routed.length; i += perCall) {
    batches.push(routed.slice(i, i + perCall));
  }

  // A trailing batch of one would be rejected by the provider (two-destination
  // minimum). Merge it back into its predecessor; the merged batch is still
  // within `maxRouteDestinationsPerCall + 1`, which is far below any real
  // ceiling, and merging never drops a destination.
  if (batches.length > 1 && batches[batches.length - 1].length < policy.minRouteDestinations) {
    const tail = batches.pop() as RouteDestination[];
    batches[batches.length - 1] = [...batches[batches.length - 1], ...tail];
  }

  return { batches, routed, deferred, elementCount: routed.length, callCount: batches.length };
}

// ---------------------------------------------------------------------------
// Tmin + GeoRegret
// ---------------------------------------------------------------------------

/**
 * Tmin = the best VALID route travel time in the comparable candidate set.
 *
 * Only SUCCESS contributes. A failed, missing-coordinate, deferred or no-route
 * measurement is excluded entirely, so an outage can never lower Tmin and
 * thereby push real vendors outside the frontier.
 *
 * Returns null when the set holds no successful measurement.
 */
export function computeTminSeconds(measurements: readonly RouteMeasurement[]): number | null {
  let tmin: number | null = null;
  for (const m of measurements) {
    if (m.status !== "SUCCESS") continue;
    const t = m.travel_time_seconds;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) continue;
    if (tmin === null || t < tmin) tmin = t;
  }
  return tmin;
}

/**
 * GeoRegret = VendorTravelTime - Tmin.
 *
 * Non-negative by construction, because Tmin is the minimum over the same set.
 * The `Math.max(0, ...)` is belt-and-braces against a caller passing a Tmin from
 * a different set, never a mask for a real negative.
 */
export function computeGeoRegretSeconds(travelTimeSeconds: number, tminSeconds: number): number {
  return Math.max(0, travelTimeSeconds - tminSeconds);
}

// ---------------------------------------------------------------------------
// Admissible closure proof
// ---------------------------------------------------------------------------

/**
 * A true LOWER BOUND on the travel time to a point `straightLineKm` away.
 *
 * Road distance is never shorter than the great-circle distance, so a trip
 * cannot be faster than covering the great-circle distance at the maximum
 * assumed speed. Rounded DOWN so the bound stays a bound.
 */
export function minimumPossibleTravelTimeSeconds(straightLineKm: number, maxAssumedSpeedKmph: number): number {
  if (!Number.isFinite(straightLineKm) || straightLineKm <= 0) return 0;
  return Math.floor((straightLineKm / maxAssumedSpeedKmph) * 3600);
}

/**
 * Is the route domain CLOSED — that is, can we prove no unrouted vendor could
 * have been inside the frontier?
 *
 * Two ways to be closed:
 *   1. nothing was deferred, so there is nothing left to prove; or
 *   2. even the NEAREST deferred vendor cannot physically reach the frontier:
 *      its minimum possible travel time already exceeds Tmin + maxGeoRegret.
 *
 * `deferred` arrives in ascending straight-line order, so the nearest deferred
 * vendor bounds all the others. When this returns false the run must NOT apply
 * the frontier: a vendor current business rules permit to win was never
 * measured, and silently ranking it last would be exactly the exclusion
 * QF-MVP-75.02 refused to make.
 */
export function isRouteDomainClosed(
  deferred: readonly RouteDestination[],
  tminSeconds: number,
  policy: RouteTimePolicy,
): boolean {
  if (deferred.length === 0) return true;
  let nearestKm = Number.POSITIVE_INFINITY;
  for (const d of deferred) {
    if (d.straight_line_km < nearestKm) nearestKm = d.straight_line_km;
  }
  if (!Number.isFinite(nearestKm)) return false;
  const lowerBound = minimumPossibleTravelTimeSeconds(nearestKm, policy.maxAssumedSpeedKmph);
  return lowerBound > tminSeconds + policy.maxGeoRegretSeconds;
}
