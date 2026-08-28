// ============================================================================
// QuickFurno — lib/geo/googleRouteMatrixProtocol.ts
//
// QF-MVP-75.03 — the PURE wire protocol for Google Maps Platform Routes API,
// method Compute Route Matrix.
//
// EXTERNAL CONTRACT USED (current official Routes API documentation)
//   POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix
//   Headers: Content-Type, X-Goog-Api-Key, X-Goog-FieldMask
//   Body:    { origins[], destinations[], travelMode, routingPreference }
//            waypoints as location.latLng.{latitude,longitude}
//   Response: a JSON ARRAY of RouteMatrixElement
//            { originIndex, destinationIndex, status, condition,
//              distanceMeters, duration }
//            condition ∈ ROUTE_EXISTS | ROUTE_NOT_FOUND |
//                        ROUTE_MATRIX_ELEMENT_CONDITION_UNSPECIFIED
//            duration is a protobuf Duration string, e.g. "123s"
//   Limits:  625 elements general maximum; 100 for TRAFFIC_AWARE_OPTIMAL and
//            TRANSIT; at least one origin and TWO OR MORE destinations.
//
//   The LEGACY Distance Matrix API is deliberately NOT implemented. It is a
//   different, superseded product and the phase brief forbids it.
//
// PURITY CONTRACT — load-bearing.
//   No I/O, no network, no fetch, no clock, no randomness, no process.env read.
//   The transport is injected by services/routeTimeProviderService, so the
//   offline suite drives every branch of this file with fixtures.
//
// NEVER LOGS OR RETURNS A CREDENTIAL.
//   The API key enters exactly one function (buildRouteMatrixHeaders) and leaves
//   only inside the header map handed straight to the transport. Nothing here
//   stringifies it, and no failure path echoes a request header.
// ============================================================================

import {
  parseDistanceMeters,
  parseDurationSeconds,
  type RouteDestination,
  type RouteElementStatus,
  type RouteMeasurement,
} from "./routeTimeContract";
import type { RouteTimePolicy } from "./routeTimePolicy";

/** The ONE endpoint this system may call for route times. */
export const GOOGLE_ROUTE_MATRIX_ENDPOINT =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

export const GOOGLE_API_KEY_HEADER = "X-Goog-Api-Key";
export const GOOGLE_FIELD_MASK_HEADER = "X-Goog-FieldMask";

/**
 * The EXACT response fields this system needs, and nothing else.
 *
 * A field mask is not decoration: Routes API bills and shapes the response by
 * what is requested, and `*` would pull polylines, legs, navigation steps, toll
 * information and localized text QuickFurno has no use for, must not persist and
 * must not pay for. These six are the complete set the frontier consumes.
 */
export const GOOGLE_ROUTE_MATRIX_FIELD_MASK =
  "originIndex,destinationIndex,status,condition,distanceMeters,duration";

/** Element conditions the Routes API documents. */
export const ROUTE_EXISTS_CONDITION = "ROUTE_EXISTS";
export const ROUTE_NOT_FOUND_CONDITION = "ROUTE_NOT_FOUND";

export interface LatLngPoint {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Request headers. The key is passed as a header, never as a query parameter, so
 * it cannot be captured by proxy access logs or a redirect chain.
 */
export function buildRouteMatrixHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    [GOOGLE_API_KEY_HEADER]: apiKey,
    [GOOGLE_FIELD_MASK_HEADER]: GOOGLE_ROUTE_MATRIX_FIELD_MASK,
  };
}

/**
 * The request body for one origin and N vendor destinations.
 *
 * CANONICAL COORDINATES ONLY. Addresses and place ids are never sent: the lead's
 * address is private client data, an address string would have to be geocoded by
 * the provider (a second billable product and a second source of truth), and the
 * Routes API caps address/place-id waypoints at 50 anyway. lat/lng is what
 * QF-MVP-75.02 canonicalized, and it is what this sends.
 *
 * `departureTime` is deliberately absent — see ROUTE_ROUTING_PREFERENCE in
 * lib/geo/routeTimePolicy.
 */
export function buildRouteMatrixBody(
  origin: LatLngPoint,
  destinations: readonly RouteDestination[],
  policy: RouteTimePolicy,
): string {
  return JSON.stringify({
    origins: [
      { waypoint: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } } },
    ],
    destinations: destinations.map((d) => ({
      waypoint: { location: { latLng: { latitude: d.latitude, longitude: d.longitude } } },
    })),
    travelMode: policy.travelMode,
    routingPreference: policy.routingPreference,
  });
}

/**
 * Map an HTTP status to a normalized element status, or null when the response
 * is a 200 whose body must still be parsed.
 *
 * An auth, quota or infrastructure failure is NEVER reported as "no route".
 * Every code below is an ARBITRARY status (lib/geo/routeTimeContract), so any of
 * them forces the whole run back to the deterministic pre-75.03 order rather
 * than silently demoting the vendors it touched.
 */
