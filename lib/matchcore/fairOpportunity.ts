// ============================================================================
// QuickFurno — lib/matchcore/fairOpportunity.ts
//
// Pure deterministic primitives for fair lead distribution.
//
// Locked product contract:
//   • one successful assignment costs one credit (existing Core authority)
//   • one provider-confirmed delivered lead consumes one fairness opportunity
//   • credits are an eligibility gate, never a rank multiplier
//   • fairness is earned only among vendors comparable for the delivered slot:
//     same category tier + same straight-line distance band
//   • no capacity, popularity, revenue, package-price or subjective quality input
// ============================================================================
import { getParentCategoryGroup } from "../vendors/categoryMatching";

export const FAIRNESS_MODEL_VERSION = "eligible_opportunity_deficit_v1";
export const FAIRNESS_ACTIVE_SLOT_CAP = 3;
export const FAIRNESS_BALANCE_CAP = 3;

/**
 * Broad client-relevance bands. Fairness may reorder vendors inside a band but
 * cannot pull a materially farther vendor ahead of a nearer band.
 */
export const FAIR_DISTANCE_BANDS_KM = [3, 7, 12] as const;

export type FairOpportunitySnapshot = {
  vendor_id: string;
  scope_key: string;
  ledger_present: boolean;
  fair_share_balance: number;
  eligible_opportunity_count: number;
  delivered_opportunity_count: number;
  restored_opportunity_count: number;
  delivered_7d: number;
  last_eligible_at: string | null;
  last_delivered_at: string | null;
};

export type FairnessScope = {
  scopeKey: string;
  cityKey: string;
  categoryKey: string;
  serviceZoneId: string | null;
};

export type FairOpportunityCandidate = {
  vendor_id: string;
  match_tier: 0 | 1;
  distance_band: number;
};

export function normalizeFairOpportunityGroups(
  candidates: readonly FairOpportunityCandidate[],
): FairOpportunityCandidate[] {
  const byId = new Map<string, FairOpportunityCandidate>();
  for (const candidate of candidates) {
    const vendorId = String(candidate.vendor_id ?? "").trim().toLowerCase();
    if (!vendorId || byId.has(vendorId)) continue;
    byId.set(vendorId, {
      vendor_id: vendorId,
      match_tier: candidate.match_tier === 1 ? 1 : 0,
      distance_band:
        Number.isFinite(candidate.distance_band) && candidate.distance_band >= 0
          ? Math.min(4, Math.floor(candidate.distance_band))
          : 4,
    });
  }
  return [...byId.values()].sort((a, b) => a.vendor_id.localeCompare(b.vendor_id));
}

function key(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildFairnessScope(input: {
  city?: string | null;
  service_zone_id?: string | null;
  subcategory?: string | null;
  service_required?: string | null;
  category?: string | null;
}): FairnessScope {
  const cityKey = key(input.city) || "unknown-city";
  const category = getParentCategoryGroup([
    input.subcategory,
    input.service_required,
    input.category,
  ]);
  const categoryKey = key(category) || "general";
  const serviceZoneId = String(input.service_zone_id ?? "").trim() || null;
  const geographyKey = serviceZoneId
    ? `zone:${serviceZoneId.toLowerCase()}`
    : `city:${cityKey}`;

  return {
    scopeKey: `${geographyKey}|category:${categoryKey}`,
    cityKey,
    categoryKey,
    serviceZoneId,
  };
}

export function distanceBand(distanceKm: number | null | undefined): number {
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm < 0) return 4;
  if (distanceKm <= FAIR_DISTANCE_BANDS_KM[0]) return 0;
  if (distanceKm <= FAIR_DISTANCE_BANDS_KM[1]) return 1;
  if (distanceKm <= FAIR_DISTANCE_BANDS_KM[2]) return 2;
  return 3;
}

/**
 * One real delivered slot is shared equally across the comparable vendors that
 * could have filled that same slot. The delivered vendor then consumes 1.
 *
 * Example: six comparable vendors, one confirmed delivery:
 *   everyone +1/6; delivered vendor -1 => delivered net -5/6, missed net +1/6.
 * Three confirmed deliveries among those six produce +/-0.5, exactly the fair
 * rotation behavior we want.
 */
export function fairSharePerDelivery(comparableVendorCount: number): number {
  if (!Number.isFinite(comparableVendorCount) || comparableVendorCount <= 0) return 0;
  return 1 / Math.floor(comparableVendorCount);
}

export function fairShareForDeliveredCount(
  comparableVendorCount: number,
  deliveredCount: number,
): number {
  if (!Number.isFinite(deliveredCount) || deliveredCount <= 0) return 0;
  return (
    fairSharePerDelivery(comparableVendorCount) *
    Math.min(FAIRNESS_ACTIVE_SLOT_CAP, Math.floor(deliveredCount))
  );
}

export function clampFairnessBalance(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(
    -FAIRNESS_BALANCE_CAP,
    Math.min(FAIRNESS_BALANCE_CAP, value),
  );
}

export function neutralFairOpportunity(
  vendorId: string,
  scopeKey = "",
): FairOpportunitySnapshot {
  return {
    vendor_id: vendorId,
    scope_key: scopeKey,
    ledger_present: false,
    fair_share_balance: 0,
    eligible_opportunity_count: 0,
    delivered_opportunity_count: 0,
    restored_opportunity_count: 0,
    delivered_7d: 0,
    last_eligible_at: null,
    last_delivered_at: null,
  };
}
