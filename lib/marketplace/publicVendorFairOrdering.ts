// ============================================================================
// QuickFurno — lib/marketplace/publicVendorFairOrdering.ts
//
// Pure read-only ordering for public vendor discovery.
//
// This intentionally reuses the canonical automatic MatchCore comparator for
// vendors that can actually receive a lead right now. Public browsing NEVER
// mutates credits, assignments or fairness state.
//
// Publicly-visible but currently assignment-ineligible vendors may still be
// shown for catalogue/profile continuity, but they are always placed AFTER
// active-credit eligible vendors and cannot consume or accumulate a fair turn.
// ============================================================================
import {
  compareAutomaticMatchDecisions,
  type AutomaticMatchDecision,
} from "../matchcore/automaticMatchDecision";
import { distanceBand } from "../matchcore/fairOpportunity";

export type PublicVendorFairCandidate = {
  vendor_id: string;
  assignment_eligible: boolean;
  has_coordinates: boolean;
  distance_km: number | null;
  fair_share_balance: number;
  delivered_7d: number;
  last_delivered_at: string | null;
  area_affinity?: number;
};

function toDecision(candidate: PublicVendorFairCandidate): AutomaticMatchDecision {
  return {
    vendor_id: candidate.vendor_id,
    eligible: candidate.assignment_eligible,
    reason_codes: [],
    match_tier: 0,
    match_type: "exact",
    has_coordinates: candidate.has_coordinates,
    coordinate_source: candidate.has_coordinates ? "office_coordinates" : "none",
    distance_km: candidate.distance_km,
    distance_band: distanceBand(candidate.distance_km),
    area_affinity: candidate.area_affinity ?? 0,
    fair_share_balance: candidate.fair_share_balance,
    delivered_7d: candidate.delivered_7d,
    last_delivered_at: candidate.last_delivered_at,
    last_assigned_at: candidate.last_delivered_at,
    // Rating is informational only and MUST NOT participate in the comparator.
    rating: 0,
    rank_position: null,
  };
}

function compareIneligible(
  a: PublicVendorFairCandidate,
  b: PublicVendorFairCandidate,
  clientHasCoordinates: boolean,
): number {
  if (clientHasCoordinates) {
    if (a.has_coordinates !== b.has_coordinates) return a.has_coordinates ? -1 : 1;
    const aBand = distanceBand(a.distance_km);
    const bBand = distanceBand(b.distance_km);
    if (aBand !== bBand) return aBand - bBand;
    const ad = a.distance_km ?? Number.POSITIVE_INFINITY;
    const bd = b.distance_km ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad < bd ? -1 : 1;
  }
  return a.vendor_id.localeCompare(b.vendor_id);
}

/**
 * Eligible vendors always lead the catalogue. Their relative order is exactly
 * the canonical MatchCore fair-order contract:
 * category -> geography band -> fair deficit -> recent deliveries -> oldest
 * delivered time -> area affinity -> exact distance -> stable id.
 *
 * Ineligible-but-public vendors are appended deterministically and never use
 * fair-share state, so zero-credit/inactive vendors cannot game public rank.
 */
export function orderPublicVendorCandidates(
  candidates: readonly PublicVendorFairCandidate[],
  clientHasCoordinates: boolean,
): PublicVendorFairCandidate[] {
  const eligible: PublicVendorFairCandidate[] = [];
  const ineligible: PublicVendorFairCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.assignment_eligible) eligible.push(candidate);
    else ineligible.push(candidate);
  }

  eligible.sort((a, b) =>
    compareAutomaticMatchDecisions(
      toDecision(a),
      toDecision(b),
      clientHasCoordinates,
    ),
  );
  ineligible.sort((a, b) => compareIneligible(a, b, clientHasCoordinates));

  return [...eligible, ...ineligible];
}
