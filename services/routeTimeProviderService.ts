// ============================================================================
// QuickFurno — services/routeTimeProviderService.ts
//
// QF-MVP-75.03 — the ONLY runtime seam that reaches an external route-time
// provider, and the narrow provider-neutral contract it satisfies.
//
// SERVER ONLY, AND FAIL-CLOSED BY DEFAULT
//   The provider is OFF unless ROUTE_TIME_PROVIDER_ENABLED is explicitly on AND
//   a server-only GOOGLE_ROUTES_API_KEY is present. With either absent the
//   matcher keeps its deterministic pre-75.03 order and records a reason. There
//   is no implicit enablement and no "enabled because a key exists" path.
//
// THE CREDENTIAL NEVER LEAVES THIS FILE EXCEPT AS A REQUEST HEADER
//   It is read from process.env here, handed to buildRouteMatrixHeaders, and
//   dropped. It is never logged, never returned, never put in an error message,
//   never persisted, never placed in matching_snapshot and never exposed through
//   a NEXT_PUBLIC_* name. The browser-key reuse guard below refuses to use the
//   PUBLIC Places key for server routing even if an operator pastes it in.
//
// NO RETRY, EVER
//   One request per batch. A failure is classified and returned; it is never
//   re-attempted. Retrying would multiply a billable element count under exactly
//   the conditions (timeout, 429, 5xx) where the provider is already struggling,
//   and the failure contract already resolves an incomplete run safely.
//
// NOT AN AUTHORITY
//   Read-only against the provider. No insert, no update, no credit movement, no
//   assignment, no matching-run write, and no path to
//   public.qf_assign_lead_vendors_v2.
// ============================================================================

import {
  DEFAULT_MAX_RESPONSE_BYTES,
  FetchHttpTransport,
  effectiveRequestTimeoutMs,
  type HttpTransport,
} from "../lib/communication/httpTransport";
import {
  buildRouteMatrixBody,
  buildRouteMatrixHeaders,
  classifyHttpStatus,
  parseRouteMatrixResponse,
  GOOGLE_ROUTE_MATRIX_ENDPOINT,
  type LatLngPoint,
} from "../lib/geo/googleRouteMatrixProtocol";
import type { RouteDestination, RouteElementStatus, RouteMeasurement } from "../lib/geo/routeTimeContract";
import type { RouteTimePolicy } from "../lib/geo/routeTimePolicy";

/** The operator switch. Absent or not exactly "true" means the provider is OFF. */
export const ROUTE_TIME_PROVIDER_ENABLED_VAR = "ROUTE_TIME_PROVIDER_ENABLED";
/** The SERVER-ONLY routing credential. Never a NEXT_PUBLIC_* name. */
export const GOOGLE_ROUTES_API_KEY_VAR = "GOOGLE_ROUTES_API_KEY";
/** The EXISTING public client Places key. Read only to REFUSE reusing it. */
export const GOOGLE_BROWSER_KEY_VAR = "NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY";

export type RouteProviderCredentialStatus =
  | "configured"
  | "disabled"
  | "missing_credential"
  | "browser_key_reuse";

export interface RouteProviderCredential {
  readonly status: RouteProviderCredentialStatus;
  /** Present ONLY when status is "configured". Never logged, never persisted. */
  readonly apiKey: string | null;
}

type EnvLike = Record<string, string | undefined>;

/**
 * Resolve the route provider credential.
 *
 * The browser-key reuse guard is not paranoia. The existing client integration
 * (lib/google-maps/loadGoogleMaps) deliberately ships
 * NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY into the client bundle, where it is
 * expected to be public and HTTP-referrer restricted. A referrer-restricted key
 * cannot authenticate a server-to-server Routes call, and an UNRESTRICTED key
 * that works for both would be a public credential with server routing quota
 * attached to it. Either way the correct answer is to refuse, not to try.
 */
export function resolveRouteProviderCredential(env: EnvLike): RouteProviderCredential {
  if (env[ROUTE_TIME_PROVIDER_ENABLED_VAR] !== "true") {
    return { status: "disabled", apiKey: null };
  }
  const raw = env[GOOGLE_ROUTES_API_KEY_VAR];
  const key = typeof raw === "string" ? raw.trim() : "";
  if (key.length === 0) return { status: "missing_credential", apiKey: null };

  const browserRaw = env[GOOGLE_BROWSER_KEY_VAR];
  const browserKey = typeof browserRaw === "string" ? browserRaw.trim() : "";
  if (browserKey.length > 0 && browserKey === key) {
    return { status: "browser_key_reuse", apiKey: null };
  }
  return { status: "configured", apiKey: key };
}

// ---------------------------------------------------------------------------
// The provider contract
// ---------------------------------------------------------------------------

export interface RouteMatrixRequest {
  readonly origin: LatLngPoint;
  readonly destinations: readonly RouteDestination[];
  /**
   * Optional CEILING on this call's timeout — the caller's remaining total
   * provider budget. It can only SHORTEN the configured timeout, never extend
   * it, and it still drives the AbortController, so the request is genuinely
   * cancelled rather than abandoned.
   */
  readonly timeoutCeilingMs?: number | null;
}

