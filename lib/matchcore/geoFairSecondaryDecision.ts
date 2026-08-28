// ============================================================================
// QuickFurno — lib/matchcore/geoFairSecondaryDecision.ts
//
// QF-MVP-75.04 — the PURE MatchCore contract for GEO-SCOPED FAIRNESS and the
// SECONDARY ordering that runs INSIDE a geography band on the canonical
// AUTOMATIC lead-matching path.
//
// WHAT THIS FILE ADDS, STATED PLAINLY
//   QF-MVP-75.03 established the geographic frontier and, with it, the rule that
//   geography is lexicographically ahead of everything else. Inside a band it
//   already ordered by exact-category tier, then area affinity, then the
//   pre-75.03 canonical MatchCore rank. What it did NOT have was a NAMED,
//   VERSIONED place for a fairness signal to live, so a later delivery phase
//   would have had to re-open the frontier comparator to add one.
//
//   This module is that place, and nothing more. It appends exactly ONE new key
//   — geo-scoped fairness exposure — between the 75.03 secondary keys and the
//   MatchCore base rank:
//
//     1. geography          (band, then GeoRegret in the outside band)   75.03
//     2. exact-category tier                                             75.03
//     3. area affinity                                                   75.03
//     4. GEO-SCOPED FAIRNESS EXPOSURE                                    75.04  <- new
//     5. the pre-75.03 canonical MatchCore rank                          75.01
//
//   Keys 1-3 are NOT re-implemented here. They are evaluated by calling the
//   FROZEN 75.03 comparator with an EQUAL base rank on both sides, so a non-zero
//   result means "these two candidates are in different geography-or-secondary
//   classes" and a zero result means "they are comparable, fairness may decide".
//   There is therefore exactly ONE definition of the geography order in the
//   repository, and no fairness or commercial signal can move a candidate across
//   a band by construction rather than by convention.
//
// FAIRNESS IS NEUTRAL IN THIS PHASE, AND THAT IS A SOURCE FINDING
//   The locked fairness rule is:
//       selection alone            DOES NOT consume fairness
//       a failed send              DOES NOT consume fairness
//       a delivered lead the vendor ignores  DOES consume fairness
//
//   No canonical DELIVERED fact exists in this database today. The lifecycle
//   vocabulary contains 'delivered' (public.lead_assignments.lifecycle_status and
//   public.lead_assignment_events.lifecycle_to), but NO code path in the
//   repository ever writes it: the canonical authority
//   public.qf_assign_lead_vendors_v2 writes 'assigned' and only 'assigned', and
//   the WhatsApp intent it queues (public.communication_intents,
//   aggregate_type = 'lead_assignment') is never claimed, dispatched or
//   reconciled — the campaign reconciler is scoped to 'vendor_campaign'.
//   public.lead_delivery_logs carries a HARDCODED delivery_status = 'delivered'
//   literal written after the fact, outside the assignment transaction, with its
//   Result discarded: it can never be false, so it is not evidence of delivery,
//   it is a restatement of the assignment.
//
//   Charging fairness from any of those would mean charging it on SELECTION,
//   which the locked rule forbids. So this phase resolves fairness to a TYPED
//   NEUTRAL decision carrying DELIVERY_EXPOSURE_UNAVAILABLE, and a neutral
//   decision is PROVABLY ORDER-PRESERVING: every candidate receives the same
//   fairness key, so key 4 collapses and the run keeps its exact 75.03 order.
//
//   The ACTIVE accounting is nevertheless written and tested here, because a
//   fairness rule that is only described in prose is a rule a later phase will
//   get wrong. computeGeoFairnessExposure() is a total function over an explicit
//   delivered-exposure event vocabulary; it counts DELIVERED (including
//   delivered-then-ignored) and refuses to count selection, assignment creation
//   or a failed send. No production caller can reach it today, because no
//   canonical source can produce its events.
//
// PURITY CONTRACT — load-bearing.
//   No I/O, no Supabase client, no network, no clock, no randomness, no global
//   state, no process.env read. Every function is a total function of its
//   arguments, so the offline MVP suite exercises the real production code.
//
// WHAT THIS MODULE IS NOT
//   It is not an eligibility authority and it is not an assignment authority.
//   public.qf_assign_lead_vendors_v2 still decides every outcome, still enforces
//   the active cap of 3 and the lifetime cap of 6, and still rechecks every
//   candidate transactionally. It contains NO package, paid-status, credit,
//   visibility or commercial key of any kind, and it introduces no clock, so a
//   fairness window is always measured against a caller-supplied instant.
//   It is not H3 and it is not a new geo index: the fairness scope is the lead
//   CITY, which is already the hard geographic gate.
// ============================================================================

