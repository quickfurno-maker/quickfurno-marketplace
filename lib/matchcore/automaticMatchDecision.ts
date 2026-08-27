// ============================================================================
// QuickFurno — lib/matchcore/automaticMatchDecision.ts
//
// QF-MVP-75.01 — the PURE MatchCore decision contract for the CANONICAL
// AUTOMATIC lead-matching path.
//
// WHY THIS MODULE EXISTS
//   Before QF-MVP-75.01 the ranked order produced by services/leadMatchingEngine
//   was advisory: public.qf_assign_lead_vendors_v2 iterated candidates in
//   ASCENDING VENDOR UUID order, so match tier, distance, area affinity and
//   fairness never decided WHICH eligible vendors were assigned once the pool
//   held more candidates than the active cap. 75.01 makes the ranked order the
//   BUSINESS ORDER inside the authority. Once caller order carries authority it
//   must have exactly ONE definition, and that definition lives here.
//
// SCOPE — CANONICAL AUTOMATIC PATH ONLY.
//   The admin-preview, admin-manual, preferred-vendor, client-selected and
//   delayed-fill paths keep their own deliberately different commercial
//   contracts. This module does not replace them and must not be imported as a
//   general-purpose eligibility or ranking helper.
//
// PURITY CONTRACT — load-bearing.
//   No I/O, no Supabase client, no network, no clock, no randomness, no global
//   state. Every function is a total function of its arguments so the offline
//   MVP suite exercises the real production code rather than a copy of it.
//
// WHAT THIS MODULE IS NOT (QF-MVP-75.01 boundary)
//   It is NOT GeoFair. There is no PostGIS, no H3, no route time, no Tmin and
//   no geographic regret frontier here. The geography model is exactly what the
//   source already supported before this slice: CITY is the hard geographic
//   gate (enforced by the persistence authority and mirrored by the caller),
//   while haversine distance and listed-area affinity remain RANKING signals
//   only. Frontier work is QF-MVP-75.02 / 75.03.
//   It is NOT primary/reserve. The ranked pool is a single ordered candidate
//   list; there is no reserve role, no promotion and no lifecycle here.
// ============================================================================

/**
 * Contract version for the automatic MatchCore decision record. Bump only when
 * the DECISION SHAPE changes in a way a reader must notice.
 */
export const MATCHCORE_AUTOMATIC_CONTRACT_VERSION = 1;

/**
 * Mirror of the `v` field in the authority's SHA-256 `request_fingerprint`
 * (migration 20260815000000). Version 1 fingerprinted a SORTED candidate set;
 * version 2 fingerprints the ORDER-PRESERVING normalized candidate list,
 * because rank order is now a material business input.
 *
 * This constant carries no authority. It exists so a reader (and the
 * QF-MVP-75.01 validator) can prove the TypeScript and SQL halves describe the
 * same fingerprint version.
 */
export const CANONICAL_REQUEST_FINGERPRINT_VERSION = 2;

// ---------------------------------------------------------------------------
// Reason codes
// ---------------------------------------------------------------------------

/**
 * Explicit automatic-path rejection reasons.
 *
 * QF-MVP-75.01 requirement: the MatchCore DECISION layer must explain a skipped
 * candidate on its own. It must never depend on the persistence authority's
 * deliberately coarse `vendor_not_eligible` to discover a routine, knowable
 * eligibility failure.
 *
 * Every code below corresponds to a hard gate that
 * public.qf_vendor_assignment_eligible also enforces, so a candidate this layer
 * accepts should not be rejected by the authority for a reason this layer could
 * have seen. Two authority reason codes are deliberately NOT mirrored here:
 *   - `duplicate_assignment` stays a persistence-time invariant, settled
 *     transactionally by the UNIQUE (lead_id, vendor_id) index. A pre-read would
 *     be a time-of-check/time-of-use guess.
 *   - `lead_not_found` / `lead_not_eligible` are lead-level and are decided
 *     before ranking begins.
 */
export const AUTOMATIC_MATCH_REJECT_REASONS = [
  "vendor_not_approved",
  "vendor_suspended",
  "vendor_assignment_suspended",
  "vendor_inactive",
  "not_accepting_leads",
  "no_credits",
  "city_mismatch",
  "category_mismatch",
] as const;

