// ============================================================================
// QuickFurno — services/vendorFairOpportunityService.ts
// Server-side seam for the deterministic fair-opportunity ledger.
// ============================================================================
import { adminClient } from "../lib/supabase";
import {
  buildFairnessScope,
  neutralFairOpportunity,
  normalizeFairOpportunityGroups,
  type FairOpportunityCandidate,
  type FairOpportunitySnapshot,
} from "../lib/matchcore/fairOpportunity";
import type { LeadForMatching } from "./leadMatchingEngine";

type RpcVendorSnapshot = {
  vendor_id?: unknown;
  scope_key?: unknown;
  fair_share_balance?: unknown;
  eligible_opportunity_count?: unknown;
  delivered_opportunity_count?: unknown;
  restored_opportunity_count?: unknown;
  delivered_7d?: unknown;
  last_eligible_at?: unknown;
  last_delivered_at?: unknown;
};

export type FairEligibleCandidate = {
  id: string;
  match_tier: 0 | 1;
  distance_band: number;
};

export type FairOpportunityState = {
  snapshots: Map<string, FairOpportunitySnapshot>;
  ledgerAvailable: boolean;
};

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asNullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function parseSnapshot(row: RpcVendorSnapshot, fallbackScope: string): FairOpportunitySnapshot | null {
  const vendorId = asNullableText(row.vendor_id);
  if (!vendorId) return null;
  return {
    vendor_id: vendorId,
    scope_key: asNullableText(row.scope_key) ?? fallbackScope,
    ledger_present: true,
    fair_share_balance: asNumber(row.fair_share_balance),
    eligible_opportunity_count: Math.max(0, Math.floor(asNumber(row.eligible_opportunity_count))),
    delivered_opportunity_count: Math.max(0, Math.floor(asNumber(row.delivered_opportunity_count))),
    restored_opportunity_count: Math.max(0, Math.floor(asNumber(row.restored_opportunity_count))),
    delivered_7d: Math.max(0, Math.floor(asNumber(row.delivered_7d))),
    last_eligible_at: asNullableText(row.last_eligible_at),
    last_delivered_at: asNullableText(row.last_delivered_at),
  };
}

function neutralMap(vendorIds: readonly string[], scopeKey: string) {
  return new Map(
    vendorIds.map((vendorId) => [
      vendorId,
      neutralFairOpportunity(vendorId, scopeKey),
    ]),
  );
}

/**
 * Persist the FIRST canonical hard-eligible pool + relevance group for this lead.
 *
 * Snapshotting does NOT move fairness balance. Fair-share entitlement is created
 * only when a provider-confirmed delivery occurs, and only among vendors in the
 * same category-tier + distance-band group as that delivered vendor.
 */
export async function snapshotFairOpportunityEligiblePool(
  lead: LeadForMatching,
  eligibleVendors: readonly FairEligibleCandidate[],
): Promise<{
  scopeKey: string;
  snapshots: Map<string, FairOpportunitySnapshot>;
  ledgerAvailable: boolean;
}> {
  const scope = buildFairnessScope(lead);
  const groups = normalizeFairOpportunityGroups(
    eligibleVendors.map((vendor) => ({
      vendor_id: vendor.id,
      match_tier: vendor.match_tier,
      distance_band: vendor.distance_band,
    })),
  );
  const ids = groups.map((vendor) => vendor.vendor_id);
  if (ids.length === 0) {
    return { scopeKey: scope.scopeKey, snapshots: new Map(), ledgerAvailable: true };
  }

  try {
    const { data, error } = await adminClient().rpc("qf_snapshot_vendor_fair_opportunity_v1", {
      p_lead_id: lead.id,
      p_scope_key: scope.scopeKey,
      p_city_key: scope.cityKey,
      p_category_key: scope.categoryKey,
      p_service_zone_id: scope.serviceZoneId,
      p_vendor_groups: groups,
    });
    if (error) throw error;

    const payload = (data ?? {}) as Record<string, unknown>;
    const rows = Array.isArray(payload.vendors) ? payload.vendors : [];
    const snapshots = new Map<string, FairOpportunitySnapshot>();
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const parsed = parseSnapshot(raw as RpcVendorSnapshot, scope.scopeKey);
      if (parsed) snapshots.set(parsed.vendor_id, parsed);
    }
    for (const vendorId of ids) {
      if (!snapshots.has(vendorId)) {
        snapshots.set(vendorId, neutralFairOpportunity(vendorId, scope.scopeKey));
      }
    }

    return { scopeKey: scope.scopeKey, snapshots, ledgerAvailable: true };
  } catch (error) {
    // Fairness is a ranking layer, never an availability gate. During a rolling
    // deploy or DB incident, preserve canonical eligibility and deterministic
    // neutral ordering rather than dropping the client lead.
    console.warn("[vendor fairness] ledger unavailable; using neutral fairness", {
      lead_id: lead.id,
      scope_key: scope.scopeKey,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      scopeKey: scope.scopeKey,
      snapshots: neutralMap(ids, scope.scopeKey),
      ledgerAvailable: false,
    };
  }
}

/**
 * Read current canonical fairness state without creating an opportunity.
 * Used by previews, diagnostics, AOS and public discovery ordering.
 */
export async function loadFairOpportunitySnapshots(input: {
  scopeKey: string;
  vendorIds: readonly string[];
}): Promise<FairOpportunityState> {
  const ids = Array.from(new Set(input.vendorIds.filter(Boolean)));
  if (ids.length === 0) {
    return { snapshots: new Map(), ledgerAvailable: true };
  }

  try {
    const { data, error } = await adminClient().rpc("qf_read_vendor_fair_opportunity_v1", {
      p_scope_key: input.scopeKey,
      p_vendor_ids: ids,
    });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const result = new Map<string, FairOpportunitySnapshot>();
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const parsed = parseSnapshot(raw as RpcVendorSnapshot, input.scopeKey);
      if (parsed) result.set(parsed.vendor_id, parsed);
    }
    for (const vendorId of ids) {
      if (!result.has(vendorId)) {
        result.set(vendorId, neutralFairOpportunity(vendorId, input.scopeKey));
      }
    }
    return { snapshots: result, ledgerAvailable: true };
  } catch (error) {
    console.warn("[vendor fairness] snapshot read unavailable; using neutral fairness", {
      scope_key: input.scopeKey,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      snapshots: neutralMap(ids, input.scopeKey),
      ledgerAvailable: false,
    };
  }
}
