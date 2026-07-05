// ============================================================================
// QuickFurno — lib/geo/distance.ts
//
// Small deterministic Haversine distance utility for local distance-aware vendor
// ranking. NO Google Distance Matrix, NO external request. Pure + side-effect
// free. Distance is RANKING information only — never an eligibility cutoff.
// ============================================================================

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** A finite lat/lng inside valid earth bounds. */
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  const la = typeof lat === "number" ? lat : Number(lat);
  const lo = typeof lng === "number" ? lng : Number(lng);
  return (
    Number.isFinite(la) && Number.isFinite(lo) &&
    la >= -90 && la <= 90 && lo >= -180 && lo <= 180 &&
    // (0,0) is in the ocean off Africa — treat as "no real coordinate" for India data.
    !(la === 0 && lo === 0)
  );
}

/**
 * Great-circle distance in kilometres between two points, or `null` when either
 * coordinate pair is missing/invalid (so callers can rank coordinate-known
 * vendors ahead of coordinate-unknown ones without a hard reject).
 */
export function haversineKm(
  lat1: number | null | undefined,
  lng1: number | null | undefined,
  lat2: number | null | undefined,
  lng2: number | null | undefined,
): number | null {
  if (!isValidCoordinate(lat1, lng1) || !isValidCoordinate(lat2, lng2)) return null;
  const la1 = Number(lat1);
  const lo1 = Number(lng1);
  const la2 = Number(lat2);
  const lo2 = Number(lng2);
  const dLat = toRad(la2 - la1);
  const dLon = toRad(lo2 - lo1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // Round to 3 decimals for stable, deterministic ranking/audit output.
  return Math.round(EARTH_RADIUS_KM * c * 1000) / 1000;
}
