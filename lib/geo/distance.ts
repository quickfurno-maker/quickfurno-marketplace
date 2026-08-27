// ============================================================================
// QuickFurno — lib/geo/distance.ts
//
// Small deterministic Haversine distance utility for local distance-aware vendor
// ranking. NO Google Distance Matrix, NO external request. Pure + side-effect
// free. Distance is RANKING information only — never an eligibility cutoff.
// ============================================================================

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Coerce a raw column value to a finite number, or `null`.
 *
 * QF-MVP-75.02 correction. The previous implementation coerced with a bare
 * `Number(value)`, which silently turns ABSENCE into the number zero:
 * `Number(null)`, `Number("")` and `Number(false)` are all `0`. A vendor row
 * holding office_latitude = 28.6139 with a MISSING office_longitude therefore
 * passed `isValidCoordinate` as the point (28.6139, 0) - a spot in the Atlantic
 * - and `haversineKm` reported a fabricated 7386 km for it. The vendor was
 * ranked as coordinate-KNOWN on a distance that was never measured.
 *
 * A one-sided pair is now what it always meant: NO usable coordinate. Only a
 * real number, or a string that parses to one, counts as present. `null`,
 * `undefined`, `""`, whitespace, booleans, objects and arrays do not.
 *
 * This is also the rule the SQL half must agree with: the GENERATED geography
 * columns in migration 20260816000000 guard with `is not null`, so without this
 * correction TypeScript and PostgreSQL would disagree about which rows hold a
 * point.
 */
function toFiniteCoordinateNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A finite lat/lng inside valid earth bounds, with BOTH sides genuinely present. */
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  const la = toFiniteCoordinateNumber(lat);
  const lo = toFiniteCoordinateNumber(lng);
  if (la === null || lo === null) return false;
  return (
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
