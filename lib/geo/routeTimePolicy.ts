// ============================================================================
// QuickFurno — lib/geo/routeTimePolicy.ts
//
// QF-MVP-75.03 — the ONE typed, versioned GeoPolicy for route-time matching.
//
// WHY A MODULE AND NOT A TABLE
//   QF-MVP-75.03 needs a handful of bounded numbers (a regret threshold, call
//   and element ceilings, timeouts, activation thresholds). The repository
//   already has a persisted policy plane — public.automation_policy_configs —
//   but it is bound to the AOS automation/dispatch domain
//   (lib/aos/policy/runtime/policyConfigStoreAdapter, vendorDispatchRegistry,
//   automationVendorExecutionService) and is keyed by workflow policy_key. It is
//   not a matching plane, and reusing it would require a migration to seed a row
//   plus a semantic lie about what the row governs.
//
//   So this slice takes the SMALLEST typed/versioned seam that removes magic
//   numbers from code: one frozen default, one pure resolver, one version. A
//   persisted DRAFT -> SIMULATION -> SHADOW -> ACTIVATE lifecycle is deliberately
//   NOT built here; that is later work (QF-MVP-75.07 territory) and would need a
//   migration this phase does not require.
//
// PURITY CONTRACT — load-bearing.
//   No I/O, no Supabase client, no network, no clock, no randomness, no global
//   state, no process.env read. Every function is a total function of its
//   arguments, so the offline suite exercises the real production values.
// ============================================================================

/**
 * Contract version for the route-time policy SHAPE. Bump only when a reader must
 * notice a change. Mirrored into every matching_snapshot as
 * `route.route_policy_version`.
 */
export const ROUTE_TIME_POLICY_VERSION = 1;

/** The one provider identity this slice implements. Provider-neutral by shape. */
export const ROUTE_TIME_PROVIDER_ID = "google_routes_compute_route_matrix";

/**
 * The single routing mode QF-MVP-75.03 locks.
 *
 * DRIVE — QuickFurno vendors travel to a client site by road with tools and
 * material samples; no other mode describes that trip. TRANSIT / BICYCLE /
 * TWO_WHEELER are deliberately absent: no product source asks for them, each
 * would add a second Tmin domain that is not comparable with the first, and a
 * mixed-mode Tmin is meaningless.
 */
export const ROUTE_TRAVEL_MODE = "DRIVE";

/**
 * TRAFFIC_UNAWARE — deliberate, and the CHEAPEST of the three Routes API
 * routing preferences.
 *
 * Three reasons, in order of weight:
 *   1. GeoRegret is a RELATIVE measure. Every vendor in one run is measured from
 *      the same origin in the same request, and Tmin is subtracted before the
 *      frontier is applied. A uniform traffic bias cancels almost entirely.
 *   2. DETERMINISM. A baseline duration is reproducible: re-running the same
 *      lead a day later yields the same evidence, so `matching_snapshot` can be
 *      audited. TRAFFIC_AWARE_OPTIMAL makes yesterday's assignment unexplainable.
 *   3. COST + BOUNDS. TRAFFIC_AWARE_OPTIMAL is the most expensive SKU and caps a
 *      request at 100 elements instead of 625.
 *
 * `departureTime` is therefore NOT sent. Time-of-day modelling is explicitly out
 * of scope for 75.03 (see the phase brief, section 7).
 */
export const ROUTE_ROUTING_PREFERENCE = "TRAFFIC_UNAWARE";

export interface RouteTimePolicy {
  readonly version: number;
  readonly providerId: typeof ROUTE_TIME_PROVIDER_ID;
  readonly travelMode: typeof ROUTE_TRAVEL_MODE;
  readonly routingPreference: typeof ROUTE_ROUTING_PREFERENCE;
  /** Locked false for 75.03 — see ROUTE_ROUTING_PREFERENCE. */
  readonly departureTimeUsed: false;

  // -- the geographic frontier ------------------------------------------------
  /**
   * A vendor is GEOGRAPHICALLY COMPARABLE when its travel time is within this
   * many seconds of Tmin. 900s = 15 minutes: within a Pune-sized service area a
   * vendor a quarter of an hour further than the closest is still a credible
   * option, while one 40 minutes further is not the same geographic proposition.
   */
  readonly maxGeoRegretSeconds: number;

  // -- provider bounds (cost control) ----------------------------------------
  /** Destinations in ONE Compute Route Matrix request. Far below Google's 625. */
  readonly maxRouteDestinationsPerCall: number;
  /** Hard element ceiling for ONE matching run. 1 origin x N destinations = N. */
  readonly maxRouteElementsPerRun: number;
  /** Hard ceiling on provider requests for one lead. There is NO retry. */
  readonly maxProviderCallsPerLead: number;
  /** Per-request timeout, enforced by a real AbortController. */
  readonly providerTimeoutMs: number;
  /** Wall-clock ceiling across every provider request for one lead. */
  readonly totalProviderBudgetMs: number;

  // -- activation thresholds --------------------------------------------------
  /**
   * Compute Route Matrix requires at least one origin and TWO OR MORE
   * destinations. Below this the provider is never called at all.
   */
  readonly minRouteDestinations: number;
  /** Fewer successful results than this and Tmin is not trustworthy. */
  readonly minSuccessfulRouteResults: number;
  /**
   * Share of the hard-eligible pool that must have produced a SUCCESS before
   * route time is allowed to decide anything. Below it the geographic picture is
   * too incomplete, and the run keeps the deterministic pre-75.03 order.
   */
  readonly minRoutedCoverageRatio: number;

