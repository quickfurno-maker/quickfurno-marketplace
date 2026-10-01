// ============================================================================
// QuickFurno — lib/locations/locationEvidence.ts
// Canonical trust boundary for client/vendor geographic evidence.
// ============================================================================

export type LocationEvidenceSource =
  | "manual"
  | "browser_gps"
  | "google_place"
  | "reverse_geocode";

type LeadLocationInput = {
  latitude?: number | null;
  longitude?: number | null;
  location_accuracy_meters?: number | null;
  location_source?: string | null;
  location_captured_at?: string | null;
  google_place_id?: string | null;
  formatted_address?: string | null;
  area_normalized?: string | null;
  sublocality?: string | null;
  neighborhood?: string | null;
};

type GoogleOfficeInput = {
  office_latitude?: number | null;
  office_longitude?: number | null;
  google_place_id?: string | null;
  formatted_address?: string | null;
  area_normalized?: string | null;
  sublocality?: string | null;
  neighborhood?: string | null;
};

function text(value: string | null | undefined): string | null {
  const clean = value?.trim();
  return clean ? clean : null;
}

function latitude(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90
    ? value
    : null;
}

function longitude(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180
    ? value
    : null;
}

function accuracy(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/**
 * Normalize client location evidence before DB persistence.
 *
 * - google_place requires BOTH a Place ID and valid coordinates.
 * - browser_gps/reverse_geocode require valid coordinates but never retain a
 *   Google Place identity from an older selection.
 * - manual/unknown sources never get canonical coordinates.
 */
export function normalizeLeadLocationEvidence(input: LeadLocationInput) {
  const lat = latitude(input.latitude);
  const lng = longitude(input.longitude);
  const hasCoords = lat != null && lng != null;
  const placeId = text(input.google_place_id);
  const source = text(input.location_source);

  if (source === "google_place" && placeId && hasCoords) {
    return {
      latitude: lat,
      longitude: lng,
      location_accuracy_meters: null,
      location_source: "google_place" as const,
      location_captured_at: text(input.location_captured_at),
      google_place_id: placeId,
      formatted_address: text(input.formatted_address),
      area_normalized: text(input.area_normalized),
      sublocality: text(input.sublocality),
      neighborhood: text(input.neighborhood),
    };
  }

  if ((source === "browser_gps" || source === "reverse_geocode") && hasCoords) {
    return {
      latitude: lat,
      longitude: lng,
      location_accuracy_meters: accuracy(input.location_accuracy_meters),
      location_source: source as "browser_gps" | "reverse_geocode",
      location_captured_at: text(input.location_captured_at),
      google_place_id: null,
      formatted_address: source === "reverse_geocode" ? text(input.formatted_address) : null,
      area_normalized: text(input.area_normalized),
      sublocality: source === "reverse_geocode" ? text(input.sublocality) : null,
      neighborhood: source === "reverse_geocode" ? text(input.neighborhood) : null,
    };
  }

  return {
    latitude: null,
    longitude: null,
    location_accuracy_meters: null,
    location_source: "manual" as const,
    location_captured_at: null,
    google_place_id: null,
    formatted_address: null,
    area_normalized: text(input.area_normalized),
    sublocality: null,
    neighborhood: null,
  };
}

/**
 * Canonical vendor office/base coordinates are trusted ONLY when bound to a
 * Google Place ID. Browser GPS remains a separate legacy/verification signal.
 */
export function normalizeVendorOfficeEvidence(input: GoogleOfficeInput) {
  const lat = latitude(input.office_latitude);
  const lng = longitude(input.office_longitude);
  const placeId = text(input.google_place_id);
  const verified = Boolean(placeId && lat != null && lng != null);

  return {
    verified,
    office_latitude: verified ? lat : null,
    office_longitude: verified ? lng : null,
    google_place_id: verified ? placeId : null,
    formatted_address: verified ? text(input.formatted_address) : null,
    area_normalized: text(input.area_normalized),
    sublocality: verified ? text(input.sublocality) : null,
    neighborhood: verified ? text(input.neighborhood) : null,
  };
}

/** Range-check optional browser GPS used on vendor onboarding. */
export function normalizeGpsCoordinates(
  latValue: number | null | undefined,
  lngValue: number | null | undefined,
): { latitude: number | null; longitude: number | null } {
  const lat = latitude(latValue);
  const lng = longitude(lngValue);
  if (lat == null || lng == null) return { latitude: null, longitude: null };
  return { latitude: lat, longitude: lng };
}
