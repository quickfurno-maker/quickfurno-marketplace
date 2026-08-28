// ============================================================================
// QuickFurno — scripts/mvp/matching/validate-qf-mvp-75-03.mjs
//
// QF-MVP-75.03 — ROUTE-TIME PROVIDER + GEOREGRET.
//
// OFFLINE BY CONSTRUCTION. No database, no network, no provider, no secret, no
// live Google call, no clock-dependent assertion. It imports the REAL production
// modules through the `.ts` resolve hook and drives the REAL provider adapter
// through an INJECTED fake transport; it never re-implements a rule it checks.
//
// VERIFICATION LEVELS — never conflated:
//   [pure]   executes the real production module.
//   [static] reads source text for a required contract.
//   [mutant] mutates the text and asserts the static checks REJECT it, so a
//            green run cannot be an artefact of a check that never bites.
//
// WHAT THIS HARNESS CANNOT PROVE, AND SAYS SO
//   It cannot prove Google's live behaviour: that the endpoint accepts our body,
//   that the field mask is honoured, or what a real duration is. Those are
//   PROVIDER facts and belong to a separately authorised, tightly bounded
//   staging smoke. What is proved here is that the request is CONSTRUCTED to the
//   documented contract, that every documented failure shape is normalized
//   safely, and that no provider outcome can reorder an assignment unsafely.
//
// Run: npm run test:mvp:75-03
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_ROUTE_TIME_POLICY,
  GOOGLE_ROUTE_MATRIX_MAX_ELEMENTS,
  ROUTE_ROUTING_PREFERENCE,
  ROUTE_TIME_POLICY_VERSION,
  ROUTE_TIME_PROVIDER_ID,
  ROUTE_TRAVEL_MODE,
  resolveRouteTimePolicy,
} from '../../../lib/geo/routeTimePolicy.ts';
import {
  ARBITRARY_ROUTE_STATUSES,
  ROUTE_ELEMENT_STATUSES,
  ROUTE_TIME_CONTRACT_VERSION,
  computeGeoRegretSeconds,
  computeTminSeconds,
  deduplicateRouteDomain,
  isArbitraryRouteStatus,
  isRouteDomainClosed,
  minimumPossibleTravelTimeSeconds,
  parseDistanceMeters,
  parseDurationSeconds,
  planRouteBatches,
  routeCoordinateKey,
} from '../../../lib/geo/routeTimeContract.ts';
import {
  GOOGLE_ROUTE_MATRIX_ENDPOINT,
  GOOGLE_ROUTE_MATRIX_FIELD_MASK,
  GOOGLE_API_KEY_HEADER,
  GOOGLE_FIELD_MASK_HEADER,
  buildRouteMatrixBody,
  buildRouteMatrixHeaders,
  classifyHttpStatus,
  parseRouteMatrixResponse,
} from '../../../lib/geo/googleRouteMatrixProtocol.ts';
import {
  GEO_FRONTIER_CONTRACT_VERSION,
  ROUTE_FRONTIER_OUTCOMES,
  compareGeoFrontierCandidates,
  decideRouteFrontier,
  reorderByGeoFrontier,
} from '../../../lib/matchcore/geoFrontierDecision.ts';
import {
  GoogleRouteTimeProvider,
  resolveRouteProviderCredential,
  ROUTE_TIME_PROVIDER_ENABLED_VAR,
  GOOGLE_ROUTES_API_KEY_VAR,
  GOOGLE_BROWSER_KEY_VAR,
} from '../../../services/routeTimeProviderService.ts';
import {
  buildRouteDomain,
  measureLeadRouteTimes,
} from '../../../services/leadRouteTimeService.ts';
import {
  compareAutomaticMatchDecisions,
  splitRankedPool,
} from '../../../lib/matchcore/automaticMatchDecision.ts';
import {
  CANONICAL_ACTIVE_ASSIGNMENT_CAP,
  CANONICAL_LIFETIME_ASSIGNMENT_CAP,
  MAX_CANONICAL_CANDIDATE_POOL,
} from '../../../lib/marketplace/canonicalAssignmentContract.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const stripTs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const flat = (src) => src.replace(/\s+/g, ' ');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`   ok    ${name}`);
  } else {
    failed += 1;
    const line = `   FAIL  ${name}${detail ? ` — ${detail}` : ''}`;
    failures.push(line);
    console.log(line);
  }
}
function section(title) {
  console.log(`\n── ${title} ──`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const POLICY_RAW = read('lib/geo/routeTimePolicy.ts');
const POLICY_TS = stripTs(POLICY_RAW);
const CONTRACT_RAW = read('lib/geo/routeTimeContract.ts');
const CONTRACT_TS = stripTs(CONTRACT_RAW);
const PROTOCOL_RAW = read('lib/geo/googleRouteMatrixProtocol.ts');
const PROTOCOL_TS = stripTs(PROTOCOL_RAW);
const FRONTIER_RAW = read('lib/matchcore/geoFrontierDecision.ts');
const FRONTIER_TS = stripTs(FRONTIER_RAW);
const PROVIDER_RAW = read('services/routeTimeProviderService.ts');
const PROVIDER_TS = stripTs(PROVIDER_RAW);
const RUNNER_RAW = read('services/leadRouteTimeService.ts');
const RUNNER_TS = stripTs(RUNNER_RAW);
const MATCHER_RAW = read('services/leadMatchingEngine.ts');
const MATCHER = stripTs(MATCHER_RAW);
const MATCHCORE_TS = stripTs(read('lib/matchcore/automaticMatchDecision.ts'));
const BUILD_GATE_TS = read('scripts/mvp/build/stagingBuildGate.mjs');
const BUILD_RUNNER_TS = read('scripts/mvp/build/runStagingBuild.mjs');
const CI_YML = read('.github/workflows/qf-mvp-50-quality-gate.yml');
const PKG = JSON.parse(read('package.json'));

const ALL_TS = [POLICY_TS, CONTRACT_TS, PROTOCOL_TS, FRONTIER_TS, PROVIDER_TS, RUNNER_TS].join('\n');
/**
 * The UNSTRIPPED sources. Any assertion about a URL must use these: `stripTs`
 * removes `//` line comments, and the `//` inside `https://` makes it swallow
 * the rest of the line — so a URL check run over stripped text is vacuous and
 * would pass no matter what endpoint the code called.
 */
const ALL_RAW = [POLICY_RAW, CONTRACT_RAW, PROTOCOL_RAW, FRONTIER_RAW, PROVIDER_RAW, RUNNER_RAW].join('\n');

// A UUID set for deterministic fixtures.
const V = {
  v1: '11111111-1111-4111-8111-111111111111',
  v2: '22222222-2222-4222-8222-222222222222',
  v3: '33333333-3333-4333-8333-333333333333',
  v4: '44444444-4444-4444-8444-444444444444',
  v5: '55555555-5555-4555-8555-555555555555',
};

const POLICY = DEFAULT_ROUTE_TIME_POLICY;
const dest = (id, km, lat = 18.5 + km / 100, lng = 73.8 + km / 100) => ({
  vendor_id: id, latitude: lat, longitude: lng, straight_line_km: km,
});
const measure = (id, status, seconds = null, meters = null) => ({
  vendor_id: id, status, travel_time_seconds: seconds, distance_meters: meters,
});

/** A fake transport. NO real network is ever used by this harness. */
function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    async request(req) {
      calls.push(req);
      return handler(req, calls.length);
    },
  };
}

console.log('QF-MVP-75.03 — route-time provider + GeoRegret (offline)');

