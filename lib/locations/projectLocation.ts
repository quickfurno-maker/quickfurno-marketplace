// ============================================================================
// QuickFurno — lib/locations/projectLocation.ts
//
// Canonical CLIENT project/service location for public marketplace browsing.
// This is intentionally selected from Google Places. It is NOT device GPS.
//
// The same structured point can be persisted in a SameSite cookie (for server
// rendering/ranking) and localStorage (for instant client hydration). Never put
// it in the URL: project addresses/coordinates should not leak into referrers,
// analytics URLs or copied links.
// ============================================================================
import type { NormalizedGooglePlace } from "../google-maps/types";

export const PROJECT_LOCATION_COOKIE = "qf_project_location_v1";
export const PROJECT_LOCATION_STORAGE_KEY = "qf:project-location:v1";
export const PROJECT_LOCATION_DISMISSED_SESSION_KEY = "qf:project-location-dismissed:v1";
export const PROJECT_LOCATION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type ProjectLocation = {
  version: 1;
  source: "google_place";
  placeId: string;
  label: string;
  formattedAddress: string | null;
  city: string;
  areaNormalized: string | null;
  sublocality: string | null;
  neighborhood: string | null;
  latitude: number;
  longitude: number;
  serviceZoneId: string | null;
  capturedAt: string;
};

function text(value: unknown): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  return v || null;
}

function finiteCoord(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export function makeProjectLocation(input: {
  place: NormalizedGooglePlace;
  city: string;
  serviceZoneId?: string | null;
  capturedAt?: string;
}): ProjectLocation | null {
  const placeId = text(input.place.placeId);
  const city = text(input.city);
  const latitude = finiteCoord(input.place.lat, -90, 90);
  const longitude = finiteCoord(input.place.lng, -180, 180);
  if (!placeId || !city || latitude == null || longitude == null) return null;

  return {
    version: 1,
    source: "google_place",
    placeId,
    label:
      text(input.place.area) ??
      text(input.place.sublocality) ??
      text(input.place.neighborhood) ??
      text(input.place.formattedAddress) ??
      city,
    formattedAddress: text(input.place.formattedAddress),
    city,
    areaNormalized: text(input.place.areaNormalized),
    sublocality: text(input.place.sublocality),
    neighborhood: text(input.place.neighborhood),
    latitude,
    longitude,
    serviceZoneId: text(input.serviceZoneId),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
}

export function projectLocationToGooglePlace(
  location: ProjectLocation,
): NormalizedGooglePlace {
  return {
    placeId: location.placeId,
    formattedAddress: location.formattedAddress,
    city: location.city,
    area: location.label,
    areaNormalized: location.areaNormalized,
    sublocality: location.sublocality,
    neighborhood: location.neighborhood,
    state: null,
    lat: location.latitude,
    lng: location.longitude,
  };
}

export function parseProjectLocation(raw: string | null | undefined): ProjectLocation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectLocation>;
    const placeId = text(parsed.placeId);
    const label = text(parsed.label);
    const city = text(parsed.city);
    const latitude = finiteCoord(parsed.latitude, -90, 90);
    const longitude = finiteCoord(parsed.longitude, -180, 180);
    if (
      parsed.version !== 1 ||
      parsed.source !== "google_place" ||
      !placeId ||
      !label ||
      !city ||
      latitude == null ||
      longitude == null
    ) {
      return null;
    }
    return {
      version: 1,
      source: "google_place",
      placeId,
      label,
      formattedAddress: text(parsed.formattedAddress),
      city,
      areaNormalized: text(parsed.areaNormalized),
      sublocality: text(parsed.sublocality),
      neighborhood: text(parsed.neighborhood),
      latitude,
      longitude,
      serviceZoneId: text(parsed.serviceZoneId),
      capturedAt: text(parsed.capturedAt) ?? "",
    };
  } catch {
    return null;
  }
}

export function serializeProjectLocation(location: ProjectLocation): string {
  return JSON.stringify(location);
}

/**
 * Server ranking needs only city/label/point provenance. Keep detailed address
 * components in localStorage instead of sending them with every same-site HTTP
 * request.
 */
export function serializeProjectLocationCookie(location: ProjectLocation): string {
  return JSON.stringify({
    version: location.version,
    source: location.source,
    placeId: location.placeId,
    label: location.label,
    city: location.city,
    latitude: location.latitude,
    longitude: location.longitude,
    capturedAt: location.capturedAt,
  });
}

export function parseProjectLocationCookie(
  cookieValue: string | null | undefined,
): ProjectLocation | null {
  if (!cookieValue) return null;
  try {
    return parseProjectLocation(decodeURIComponent(cookieValue));
  } catch {
    return null;
  }
}