import {
  compareGeoFrontierCandidates,
  type GeoFrontierPlacement,
} from "./geoFrontierDecision";
import type { SelectionPlan } from "./selectionPlan";

/**
 * Contract version for the GeoFair secondary decision SHAPE and ORDER. Bump when
 * the lexicographic order, the fairness vocabulary or the evidence shape
 * changes. Mirrored into every matching_snapshot as
 * `geofair.geofair_contract_version`.
 */
export const GEOFAIR_SECONDARY_CONTRACT_VERSION = 1;

/**
 * The policy identity for this slice.
 *
 * QF-MVP-75.03 already explained why a persisted DRAFT -> SIMULATION -> SHADOW
 * -> ACTIVATE policy plane is NOT built for matching yet: the only persisted
 * plane (public.automation_policy_configs) is bound to the AOS automation domain
 * and keyed by workflow policy_key, so reusing it would need a migration plus a
 * semantic lie. That reasoning is unchanged. This is the smallest explicit
 * policy identifier the phase needs, and it costs no migration.
 */
export const GEOFAIR_POLICY_ID = "qf_geofair_v1";
export const GEOFAIR_POLICY_VERSION = 1;

/**
 * The bounded recency window for delivered exposure, in days.
 *
 * Fairness must be RECENT, not lifetime: a vendor that received many leads two
 * years ago is not over-served today, and a lifetime counter would permanently
 * demote long-standing vendors. 30 days is one billing-shaped month, which is
 * also the horizon a vendor can actually remember.
 *
 * It is inert while fairness is NEUTRAL; it is recorded as evidence so the value
 * a run used is auditable, and so activating fairness later does not silently
 * change the window a reader assumed.
 */
export const GEOFAIR_EXPOSURE_WINDOW_DAYS = 30;

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Geo scope
// ---------------------------------------------------------------------------

/**
 * The geographic scope a fairness count is taken within.
 *
 *   lead_city — the lead's normalized city. This is the smallest SOURCE-PROVEN
 *               stable scope available today, and it is not an invention: city
 *               is already the HARD geographic gate in both the matcher
 *               (cityMatches) and public.qf_vendor_assignment_eligible, so every
 *               candidate compared in one run is in this scope by construction.
 *   none      — the lead carries no usable city. Fairness cannot be scoped, so
 *               it must not be counted.
 *
 * H3 is deliberately absent. The locked architecture allows H3 later, but
 * introducing it HERE would mean manufacturing a scope purely to have a finer
 * one, which the phase brief forbids. `public.vendors.geo_point` exists
 * (migration 20260816000000) but no coarse coordinate bucket has been adopted as
 * canonical, and `area` is free text used only as a SOFT affinity signal.
 */
export const GEOFAIR_SCOPE_KINDS = ["lead_city", "none"] as const;
export type GeoFairnessScopeKind = (typeof GEOFAIR_SCOPE_KINDS)[number];

export interface GeoFairnessScope {
  readonly kind: GeoFairnessScopeKind;
  /** Normalized scope key, or null when the scope could not be established. */
  readonly key: string | null;
}

/**
 * Normalize a scope key exactly as `public.qf_norm_text` does — `lower(trim(…))`
 * — so the TypeScript scope and any future SQL scope cannot drift apart.
 */
export function normalizeGeoFairnessScopeKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/** Resolve the fairness scope from the lead. Total: never throws, never guesses. */
export function resolveGeoFairnessScope(lead: { city?: string | null } | null | undefined): GeoFairnessScope {
  const key = normalizeGeoFairnessScopeKey(lead?.city);
  return key === null ? { kind: "none", key: null } : { kind: "lead_city", key };
}