export function classifyHttpStatus(status: number): RouteElementStatus | null {
  if (status === 200) return null;
  if (status === 401 || status === 403) return "PROVIDER_AUTH";
  if (status === 429) return "PROVIDER_RATE_LIMIT";
  if (status >= 500) return "PROVIDER_5XX";
  // Any other 4xx is a REQUEST defect on our side (bad body, bad field mask,
  // rejected waypoint). It is not a geography fact and must not look like one.
  return "INVALID_PROVIDER_ELEMENT";
}

/** True when a google.rpc.Status object means "OK". Absent or code 0 is OK. */
function elementStatusIsOk(status: unknown): boolean {
  if (status === null || status === undefined) return true;
  if (typeof status !== "object") return false;
  const code = (status as { code?: unknown }).code;
  if (code === undefined || code === null) return true;
  return code === 0;
}

/**
 * Classify one RouteMatrixElement into a measurement.
 *
 * ROUTE_NOT_FOUND is the ONLY provider signal accepted as a geography fact.
 * Everything else that is not a clean ROUTE_EXISTS becomes an arbitrary status,
 * because an element we cannot explain must never be allowed to quietly demote
 * a vendor that might have won the lead.
 */
function classifyElement(element: Record<string, unknown>): {
  status: RouteElementStatus;
  travel_time_seconds: number | null;
  distance_meters: number | null;
} {
  if (!elementStatusIsOk(element.status)) {
    return { status: "INVALID_PROVIDER_ELEMENT", travel_time_seconds: null, distance_meters: null };
  }

  const condition = typeof element.condition === "string" ? element.condition : "";
  if (condition === ROUTE_NOT_FOUND_CONDITION) {
    return { status: "NO_ROUTE", travel_time_seconds: null, distance_meters: null };
  }
  if (condition !== ROUTE_EXISTS_CONDITION) {
    return { status: "INVALID_PROVIDER_ELEMENT", travel_time_seconds: null, distance_meters: null };
  }

  const seconds = parseDurationSeconds(element.duration);
  if (seconds === null) {
    // ROUTE_EXISTS without a readable duration is a malformed payload, not a
    // route of unknown length.
    return { status: "MALFORMED_RESPONSE", travel_time_seconds: null, distance_meters: null };
  }

  return {
    status: "SUCCESS",
    travel_time_seconds: seconds,
    distance_meters: parseDistanceMeters(element.distanceMeters),
  };
}

export interface RouteMatrixParseResult {
  /** One measurement per requested destination, in request order. */
  readonly measurements: RouteMeasurement[];
  /** Elements whose indices were duplicated, out of range, or non-numeric. */
  readonly protocolViolationCount: number;
}

/**
 * Normalize a Compute Route Matrix response body into one measurement per
 * REQUESTED destination.
 *
 * The result is keyed by our own request order, never by the provider's response
 * order: Routes API explicitly does not guarantee element order, and the phase
 * brief forbids provider response order from becoming rank order. Every slot
 * starts as INVALID_PROVIDER_ELEMENT and is filled only by an element whose
 * `destinationIndex` is an in-range integer not already claimed, so a duplicate,
 * an out-of-range index and a missing index are all caught rather than shifting
 * a measurement onto the wrong vendor.
 *
 * A body that is not parseable JSON, or is not an array, makes EVERY destination
 * MALFORMED_RESPONSE — nothing partial is salvaged from an unreadable payload.
 */
export function parseRouteMatrixResponse(
  bodyText: string,
  destinations: readonly RouteDestination[],
): RouteMatrixParseResult {
  const malformedAll = (): RouteMatrixParseResult => ({
    measurements: destinations.map((d) => ({
      vendor_id: d.vendor_id,
      status: "MALFORMED_RESPONSE" as const,
      travel_time_seconds: null,
      distance_meters: null,
    })),
    protocolViolationCount: 0,
  });

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return malformedAll();
  }
  if (!Array.isArray(payload)) return malformedAll();

  const filled = new Array<RouteMeasurement | null>(destinations.length).fill(null);
  let protocolViolationCount = 0;

  for (const raw of payload) {
    if (typeof raw !== "object" || raw === null) {
      protocolViolationCount += 1;
      continue;
    }
    const element = raw as Record<string, unknown>;

    // We send exactly one origin, so any other originIndex is a protocol breach.
    const originIndex = element.originIndex;
    if (originIndex !== undefined && originIndex !== 0) {
      protocolViolationCount += 1;
      continue;
    }

    const index = element.destinationIndex;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= destinations.length) {
      protocolViolationCount += 1;
      continue;
    }
    if (filled[index] !== null) {
      protocolViolationCount += 1;
      continue;
    }

    const classified = classifyElement(element);
    filled[index] = {
      vendor_id: destinations[index].vendor_id,
      status: classified.status,
      travel_time_seconds: classified.travel_time_seconds,
      distance_meters: classified.distance_meters,
    };
  }

  const measurements = destinations.map((d, i) =>
    filled[i] ?? {
      vendor_id: d.vendor_id,
      status: "INVALID_PROVIDER_ELEMENT" as const,
      travel_time_seconds: null,
      distance_meters: null,
    },
  );

  return { measurements, protocolViolationCount };
}
