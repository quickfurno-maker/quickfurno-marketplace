import "server-only";

import { adminClient } from "../lib/supabase";
import { buildFairnessScope } from "../lib/matchcore/fairOpportunity";
import { buildVendorMatchPrefilterTerms } from "../lib/vendors/categoryMatching";

const PREFILTER_RPC = "qf_match_vendor_prefilter_v1";
export const MATCHING_PREFILTER_LIMIT = 512;
const LEGACY_FALLBACK_PAGE_SIZE = 500;
const LEGACY_FALLBACK_MAX_SCAN = 5000;

type LeadForPrefilter = {
  id: string;
  city?: string | null;
  service_zone_id?: string | null;
  category?: string | null;
  service_required?: string | null;
  subcategory?: string | null;
};

export type VendorMatchPrefilterResult = {
  rows: Array<Record<string, unknown>>;
  source: "database_prefilter" | "legacy_fallback";
  degradedReason: string | null;
};

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42883" || error.code === "PGRST202") return true;
  return /qf_match_vendor_prefilter_v1/i.test(error.message ?? "") &&
    /does not exist|schema cache|could not find/i.test(error.message ?? "");
}

async function legacyFallbackScan(): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; from < LEGACY_FALLBACK_MAX_SCAN; from += LEGACY_FALLBACK_PAGE_SIZE) {
    const { data, error } = await adminClient()
      .from("vendors")
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + LEGACY_FALLBACK_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < LEGACY_FALLBACK_PAGE_SIZE) break;
  }
  return rows;
}

/**
 * SCALE-P08 database-side bounded vendor discovery.
 *
 * This is deliberately NOT the final eligibility/ranking authority. PostgreSQL
 * removes obviously impossible vendors and returns the best bounded window using
 * the same deterministic rank dimensions. The canonical TypeScript matcher then
 * re-evaluates every returned row and the assignment RPC performs the final
 * transactional recheck.
 *
 * The legacy 5k scan exists only as a deployment-compatibility fallback while
 * the additive migration has not yet been applied. Once the RPC exists, the
 * normal path never scans the vendor table from application code.
 */
export async function fetchVendorMatchPrefilterRows(
  lead: LeadForPrefilter,
): Promise<VendorMatchPrefilterResult> {
  const terms = buildVendorMatchPrefilterTerms(lead);
  const scope = buildFairnessScope(lead);

  try {
    const { data, error } = await adminClient().rpc(PREFILTER_RPC, {
      p_lead_id: lead.id,
      p_scope_key: scope.scopeKey,
      p_tier0_terms: terms.tier0Terms,
      p_tier1_terms: terms.tier1Terms,
      p_limit: MATCHING_PREFILTER_LIMIT,
    });

    if (!error && Array.isArray(data)) {
      const rows = data
        .map((entry) => {
          if (
            entry &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            "vendor" in entry &&
            entry.vendor &&
            typeof entry.vendor === "object" &&
            !Array.isArray(entry.vendor)
          ) {
            return entry.vendor as Record<string, unknown>;
          }
          return null;
        })
        .filter((row): row is Record<string, unknown> => row !== null);
      return { rows, source: "database_prefilter", degradedReason: null };
    }

    const reason = isMissingFunction(error)
      ? "PHASE08_PREFILTER_NOT_DEPLOYED"
      : "PHASE08_PREFILTER_QUERY_FAILED";
    console.warn("[lead matching] database prefilter unavailable; using compatibility scan", {
      reason,
      code: error?.code ?? null,
    });
    return {
      rows: await legacyFallbackScan(),
      source: "legacy_fallback",
      degradedReason: reason,
    };
  } catch (error) {
    console.warn("[lead matching] database prefilter threw; using compatibility scan", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      rows: await legacyFallbackScan(),
      source: "legacy_fallback",
      degradedReason: "PHASE08_PREFILTER_QUERY_THREW",
    };
  }
}