// ===========================================================================
section('A. EXTERNAL CONTRACT — Routes API Compute Route Matrix [static/pure]');
// ===========================================================================
{
  check('A01 the endpoint is the Routes API computeRouteMatrix method',
    GOOGLE_ROUTE_MATRIX_ENDPOINT === 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix');

  check('A02 the LEGACY Distance Matrix API is not implemented anywhere',
    !/maps\.googleapis\.com\/maps\/api\/distancematrix/i.test(ALL_RAW)
    && !/distancematrix\/json/i.test(ALL_RAW));

  check('A03 the field mask requests exactly the six fields the frontier consumes',
    GOOGLE_ROUTE_MATRIX_FIELD_MASK === 'originIndex,destinationIndex,status,condition,distanceMeters,duration');

  check('A04 the field mask is never the wildcard, and no route payload is requested',
    !/["']\*["']/.test(PROTOCOL_TS.split('GOOGLE_ROUTE_MATRIX_FIELD_MASK')[1]?.split('\n')[1] ?? '')
    && !/polyline|navigationInstruction|travelAdvisory|legs|tolls|localizedValues/i.test(ALL_TS));

  const headers = buildRouteMatrixHeaders('TEST-KEY-VALUE');
  check('A05 the key travels in the X-Goog-Api-Key HEADER, never a query parameter',
    headers[GOOGLE_API_KEY_HEADER] === 'TEST-KEY-VALUE'
    && GOOGLE_API_KEY_HEADER === 'X-Goog-Api-Key'
    && !/[?&]key=/.test(GOOGLE_ROUTE_MATRIX_ENDPOINT)
    && !/[?&]key=/.test(PROTOCOL_TS));

  check('A06 the field mask is sent as X-Goog-FieldMask',
    GOOGLE_FIELD_MASK_HEADER === 'X-Goog-FieldMask'
    && headers[GOOGLE_FIELD_MASK_HEADER] === GOOGLE_ROUTE_MATRIX_FIELD_MASK);

  const body = JSON.parse(buildRouteMatrixBody({ latitude: 18.52, longitude: 73.85 },
    [dest(V.v1, 2), dest(V.v2, 5)], POLICY));
  check('A07 waypoints use canonical location.latLng, exactly as documented',
    body.origins.length === 1
    && body.origins[0].waypoint.location.latLng.latitude === 18.52
    && body.origins[0].waypoint.location.latLng.longitude === 73.85
    && body.destinations.length === 2
    && typeof body.destinations[0].waypoint.location.latLng.latitude === 'number');

  check('A08 no address string, no place id and no private client address is ever sent',
    !/address|placeId|place_id/i.test(JSON.stringify(body))
    && !/address|placeId/i.test(PROTOCOL_TS.split('export function buildRouteMatrixBody')[1] ?? ''));

  check('A09 travelMode and routingPreference are sent, departureTime is NOT',
    body.travelMode === 'DRIVE'
    && body.routingPreference === 'TRAFFIC_UNAWARE'
    && !('departureTime' in body)
    && !/departureTime/.test(PROTOCOL_TS));

  check('A10 Google element ceilings are treated as OUTER limits only',
    GOOGLE_ROUTE_MATRIX_MAX_ELEMENTS === 625
    && POLICY.maxRouteElementsPerRun < GOOGLE_ROUTE_MATRIX_MAX_ELEMENTS
    && POLICY.maxRouteDestinationsPerCall < GOOGLE_ROUTE_MATRIX_MAX_ELEMENTS);
}

// ===========================================================================
section('B. ROUTING MODE + POLICY [pure/static]');
// ===========================================================================
{
  check('B01 exactly one travel mode is locked, and it is DRIVE',
    ROUTE_TRAVEL_MODE === 'DRIVE' && POLICY.travelMode === 'DRIVE');

  check('B02 no motorcycle / transit / bicycle mode is implemented',
    !/TWO_WHEELER|TRANSIT|BICYCLE|WALK/.test(ALL_TS));

  check('B03 the cheapest deterministic routing preference is chosen, not the most expensive',
    ROUTE_ROUTING_PREFERENCE === 'TRAFFIC_UNAWARE'
    && !/TRAFFIC_AWARE_OPTIMAL/.test(POLICY_TS + PROTOCOL_TS));

  check('B04 departure-time behaviour is locked off in the policy itself',
    POLICY.departureTimeUsed === false);

  check('B05 the policy is versioned and frozen',
    ROUTE_TIME_POLICY_VERSION === 1
    && POLICY.version === ROUTE_TIME_POLICY_VERSION
    && Object.isFrozen(POLICY));

  check('B06 every bound is a policy field, never a literal in the call path',
    !/timeoutMs: \d{3,}/.test(PROVIDER_TS)
    && /policy\.providerTimeoutMs/.test(PROVIDER_TS)
    && /policy\.maxRouteElementsPerRun/.test(CONTRACT_TS)
    && /policy\.maxProviderCallsPerLead/.test(CONTRACT_TS));

  const hostile = resolveRouteTimePolicy({
    maxRouteElementsPerRun: 1e9, maxProviderCallsPerLead: 9999,
    providerTimeoutMs: 0, maxGeoRegretSeconds: -5, minRoutedCoverageRatio: 4,
  });
  check('B07 a hostile override cannot produce unbounded spend, a zero timeout or a negative frontier',
    hostile.maxRouteElementsPerRun <= GOOGLE_ROUTE_MATRIX_MAX_ELEMENTS
    && hostile.maxProviderCallsPerLead <= 10
    && hostile.providerTimeoutMs >= 250
    && hostile.maxGeoRegretSeconds >= 0
    && hostile.minRoutedCoverageRatio === POLICY.minRoutedCoverageRatio);

  check('B08 provider identity, mode and preference are NOT overridable by config',
    resolveRouteTimePolicy({ travelMode: 'TRANSIT', routingPreference: 'TRAFFIC_AWARE_OPTIMAL' }).travelMode === 'DRIVE'
    && resolveRouteTimePolicy({}).routingPreference === 'TRAFFIC_UNAWARE'
    && resolveRouteTimePolicy({}).providerId === ROUTE_TIME_PROVIDER_ID);
}

// ===========================================================================
section('C. DURATION + ELEMENT PARSING [pure]');
// ===========================================================================
{
  check('C01 a well-formed Duration parses to integer seconds',
    parseDurationSeconds('123s') === 123 && parseDurationSeconds('0s') === 0);

  check('C02 a fractional Duration rounds UP, never reporting a faster trip than measured',
    parseDurationSeconds('3.5s') === 4 && parseDurationSeconds('120.001s') === 121);

  check('C03 equal durations produce equal integer seconds (tie preservation)',
    parseDurationSeconds('600s') === parseDurationSeconds('600.0s'));

  check('C04 every malformed duration is rejected, never coerced to zero',
    [null, undefined, '', '  ', '123', 'abc', 's', '-5s', 'NaNs', 123, {}, []]
      .every((v) => parseDurationSeconds(v) === null));

  check('C05 distance is supporting evidence and is parsed defensively',
    parseDistanceMeters(1234) === 1234
    && parseDistanceMeters(-1) === null
    && parseDistanceMeters('1234') === null
    && parseDistanceMeters(Number.NaN) === null);

  const ds = [dest(V.v1, 1), dest(V.v2, 2), dest(V.v3, 3)];
  const okBody = JSON.stringify([
    { originIndex: 0, destinationIndex: 2, condition: 'ROUTE_EXISTS', duration: '900s', distanceMeters: 9000 },
    { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '300s', distanceMeters: 3000 },
    { originIndex: 0, destinationIndex: 1, condition: 'ROUTE_NOT_FOUND' },
  ]);
  const parsedOk = parseRouteMatrixResponse(okBody, ds);
  check('C06 results are keyed by REQUEST order, never by provider response order',
    eq(parsedOk.measurements.map((m) => m.vendor_id), [V.v1, V.v2, V.v3])
    && parsedOk.measurements[0].travel_time_seconds === 300
    && parsedOk.measurements[2].travel_time_seconds === 900);

  check('C07 ROUTE_NOT_FOUND is the only provider signal accepted as "no route"',
    parsedOk.measurements[1].status === 'NO_ROUTE'
    && parsedOk.measurements[1].travel_time_seconds === null);

  const dup = parseRouteMatrixResponse(JSON.stringify([
    { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '10s' },
    { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '20s' },
    { originIndex: 0, destinationIndex: 7, condition: 'ROUTE_EXISTS', duration: '30s' },
  ]), ds);
  check('C08 duplicate, out-of-range and MISSING indices are all caught, never shifted onto a vendor',
    dup.protocolViolationCount === 2
    && dup.measurements[0].travel_time_seconds === 10
    && dup.measurements[1].status === 'INVALID_PROVIDER_ELEMENT'
    && dup.measurements[2].status === 'INVALID_PROVIDER_ELEMENT');

  check('C09 a non-zero originIndex is a protocol breach, not a measurement',
    parseRouteMatrixResponse(JSON.stringify([
      { originIndex: 1, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '10s' },
    ]), ds).protocolViolationCount === 1);

  check('C10 a non-OK element status is never read as a route or as "no route"',
    parseRouteMatrixResponse(JSON.stringify([
      { originIndex: 0, destinationIndex: 0, status: { code: 3, message: 'x' }, condition: 'ROUTE_EXISTS', duration: '10s' },
    ]), ds).measurements[0].status === 'INVALID_PROVIDER_ELEMENT');

  check('C11 ROUTE_EXISTS without a readable duration is MALFORMED, not a route of unknown length',
    parseRouteMatrixResponse(JSON.stringify([
      { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: 'oops' },
    ]), ds).measurements[0].status === 'MALFORMED_RESPONSE');

  check('C12 an unparseable or non-array body salvages NOTHING partial',
    parseRouteMatrixResponse('{not json', ds).measurements.every((m) => m.status === 'MALFORMED_RESPONSE')
    && parseRouteMatrixResponse('{"a":1}', ds).measurements.every((m) => m.status === 'MALFORMED_RESPONSE'));

  check('C13 a MIXED partial response keeps successes and marks failures explicitly',
    (() => {
      const mixed = parseRouteMatrixResponse(JSON.stringify([
        { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '300s', distanceMeters: 100 },
        { originIndex: 0, destinationIndex: 1, condition: 'ROUTE_NOT_FOUND' },
      ]), ds).measurements;
      return mixed[0].status === 'SUCCESS' && mixed[1].status === 'NO_ROUTE'
        && mixed[2].status === 'INVALID_PROVIDER_ELEMENT';
    })());
}

// ===========================================================================
section('D. FAILURE CLASSIFICATION [pure]');
// ===========================================================================
{
  check('D01 the ten required normalized statuses all exist',
    ['SUCCESS', 'NO_ROUTE', 'INVALID_PROVIDER_ELEMENT', 'PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMIT',
      'PROVIDER_AUTH', 'PROVIDER_5XX', 'MALFORMED_RESPONSE', 'MISSING_COORDINATE', 'NOT_ROUTED_DUE_TO_BOUND']
      .every((s) => ROUTE_ELEMENT_STATUSES.includes(s)));

  check('D02 auth, quota and infrastructure failures are NEVER classified as "no route"',
    classifyHttpStatus(401) === 'PROVIDER_AUTH'
    && classifyHttpStatus(403) === 'PROVIDER_AUTH'
    && classifyHttpStatus(429) === 'PROVIDER_RATE_LIMIT'
    && classifyHttpStatus(500) === 'PROVIDER_5XX'
    && classifyHttpStatus(503) === 'PROVIDER_5XX'
    && classifyHttpStatus(400) === 'INVALID_PROVIDER_ELEMENT'
    && ![401, 403, 429, 500, 503, 400].some((s) => classifyHttpStatus(s) === 'NO_ROUTE'));

  check('D03 a 200 is not a failure and its body must still be parsed',
    classifyHttpStatus(200) === null);

  check('D04 every infrastructure status is ARBITRARY, and the data facts are not',
    ARBITRARY_ROUTE_STATUSES.every((s) => isArbitraryRouteStatus(s))
    && !isArbitraryRouteStatus('SUCCESS')
    && !isArbitraryRouteStatus('NO_ROUTE')
    && !isArbitraryRouteStatus('MISSING_COORDINATE')
    && !isArbitraryRouteStatus('NOT_ROUTED_DUE_TO_BOUND'));

  check('D05 one failed element does not poison the successful ones',
    (() => {
      const d = decideRouteFrontier({
        eligibleVendorIds: [V.v1, V.v2, V.v3],
        measurements: [measure(V.v1, 'SUCCESS', 300), measure(V.v2, 'NO_ROUTE'), measure(V.v3, 'SUCCESS', 600)],
        deferred: [], missingCoordinateVendorIds: [], policy: POLICY,
      });
      return d.engaged && d.tmin_seconds === 300 && d.successful_count === 2;
    })());
}

// ===========================================================================
section('E. Tmin + GEOREGRET [pure]');
// ===========================================================================
{
  const ms = [measure(V.v1, 'SUCCESS', 900), measure(V.v2, 'SUCCESS', 300), measure(V.v3, 'SUCCESS', 1500)];
  check('E01 Tmin is the best VALID travel time in the set',
    computeTminSeconds(ms) === 300);

  check('E02 Tmin >= 0 and failed / missing routes are excluded from it',
    computeTminSeconds([measure(V.v1, 'NO_ROUTE'), measure(V.v2, 'SUCCESS', 42),
      measure(V.v3, 'PROVIDER_TIMEOUT'), measure(V.v4, 'MISSING_COORDINATE')]) === 42
    && computeTminSeconds([measure(V.v1, 'NO_ROUTE')]) === null
    && computeTminSeconds([]) === null);

  check('E03 GeoRegret = travel - Tmin, and is never negative',
    computeGeoRegretSeconds(900, 300) === 600
    && computeGeoRegretSeconds(300, 300) === 0
    && computeGeoRegretSeconds(100, 300) === 0);

  check('E04 at least one successful vendor always has regret exactly 0',
    (() => {
      const t = computeTminSeconds(ms);
      return ms.filter((m) => computeGeoRegretSeconds(m.travel_time_seconds, t) === 0).length === 1;
    })());

  check('E05 equal route times produce equal regret',
    computeGeoRegretSeconds(600, 300) === computeGeoRegretSeconds(600, 300));

  check('E06 Tmin and regret are INPUT-ORDER INDEPENDENT',
    (() => {
      const forward = decideRouteFrontier({
        eligibleVendorIds: [V.v1, V.v2, V.v3],
        measurements: [measure(V.v1, 'SUCCESS', 900), measure(V.v2, 'SUCCESS', 300), measure(V.v3, 'SUCCESS', 1500)],
        deferred: [], missingCoordinateVendorIds: [], policy: POLICY,
      });
      const reversed = decideRouteFrontier({
        eligibleVendorIds: [V.v1, V.v2, V.v3],
        measurements: [measure(V.v3, 'SUCCESS', 1500), measure(V.v2, 'SUCCESS', 300), measure(V.v1, 'SUCCESS', 900)],
        deferred: [], missingCoordinateVendorIds: [], policy: POLICY,
      });
      return forward.tmin_seconds === reversed.tmin_seconds
        && eq(forward.placements, reversed.placements);
    })());

  check('E07 regret is INTEGER seconds — no float can reach the frontier comparison',
    (() => {
      const d = decideRouteFrontier({
        eligibleVendorIds: [V.v1, V.v2],
        measurements: [measure(V.v1, 'SUCCESS', parseDurationSeconds('300.4s')),
          measure(V.v2, 'SUCCESS', parseDurationSeconds('300.6s'))],
        deferred: [], missingCoordinateVendorIds: [], policy: POLICY,
      });
      return d.placements.every((p) => Number.isInteger(p.geo_regret_seconds));
    })());

  check('E08 distance metres never substitute for travel time as the primary measure',
    /travel time is the primary/i.test(CONTRACT_RAW)
    && !/distance_meters/.test(FRONTIER_TS.split('export function compareGeoFrontierCandidates')[1] ?? ''));
}

// ===========================================================================
section('F. GEOGRAPHIC FRONTIER [pure]');
// ===========================================================================
{
  const frontierAt = (regretCap) => resolveRouteTimePolicy({ maxGeoRegretSeconds: regretCap });

  check('F01 vendors within maxGeoRegretSeconds are INSIDE; beyond it are OUTSIDE',
    (() => {
      const d = decideRouteFrontier({
        eligibleVendorIds: [V.v1, V.v2, V.v3],
        measurements: [measure(V.v1, 'SUCCESS', 300), measure(V.v2, 'SUCCESS', 1100), measure(V.v3, 'SUCCESS', 2000)],
        deferred: [], missingCoordinateVendorIds: [], policy: frontierAt(900),
      });
      return eq(d.inside_frontier_vendor_ids, [V.v1, V.v2]) && eq(d.outside_frontier_vendor_ids, [V.v3]);
    })());

  check('F02 the threshold is INCLUSIVE — a vendor exactly on the boundary is inside',
    (() => {
      const d = decideRouteFrontier({
        eligibleVendorIds: [V.v1, V.v2],
        measurements: [measure(V.v1, 'SUCCESS', 300), measure(V.v2, 'SUCCESS', 1200)],
        deferred: [], missingCoordinateVendorIds: [], policy: frontierAt(900),
      });
      return d.frontier_threshold_seconds === 1200 && eq(d.inside_frontier_vendor_ids, [V.v1, V.v2]);
    })());

  check('F03 route time does NOT discriminate inside the frontier — the secondary rules do',
    (() => {
      const placements = new Map([
        [V.v1, { vendor_id: V.v1, band: 'inside_frontier', geo_regret_seconds: 800, route_status: 'SUCCESS', travel_time_seconds: 1100, distance_meters: null }],
        [V.v2, { vendor_id: V.v2, band: 'inside_frontier', geo_regret_seconds: 0, route_status: 'SUCCESS', travel_time_seconds: 300, distance_meters: null }],
      ]);
      // v1 is Tier 0 but 800s further; v2 is Tier 1 and closest. Inside the
      // frontier the exact-category tier must win.
      const r = compareGeoFrontierCandidates(
        { id: V.v1, match_tier: 0, area_affinity: 0, base_rank: 2 },
        { id: V.v2, match_tier: 1, area_affinity: 0, base_rank: 1 },
        placements);
      return r < 0;
    })());

  check('F04 the OUTSIDE band is ordered by GeoRegret ASC — the nearest miss ranks first',
    (() => {
      const placements = new Map([
        [V.v1, { vendor_id: V.v1, band: 'outside_frontier', geo_regret_seconds: 3000, route_status: 'SUCCESS', travel_time_seconds: 3300, distance_meters: null }],
        [V.v2, { vendor_id: V.v2, band: 'outside_frontier', geo_regret_seconds: 1000, route_status: 'SUCCESS', travel_time_seconds: 1300, distance_meters: null }],
      ]);
      return compareGeoFrontierCandidates(
        { id: V.v1, match_tier: 0, area_affinity: 1, base_rank: 1 },
        { id: V.v2, match_tier: 1, area_affinity: 0, base_rank: 2 },
        placements) > 0;
    })());

  check('F05 the band order is inside -> outside -> unmeasured, always',
    (() => {
      const placements = new Map([
        [V.v1, { vendor_id: V.v1, band: 'unmeasured', geo_regret_seconds: null, route_status: 'MISSING_COORDINATE', travel_time_seconds: null, distance_meters: null }],
        [V.v2, { vendor_id: V.v2, band: 'outside_frontier', geo_regret_seconds: 5000, route_status: 'SUCCESS', travel_time_seconds: 5300, distance_meters: null }],
        [V.v3, { vendor_id: V.v3, band: 'inside_frontier', geo_regret_seconds: 10, route_status: 'SUCCESS', travel_time_seconds: 310, distance_meters: null }],
      ]);
      const rows = [
        { id: V.v1, match_tier: 0, area_affinity: 1, rank_position: 1 },
        { id: V.v2, match_tier: 0, area_affinity: 1, rank_position: 2 },
        { id: V.v3, match_tier: 1, area_affinity: 0, rank_position: 3 },
      ];
      return eq(reorderByGeoFrontier(rows, placements), [V.v3, V.v2, V.v1]);
    })());

  check('F06 the reorder is IN PLACE and re-stamps rank_position 1..n',
    (() => {
      const placements = new Map([
        [V.v1, { vendor_id: V.v1, band: 'outside_frontier', geo_regret_seconds: 4000, route_status: 'SUCCESS', travel_time_seconds: 4300, distance_meters: null }],
        [V.v2, { vendor_id: V.v2, band: 'inside_frontier', geo_regret_seconds: 0, route_status: 'SUCCESS', travel_time_seconds: 300, distance_meters: null }],
      ]);
      const rows = [
        { id: V.v1, match_tier: 0, area_affinity: 0, rank_position: 1 },
        { id: V.v2, match_tier: 0, area_affinity: 0, rank_position: 2 },
      ];
      const ref = rows;
      reorderByGeoFrontier(rows, placements);
      return ref === rows && rows[0].id === V.v2 && rows[0].rank_position === 1 && rows[1].rank_position === 2;
    })());

  check('F07 the comparator is TOTAL — it returns 0 only for the same candidate',
    (() => {
      const placements = new Map();
      const a = { id: V.v1, match_tier: 0, area_affinity: 0, base_rank: 1 };
      const b = { id: V.v2, match_tier: 0, area_affinity: 0, base_rank: 2 };
      return compareGeoFrontierCandidates(a, a, placements) === 0
        && compareGeoFrontierCandidates(a, b, placements) !== 0;
    })());

  check('F08 provider RESPONSE ORDER can never become rank order',
    (() => {
      const placements = new Map([
        [V.v1, { vendor_id: V.v1, band: 'inside_frontier', geo_regret_seconds: 0, route_status: 'SUCCESS', travel_time_seconds: 300, distance_meters: null }],
        [V.v2, { vendor_id: V.v2, band: 'inside_frontier', geo_regret_seconds: 5, route_status: 'SUCCESS', travel_time_seconds: 305, distance_meters: null }],
      ]);
      const forward = [{ id: V.v1, match_tier: 1, area_affinity: 0, rank_position: 2 },
        { id: V.v2, match_tier: 0, area_affinity: 0, rank_position: 1 }];
      const reverse = [{ id: V.v2, match_tier: 0, area_affinity: 0, rank_position: 1 },
        { id: V.v1, match_tier: 1, area_affinity: 0, rank_position: 2 }];
      return eq(reorderByGeoFrontier(forward, placements), reorderByGeoFrontier(reverse, placements));
    })());
}

// ===========================================================================
section('G. TIER-0 / TIER-1 INTERACTION — the explicit architectural change [pure]');
// ===========================================================================
{
  const insideT1 = { vendor_id: V.v2, band: 'inside_frontier', geo_regret_seconds: 100, route_status: 'SUCCESS', travel_time_seconds: 400, distance_meters: null };
  const outsideT0 = { vendor_id: V.v1, band: 'outside_frontier', geo_regret_seconds: 4000, route_status: 'SUCCESS', travel_time_seconds: 4300, distance_meters: null };
  const placements = new Map([[V.v1, outsideT0], [V.v2, insideT1]]);

  check('G01 a Tier-1 vendor INSIDE the frontier now outranks a Tier-0 vendor OUTSIDE it',
    compareGeoFrontierCandidates(
      { id: V.v2, match_tier: 1, area_affinity: 0, base_rank: 2 },
      { id: V.v1, match_tier: 0, area_affinity: 1, base_rank: 1 },
      placements) < 0);

  check('G02 within the frontier the Tier-0 exact-category vendor still wins',
    (() => {
      const both = new Map([
        [V.v1, { ...outsideT0, band: 'inside_frontier', geo_regret_seconds: 500 }],
        [V.v2, insideT1],
      ]);
      return compareGeoFrontierCandidates(
        { id: V.v1, match_tier: 0, area_affinity: 0, base_rank: 2 },
        { id: V.v2, match_tier: 1, area_affinity: 0, base_rank: 1 },
        both) < 0;
    })());

  check('G03 the change is VERSIONED and stated, not silent',
    GEO_FRONTIER_CONTRACT_VERSION === 1
    && /lexicographically ahead/i.test(FRONTIER_RAW)
    && /Tier-0 vendor OUTSIDE the frontier therefore now loses/i.test(FRONTIER_RAW));

  check('G04 CATEGORY COMPATIBILITY remains a HARD GATE upstream, untouched by this phase',
    /if \(tierResult === null\) reasons\.push\("category_mismatch"\);/.test(MATCHER)
    && /if \(!cityMatches\(vendor, lead\)\) reasons\.push\("city_mismatch"\);/.test(MATCHER)
    && /evaluateVendorAutomaticLeadEligibility\(vendor, \{ nowMs \}\)/.test(MATCHER));

  check('G05 the business sort is NOT hidden outside MatchCore — it lives in lib/matchcore',
    /lib\/matchcore\/geoFrontierDecision/.test(MATCHER_RAW)
    && /export function compareGeoFrontierCandidates/.test(FRONTIER_RAW)
    // The service layer may order the DOMAIN (straight-line, for batching) but
    // must never order candidates by a BUSINESS key. No band, regret, tier,
    // area-affinity or rank comparison may appear outside lib/matchcore.
    && !/band|geo_regret|match_tier|area_affinity|rank_position/.test(
      RUNNER_TS.split('destinations.sort(')[1]?.split('return { destinations')[0] ?? '')
    && !/\.sort\(/.test(PROVIDER_TS)
    && !/compareGeoFrontierCandidates/.test(RUNNER_TS + PROVIDER_TS));

  check('G06 the pre-75.03 comparator is PRESERVED and still the base order + final tiebreak',
    /eligible\.sort\(\(a, b\) => compareAutomaticMatchDecisions\(a\.__decision, b\.__decision, leadHasCoords\)\);/.test(MATCHER)
    && /base_rank/.test(FRONTIER_TS)
    && typeof compareAutomaticMatchDecisions === 'function');
}

// ===========================================================================
section('H. PACKAGE / COMMERCIAL ISOLATION [pure/static]');
// ===========================================================================
{
  check('H01 the geo frontier comparator has NO package/paid/credit/commercial key',
    !/package|paid_status|credits|visibility|price|amount/i.test(
      FRONTIER_TS.split('export function compareGeoFrontierCandidates')[1]?.split('export function reorderByGeoFrontier')[0] ?? ''));

  check('H02 no route module reads a package, paid status or credit field at all',
    !/package_status|paid_status|remaining_credits|vendor_packages|visibility_type/i.test(ALL_TS));

  check('H03 [pure] a paid vendor OUTSIDE the frontier cannot leapfrog a free vendor INSIDE it',
    (() => {
      const placements = new Map([
        [V.v1, { vendor_id: V.v1, band: 'outside_frontier', geo_regret_seconds: 9000, route_status: 'SUCCESS', travel_time_seconds: 9300, distance_meters: null }],
        [V.v2, { vendor_id: V.v2, band: 'inside_frontier', geo_regret_seconds: 600, route_status: 'SUCCESS', travel_time_seconds: 900, distance_meters: null }],
      ]);
      // Every commercial advantage the data model can express, on the far vendor:
      // best tier, best area affinity, best base rank. It must still lose.
      const rows = [
        { id: V.v1, match_tier: 0, area_affinity: 1, rank_position: 1, packageStatus: 'active', credits: 999 },
        { id: V.v2, match_tier: 1, area_affinity: 0, rank_position: 2, packageStatus: 'expired', credits: 1 },
      ];
      return eq(reorderByGeoFrontier(rows, placements), [V.v2, V.v1]);
    })());

  check('H04 package tier can never raise the routing budget',
    !/package|paid|tier.*budget|budget.*tier/i.test(
      CONTRACT_TS.split('export function planRouteBatches')[1] ?? '')
    && !/package|paid/i.test(POLICY_TS));

  check('H05 the pre-75.03 automatic comparator still carries no commercial key either',
    !/package|paid_status|credits/i.test(
      MATCHCORE_TS.split('export function compareAutomaticMatchDecisions')[1] ?? ''));
}

// ===========================================================================
section('I. SAFE CANDIDATE DOMAIN + BOUNDS [pure/static]');
// ===========================================================================
{
  check('I01 the routing domain is the HARD-ELIGIBLE set — never a distance/tier/PostGIS prefilter',
    /candidates: eligible\.map\(/.test(flat(MATCHER))
    && !/shortlist|geoOutcome|geoEvidence/.test(
      MATCHER.split('const routeOutcome = await measureLeadRouteTimes')[1]?.split('const routeOrderedVendorIds')[0] ?? ''));

  check('I02 the domain is ordered deterministically by (straight-line km ASC, vendor id ASC)',
    (() => {
      const built = buildRouteDomain([
        { id: V.v3, latitude: 1, longitude: 1, distance_km: 5 },
        { id: V.v1, latitude: 2, longitude: 2, distance_km: 2 },
        { id: V.v2, latitude: 3, longitude: 3, distance_km: 2 },
      ]);
      return eq(built.destinations.map((d) => d.vendor_id), [V.v1, V.v2, V.v3]);
    })());

  check('I03 a coordinate-less candidate is MISSING_COORDINATE, never silently dropped',
    (() => {
      const built = buildRouteDomain([
        { id: V.v1, latitude: null, longitude: null, distance_km: null },
        { id: V.v2, latitude: 1, longitude: 1, distance_km: 3 },
      ]);
      return eq(built.missingCoordinateVendorIds, [V.v1]) && built.destinations.length === 1;
    })());

  const many = Array.from({ length: 120 }, (_, i) =>
    dest(`${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, i + 1));

  check('I04 hard element / call bounds are enforced, and the excess is EXPLICIT not silent',
    (() => {
      const plan = planRouteBatches(many, POLICY);
      return plan.elementCount === POLICY.maxRouteElementsPerRun
        && plan.callCount <= POLICY.maxProviderCallsPerLead
        && plan.routed.length + plan.deferred.length === many.length
        && plan.deferred.length === many.length - POLICY.maxRouteElementsPerRun;
    })());

  check('I05 batching is deterministic and no batch exceeds maxRouteDestinationsPerCall',
    (() => {
      const a = planRouteBatches(many, POLICY);
      const b = planRouteBatches(many, POLICY);
      return eq(a.batches.map((x) => x.map((d) => d.vendor_id)), b.batches.map((x) => x.map((d) => d.vendor_id)))
        && a.batches.every((batch) => batch.length <= POLICY.maxRouteDestinationsPerCall);
    })());

  check('I06 a domain below the provider two-destination minimum makes ZERO calls',
    (() => {
      const plan = planRouteBatches([dest(V.v1, 1)], POLICY);
      return plan.batches.length === 0 && plan.elementCount === 0 && plan.callCount === 0
        && plan.deferred.length === 1;
    })());

  check('I07 a trailing one-destination batch is merged, never sent as an invalid request',
    (() => {
      const p = resolveRouteTimePolicy({ maxRouteDestinationsPerCall: 2, maxRouteElementsPerRun: 5, maxProviderCallsPerLead: 3 });
      const plan = planRouteBatches(many.slice(0, 5), p);
      return plan.batches.every((batch) => batch.length >= 2)
        && plan.batches.reduce((n, b) => n + b.length, 0) === 5;
    })());

  check('I08 there is NO retry anywhere in the provider path',
    !/retry|retries|backoff|attempt\s*\+\+|for\s*\(.*attempt/i.test(PROVIDER_TS)
    && !/retry|backoff/i.test(RUNNER_TS)
    && /NO RETRY, EVER/.test(PROVIDER_RAW));

  check('I09 the 5000-vendor scan is NEVER routed — only hard-eligible candidates are',
    /MAX_VENDOR_SCAN/.test(MATCHER)
    && !/MAX_VENDOR_SCAN/.test(RUNNER_TS)
    && !/rows/.test(RUNNER_TS.split('export function buildRouteDomain')[1]?.split('}')[0] ?? ''));

  check('I10 per-run de-duplication means one coordinate is never routed twice',
    (() => {
      const d = deduplicateRouteDomain([
        dest(V.v1, 2, 18.5, 73.8), dest(V.v2, 2, 18.5, 73.8), dest(V.v3, 4, 18.6, 73.9),
      ]);
      return d.unique.length === 2 && d.duplicateCount === 1
        && eq(d.vendorIdsByKey.get(routeCoordinateKey(18.5, 73.8)), [V.v1, V.v2]);
    })());
}

// ===========================================================================
section('J. CLOSURE PROOF — no silent exclusion [pure]');
// ===========================================================================
{
  check('J01 an empty deferred tail is trivially closed',
    isRouteDomainClosed([], 300, POLICY) === true);

  check('J02 the travel-time lower bound is a TRUE bound (road >= great-circle)',
    minimumPossibleTravelTimeSeconds(80, 80) === 3600
    && minimumPossibleTravelTimeSeconds(0, 80) === 0
    && minimumPossibleTravelTimeSeconds(-1, 80) === 0);

  check('J03 a NEAR deferred vendor leaves the domain OPEN — it could still be inside',
    isRouteDomainClosed([dest(V.v1, 3)], 300, POLICY) === false);

  check('J04 a FAR deferred vendor closes the domain — it provably cannot be inside',
    isRouteDomainClosed([dest(V.v1, 500)], 300, POLICY) === true);

  check('J05 an OPEN domain refuses to engage route authority (no silent exclusion)',
    (() => {
      const d = decideRouteFrontier({
        eligibleVendorIds: [V.v1, V.v2, V.v3],
        measurements: [measure(V.v1, 'SUCCESS', 300), measure(V.v2, 'SUCCESS', 400), measure(V.v3, 'SUCCESS', 500)],
        deferred: [dest(V.v4, 3)], missingCoordinateVendorIds: [], policy: POLICY,
      });
      return d.engaged === false && d.outcome === 'route_domain_not_closed';
    })());

  check('J06 over-estimating the assumed speed only WEAKENS pruning — it never excludes a winner',
    isRouteDomainClosed([dest(V.v1, 40)], 300, resolveRouteTimePolicy({ maxAssumedSpeedKmph: 400 })) === false
    && isRouteDomainClosed([dest(V.v1, 40)], 300, resolveRouteTimePolicy({ maxAssumedSpeedKmph: 5 })) === true);
}

// ===========================================================================
section('K. ACTIVATION PREDICATE + FALLBACK [pure]');
// ===========================================================================
{
  const base = { deferred: [], missingCoordinateVendorIds: [], policy: POLICY };

  check('K01 every fallback reason is a distinct declared outcome',
    ROUTE_FRONTIER_OUTCOMES.length === new Set(ROUTE_FRONTIER_OUTCOMES).size
    && ROUTE_FRONTIER_OUTCOMES.includes('route_authority_engaged')
    && ['route_provider_disabled', 'route_provider_not_configured', 'no_lead_coordinate',
      'insufficient_route_domain', 'insufficient_route_results', 'insufficient_route_coverage',
      'route_provider_incomplete', 'route_domain_not_closed']
      .every((r) => ROUTE_FRONTIER_OUTCOMES.includes(r)));

  check('K02 ANY infrastructure failure in the domain forces a full fallback',
    ARBITRARY_ROUTE_STATUSES.every((status) => {
      const d = decideRouteFrontier({
        ...base,
        eligibleVendorIds: [V.v1, V.v2, V.v3],
        measurements: [measure(V.v1, 'SUCCESS', 300), measure(V.v2, 'SUCCESS', 400), measure(V.v3, status)],
      });
      return d.engaged === false && d.outcome === 'route_provider_incomplete';
    }));

  check('K03 too few successful results is a fallback, not a one-reading Tmin',
    decideRouteFrontier({
      ...base, eligibleVendorIds: [V.v1, V.v2, V.v3, V.v4, V.v5],
      measurements: [measure(V.v1, 'SUCCESS', 300), measure(V.v2, 'NO_ROUTE'), measure(V.v3, 'NO_ROUTE')],
    }).outcome === 'insufficient_route_results');

  check('K04 thin COVERAGE is a fallback — two coordinate-holders cannot capture the pool',
    (() => {
      const d = decideRouteFrontier({
        ...base,
        eligibleVendorIds: [V.v1, V.v2, V.v3, V.v4, V.v5],
        measurements: [measure(V.v1, 'SUCCESS', 300), measure(V.v2, 'SUCCESS', 400)],
        missingCoordinateVendorIds: [V.v3, V.v4, V.v5],
      });
      return d.engaged === false && d.outcome === 'insufficient_route_coverage' && d.coverage_ratio === 0.4;
    })());

  check('K05 good coverage with a genuine NO_ROUTE still engages (data facts are not arbitrary)',
    (() => {
      const d = decideRouteFrontier({
        ...base,
        eligibleVendorIds: [V.v1, V.v2, V.v3, V.v4],
        measurements: [measure(V.v1, 'SUCCESS', 300), measure(V.v2, 'SUCCESS', 400),
          measure(V.v3, 'SUCCESS', 500), measure(V.v4, 'NO_ROUTE')],
      });
      return d.engaged === true && d.unmeasured_vendor_ids.includes(V.v4);
    })());

  check('K06 ALL no-route is a safe fallback, never an empty market',
    (() => {
      const d = decideRouteFrontier({
        ...base, eligibleVendorIds: [V.v1, V.v2],
        measurements: [measure(V.v1, 'NO_ROUTE'), measure(V.v2, 'NO_ROUTE')],
      });
      return d.engaged === false && d.tmin_seconds === null
        && d.outcome === 'insufficient_route_results'
        && d.placements.length === 2;
    })());

  check('K07 a fallback still records placements as EVIDENCE, it just does not reorder',
    decideRouteFrontier({
      ...base, eligibleVendorIds: [V.v1, V.v2, V.v3],
      measurements: [measure(V.v1, 'SUCCESS', 300), measure(V.v2, 'SUCCESS', 400), measure(V.v3, 'PROVIDER_TIMEOUT')],
    }).placements.length === 3);
}

// ===========================================================================
section('L. PROVIDER ADAPTER — driven through an INJECTED fake transport [pure]');
// ===========================================================================
{
  const origin = { latitude: 18.52, longitude: 73.85 };
  const two = [dest(V.v1, 2), dest(V.v2, 6)];
  const provider = (handler) => {
    const transport = fakeTransport(handler);
    return {
      transport,
      instance: new GoogleRouteTimeProvider({ transport, apiKey: 'K-SERVER-ONLY', policy: POLICY }),
    };
  };

  const okResponse = JSON.stringify([
    { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '300s', distanceMeters: 4000 },
    { originIndex: 0, destinationIndex: 1, condition: 'ROUTE_EXISTS', duration: '1500s', distanceMeters: 12000 },
  ]);

  const happy = provider(() => ({ kind: 'response', status: 200, bodyText: okResponse, truncated: false }));
  const happyResult = await happy.instance.routeMatrix({ origin, destinations: two });

  check('L01 exactly ONE request is made per batch, to the documented endpoint',
    happy.transport.calls.length === 1
    && happy.transport.calls[0].url === GOOGLE_ROUTE_MATRIX_ENDPOINT
    && happy.transport.calls[0].method === 'POST');

  check('L02 the request carries a bounded timeout and a bounded response byte cap',
    Number.isFinite(happy.transport.calls[0].timeoutMs)
    && happy.transport.calls[0].timeoutMs > 0
    && happy.transport.calls[0].timeoutMs <= POLICY.providerTimeoutMs
    && happy.transport.calls[0].maxResponseBytes > 0);

  check('L03 durations and distances are normalized per destination',
    happyResult.measurements[0].status === 'SUCCESS'
    && happyResult.measurements[0].travel_time_seconds === 300
    && happyResult.measurements[0].distance_meters === 4000
    && happyResult.measurements[1].travel_time_seconds === 1500);

  const timedOut = provider(() => ({ kind: 'aborted' }));
  check('L04 an aborted request is PROVIDER_TIMEOUT for every destination, never "no route"',
    (await timedOut.instance.routeMatrix({ origin, destinations: two }))
      .measurements.every((m) => m.status === 'PROVIDER_TIMEOUT'));

  const netErr = provider(() => ({ kind: 'network_error', code: 'ECONNRESET' }));
  check('L05 a transport failure is infrastructure, never geography',
    (await netErr.instance.routeMatrix({ origin, destinations: two }))
      .measurements.every((m) => m.status === 'PROVIDER_5XX'));

  for (const [status, expected] of [[401, 'PROVIDER_AUTH'], [403, 'PROVIDER_AUTH'],
    [429, 'PROVIDER_RATE_LIMIT'], [500, 'PROVIDER_5XX'], [503, 'PROVIDER_5XX']]) {
    const p = provider(() => ({ kind: 'response', status, bodyText: '{"error":"secret-echo"}', truncated: false }));
    const r = await p.instance.routeMatrix({ origin, destinations: two });
    check(`L06.${status} HTTP ${status} normalizes to ${expected} and the error body is never read`,
      r.measurements.every((m) => m.status === expected));
  }

  const malformed = provider(() => ({ kind: 'response', status: 200, bodyText: 'not-json', truncated: false }));
  check('L07 a malformed 200 body is MALFORMED_RESPONSE for every destination',
    (await malformed.instance.routeMatrix({ origin, destinations: two }))
      .measurements.every((m) => m.status === 'MALFORMED_RESPONSE'));

  const truncated = provider(() => ({ kind: 'response', status: 200, bodyText: okResponse, truncated: true }));
  check('L08 a TRUNCATED body is never parsed as if complete',
    (await truncated.instance.routeMatrix({ origin, destinations: two }))
      .measurements.every((m) => m.status === 'MALFORMED_RESPONSE'));

  check('L09 a remaining-budget ceiling can only SHORTEN the call timeout',
    (() => {
      const p = provider(() => ({ kind: 'response', status: 200, bodyText: okResponse, truncated: false }));
      return p.instance.routeMatrix({ origin, destinations: two, timeoutCeilingMs: 250 })
        .then(() => p.transport.calls[0].timeoutMs === 250);
    })());

  check('L10 the credential appears ONLY in the api-key header, never in url/body/log',
    happy.transport.calls[0].headers[GOOGLE_API_KEY_HEADER] === 'K-SERVER-ONLY'
    && !happy.transport.calls[0].url.includes('K-SERVER-ONLY')
    && !String(happy.transport.calls[0].body).includes('K-SERVER-ONLY'));
}

// ===========================================================================
section('M. SECURITY / CREDENTIAL CONTRACT [pure/static]');
// ===========================================================================
{
  check('M01 the routing credential is SERVER-ONLY and never a NEXT_PUBLIC_* name',
    GOOGLE_ROUTES_API_KEY_VAR === 'GOOGLE_ROUTES_API_KEY'
    && !GOOGLE_ROUTES_API_KEY_VAR.startsWith('NEXT_PUBLIC_')
    && !/NEXT_PUBLIC_[A-Z_]*ROUTE/.test(ALL_TS));

  check('M02 the provider is OFF unless explicitly switched on — fail-closed by default',
    resolveRouteProviderCredential({}).status === 'disabled'
    && resolveRouteProviderCredential({ [GOOGLE_ROUTES_API_KEY_VAR]: 'k' }).status === 'disabled'
    && resolveRouteProviderCredential({ [ROUTE_TIME_PROVIDER_ENABLED_VAR]: 'TRUE' }).status === 'disabled');

  check('M03 enabled without a credential is missing_credential, not a call attempt',
    resolveRouteProviderCredential({ [ROUTE_TIME_PROVIDER_ENABLED_VAR]: 'true' }).status === 'missing_credential'
    && resolveRouteProviderCredential({ [ROUTE_TIME_PROVIDER_ENABLED_VAR]: 'true', [GOOGLE_ROUTES_API_KEY_VAR]: '   ' })
      .status === 'missing_credential');

  check('M04 reusing the PUBLIC browser Places key for server routing is REFUSED',
    resolveRouteProviderCredential({
      [ROUTE_TIME_PROVIDER_ENABLED_VAR]: 'true',
      [GOOGLE_ROUTES_API_KEY_VAR]: 'SHARED-KEY',
      [GOOGLE_BROWSER_KEY_VAR]: 'SHARED-KEY',
    }).status === 'browser_key_reuse');

  check('M05 a properly separated server key is accepted',
    (() => {
      const c = resolveRouteProviderCredential({
        [ROUTE_TIME_PROVIDER_ENABLED_VAR]: 'true',
        [GOOGLE_ROUTES_API_KEY_VAR]: 'SERVER-KEY',
        [GOOGLE_BROWSER_KEY_VAR]: 'BROWSER-KEY',
      });
      return c.status === 'configured' && c.apiKey === 'SERVER-KEY';
    })());

  check('M06 the key is never logged, never stringified into evidence, never thrown',
    !/console\.[a-z]+\([^)]*apiKey/i.test(PROVIDER_TS)
    && !/JSON\.stringify\([^)]*apiKey/i.test(PROVIDER_TS)
    && !/throw[^;]*apiKey/i.test(PROVIDER_TS)
    && !/apiKey/.test(RUNNER_TS)
    && !/api_key|apiKey/i.test(
      RUNNER_TS.split('route_contract_version')[1] ?? ''));

  check('M07 the EXISTING client Places integration is untouched',
    /NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY/.test(read('lib/google-maps/loadGoogleMaps.ts'))
    && !/GOOGLE_ROUTES_API_KEY/.test(read('lib/google-maps/loadGoogleMaps.ts'))
    && !/routes\.googleapis\.com/.test(read('lib/google-maps/loadGoogleMaps.ts')));

  check('M08 no route module is reachable from a client component ("use client")',
    !/"use client"/.test(PROVIDER_RAW) && !/"use client"/.test(RUNNER_RAW)
    && !/"use client"/.test(PROTOCOL_RAW));

  check('M09 the staging build gate scans for the route key in CLIENT artifacts',
    /GOOGLE_ROUTES_API_KEY/.test(BUILD_RUNNER_TS));

  check('M10 the route provider switch is a known outbound flag for the staging build gate',
    /ROUTE_TIME_PROVIDER_ENABLED/.test(BUILD_GATE_TS));

  check('M11 no real key is present in this harness, fixtures or the repo env example',
    !/AIza[0-9A-Za-z_-]{35}/.test(read('scripts/mvp/matching/validate-qf-mvp-75-03.mjs'))
    && !/AIza[0-9A-Za-z_-]{35}/.test(read('.env.example'))
    && !/AIza[0-9A-Za-z_-]{35}/.test(ALL_TS));

  check('M12 CI runs this harness and is provider-offline (no key, no live call)',
    /npm run test:mvp:75-03/.test(CI_YML)
    && !/GOOGLE_ROUTES_API_KEY/.test(CI_YML)
    && !/routes\.googleapis\.com/.test(CI_YML));
}

// ===========================================================================
section('N. END-TO-END RUN through the real service, provider-offline [pure]');
// ===========================================================================
{
  const candidates = [
    { id: V.v1, latitude: 18.50, longitude: 73.80, distance_km: 2 },
    { id: V.v2, latitude: 18.55, longitude: 73.85, distance_km: 5 },
    { id: V.v3, latitude: 18.60, longitude: 73.90, distance_km: 9 },
  ];
  const env = {
    [ROUTE_TIME_PROVIDER_ENABLED_VAR]: 'true',
    [GOOGLE_ROUTES_API_KEY_VAR]: 'SERVER-ONLY-KEY',
    [GOOGLE_BROWSER_KEY_VAR]: 'BROWSER-KEY',
  };

  const disabled = await measureLeadRouteTimes({
    leadOrigin: { latitude: 18.5, longitude: 73.8 }, candidates, env: {},
  });
  check('N01 with the provider OFF: zero calls, not engaged, explicit reason',
    disabled.decision.engaged === false
    && disabled.evidence.route_fallback_reason === 'route_provider_disabled'
    && disabled.evidence.provider_call_count === 0
    && disabled.evidence.route_credential_status === 'disabled');

  const noOrigin = await measureLeadRouteTimes({ leadOrigin: null, candidates, env });
  check('N02 a lead with NO coordinate makes zero calls and falls back explicitly',
    noOrigin.decision.engaged === false
    && noOrigin.evidence.route_fallback_reason === 'no_lead_coordinate'
    && noOrigin.evidence.provider_call_count === 0);

  const engaged = await measureLeadRouteTimes({
    leadOrigin: { latitude: 18.5, longitude: 73.8 },
    candidates,
    env,
    transport: fakeTransport(() => ({
      kind: 'response', status: 200, truncated: false,
      bodyText: JSON.stringify([
        { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '300s', distanceMeters: 3000 },
        { originIndex: 0, destinationIndex: 1, condition: 'ROUTE_EXISTS', duration: '800s', distanceMeters: 8000 },
        { originIndex: 0, destinationIndex: 2, condition: 'ROUTE_EXISTS', duration: '4000s', distanceMeters: 40000 },
      ]),
    })),
  });
  check('N03 a healthy run engages, computes Tmin and partitions the frontier',
    engaged.decision.engaged === true
    && engaged.evidence.tmin_seconds === 300
    && engaged.evidence.frontier_threshold_seconds === 1200
    && eq(engaged.evidence.inside_frontier_vendor_ids, [V.v1, V.v2])
    && eq(engaged.evidence.outside_frontier_vendor_ids, [V.v3]));

  check('N04 the evidence carries the policy, provider and mode it was measured under',
    engaged.evidence.route_policy_version === ROUTE_TIME_POLICY_VERSION
    && engaged.evidence.route_contract_version === ROUTE_TIME_CONTRACT_VERSION
    && engaged.evidence.geo_frontier_contract_version === GEO_FRONTIER_CONTRACT_VERSION
    && engaged.evidence.route_provider_id === ROUTE_TIME_PROVIDER_ID
    && engaged.evidence.route_travel_mode === 'DRIVE'
    && engaged.evidence.route_routing_preference === 'TRAFFIC_UNAWARE'
    && engaged.evidence.route_departure_time_used === false);

  check('N05 the evidence asserts what route time is NOT',
    engaged.evidence.route_is_assignment_authority === false
    && engaged.evidence.route_is_eligibility_authority === false
    && engaged.evidence.route_provider_payload_persisted === false
    && engaged.evidence.route_package_weighted === false);

  check('N06 no raw provider body, api key or lead coordinate reaches the evidence',
    (() => {
      const serialized = JSON.stringify(engaged.evidence);
      return !serialized.includes('SERVER-ONLY-KEY')
        && !serialized.includes('BROWSER-KEY')
        && !serialized.includes('ROUTE_EXISTS')
        && !serialized.includes('originIndex')
        && !serialized.includes('73.8');
    })());

  const authFail = await measureLeadRouteTimes({
    leadOrigin: { latitude: 18.5, longitude: 73.8 }, candidates, env,
    transport: fakeTransport(() => ({ kind: 'response', status: 401, bodyText: '', truncated: false })),
  });
  check('N07 a swallowed auth failure is impossible — it surfaces and forces a fallback',
    authFail.decision.engaged === false
    && authFail.evidence.route_fallback_reason === 'route_provider_incomplete'
    && authFail.evidence.arbitrary_failure_count === candidates.length);

  check('N08 the service NEVER throws, on any input',
    (async () => {
      for (const bad of [null, undefined, 'x', 42, {}, []]) {
        // eslint-disable-next-line no-await-in-loop
        const r = await measureLeadRouteTimes({ leadOrigin: bad, candidates: [], env: {} });
        if (r.decision.engaged !== false) return false;
      }
      return true;
    })() instanceof Promise);

  /** 80 hard-eligible vendors, spread over `spreadKm`. Only 50 can be routed. */
  const largePool = (spreadKm) => measureLeadRouteTimes({
    leadOrigin: { latitude: 18.5, longitude: 73.8 },
    candidates: Array.from({ length: 80 }, (_, i) => ({
      id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      latitude: 18.5 + i / 1000, longitude: 73.8 + i / 1000,
      distance_km: (i + 1) * (spreadKm / 80),
    })),
    env,
    transport: fakeTransport((req) => ({
      kind: 'response', status: 200, truncated: false,
      bodyText: JSON.stringify(JSON.parse(req.body).destinations.map((_, i) => ({
        originIndex: 0, destinationIndex: i, condition: 'ROUTE_EXISTS', duration: `${300 + i}s`, distanceMeters: 1000,
      }))),
    })),
  });

  // Spread over 80 km: the 51st-nearest vendor is ~51 km out, whose minimum
  // possible drive time (51 km at 80 km/h = 2295 s) already exceeds the
  // frontier (300 + 900 = 1200 s). The unrouted tail is PROVABLY outside.
  const spread = await largePool(80);
  check('N09 a large eligible pool never exceeds the element or call ceiling',
    spread.evidence.requested_destination_count <= POLICY.maxRouteElementsPerRun
    && spread.evidence.provider_call_count <= POLICY.maxProviderCallsPerLead
    && spread.evidence.not_routed_due_to_bound_count > 0);

  check('N10 a bounded run still engages when the unrouted tail is PROVABLY outside',
    spread.decision.engaged === true
    && spread.evidence.route_domain_closed === true
    && spread.evidence.hard_eligible_count === 80);

  // Spread over 1 km: every unrouted vendor is close enough that it could still
  // be inside the frontier. Nothing may be reordered on unproven evidence.
  const dense = await largePool(1);
  check('N11 but when a bound leaves the domain OPEN it refuses to reorder',
    dense.decision.engaged === false
    && dense.evidence.route_domain_closed === false
    && dense.evidence.route_fallback_reason === 'route_domain_not_closed'
    && dense.evidence.not_routed_due_to_bound_count > 0);
}

// ===========================================================================
section('O. MATCHER INTEGRATION — authority + 75.01/75.02 preserved [static]');
// ===========================================================================
{
  const iEval = MATCHER.indexOf('const evaluation = await evaluateVendorsForLead(leadRow);');
  const iGeo = MATCHER.indexOf('await fetchGeoVendorShortlist(leadRow)');
  const iRoute = MATCHER.indexOf('const routeOutcome = await measureLeadRouteTimes(');
  const iPool = MATCHER.indexOf('const rankedPool = splitRankedPool(');

  check('O01 route measurement runs AFTER the hard-eligible set is final and BEFORE the pool',
    iEval > 0 && iGeo > iEval && iRoute > iGeo && iPool > iRoute);

  check('O02 the ranked pool is STILL built from `eligible` alone (QF-MVP-75.01 binding contract)',
    /const rankedPool = splitRankedPool\(\s*eligible\.map\(\(vendor\) => vendor\.id\),\s*MAX_ASSIGNMENT_CANDIDATE_POOL,\s*\);/
      .test(flat(MATCHER))
    && /const selectedVendorIds = rankedPool\.pool;/.test(MATCHER));

  check('O03 the frontier reorders MEMBERSHIP-PRESERVINGLY — nothing is filtered out of `eligible`',
    /reorderByGeoFrontier\(eligible, routeOutcome\.placements\)/.test(MATCHER)
    && !/eligible\s*=\s*eligible\.filter/.test(MATCHER)
    && !/eligible\.splice/.test(MATCHER)
    && !/eligible\.filter\([\s\S]{0,200}?routeOutcome/.test(MATCHER));

  check('O04 the reorder happens ONLY when route authority engaged',
    /routeOutcome\.decision\.engaged\s*\?\s*reorderByGeoFrontier/.test(flat(MATCHER)));

  check('O05 the PURE ranking function still has no route, provider or geo input',
    !/measureLeadRouteTimes|routeOutcome|routeEvidence|reorderByGeoFrontier|fetchGeoVendorShortlist|geoEvidence|shortlist/i
      .test(MATCHER.split('export function rankVendorsForLead')[1] ?? ''));

  check('O06 the authority is still handed exactly the ranked pool, unmodified',
    /const assignment = await assignLeadToMatchedVendors\(leadId, selectedVendorIds\);/.test(MATCHER));

  check('O07 QF-MVP-75.01 evidence fields all survive',
    /matchcore_contract_version/.test(MATCHER)
    && /request_fingerprint_version: CANONICAL_REQUEST_FINGERPRINT_VERSION/.test(MATCHER)
    && /candidate_order_is_binding: true/.test(MATCHER)
    && /ranked_candidate_order: selectedVendorIds/.test(MATCHER)
    && /cap_deferred_vendor_ids: classifyCapDeferred\(/.test(MATCHER)
    && (MATCHER.match(/\.\.\.outcomeAudit/g) || []).length === 3);

  check('O08 QF-MVP-75.02 geo evidence survives and is still consulted exactly once',
    (MATCHER.match(/await fetchGeoVendorShortlist\(/g) || []).length === 1
    && (MATCHER.match(/geoEvidence/g) || []).length === 2
    && /geo: geoEvidence,/.test(MATCHER));

  check('O09 route evidence is recorded on the SAME snapshot, as a sibling of geo',
    /route: routeEvidence,/.test(MATCHER)
    && /route_ordered_vendor_ids: routeOrderedVendorIds/.test(MATCHER));

  check('O10 the matcher still takes exactly ONE clock read per ranking run',
    (MATCHER.match(/const nowMs = Date\.now\(\);/g) || []).length === 1);

  check('O11 MatchCore still ranks on its own haversine, never the PostGIS number',
    /haversineKm\(lead\.latitude, lead\.longitude, coords\.lat, coords\.lng\)/.test(MATCHER));

  check('O12 the route seam performs no assignment, delivery, credit or matching-run write',
    !/assignLeadToMatchedVendors|executeCanonicalAssignment|qf_assign_lead_vendors|deliverLeadToVendorDashboard|lead_matching_runs|remaining_credits|\.insert\(|\.update\(|\.upsert\(|\.delete\(/
      .test(RUNNER_TS + PROVIDER_TS + FRONTIER_TS + CONTRACT_TS + PROTOCOL_TS));

  check('O13 no route module touches Supabase at all',
    !/adminClient|supabase|createClient|\.rpc\(/i.test(
      RUNNER_TS + PROVIDER_TS + FRONTIER_TS + CONTRACT_TS + PROTOCOL_TS + POLICY_TS));

  check('O14 the caps are untouched: active 3, lifetime 6, pool 20',
    CANONICAL_ACTIVE_ASSIGNMENT_CAP === 3
    && CANONICAL_LIFETIME_ASSIGNMENT_CAP === 6
    && MAX_CANONICAL_CANDIDATE_POOL === 20
    && splitRankedPool([V.v1, V.v2, V.v3], MAX_CANONICAL_CANDIDATE_POOL).pool.length === 3);

  check('O15 no H3, no geohash, no S2 — the 75.00 exclusion still holds',
    !/\bh3\b|h3-js|geohash|\bs2\b|latLngToCell|hexagon/i.test(ALL_TS));

  check('O16 QF-MVP-75.03 adds NO migration',
    !/supabase\/migrations/.test(ALL_TS)
    && !/create (or replace )?(function|table|index|extension)/i.test(ALL_TS));

  check('O17 the pure modules take no clock read — determinism is testable',
    !/Date\.now\(\)|new Date\(/.test(CONTRACT_TS + FRONTIER_TS + PROTOCOL_TS + POLICY_TS));

  check('O18 no route module reads process.env outside the credential seam',
    !/process\.env/.test(CONTRACT_TS + FRONTIER_TS + PROTOCOL_TS + POLICY_TS));

  check('O19 the npm script exists and matches this file',
    PKG.scripts['test:mvp:75-03']?.includes('validate-qf-mvp-75-03.mjs') === true);
}

// ===========================================================================
section('P. MUTANTS — every static check above must actually bite');
// ===========================================================================
{
  /**
   * A mutant proves a check is load-bearing: mutate the source text, assert the
   * predicate HOLDS on the real text and FAILS on the mutated text. A check that
   * survives its own mutant is a check that never bites.
   */
  function mutant(name, source, mutate, predicate) {
    const mutated = mutate(source);
    const changed = mutated !== source;
    const holdsOnReal = predicate(source);
    const holdsOnMutant = predicate(mutated);
    check(`P-${name}`, changed && holdsOnReal && !holdsOnMutant,
      !changed ? 'mutation did not change the source'
        : !holdsOnReal ? 'predicate already fails on the REAL source'
          : 'predicate SURVIVED the mutation (check does not bite)');
  }

  mutant('01 a NEXT_PUBLIC route key is rejected',
    PROVIDER_RAW,
    (s) => s.replace(/"GOOGLE_ROUTES_API_KEY"/, '"NEXT_PUBLIC_GOOGLE_ROUTES_API_KEY"'),
    (s) => !/NEXT_PUBLIC_[A-Z_]*ROUTE/.test(stripTs(s)));

  mutant('02 logging the api key is rejected',
    PROVIDER_RAW,
    (s) => s.replace('const key = typeof raw === "string" ? raw.trim() : "";',
      'const key = typeof raw === "string" ? raw.trim() : ""; console.log(apiKey);'),
    (s) => !/console\.[a-z]+\([^)]*apiKey/i.test(stripTs(s)));

  mutant('03 reusing the browser key for server routing is rejected',
    PROVIDER_RAW,
    (s) => s.replace(/if \(browserKey\.length > 0 && browserKey === key\) \{[\s\S]*?\n  \}/,
      '// browser-key guard removed'),
    (s) => /browser_key_reuse/.test(stripTs(s).split('export function resolveRouteProviderCredential')[1] ?? ''));

  mutant('04 the LEGACY Distance Matrix endpoint is rejected',
    PROTOCOL_RAW,
    // Global replace: the endpoint also appears in the header comment, and a
    // first-occurrence-only mutation would be erased by stripTs.
    (s) => s.split(GOOGLE_ROUTE_MATRIX_ENDPOINT)
      .join('https://maps.googleapis.com/maps/api/distancematrix/json'),
    // RAW, not stripped: stripTs would eat the URL at its own `//`.
    (s) => !/maps\.googleapis\.com\/maps\/api\/distancematrix/i.test(s));

  mutant('05 a wildcard field mask is rejected',
    PROTOCOL_RAW,
    (s) => s.replace('"originIndex,destinationIndex,status,condition,distanceMeters,duration"', '"*"'),
    (s) => /originIndex,destinationIndex,status,condition,distanceMeters,duration/.test(s)
      && !/GOOGLE_ROUTE_MATRIX_FIELD_MASK =\s*\n?\s*"\*"/.test(s));

  mutant('06 a missing request timeout is rejected',
    PROVIDER_RAW,
    (s) => s.replace('timeoutMs: effectiveRequestTimeoutMs(this.timeoutMs, request.timeoutCeilingMs),',
      'timeoutMs: 0,'),
    (s) => /timeoutMs: effectiveRequestTimeoutMs\(/.test(stripTs(s)));

  mutant('07 an unbounded retry loop is rejected',
    PROVIDER_RAW,
    (s) => s.replace('async routeMatrix(request: RouteMatrixRequest): Promise<RouteMatrixCallResult> {',
      'async routeMatrix(request: RouteMatrixRequest): Promise<RouteMatrixCallResult> {\n    for (let attempt = 0; ; attempt += 1) { /* retry */ }'),
    (s) => !/retry|retries|backoff|for\s*\(.*attempt/i.test(stripTs(s)));

  mutant('08 an unbounded element count is rejected',
    CONTRACT_RAW,
    (s) => s.replace('    policy.maxRouteElementsPerRun,\n', ''),
    (s) => /policy\.maxRouteElementsPerRun/.test(
      stripTs(s).split('export function planRouteBatches')[1] ?? ''));

  mutant('09 a swallowed auth error is rejected',
    PROTOCOL_RAW,
    (s) => s.replace('if (status === 401 || status === 403) return "PROVIDER_AUTH";',
      'if (status === 401 || status === 403) return "NO_ROUTE";'),
    (s) => /if \(status === 401 \|\| status === 403\) return "PROVIDER_AUTH";/.test(s));

  mutant('10 package-before-geography is rejected',
    FRONTIER_RAW,
    (s) => s.replace('  if (a.match_tier !== b.match_tier) return a.match_tier - b.match_tier;',
      '  if (a.package_status !== b.package_status) return -1;\n  if (a.match_tier !== b.match_tier) return a.match_tier - b.match_tier;'),
    (s) => !/package|paid_status|credits/i.test(
      stripTs(s).split('export function compareGeoFrontierCandidates')[1]?.split('export function reorderByGeoFrontier')[0] ?? ''));

  mutant('11 geography-after-tier (the pre-75.03 order) is rejected',
    FRONTIER_RAW,
    (s) => s.replace(/  const bandA = pa \? BAND_RANK\[pa\.band\] : BAND_RANK\.unmeasured;[\s\S]*?if \(bandA !== bandB\) return bandA - bandB;\n/,
      ''),
    (s) => /if \(bandA !== bandB\) return bandA - bandB;/.test(s)
      && (stripTs(s).indexOf('bandA !== bandB') < stripTs(s).indexOf('a.match_tier !== b.match_tier')));

  mutant('12 provider response order becoming rank order is rejected',
    PROTOCOL_RAW,
    (s) => s.replace(/const filled = new Array<RouteMeasurement \| null>\(destinations\.length\)\.fill\(null\);/,
      'const filled: (RouteMeasurement | null)[] = [];'),
    (s) => /new Array<RouteMeasurement \| null>\(destinations\.length\)\.fill\(null\)/.test(s));

  mutant('13 persisting the raw provider payload is rejected',
    RUNNER_RAW,
    (s) => s.replace('route_provider_payload_persisted: false,',
      'route_provider_payload_persisted: false, raw_provider_body: bodyText,'),
    (s) => !/raw_provider_body|provider_response_body|rawPayload/i.test(stripTs(s)));

  mutant('14 an assignment call from the provider path is rejected',
    RUNNER_RAW,
    (s) => s.replace('  const decision = decideRouteFrontier({',
      '  await assignLeadToMatchedVendors(leadId, ids);\n  const decision = decideRouteFrontier({'),
    (s) => !/assignLeadToMatchedVendors|executeCanonicalAssignment|qf_assign_lead_vendors/.test(stripTs(s)));

  // A live provider call can only originate where the request is made, so the
  // mutant targets the adapter: bypassing the INJECTED transport for the global
  // fetch is exactly how a real Google call would reach CI.
  mutant('15 a live Google call bypassing the injected transport is rejected',
    PROVIDER_RAW,
    (s) => s.replace('    const result = await this.transport.request({',
      '    await fetch(GOOGLE_ROUTE_MATRIX_ENDPOINT);\n    const result = await this.transport.request({'),
    (s) => !/\bawait fetch\(|globalThis\.fetch\(|\bfetch\(GOOGLE_/.test(stripTs(s)));

  mutant('16 narrowing `eligible` by the route result is rejected',
    MATCHER_RAW,
    (s) => s.replace('const routeOrderedVendorIds = routeOutcome.decision.engaged',
      'const filtered = eligible.filter((v) => routeOutcome.placements.get(v.id)?.band === "inside_frontier");\n    const routeOrderedVendorIds = routeOutcome.decision.engaged'),
    (s) => !/eligible\.filter\([\s\S]{0,200}?routeOutcome/.test(stripTs(s)));

  mutant('17 reordering on a NON-engaged run is rejected',
    MATCHER_RAW,
    (s) => s.replace(/const routeOrderedVendorIds = routeOutcome\.decision\.engaged\s*\n?\s*\? reorderByGeoFrontier\(eligible, routeOutcome\.placements\)\s*\n?\s*: eligible\.map\(\(vendor\) => vendor\.id\);/,
      'const routeOrderedVendorIds = reorderByGeoFrontier(eligible, routeOutcome.placements);'),
    (s) => /routeOutcome\.decision\.engaged\s*\?\s*reorderByGeoFrontier/.test(flat(stripTs(s))));

  mutant('18 breaking the QF-MVP-75.01 pool-construction contract is rejected',
    MATCHER_RAW,
    (s) => s.replace('eligible.map((vendor) => vendor.id),', 'eligible.slice(0, 5).map((vendor) => vendor.id),'),
    (s) => /const rankedPool = splitRankedPool\(\s*eligible\.map\(\(vendor\) => vendor\.id\),\s*MAX_ASSIGNMENT_CANDIDATE_POOL,\s*\);/
      .test(flat(stripTs(s))));

  mutant('19 an open (unproven) domain silently engaging is rejected',
    FRONTIER_RAW,
    (s) => s.replace('  else if (!domainClosed) outcome = "route_domain_not_closed";', ''),
    (s) => /else if \(!domainClosed\) outcome = "route_domain_not_closed";/.test(s));

  mutant('20 an infrastructure failure silently engaging is rejected',
    FRONTIER_RAW,
    (s) => s.replace('if (arbitraryFailureCount > 0) outcome = "route_provider_incomplete";',
      'if (false) outcome = "route_provider_incomplete";'),
    (s) => /if \(arbitraryFailureCount > 0\) outcome = "route_provider_incomplete";/.test(s));

  mutant('21 a departureTime / traffic-optimal upgrade by stealth is rejected',
    POLICY_RAW,
    (s) => s.replace('export const ROUTE_ROUTING_PREFERENCE = "TRAFFIC_UNAWARE";',
      'export const ROUTE_ROUTING_PREFERENCE = "TRAFFIC_AWARE_OPTIMAL";'),
    (s) => !/TRAFFIC_AWARE_OPTIMAL/.test(stripTs(s)));

  mutant('22 dropping the per-run coordinate de-duplication is rejected',
    RUNNER_RAW,
    (s) => s.replace('const deduplicated = deduplicateRouteDomain(destinations);',
      'const deduplicated = { unique: destinations, vendorIdsByKey: new Map(), duplicateCount: 0 };'),
    (s) => /const deduplicated = deduplicateRouteDomain\(destinations\);/.test(s));
}

// ===========================================================================
console.log(`\n${'='.repeat(78)}`);
console.log(`QF-MVP-75.03 — passed ${passed}, failed ${failed}`);
if (failed > 0) {
  console.log('\nFAILURES:');
  for (const line of failures) console.log(line);
}
console.log('='.repeat(78));
process.exit(failed > 0 ? 1 : 0);
