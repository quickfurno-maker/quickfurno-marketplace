// ============================================================================
// QuickFurno — lib/geo/geoShortlistContract.ts
//
// QF-MVP-75.02 — the PURE contract for the bounded read-only PostGIS geo
// shortlist, and for the matching evidence it produces.
//
// WHAT THE SHORTLIST IS, EXACTLY
//   A DISCOVERY SEAM. Given a lead that holds a canonical coordinate, it asks
//   PostGIS which vendors carry a canonical coordinate nearest to it, in
//   straight-line kilometres, bounded and deterministically ordered.
//
// WHAT THE SHORTLIST IS NOT — the load-bearing QF-MVP-75.02 boundary.
//   It is NOT a candidate filter. In this slice the shortlist NEVER narrows the
//   set MatchCore ranks: services/leadMatchingEngine still evaluates the same
//   vendor rows it evaluated before, under the same hard eligibility, and
//   submits the same ranked pool to the same canonical authority. The shortlist
//   result is OBSERVED and RECORDED, never subtracted.
//
//   That is not timidity, it is the only design that discharges the QF-MVP-75.02
//   proof obligation "a new bound must not exclude a vendor the current
//   20-candidate contract could have selected". The current comparator
//   (lib/matchcore/automaticMatchDecision) orders match_tier ASC BEFORE any
//   distance key, so a Tier-0 exact-category vendor outranks every Tier-1
//   parent-group vendor no matter how far away it is. A distance-bounded
//   upstream shortlist is category-blind and could therefore drop exactly that
//   Tier-0 vendor. Since a shortlist that subtracts nothing can exclude nothing,
//   the obligation is discharged structurally rather than by argument.
//
//   It is NOT route distance and NOT route time. ST_Distance over `geography` is
//   a straight-line great-circle number and must never be labelled otherwise.
//   Route-time work is a later frontier.
//
//   It is NOT an eligibility authority, carries no credit effect, performs no
//   assignment, writes no matching-run row and never reaches
//   public.qf_assign_lead_vendors_v2.
//
// PURITY CONTRACT — load-bearing.
//   No I/O, no Supabase client, no network, no clock, no randomness, no global
//   state. The I/O adapter is services/geoVendorShortlistService.
// ============================================================================

import { MAX_CANONICAL_CANDIDATE_POOL } from "../marketplace/canonicalAssignmentContract";
import { GEO_CONTRACT_VERSION, type LeadCoordinateSource } from "./canonicalCoordinate";

/** The one RPC this seam may call. Read-only, service_role only. */
export const GEO_SHORTLIST_RPC = "qf_geo_vendor_shortlist_v1";

/**
 * The bounded evidence window.
 *
 * NOT an invented number. It is MAX_CANONICAL_CANDIDATE_POOL — the existing
 * transport ceiling on the candidate pool the canonical authority can ever be
 * handed — imported rather than re-declared so the two cannot drift. The
 * evidence window is therefore never wider than the pool itself, and the SQL
 * side clamps to the same 20 independently.
 */
export const GEO_SHORTLIST_MAX_RESULTS = MAX_CANONICAL_CANDIDATE_POOL;

/**
 * How the reported kilometre figure was produced. Recorded verbatim in every
 * snapshot so a reader can never mistake it for a routed number.
 */
export const GEO_SHORTLIST_DISTANCE_METRIC =
  "postgis_st_distance_geography_wgs84_sphere_straight_line_km";

export type GeoShortlistStatus =
  /** The RPC ran and returned at least one vendor. */
  | "shortlisted"
  /** The lead holds no canonical coordinate, so the RPC was never called. */
  | "no_lead_coordinate"
  /** The RPC ran and returned zero rows: no vendor holds a canonical point. */
  | "no_geo_vendor"
  /** The RPC is absent — migration 20260816000000 is not applied here. */
  | "unavailable"
  /** The RPC failed. Nothing partial may be used. */
  | "error";

/**
 * Which path the automatic run actually took. In QF-MVP-75.02 every one of these
 * runs the SAME MatchCore ranking over the SAME eligible pool; the label records
 * WHY geo evidence is or is not present, so a lead can never be silently written
 * off as "no supply".
 */
export type GeoMatchPath =
  | "geo_shortlist"
  | "city_fallback_no_lead_coordinate"
  | "city_fallback_no_geo_vendor"
  | "city_fallback_geo_unavailable"
  | "city_fallback_geo_error";

export interface GeoShortlistEntry {
  vendor_id: string;
  /** Straight-line kilometres. Never route distance, never route time. */
  straight_line_distance_km: number;
  shortlist_rank: number;
}

export interface GeoShortlistOutcome {
  status: GeoShortlistStatus;
  entries: GeoShortlistEntry[];
  /** Stable machine reason when status is `unavailable` or `error`; else null. */
  error_code: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalize the raw RPC payload into the contract shape.
 *
 * Deliberately strict, because a partial or malformed response must never
 * become evidence: a row is kept only when its vendor id is a real UUID and its
 * distance is a finite non-negative number. Order is re-established from the
 * distance and the vendor id — the same total order the SQL applies — so the
 * evidence is deterministic even if transport re-orders the rows, and
 * `shortlist_rank` is re-stamped 1-based from that order rather than trusted.
 */
export function normalizeGeoShortlistRows(rows: unknown): GeoShortlistEntry[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const kept: GeoShortlistEntry[] = [];

  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const vendorId = typeof row.vendor_id === "string" ? row.vendor_id.trim().toLowerCase() : "";
    if (!UUID_RE.test(vendorId) || seen.has(vendorId)) continue;
    const distance = Number(row.straight_line_distance_km);
    if (!Number.isFinite(distance) || distance < 0) continue;
    seen.add(vendorId);
    kept.push({ vendor_id: vendorId, straight_line_distance_km: distance, shortlist_rank: 0 });
  }

