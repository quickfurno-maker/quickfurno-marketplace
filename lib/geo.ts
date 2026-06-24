// ============================================================================
// QuickFurno — lib/geo.ts
// Geo helpers for vendor base location.
// TODO: Vendor GPS fields (base_latitude / base_longitude / service_radius_km)
//       will be used later for nearest-client lead assignment. This Haversine
//       helper is provided now but is NOT yet wired into the assignment RPC.
// ============================================================================

const EARTH_RADIUS_KM = 6371;

const toRadians = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two lat/lon points in kilometres (Haversine).
 * Returns NaN if any coordinate is missing/invalid so callers can guard on it.
 */
export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if (![lat1, lon1, lat2, lon2].every((v) => Number.isFinite(v))) return NaN;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}