  // -- admissible pruning -----------------------------------------------------
  /**
   * Upper bound on achievable average road speed, used ONLY to prove that an
   * UNROUTED vendor cannot be inside the frontier:
   *
   *   travelTimeSeconds >= straightLineKm / maxAssumedSpeedKmph * 3600
   *
   * Road distance is never shorter than the great-circle distance, so this is a
   * true lower bound on travel time. 80 km/h is far above any real Indian urban
   * average, and OVER-estimating it only makes the bound WEAKER — the proof
   * fails more often and more vendors get routed. The assumption therefore errs
   * safe by construction: it can never prune a vendor that could have won.
   */
  readonly maxAssumedSpeedKmph: number;
}

/**
 * The frozen default policy. These are the values 75.03 ships with; the resolver
 * below is the only way to vary them, and it clamps every field.
 *
 * COST NOTE, stated plainly because it is a real business number: Compute Route
 * Matrix is billed per ELEMENT (origins x destinations). One origin x N vendors
 * = N elements, so `maxRouteElementsPerRun` is the per-lead ceiling on billable
 * elements. At 50 it is a small multiple of a lead's value, and the bound is
 * reached only when a single city/category has more than 50 credit-carrying
 * vendors with coordinates. Package tier is not an input here and can never
 * raise it.
 */
export const DEFAULT_ROUTE_TIME_POLICY: RouteTimePolicy = Object.freeze({
  version: ROUTE_TIME_POLICY_VERSION,
  providerId: ROUTE_TIME_PROVIDER_ID,
  travelMode: ROUTE_TRAVEL_MODE,
  routingPreference: ROUTE_ROUTING_PREFERENCE,
  departureTimeUsed: false as const,

  maxGeoRegretSeconds: 900,

  maxRouteDestinationsPerCall: 25,
  maxRouteElementsPerRun: 50,
  maxProviderCallsPerLead: 2,
  providerTimeoutMs: 4000,
  totalProviderBudgetMs: 9000,

  minRouteDestinations: 2,
  minSuccessfulRouteResults: 2,
  minRoutedCoverageRatio: 0.6,

  maxAssumedSpeedKmph: 80,
});

/** Google's documented general ceiling. An OUTER limit, never an app target. */
export const GOOGLE_ROUTE_MATRIX_MAX_ELEMENTS = 625;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function clampRatio(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

export type RouteTimePolicyOverrides = Partial<
  Pick<
    RouteTimePolicy,
    | "maxGeoRegretSeconds"
    | "maxRouteDestinationsPerCall"
    | "maxRouteElementsPerRun"
    | "maxProviderCallsPerLead"
    | "providerTimeoutMs"
    | "totalProviderBudgetMs"
    | "minRouteDestinations"
    | "minSuccessfulRouteResults"
    | "minRoutedCoverageRatio"
    | "maxAssumedSpeedKmph"
  >
>;

/**
 * Resolve an effective policy from optional overrides.
 *
 * Every numeric field is clamped, so a malformed or hostile override can never
 * produce an unbounded provider spend, a zero timeout or a negative frontier.
 * The provider identity, travel mode, routing preference and departure-time
 * behaviour are NOT overridable in this slice: changing them changes what the
 * measured number MEANS, and that requires a contract version bump, not config.
 */
export function resolveRouteTimePolicy(overrides?: RouteTimePolicyOverrides | null): RouteTimePolicy {
  const d = DEFAULT_ROUTE_TIME_POLICY;
  const o = overrides ?? {};
  return Object.freeze({
    version: ROUTE_TIME_POLICY_VERSION,
    providerId: ROUTE_TIME_PROVIDER_ID,
    travelMode: ROUTE_TRAVEL_MODE,
    routingPreference: ROUTE_ROUTING_PREFERENCE,
    departureTimeUsed: false as const,

    maxGeoRegretSeconds: clampInt(o.maxGeoRegretSeconds, 0, 24 * 3600, d.maxGeoRegretSeconds),

    // Never above Google's documented general ceiling, and never below the
    // two-destination minimum the API itself requires.
    maxRouteDestinationsPerCall: clampInt(
      o.maxRouteDestinationsPerCall, 2, GOOGLE_ROUTE_MATRIX_MAX_ELEMENTS, d.maxRouteDestinationsPerCall,
    ),
    maxRouteElementsPerRun: clampInt(
      o.maxRouteElementsPerRun, 0, GOOGLE_ROUTE_MATRIX_MAX_ELEMENTS, d.maxRouteElementsPerRun,
    ),
    maxProviderCallsPerLead: clampInt(o.maxProviderCallsPerLead, 0, 10, d.maxProviderCallsPerLead),
    providerTimeoutMs: clampInt(o.providerTimeoutMs, 250, 30_000, d.providerTimeoutMs),
    totalProviderBudgetMs: clampInt(o.totalProviderBudgetMs, 250, 60_000, d.totalProviderBudgetMs),

    minRouteDestinations: clampInt(o.minRouteDestinations, 2, 100, d.minRouteDestinations),
    minSuccessfulRouteResults: clampInt(o.minSuccessfulRouteResults, 1, 100, d.minSuccessfulRouteResults),
    minRoutedCoverageRatio: clampRatio(o.minRoutedCoverageRatio, d.minRoutedCoverageRatio),

    maxAssumedSpeedKmph: clampInt(o.maxAssumedSpeedKmph, 1, 400, d.maxAssumedSpeedKmph),
  });
}
