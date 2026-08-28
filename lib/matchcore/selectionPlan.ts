// ============================================================================
// QuickFurno — lib/matchcore/selectionPlan.ts
//
// QF-MVP-75.04 — the PURE PRIMARY + ordered RESERVES selection plan.
//
// WHAT A ROLE MEANS HERE, AND WHAT IT DOES NOT MEAN
//   A role is a SELECTION-PLAN POSITION and nothing else:
//
//     rank 1 -> PRIMARY      rank 2 -> RESERVE_1      rank 3 -> RESERVE_2
//
//   It is NOT a delivery fact, NOT a lifecycle state, NOT a persisted column and
//   NOT a claim that a reserve was contacted, sent to, or held back. The phase
//   brief is explicit that "reserve" must not be redefined to mean "already
//   delivered/assigned" while the database lifecycle cannot support that meaning
//   — and it cannot: public.qf_assign_lead_vendors_v2 assigns EVERY eligible
//   candidate it reaches, in rank order, until the active cap of 3 is filled,
//   debiting one credit each. All three are `lifecycle_status = 'assigned'` the
//   moment the operation commits. There is today no "hold a reserve back", no
//   delivery timeout and no promotion.
//
//   So this module deliberately introduces a PURE BOUNDARY rather than a
//   behaviour: it names the three ranked positions the authority is about to
//   consume, records them as evidence, and hands the ordered ids back unchanged.
//   The later delivery/fallback phase can then make PRIMARY mean "delivered
//   first" and RESERVE_n mean "promoted on timeout" WITHOUT re-deriving who they
//   are, and without this phase having lied about what happened.
//
// FAIRNESS IS NOT CONSUMED HERE
//   Building a plan is selection. Locked rule: selection alone does not consume
//   fairness. This module therefore touches no counter, reads no ledger, writes
//   nothing, and has no dependency on the fairness contract at all.
//
// PURITY CONTRACT — load-bearing.
//   No I/O, no Supabase client, no network, no clock, no randomness, no global
//   state. Every function is a total function of its arguments.
// ============================================================================

import { normalizeRankedVendorIds } from "./automaticMatchDecision";
import { CANONICAL_ACTIVE_ASSIGNMENT_CAP } from "../marketplace/canonicalAssignmentContract";

/**
 * Contract version for the selection-plan SHAPE. Bump when the roles, their
 * meaning or the evidence shape changes. Mirrored into every matching_snapshot
 * as `geofair.selection_plan.contract_version`.
 */
export const SELECTION_PLAN_CONTRACT_VERSION = 1;

/**
 * The roles, in rank order. The list length is exactly the canonical ACTIVE cap,
 * imported rather than re-declared so a cap change cannot silently leave this
 * module describing four slots or two.
 */
export const SELECTION_ROLES = ["PRIMARY", "RESERVE_1", "RESERVE_2"] as const;
export type SelectionRole = (typeof SELECTION_ROLES)[number];

/** The cap this plan may never exceed. Same constant the authority enforces. */
export const SELECTION_PLAN_ROLE_CAP = CANONICAL_ACTIVE_ASSIGNMENT_CAP;

export function isSelectionRole(value: unknown): value is SelectionRole {
  return typeof value === "string" && (SELECTION_ROLES as readonly string[]).includes(value);
}

export interface SelectionPlanEntry {
  readonly vendor_id: string;
  readonly role: SelectionRole;
  /** 1-based position in the FINAL ranked order this plan was built from. */
  readonly rank_position: number;
}

export interface SelectionPlan {
  readonly contract_version: number;
  readonly entries: readonly SelectionPlanEntry[];
  readonly primary_vendor_id: string | null;
  /** RESERVE_1 then RESERVE_2, in that order. */
  readonly reserve_vendor_ids: readonly string[];
  readonly role_count: number;
  readonly role_cap: number;
  /**
   * Load-bearing literal, recorded in the snapshot. A role in this plan is a
   * selection position; it is NOT evidence that anything was delivered. Any
   * reader — human or later phase — that finds this false has found a bug.
   */
  readonly is_delivery_evidence: false;
  /** Selection does not consume fairness. Also recorded, for the same reason. */
  readonly consumes_fairness: false;
}

/**
 * Build the plan from the FINAL ranked candidate ids.
 *
 * Rules, all of them total:
 *   - ids are normalized by the ONE canonical rule
 *     (automaticMatchDecision.normalizeRankedVendorIds): trim, lowercase, drop
 *     non-uuids, de-duplicate keeping the FIRST (best-ranked) occurrence, and
 *     preserve the remaining order verbatim. Reused rather than re-implemented
 *     so the plan can never disagree with the pool the authority receives.
 *   - the first SELECTION_PLAN_ROLE_CAP ids take the roles in order.
 *   - fewer candidates simply yield fewer roles. Never a placeholder, never a
 *     repeated vendor, never a padded entry.
 *   - the result is frozen, so a caller cannot mutate a plan after it is built.
 */
export function buildSelectionPlan(rankedVendorIds: readonly unknown[] | null | undefined): SelectionPlan {
  const ranked = normalizeRankedVendorIds(rankedVendorIds);
  const entries: SelectionPlanEntry[] = [];

  for (let index = 0; index < ranked.length && index < SELECTION_PLAN_ROLE_CAP; index += 1) {
    entries.push(Object.freeze({
      vendor_id: ranked[index],
      role: SELECTION_ROLES[index],
      rank_position: index + 1,
    }));
  }

  return Object.freeze({
    contract_version: SELECTION_PLAN_CONTRACT_VERSION,
    entries: Object.freeze(entries),
    primary_vendor_id: entries.length > 0 ? entries[0].vendor_id : null,
    reserve_vendor_ids: Object.freeze(entries.slice(1).map((entry) => entry.vendor_id)),
    role_count: entries.length,
    role_cap: SELECTION_PLAN_ROLE_CAP,
    is_delivery_evidence: false as const,
    consumes_fairness: false as const,
  });
}

/**
 * Project the plan back onto the ordered vendor-id list shape the canonical
 * assignment seam speaks.
 *
 * LEGACY COMPATIBILITY, STATED EXACTLY: QF-MVP-75.04 does NOT change what is
 * submitted to public.qf_assign_lead_vendors_v2. The matcher still submits the
 * full bounded ranked pool (up to MAX_CANONICAL_CANDIDATE_POOL = 20), because
 * that pool is what lets the authority FILL UNTIL THREE when a higher-ranked
 * candidate loses its last credit between ranking and commit. Narrowing the
 * submission to these three would reintroduce the under-fill this repository
 * already fixed.
 *
 * This projection therefore exists to PROVE the relationship, not to replace the
 * pool: the ids it returns are, by construction, the first `role_count` entries
 * of that same ranked pool, in the same order. The offline suite asserts exactly
 * that, so the plan can never drift away from what the authority consumes.
 */
export function selectionPlanToOrderedVendorIds(plan: SelectionPlan): string[] {
  return plan.entries.map((entry) => entry.vendor_id);
}

/**
 * True when the plan is a prefix of the submitted ranked pool — the compatibility
 * invariant above, expressed as a checkable predicate rather than a comment.
 */
export function selectionPlanMatchesRankedPool(
  plan: SelectionPlan,
  rankedPool: readonly string[],
): boolean {
  const ordered = selectionPlanToOrderedVendorIds(plan);
  if (ordered.length > rankedPool.length) return false;
  return ordered.every((vendorId, index) => rankedPool[index] === vendorId);
}