// ---------------------------------------------------------------------------
// Exposure vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed vocabulary of things that can happen to a (vendor, lead) pair, from
 * a fairness point of view.
 *
 * Only two of them consume fairness, and the split IS the locked rule:
 *
 *   selected           ranked and submitted to the authority. NOT fairness.
 *                      A candidate can be submitted 20-deep and never assigned.
 *   assignment_created an assignment row exists. NOT fairness. Assignment is a
 *                      persistence fact, not a delivery fact; a later phase may
 *                      assign a RESERVE without delivering to it.
 *   send_failed        a delivery attempt failed. NOT fairness — locked rule 13:
 *                      a vendor must never be charged for our transport failing.
 *   delivered          the lead actually reached the vendor. FAIRNESS.
 *   delivered_ignored  it reached the vendor and the vendor did nothing.
 *                      FAIRNESS — locked rule 14: exposure is the cost, not the
 *                      vendor's response to it. Ranked separately from
 *                      `delivered` only so a reader can see the distinction; it
 *                      is counted identically.
 */
export const GEOFAIR_EXPOSURE_EVENT_KINDS = [
  "selected",
  "assignment_created",
  "send_failed",
  "delivered",
  "delivered_ignored",
] as const;

export type GeoFairnessExposureEventKind = (typeof GEOFAIR_EXPOSURE_EVENT_KINDS)[number];

/** The ONLY event kinds that consume fairness. */
export const GEOFAIR_FAIRNESS_CONSUMING_EVENT_KINDS: readonly GeoFairnessExposureEventKind[] = [
  "delivered",
  "delivered_ignored",
];

export function consumesGeoFairness(kind: unknown): boolean {
  return (GEOFAIR_FAIRNESS_CONSUMING_EVENT_KINDS as readonly string[]).includes(String(kind));
}

/**
 * One exposure event, as a LATER phase would read it from a delivery ledger.
 *
 * `occurred_at_ms` is a caller-supplied epoch, never a clock read here, so the
 * window decision is reproducible in a test and identical for every vendor in
 * one run.
 */
export interface GeoFairnessExposureEvent {
  readonly vendor_id: string;
  readonly kind: GeoFairnessExposureEventKind;
  /** Normalized scope key the event happened in, or null when unknown. */
  readonly scope_key: string | null;
  readonly occurred_at_ms: number;
}

// ---------------------------------------------------------------------------
// The fairness decision
// ---------------------------------------------------------------------------

export const GEOFAIR_FAIRNESS_MODES = ["ACTIVE", "NEUTRAL"] as const;
export type GeoFairnessMode = (typeof GEOFAIR_FAIRNESS_MODES)[number];

/**
 * Why fairness is neutral. A neutral decision must always say WHY, or a reader
 * cannot tell "fairness is off" from "fairness found nothing".
 *
 *   DELIVERY_EXPOSURE_UNAVAILABLE — no canonical delivered fact exists in this
 *       database. This is the QF-MVP-75.04 production value; see the file
 *       header for the exact source proof.
 *   FAIRNESS_SCOPE_UNAVAILABLE    — the lead carries no usable city, so exposure
 *       cannot be scoped geographically and a global counter is forbidden.
 */
export const GEOFAIR_NEUTRAL_REASONS = [
  "DELIVERY_EXPOSURE_UNAVAILABLE",
  "FAIRNESS_SCOPE_UNAVAILABLE",
] as const;

export type GeoFairnessNeutralReason = (typeof GEOFAIR_NEUTRAL_REASONS)[number];

export function isGeoFairnessNeutralReason(value: unknown): value is GeoFairnessNeutralReason {
  return typeof value === "string" && (GEOFAIR_NEUTRAL_REASONS as readonly string[]).includes(value);
}

export interface GeoFairnessSnapshot {
  readonly mode: GeoFairnessMode;
  /** Always set when mode is NEUTRAL; always null when mode is ACTIVE. */
  readonly reason: GeoFairnessNeutralReason | null;
  readonly scope: GeoFairnessScope;
  readonly window_days: number;
  /** Delivered-exposure count per vendor id. Empty on every NEUTRAL decision. */
  readonly exposure_by_vendor: Readonly<Record<string, number>>;
  readonly counted_event_count: number;
  readonly rejected_event_count: number;
}

/**
 * The TYPED NEUTRAL fairness decision — the one QF-MVP-75.04 ships.
 *
 * `exposure_by_vendor` is deliberately EMPTY, not "all zeroes for the candidates
 * we happen to know about". An empty map means fairnessOrderKey() returns the
 * same constant for every vendor id in existence, so a neutral decision cannot
 * reorder anything even if a caller passes it an unexpected candidate set.
 */
