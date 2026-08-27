// ============================================================================
// QuickFurno — lib/geo/canonicalCoordinate.ts
//
// QF-MVP-75.02 — THE canonical WGS84 coordinate contract, stated once.
//
// WHY THIS MODULE EXISTS
//   Before QF-MVP-75.02 the "does this row have a usable coordinate?" rule lived
//   in exactly one place (lib/geo/distance.isValidCoordinate) and the "which of a
//   vendor's coordinate pairs wins?" rule lived in exactly one other place (a
//   private helper inside services/leadMatchingEngine). 75.02 adds a THIRD
//   consumer — the PostGIS generated columns in migration 20260816000000 — so
//   the rules must have one statement that every consumer shares, or SQL and
//   TypeScript will eventually disagree about which rows have a point.
//
//   This module does NOT restate the validity rule. It imports the existing one
//   and builds on it, so there is still exactly one definition of "valid".
//
// PURITY CONTRACT — load-bearing.
//   No I/O, no Supabase client, no network, no clock, no randomness, no global
//   state. Every function is a total function of its arguments, so the offline
//   MVP suite exercises the real production code rather than a copy of it.
//
// WHAT THIS MODULE IS NOT
//   It is not a geocoder and never becomes one. It performs no distance
//   calculation (that is lib/geo/distance), applies no eligibility rule, and
//   knows nothing about service_radius_km, packages, paid status or pincodes.
// ============================================================================

import { isValidCoordinate } from "./distance";

/**
 * Contract version for the canonical coordinate + geo evidence shape. Bump only
 * when a reader must notice a change. Mirrored into every matching_snapshot as
 * `geo.geo_contract_version` and asserted by the QF-MVP-75.02 validator.
 */
export const GEO_CONTRACT_VERSION = 1;

/** WGS84. The ONE spatial reference this system uses, end to end. */
export const GEO_SRID = 4326;

export const LATITUDE_MIN = -90;
export const LATITUDE_MAX = 90;
export const LONGITUDE_MIN = -180;
export const LONGITUDE_MAX = 180;

/**
 * Where a vendor's canonical point came from.
 *
 * Identical to `MatchCoordinateSource` in lib/matchcore/automaticMatchDecision
 * and to `CoordinateSource` in services/leadMatchingEngine; those two remain the
 * public shapes their own contracts publish, and this is the shared producer.
 */
export type VendorCoordinateSource = "office_coordinates" | "legacy_coordinates" | "none";

/** Where a lead's canonical point came from. Leads have exactly one pair. */
export type LeadCoordinateSource = "lead_coordinates" | "none";

export interface CanonicalCoordinate {
  latitude: number;
  longitude: number;
}

export interface ResolvedVendorCoordinate {
  latitude: number | null;
  longitude: number | null;
  source: VendorCoordinateSource;
}

export interface ResolvedLeadCoordinate {
  latitude: number | null;
  longitude: number | null;
  source: LeadCoordinateSource;
}

/**
 * Normalize an arbitrary lat/lng pair to a canonical coordinate, or `null`.
 *
 * The validity rule is NOT restated here — it is `isValidCoordinate` from
 * lib/geo/distance, unchanged and already load-bearing in the automatic matcher:
 *   both sides finite, latitude in [-90, 90], longitude in [-180, 180], and the
 *   pair is not the (0, 0) null island.
 *
 * Every failure mode collapses to the SAME answer — "this row has no usable
 * coordinate" — so a one-sided pair, an out-of-range value, NaN, Infinity and a
 * garbage string can never become a wrong point:
 *   - missing / null / undefined  -> null
 *   - one side only               -> null
 *   - out of range (either axis)  -> null
 *   - NaN / Infinity / non-numeric-> null
 *   - (0, 0)                      -> null
 *
 * Migration 20260816000000 implements the identical rule in SQL, as the CASE
 * guard of the two GENERATED geography columns.
 */
export function normalizeCoordinate(lat: unknown, lng: unknown): CanonicalCoordinate | null {
  if (!isValidCoordinate(lat, lng)) return null;
  return { latitude: Number(lat), longitude: Number(lng) };
}

/** True when the pair normalizes to a canonical point. */
export function hasCanonicalCoordinate(lat: unknown, lng: unknown): boolean {
  return normalizeCoordinate(lat, lng) !== null;
}

/**
 * THE canonical vendor coordinate priority: office pair first, legacy pair only
 * when the office pair is not usable, otherwise no coordinate at all.
 *
 * This is the source-proven runtime rule that
 * services/leadMatchingEngine.resolveVendorCoordinates has always applied; that
 * function now delegates here so the rule has one statement. Migration
 * 20260816000000 mirrors it as the two-branch CASE of
 * public.vendors.geo_point.
 *
 * public.vendors.base_latitude / base_longitude (migration 20260622000007) are
 * deliberately NOT a source: no runtime path has ever read them and they are
 * absent from the QuickFurno Staging baseline.
 */
export function resolveVendorCanonicalCoordinate(
  vendor: Record<string, unknown> | null | undefined,
): ResolvedVendorCoordinate {
  const row = vendor ?? {};
  const office = normalizeCoordinate(row.office_latitude, row.office_longitude);
  if (office) return { latitude: office.latitude, longitude: office.longitude, source: "office_coordinates" };
  const legacy = normalizeCoordinate(row.latitude, row.longitude);
  if (legacy) return { latitude: legacy.latitude, longitude: legacy.longitude, source: "legacy_coordinates" };
  return { latitude: null, longitude: null, source: "none" };
}

/**
 * THE canonical lead coordinate: public.leads.latitude / longitude, the only
 * lead coordinate any matching path reads. `google_place_id` is provenance and
 * identity metadata, never a distance input, and pincode is never a matching
 * authority — neither is consulted here.
 */
export function resolveLeadCanonicalCoordinate(
  lead: { latitude?: unknown; longitude?: unknown } | null | undefined,
): ResolvedLeadCoordinate {
  const point = normalizeCoordinate(lead?.latitude, lead?.longitude);
  if (!point) return { latitude: null, longitude: null, source: "none" };
  return { latitude: point.latitude, longitude: point.longitude, source: "lead_coordinates" };
}