export type AutomaticMatchRejectReason = (typeof AUTOMATIC_MATCH_REJECT_REASONS)[number];

export function isAutomaticMatchRejectReason(value: unknown): value is AutomaticMatchRejectReason {
  return typeof value === "string" && (AUTOMATIC_MATCH_REJECT_REASONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Decision record
// ---------------------------------------------------------------------------

export type MatchCoordinateSource = "office_coordinates" | "legacy_coordinates" | "none";

/**
 * One vendor's automatic-path decision. `rank_position` is 1-based and is
 * stamped only on ACCEPTED decisions, by rankAutomaticMatchDecisions().
 */
export interface AutomaticMatchDecision {
  vendor_id: string;
  eligible: boolean;
  reason_codes: AutomaticMatchRejectReason[];
  /** 0 = exact / synonym / subcategory, 1 = same parent-group fallback. */
  match_tier: 0 | 1;
  match_type: string;
  has_coordinates: boolean;
  coordinate_source: MatchCoordinateSource;
  /** Haversine kilometres, or null when either side has no usable coordinate. */
  distance_km: number | null;
  /** 1 = listed area, 0.5 = covers_full_city, 0 = neither. Ranking only. */
  area_affinity: number;
  /** ISO timestamp of the vendor's last assignment debit, or null. Fairness. */
  last_assigned_at: string | null;
  /** Existing fallback tiebreaker only. NOT a quality model (see 75.00 audit). */
  rating: number;
  rank_position: number | null;
}

// ---------------------------------------------------------------------------
// Candidate normalization — the ONE rule the SQL authority mirrors
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * THE canonical ranked-candidate normalization rule.
 *
 * Exactly, and in this order:
 *   1. drop every entry that is not a string,
 *   2. trim and lowercase,
 *   3. drop every entry that is not a UUID (this also drops null/blank),
 *   4. de-duplicate keeping the FIRST occurrence, which is the best rank,
 *   5. preserve the caller's remaining order verbatim.
 *
 * Migration 20260815000000 implements the identical rule in SQL over
 * `unnest(p_candidate_vendors) with ordinality`, grouping by vendor id and
 * ordering by `min(ordinality)`. Both halves therefore produce the same ordered
 * list from the same input, which is what lets the request fingerprint, the
 * lock pass and the business pass agree.
 *
 * NOTE: lib/marketplace/canonicalAssignmentContract.normalizeCandidateVendorIds
 * already implemented this rule for transport hygiene, and remains the
 * transport entry point. This is the MatchCore statement of the same rule; the
 * QF-MVP-75.01 validator proves the two agree on every case it exercises.
 */
export function normalizeRankedVendorIds(vendorIds: readonly unknown[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of vendorIds ?? []) {
    if (typeof raw !== "string") continue;
    const id = raw.trim().toLowerCase();
    if (!UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic total order
// ---------------------------------------------------------------------------

/**
 * Parse an ISO timestamp into a fairness ordering key.
 *
 * A vendor that has never been assigned (null) sorts FIRST. An UNPARSEABLE
 * timestamp also sorts first rather than producing NaN: `Date.parse` returns
 * NaN for malformed input, and a NaN comparison key makes the comparator
 * non-total, which lets Array.prototype.sort produce an implementation-defined
 * order for the same input. QF-MVP-75.01 requires a TOTAL deterministic order,
 * so NaN is never allowed to reach the comparator.
 */
export function fairnessKey(lastAssignedAt: string | null | undefined): number {
  if (typeof lastAssignedAt !== "string" || lastAssignedAt.trim().length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(lastAssignedAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * The approved automatic-path comparator, unchanged in intent from the ordering
 * services/leadMatchingEngine has always produced:
 *
 *   match_tier ASC                 (0 exact before 1 parent-group fallback)
 *   has_coordinates DESC   -.
 *   distance_km ASC        -'     only when the LEAD itself has coordinates
 *   area_affinity DESC
 *   last_assigned_at ASC           fairness; never-assigned first
 *   rating DESC                    existing fallback tiebreaker
 *   vendor_id ASC                  stable final tiebreak
 *
 * Deterministic and total: the final key is a UUID comparison over a
 * de-duplicated candidate set, so the comparator returns 0 only when both sides
 * are the same vendor. There is no random() and no clock.
 *
 * QF-MVP-75.01 does NOT change this order. It changes only whether the
 * persistence authority is bound by it.
 */
export function compareAutomaticMatchDecisions(
  a: AutomaticMatchDecision,
  b: AutomaticMatchDecision,
  leadHasCoordinates: boolean,
): number {
  if (a.match_tier !== b.match_tier) return a.match_tier - b.match_tier;

  if (leadHasCoordinates) {
    if (a.has_coordinates !== b.has_coordinates) return a.has_coordinates ? -1 : 1;
    const ad = a.distance_km ?? Number.POSITIVE_INFINITY;
    const bd = b.distance_km ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad < bd ? -1 : 1;
  }

  if (a.area_affinity !== b.area_affinity) return b.area_affinity - a.area_affinity;

  const at = fairnessKey(a.last_assigned_at);
  const bt = fairnessKey(b.last_assigned_at);
  if (at !== bt) return at < bt ? -1 : 1;

  if (a.rating !== b.rating) return b.rating - a.rating;

  return a.vendor_id.localeCompare(b.vendor_id);
}

/**
 * Sort accepted decisions into the canonical ranked order and stamp the 1-based
 * `rank_position`. Returns a NEW array; the decision objects themselves are
 * stamped in place so callers keep one object identity per vendor.
 */
export function rankAutomaticMatchDecisions(
  decisions: readonly AutomaticMatchDecision[],
  leadHasCoordinates: boolean,
): AutomaticMatchDecision[] {
  const ranked = [...decisions].sort((a, b) => compareAutomaticMatchDecisions(a, b, leadHasCoordinates));
  ranked.forEach((decision, index) => {
    decision.rank_position = index + 1;
  });
  return ranked;
}

// ---------------------------------------------------------------------------
// Pool + cap accounting (evidence, never authority)
// ---------------------------------------------------------------------------

export interface RankedPoolSplit {
  /** The ordered ids submitted to the authority, capped at `poolCap`. */
  pool: string[];
  /** Eligible ids ranked beyond `poolCap`; never submitted. */
  beyondPool: string[];
}

/**
 * Split the ranked eligible list into the submitted pool and the tail that did
 * not fit the transport pool cap. `poolCap` is a TRANSPORT bound
 * (MAX_CANONICAL_CANDIDATE_POOL = 20), never an assignment ceiling: the
 * authority still stops at its own active cap no matter how long the pool is.
 */
export function splitRankedPool(rankedVendorIds: readonly string[], poolCap: number): RankedPoolSplit {
  const cap = Number.isFinite(poolCap) && poolCap > 0 ? Math.floor(poolCap) : 0;
  return {
    pool: rankedVendorIds.slice(0, cap),
    beyondPool: rankedVendorIds.slice(cap),
  };
}

/**
 * Candidates that were submitted in the ranked pool, were NOT assigned, and were
 * NOT reported as skipped by the authority.
 *
 * The authority records a per-vendor `skipped` entry for every candidate it
 * actually evaluated, and stops its business pass the moment the active cap is
 * reached. A pool member appearing in neither list was therefore never reached:
 * it lost ONLY to the active cap, not to an eligibility failure. That is exactly
 * the distinction QF-MVP-75.01 evidence must be able to prove, and it is
 * DERIVED — no new column and no new table is needed to obtain it.
 *
 * Order follows the submitted ranked pool, so the first entry is the
 * highest-ranked candidate that lost only to the cap.
 */
export function classifyCapDeferred(
  submittedPool: readonly string[],
  assignedVendorIds: readonly string[],
  skippedVendorIds: readonly string[],
): string[] {
  const assigned = new Set(assignedVendorIds.map((id) => String(id).toLowerCase()));
  const skipped = new Set(skippedVendorIds.map((id) => String(id).toLowerCase()));
  return submittedPool.filter((id) => {
    const key = String(id).toLowerCase();
    return !assigned.has(key) && !skipped.has(key);
  });
}