export function neutralGeoFairness(
  scope: GeoFairnessScope,
  reason: GeoFairnessNeutralReason = "DELIVERY_EXPOSURE_UNAVAILABLE",
): GeoFairnessSnapshot {
  return Object.freeze({
    mode: "NEUTRAL" as const,
    reason,
    scope,
    window_days: GEOFAIR_EXPOSURE_WINDOW_DAYS,
    exposure_by_vendor: Object.freeze({}),
    counted_event_count: 0,
    rejected_event_count: 0,
  });
}

/**
 * ACTIVE geo-scoped fairness accounting.
 *
 * NOT REACHABLE FROM PRODUCTION IN QF-MVP-75.04, and that is deliberate: no
 * canonical source can produce `GeoFairnessExposureEvent`s yet (see the file
 * header). It exists so the rule is CODE rather than prose, and so the offline
 * suite can prove the sign, the scope isolation and the event-kind split before
 * a delivery phase depends on them.
 *
 * An event is counted only when ALL of these hold:
 *   - its kind consumes fairness (delivered / delivered_ignored),
 *   - its scope key equals the run's scope key EXACTLY (after normalization),
 *   - it occurred inside the window `(nowMs - windowDays, nowMs]`.
 *
 * Missing history is NEUTRAL, never punitive: a vendor absent from the map
 * scores 0, which is the BEST fairness key, so a vendor that has received
 * nothing recently ranks ahead of one that has. That direction is the whole
 * point and is mutation-tested.
 */
export function computeGeoFairnessExposure(input: {
  readonly scope: GeoFairnessScope;
  readonly events: readonly GeoFairnessExposureEvent[];
  readonly nowMs: number;
  readonly windowDays?: number;
}): GeoFairnessSnapshot {
  const scope = input.scope;
  if (scope.kind === "none" || scope.key === null) {
    return neutralGeoFairness(scope, "FAIRNESS_SCOPE_UNAVAILABLE");
  }

  const windowDays =
    Number.isFinite(input.windowDays) && (input.windowDays as number) > 0
      ? Math.floor(input.windowDays as number)
      : GEOFAIR_EXPOSURE_WINDOW_DAYS;
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : 0;
  const floorMs = nowMs - windowDays * MS_PER_DAY;

  const exposure: Record<string, number> = {};
  let counted = 0;
  let rejected = 0;

  for (const event of input.events ?? []) {
    const vendorId = typeof event?.vendor_id === "string" ? event.vendor_id.trim().toLowerCase() : "";
    const occurredAt = Number(event?.occurred_at_ms);
    const scopeKey = normalizeGeoFairnessScopeKey(event?.scope_key);
    const inWindow = Number.isFinite(occurredAt) && occurredAt > floorMs && occurredAt <= nowMs;

    if (vendorId.length === 0 || !consumesGeoFairness(event?.kind) || scopeKey !== scope.key || !inWindow) {
      rejected += 1;
      continue;
    }
    exposure[vendorId] = (exposure[vendorId] ?? 0) + 1;
    counted += 1;
  }

  return Object.freeze({
    mode: "ACTIVE" as const,
    reason: null,
    scope,
    window_days: windowDays,
    exposure_by_vendor: Object.freeze(exposure),
    counted_event_count: counted,
    rejected_event_count: rejected,
  });
}

/**
 * The fairness ordering key for one vendor. LOWER IS BETTER (less recently
 * exposed ranks first).
 *
 * A NEUTRAL snapshot returns the SAME CONSTANT for every vendor without reading
 * the map at all, so neutrality is a structural property of this function rather
 * than a property of the data it happens to hold.
 */
export function geoFairnessOrderKey(snapshot: GeoFairnessSnapshot, vendorId: string): number {
  if (snapshot.mode !== "ACTIVE") return 0;
  return snapshot.exposure_by_vendor[String(vendorId).trim().toLowerCase()] ?? 0;
}

// ---------------------------------------------------------------------------
// The GeoFair secondary order
// ---------------------------------------------------------------------------

/**
 * The ordered component names of the QF-MVP-75.04 decision, recorded as evidence
 * so a snapshot states its own comparator rather than requiring a reader to find
 * this file.
 */
export const GEOFAIR_SECONDARY_COMPONENTS = [
  "geo_band",
  "geo_regret_seconds",
  "match_tier",
  "area_affinity",
  "geo_fairness_exposure",
  "matchcore_base_rank",
] as const;