export interface RouteMatrixCallResult {
  /** One measurement per requested destination, in REQUEST order. */
  readonly measurements: RouteMeasurement[];
  /** Elements whose indices were duplicated, out of range or non-numeric. */
  readonly protocolViolationCount: number;
  /** Provider-side request identifier when the transport exposes one. */
  readonly providerRequestId: string | null;
}

/**
 * The narrow, provider-neutral contract. One lead origin, a BOUNDED set of
 * vendor destinations, one result per destination. Nothing Google-shaped crosses
 * this boundary — a future provider implements this interface and nothing else
 * in the system changes.
 */
export interface RouteTimeProvider {
  readonly providerId: string;
  routeMatrix(request: RouteMatrixRequest): Promise<RouteMatrixCallResult>;
}

/** Uniform failure result: every destination carries the same normalized status. */
function allDestinations(
  destinations: readonly RouteDestination[],
  status: RouteElementStatus,
): RouteMeasurement[] {
  return destinations.map((d) => ({
    vendor_id: d.vendor_id,
    status,
    travel_time_seconds: null,
    distance_meters: null,
  }));
}

/**
 * Google Maps Platform Routes API — Compute Route Matrix.
 *
 * The transport is injected, so the offline suite drives every branch (timeout,
 * 401, 429, 5xx, malformed body, partial elements) with a fake transport and NO
 * real network. CI never makes a provider call.
 */
export class GoogleRouteTimeProvider implements RouteTimeProvider {
  readonly providerId: string;

  private readonly transport: HttpTransport;
  private readonly apiKey: string;
  private readonly policy: RouteTimePolicy;
  private readonly timeoutMs: number;

  constructor(deps: {
    transport: HttpTransport;
    apiKey: string;
    policy: RouteTimePolicy;
    /** Shortened per-call timeout when a total budget is running out. */
    timeoutMs?: number;
  }) {
    this.transport = deps.transport;
    this.apiKey = deps.apiKey;
    this.policy = deps.policy;
    this.providerId = deps.policy.providerId;
    this.timeoutMs = deps.timeoutMs ?? deps.policy.providerTimeoutMs;
  }

  async routeMatrix(request: RouteMatrixRequest): Promise<RouteMatrixCallResult> {
    const { origin, destinations } = request;

    // Exactly ONE request. No loop, no retry, no backoff.
    const result = await this.transport.request({
      url: GOOGLE_ROUTE_MATRIX_ENDPOINT,
      method: "POST",
      headers: buildRouteMatrixHeaders(this.apiKey),
      body: buildRouteMatrixBody(origin, destinations, this.policy),
      timeoutMs: effectiveRequestTimeoutMs(this.timeoutMs, request.timeoutCeilingMs),
      maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    });

    if (result.kind === "aborted") {
      return {
        measurements: allDestinations(destinations, "PROVIDER_TIMEOUT"),
        protocolViolationCount: 0,
        providerRequestId: null,
      };
    }
    if (result.kind === "network_error") {
      // A transport-level failure is infrastructure, never geography.
      return {
        measurements: allDestinations(destinations, "PROVIDER_5XX"),
        protocolViolationCount: 0,
        providerRequestId: null,
      };
    }

    const httpFailure = classifyHttpStatus(result.status);
    if (httpFailure) {
      // The body of an error response is NEVER read, parsed, logged or
      // persisted: it can echo request material and has no business value.
      return {
        measurements: allDestinations(destinations, httpFailure),
        protocolViolationCount: 0,
        providerRequestId: null,
      };
    }

    if (result.truncated) {
      return {
        measurements: allDestinations(destinations, "MALFORMED_RESPONSE"),
        protocolViolationCount: 0,
        providerRequestId: null,
      };
    }

    const parsed = parseRouteMatrixResponse(result.bodyText, destinations);
    return {
      measurements: parsed.measurements,
      protocolViolationCount: parsed.protocolViolationCount,
      providerRequestId: null,
    };
  }
}

/**
 * Build the production provider, or null when it is not usable.
 *
 * The default transport is the repository's existing abortable, byte-bounded
 * FetchHttpTransport (lib/communication/httpTransport) — the same one every
 * provider adapter uses — so the timeout is enforced by a real AbortController
 * that CANCELS the request rather than abandoning it.
 */
export function createRouteTimeProvider(deps: {
  policy: RouteTimePolicy;
  env?: EnvLike;
  transport?: HttpTransport;
  timeoutMs?: number;
}): { provider: RouteTimeProvider | null; credentialStatus: RouteProviderCredentialStatus } {
  const env = deps.env ?? (process.env as EnvLike);
  const credential = resolveRouteProviderCredential(env);
  if (credential.status !== "configured" || !credential.apiKey) {
    return { provider: null, credentialStatus: credential.status };
  }
  return {
    provider: new GoogleRouteTimeProvider({
      transport: deps.transport ?? new FetchHttpTransport(),
      apiKey: credential.apiKey,
      policy: deps.policy,
      timeoutMs: deps.timeoutMs,
    }),
    credentialStatus: credential.status,
  };
}