  kept.sort((a, b) =>
    a.straight_line_distance_km !== b.straight_line_distance_km
      ? a.straight_line_distance_km - b.straight_line_distance_km
      : a.vendor_id.localeCompare(b.vendor_id),
  );

  return kept
    .slice(0, GEO_SHORTLIST_MAX_RESULTS)
    .map((entry, index) => ({ ...entry, shortlist_rank: index + 1 }));
}

/**
 * Decide the path label from the shortlist outcome.
 *
 * A shortlist that produced nothing usable ALWAYS resolves to an explicit city
 * fallback label. There is no path that means "no supply": that conclusion can
 * only ever be drawn from the eligible pool, which the shortlist never touches.
 */
export function resolveGeoMatchPath(status: GeoShortlistStatus): GeoMatchPath {
  switch (status) {
    case "shortlisted":
      return "geo_shortlist";
    case "no_lead_coordinate":
      return "city_fallback_no_lead_coordinate";
    case "no_geo_vendor":
      return "city_fallback_no_geo_vendor";
    case "unavailable":
      return "city_fallback_geo_unavailable";
    case "error":
    default:
      return "city_fallback_geo_error";
  }
}

/** True for every outcome that must fall back to the deterministic city path. */
export function isCityFallbackPath(path: GeoMatchPath): boolean {
  return path !== "geo_shortlist";
}

export interface GeoMatchEvidenceInput {
  outcome: GeoShortlistOutcome;
  leadCoordinateSource: LeadCoordinateSource;
  /** Whether the LEAD normalized to a canonical point. */
  leadHasValidCoordinate: boolean;
  /** Provenance only — `location_source` text, never coordinates. */
  leadLocationSource: string | null;
  /** Provenance only — presence, never the identifier itself. */
  leadGooglePlaceIdPresent: boolean;
  /** Size of the city-gated eligible pool MatchCore actually ranked. */
  cityEligibleVendorCount: number;
}

export interface GeoMatchEvidence {
  geo_contract_version: number;
  geo_srid: number;
  lead_has_valid_coordinate: boolean;
  lead_coordinate_source: LeadCoordinateSource;
  lead_location_source: string | null;
  lead_google_place_id_present: boolean;
  shortlist_status: GeoShortlistStatus;
  shortlist_path: GeoMatchPath;
  shortlist_bound: number;
  shortlist_vendor_ids: string[];
  shortlist_distances: GeoShortlistEntry[];
  shortlist_distance_metric: string;
  shortlist_is_route_distance: false;
  shortlist_is_route_time: false;
  shortlist_is_assignment_authority: false;
  shortlist_is_eligibility_authority: false;
  shortlist_narrowed_candidate_pool: false;
  city_eligible_vendor_count: number;
  city_fallback_used: boolean;
  geo_error_code: string | null;
}

/**
 * Build the geo half of `lead_matching_runs.matching_snapshot`.
 *
 * Extends the EXISTING jsonb snapshot only — no new column, no new table, no new
 * dashboard, no analytics schema. It carries no raw provider payload, no secret,
 * and no lead coordinate: the lead's own latitude/longitude would identify a
 * private address, so only the non-sensitive PROVENANCE of the coordinate is
 * recorded. Vendor distances are business geography, and are the evidence this
 * phase exists to produce.
 */
export function buildGeoMatchEvidence(input: GeoMatchEvidenceInput): GeoMatchEvidence {
  const path = resolveGeoMatchPath(input.outcome.status);
  const entries = input.outcome.entries;
  return {
    geo_contract_version: GEO_CONTRACT_VERSION,
    geo_srid: 4326,
    lead_has_valid_coordinate: input.leadHasValidCoordinate,
    lead_coordinate_source: input.leadCoordinateSource,
    lead_location_source: input.leadLocationSource,
    lead_google_place_id_present: input.leadGooglePlaceIdPresent,
    shortlist_status: input.outcome.status,
    shortlist_path: path,
    shortlist_bound: GEO_SHORTLIST_MAX_RESULTS,
    shortlist_vendor_ids: entries.map((entry) => entry.vendor_id),
    shortlist_distances: entries,
    shortlist_distance_metric: GEO_SHORTLIST_DISTANCE_METRIC,
    shortlist_is_route_distance: false,
    shortlist_is_route_time: false,
    shortlist_is_assignment_authority: false,
    shortlist_is_eligibility_authority: false,
    shortlist_narrowed_candidate_pool: false,
    city_eligible_vendor_count: input.cityEligibleVendorCount,
    city_fallback_used: isCityFallbackPath(path),
    geo_error_code: input.outcome.error_code,
  };
}