/** The minimum a candidate must expose to be ordered by this contract. */
export interface GeoFairRankableCandidate {
  readonly id: string;
  readonly match_tier: 0 | 1;
  readonly area_affinity: number;
  /** The 1-based rank the run has ALREADY stamped. Unique per candidate. */
  readonly base_rank: number;
}

export interface GeoFairSecondaryContext {
  /**
   * True only when QF-MVP-75.03 route authority engaged for this run.
   *
   * WHY THIS GATE EXISTS, and why it is not optional: when the frontier did NOT
   * engage, the candidate list is in the pre-75.03 canonical MatchCore order, in
   * which `distance_km` outranks `area_affinity`. Re-applying the geography and
   * secondary keys to THAT list would reorder it — a vendor with a listed-area
   * match would jump ahead of a nearer one — and a provider outage would then
   * change who wins a lead. On a non-engaged run keys 1-3 are therefore
   * suppressed entirely and only fairness may refine the existing order.
   */
  readonly geographyEngaged: boolean;
  readonly placements: ReadonlyMap<string, GeoFrontierPlacement>;
  readonly fairness: GeoFairnessSnapshot;
}

/**
 * The QF-MVP-75.04 comparator, in full:
 *
 *   [when geography engaged]
 *     band                 ASC   inside -> outside -> unmeasured
 *     geo_regret_seconds   ASC   outside band ONLY
 *     match_tier           ASC   0 exact/synonym/subcategory before 1 fallback
 *     area_affinity        DESC  1 listed area, 0.5 covers_full_city, 0 neither
 *   geo fairness exposure  ASC   less recently exposed first; 0 when NEUTRAL
 *   base_rank              ASC   the rank the run already stamped
 *
 * The first four keys are evaluated by the FROZEN 75.03 comparator, called with
 * an EQUAL base rank on both sides so that its own final tiebreak cannot fire.
 * Its non-zero result therefore means exactly "different geography-or-secondary
 * class", and only its zero result — genuine comparability — lets fairness
 * speak. Consequences, both of them the point of the phase:
 *
 *   - No fairness value can move a candidate across a geography band, because
 *     fairness is never consulted when the band key differs. This is structural,
 *     not a review convention.
 *   - There is no package, paid-status, credit, visibility or commercial key
 *     anywhere in this comparator, nor in either comparator it delegates to.
 *     Package cannot buy a band, a regret class, or a fairness credit.
 *
 * Deterministic and TOTAL: `base_rank` is unique per candidate in a run, so the
 * comparator returns 0 only when both sides are the same candidate. No clock, no
 * randomness, no provider response order.
 */
export function compareGeoFairSecondary(
  a: GeoFairRankableCandidate,
  b: GeoFairRankableCandidate,
  context: GeoFairSecondaryContext,
): number {
  if (context.geographyEngaged) {
    // Equal base ranks neutralize the frozen comparator's own final tiebreak, so
    // what comes back is purely the geography + secondary class comparison.
    const geo = compareGeoFrontierCandidates(
      { id: a.id, match_tier: a.match_tier, area_affinity: a.area_affinity, base_rank: 0 },
      { id: b.id, match_tier: b.match_tier, area_affinity: b.area_affinity, base_rank: 0 },
      context.placements,
    );
    if (geo !== 0) return geo;
  }

  const fa = geoFairnessOrderKey(context.fairness, a.id);
  const fb = geoFairnessOrderKey(context.fairness, b.id);
  if (fa !== fb) return fa < fb ? -1 : 1;

  return a.base_rank - b.base_rank;
}

/**
 * Reorder an already-ranked candidate list IN PLACE by the GeoFair secondary
 * contract and re-stamp `rank_position`. Returns the ordered vendor ids.
 *
 * MEMBERSHIP-PRESERVING: it sorts the caller's array. Nothing is added, nothing
 * is removed, so the bounded candidate pool the QF-MVP-75.01 binding contract
 * builds from this list is still built from exactly the same vendors.
 *
 * IDENTITY UNDER NEUTRAL FAIRNESS — provable, and proved by the offline suite.
 * The incoming list is already sorted by the geography + secondary keys with
 * ties broken by position, and `base_rank` is read from that same position. With
 * a NEUTRAL fairness key (constant for every vendor) the sort key is therefore
 * exactly the order the list is already in. QF-MVP-75.04 consequently changes NO
 * assignment outcome; it installs the seam, the roles and the evidence.
 */
