// QuickFurno — server-side location verification / service-zone resolution.
// Google supplies coordinates only. QuickFurno/PostGIS decides service geography.
import { adminClient } from "../lib/supabase";
import { normalizeCoordinate } from "../lib/geo/canonicalCoordinate";

export type LocationVerificationStatus =
  | "unverified"
  | "provisional"
  | "verified"
  | "outside_service_area";

export type LocationVerificationMethod =
  | "none"
  | "city_fallback"
  | "polygon";

export interface LocationVerificationResult {
  serviceZoneId: string | null;
  serviceZoneSlug: string | null;
  inServiceArea: boolean | null;
  status: LocationVerificationStatus;
  method: LocationVerificationMethod;
  verifiedAt: string | null;
  reasonCode: string | null;
}

const UNVERIFIED: LocationVerificationResult = {
  serviceZoneId: null,
  serviceZoneSlug: null,
  inServiceArea: null,
  status: "unverified",
  method: "none",
  verifiedAt: null,
  reasonCode: "LOCATION_VERIFICATION_UNAVAILABLE",
};
type ResolverRow = {
  service_zone_id?: unknown;
  service_zone_slug?: unknown;
  in_service_area?: unknown;
  resolution_mode?: unknown;
  verification_status?: unknown;
  reason_code?: unknown;
};

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isStatus(value: unknown): value is LocationVerificationStatus {
  return (
    value === "unverified" ||
    value === "provisional" ||
    value === "verified" ||
    value === "outside_service_area"
  );
}

function isMethod(value: unknown): value is LocationVerificationMethod {
  return value === "none" || value === "city_fallback" || value === "polygon";
}

export async function verifyLocationForServiceArea(input: {
  latitude: unknown;
  longitude: unknown;
  /** Independent Google city evidence. Never pass the selected marketplace city. */
  googleCity?: string | null;
}): Promise<LocationVerificationResult> {
  const point = normalizeCoordinate(input.latitude, input.longitude);
  if (!point) {
    return {
      ...UNVERIFIED,
      reasonCode: "INVALID_OR_MISSING_COORDINATE",
    };
  }

  try {
    const { data, error } = await adminClient().rpc("qf_resolve_service_zone_v1", {
      p_latitude: point.latitude,
      p_longitude: point.longitude,
      p_city_hint: textOrNull(input.googleCity),
    });

    if (error) {
      console.warn("[location verification] service-zone resolver unavailable", {
        code: error.code,
        message: error.message,
      });
      return UNVERIFIED;
    }

    const row = (Array.isArray(data) ? data[0] : data) as ResolverRow | null;
    if (!row || !isStatus(row.verification_status) || !isMethod(row.resolution_mode)) {
      return UNVERIFIED;
    }

    const status = row.verification_status;
    return {
      serviceZoneId: textOrNull(row.service_zone_id),
      serviceZoneSlug: textOrNull(row.service_zone_slug),
      inServiceArea:
        typeof row.in_service_area === "boolean" ? row.in_service_area : null,
      status,
      method: row.resolution_mode,
      verifiedAt:
        status === "verified" || status === "provisional"
          ? new Date().toISOString()
          : null,
      reasonCode: textOrNull(row.reason_code),
    };
  } catch (error) {
    console.warn("[location verification] service-zone resolver threw", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return UNVERIFIED;
  }
}

/**
 * Only an explicit outside-area verdict blocks geography. Unverified is not an
 * outside verdict: it preserves capture while keeping the location non-authoritative.
 */
export function isOutsideServiceArea(
  result: Pick<LocationVerificationResult, "status">,
): boolean {
  return result.status === "outside_service_area";
}
