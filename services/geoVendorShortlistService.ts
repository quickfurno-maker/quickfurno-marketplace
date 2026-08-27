// ============================================================================
// QuickFurno — services/geoVendorShortlistService.ts
//
// QF-MVP-75.02 — the ONLY runtime seam that reaches the bounded read-only
// PostGIS geo shortlist, public.qf_geo_vendor_shortlist_v1.
//
// FAIL-SAFE BY CONSTRUCTION
//   Every abnormal path — no lead coordinate, the migration not applied, a
//   transport error, a malformed payload — returns a TYPED outcome, never a
//   throw and never a partial result. The caller then takes the deterministic
//   city path it would have taken anyway. No outcome of this module can create,
//   block or alter an assignment, because it is never consulted by the code that
//   builds the candidate pool.
//
// NOT AN AUTHORITY
//   Read-only. No insert, no update, no credit movement, no assignment, no
//   matching-run write. The single RPC it calls is STABLE and SECURITY INVOKER
//   and is executable by service_role alone.
//
// NO EXTERNAL GEO SERVICE
//   No Google, no Maps, no Route Matrix, no Distance Matrix, no geocoder, no
//   HTTP of any kind. The only network call is the Supabase RPC below.
// ============================================================================
import { adminClient } from "../lib/supabase";
import {
  GEO_SHORTLIST_MAX_RESULTS,
  GEO_SHORTLIST_RPC,
  normalizeGeoShortlistRows,
  type GeoShortlistOutcome,
} from "../lib/geo/geoShortlistContract";
import { resolveLeadCanonicalCoordinate } from "../lib/geo/canonicalCoordinate";

/** Stable machine reason codes. Never surfaced to a client. */
export const GEO_SHORTLIST_UNAVAILABLE = "GEO_SHORTLIST_RPC_UNAVAILABLE";
export const GEO_SHORTLIST_FAILED = "GEO_SHORTLIST_QUERY_FAILED";
export const GEO_SHORTLIST_MIGRATION_HINT =
  "public.qf_geo_vendor_shortlist_v1 is absent. Apply migration 20260816000000_qf_mvp_75_02_geo_postgis_shortlist.sql. Automatic matching continues on the deterministic city path meanwhile.";

/** 42883 = undefined_function; PGRST202 = function absent from the schema cache. */
function isMissingShortlistError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42883" || error.code === "PGRST202") return true;
  const message = error.message ?? "";
  return (
    message.includes(GEO_SHORTLIST_RPC) &&
    /does not exist|schema cache|could not find the function/i.test(message)
  );
}

/**
 * Ask PostGIS which vendors carrying a canonical coordinate are nearest to this
 * lead, in straight-line kilometres.
 *
 * DISCOVERY ONLY. The result is recorded as matching evidence and is never
 * subtracted from the candidate pool, never used as an eligibility verdict and
 * never used as a ranking input — MatchCore continues to rank on its own
 * haversine (lib/geo/distance).
 */
export async function fetchGeoVendorShortlist(
  lead: { id: string; latitude?: unknown; longitude?: unknown },
): Promise<GeoShortlistOutcome> {
  // The lead's own coordinate is normalized by the SHARED canonical primitive,
  // so this seam cannot disagree with either MatchCore or the SQL generated
  // column about whether the lead has a usable point.
  const leadPoint = resolveLeadCanonicalCoordinate(lead);
  if (leadPoint.source === "none") {
    return { status: "no_lead_coordinate", entries: [], error_code: null };
  }

  try {
    const { data, error } = await adminClient().rpc(GEO_SHORTLIST_RPC, {
      p_lead_id: lead.id,
      p_limit: GEO_SHORTLIST_MAX_RESULTS,
    });

    if (error) {
      if (isMissingShortlistError(error)) {
        return { status: "unavailable", entries: [], error_code: GEO_SHORTLIST_UNAVAILABLE };
      }
      // A failed geo read is an INFRASTRUCTURE fact, never a supply fact. It
      // must never be reported as "no geo vendor", because that would let an
      // outage look like an empty market.
      console.warn("[geo shortlist] query failed", { message: error.message });
      return { status: "error", entries: [], error_code: GEO_SHORTLIST_FAILED };
    }

    const entries = normalizeGeoShortlistRows(data);
    if (entries.length === 0) {
      return { status: "no_geo_vendor", entries: [], error_code: null };
    }
    return { status: "shortlisted", entries, error_code: null };
  } catch (e) {
    console.warn("[geo shortlist] query threw", {
      message: e instanceof Error ? e.message : "Unknown error",
    });
    return { status: "error", entries: [], error_code: GEO_SHORTLIST_FAILED };
  }
}