export function reorderByGeoFairSecondary<
  T extends { id: string; match_tier: 0 | 1; area_affinity: number; rank_position?: number },
>(candidates: T[], context: GeoFairSecondaryContext): string[] {
  const baseRank = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    baseRank.set(candidate.id, typeof candidate.rank_position === "number" ? candidate.rank_position : index + 1);
  });

  const key = (candidate: T): GeoFairRankableCandidate => ({
    id: candidate.id,
    match_tier: candidate.match_tier,
    area_affinity: candidate.area_affinity,
    base_rank: baseRank.get(candidate.id) ?? Number.MAX_SAFE_INTEGER,
  });

  candidates.sort((a, b) => compareGeoFairSecondary(key(a), key(b), context));
  candidates.forEach((candidate, index) => {
    candidate.rank_position = index + 1;
  });
  return candidates.map((candidate) => candidate.id);
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * The sanitized, deterministic GeoFair evidence recorded on `matching_snapshot`.
 *
 * WHAT IS DELIBERATELY ABSENT, and why each one:
 *   - no raw provider body, no API key, no auth header. The 75.03 route evidence
 *     already established that boundary and this block adds no provider field.
 *   - no lead coordinate, no vendor coordinate. The snapshot's existing
 *     coordinate discipline is unchanged by this phase.
 *   - no phone, no name, no address, no PII of any kind.
 *   - no per-vendor exposure map. Exposure is a per-vendor business statistic;
 *     the snapshot records only the MODE, the REASON and the aggregate counts,
 *     which is everything an auditor needs to know whether fairness spoke.
 *
 * `fairness_scope_key` is the lead's normalized city. It introduces NO new
 * sensitivity: the snapshot's `lead` summary already carries `city`.
 */
export interface GeoFairEvidence {
  readonly geofair_contract_version: number;
  readonly geofair_policy_id: string;
  readonly geofair_policy_version: number;
  readonly geofair_secondary_components: readonly string[];
  /** True only when QF-MVP-75.03 route authority engaged for this run. */
  readonly geography_engaged: boolean;
  readonly fairness_mode: GeoFairnessMode;
  readonly fairness_reason: GeoFairnessNeutralReason | null;
  readonly fairness_scope_kind: GeoFairnessScopeKind;
  readonly fairness_scope_key: string | null;
  readonly fairness_window_days: number;
  readonly fairness_counted_event_count: number;
  readonly fairness_rejected_event_count: number;
  /** The final order this contract produced. Membership equals the input. */
  readonly geofair_ordered_vendor_ids: readonly string[];
  readonly selection_plan: SelectionPlan;
  // -- standing negatives, asserted by the offline suite ---------------------
  readonly geofair_is_assignment_authority: false;
  readonly geofair_is_eligibility_authority: false;
  readonly geofair_package_weighted: false;
  readonly geofair_consumes_fairness_on_selection: false;
  readonly geofair_role_is_delivery_evidence: false;
}

/** Assemble the evidence block. Pure: it derives, it never measures. */
export function buildGeoFairEvidence(input: {
  readonly geographyEngaged: boolean;
  readonly fairness: GeoFairnessSnapshot;
  readonly orderedVendorIds: readonly string[];
  readonly selectionPlan: SelectionPlan;
}): GeoFairEvidence {
  return {
    geofair_contract_version: GEOFAIR_SECONDARY_CONTRACT_VERSION,
    geofair_policy_id: GEOFAIR_POLICY_ID,
    geofair_policy_version: GEOFAIR_POLICY_VERSION,
    geofair_secondary_components: GEOFAIR_SECONDARY_COMPONENTS,
    geography_engaged: input.geographyEngaged,
    fairness_mode: input.fairness.mode,
    fairness_reason: input.fairness.reason,
    fairness_scope_kind: input.fairness.scope.kind,
    fairness_scope_key: input.fairness.scope.key,
    fairness_window_days: input.fairness.window_days,
    fairness_counted_event_count: input.fairness.counted_event_count,
    fairness_rejected_event_count: input.fairness.rejected_event_count,
    geofair_ordered_vendor_ids: input.orderedVendorIds,
    selection_plan: input.selectionPlan,
    geofair_is_assignment_authority: false,
    geofair_is_eligibility_authority: false,
    geofair_package_weighted: false,
    geofair_consumes_fairness_on_selection: false,
    geofair_role_is_delivery_evidence: false,
  };
}
