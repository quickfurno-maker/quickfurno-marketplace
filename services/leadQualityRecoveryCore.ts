// ============================================================================
// QuickFurno — services/leadQualityRecoveryCore.ts
// Phase 3B: PURE recovery core shared by the rescore + retry services and tests.
//
// ZERO runtime dependencies (only `import type`, which is fully erased). It holds
// the deterministic, side-effect-free pieces of Phase 3B recovery:
//   • buildRescoreQualityInput  — reconstruct Quality V2 input from a stored lead
//   • summarizeRescoreComparison — previous vs current decision diff
//   • evaluateRetryQualityGate  — mirror of canAutoDistributeLead (read-only)
//   • classifyRetryPrecondition — the explicit retry decision (no matcher call)
//   • mapMatcherStatusToRetryStatus — normalize matcher outcome → retry status
//
// It NEVER scores, matches, assigns, or writes. The I/O services
// (leadQualityRecoveryService.ts, leadProcessingRecoveryService.ts) wrap these
// and reuse the EXISTING Quality V2 engine / matcher — nothing here re-implements
// quality weights, tiers, distance, credit, or package logic.
// ============================================================================
import type { LeadQualityInput } from "./leadQualityService";

// Must mirror canAutoDistributeLead() in services/leadQualityService.ts.
export const RETRY_QUALITY_MIN_SCORE = 70;

export type RecoveryErrorCode =
  | "VALIDATION"
  | "LEAD_NOT_FOUND"
  | "QUALITY_RESCORE_FAILED"
  | "QUALITY_STATE_INCONSISTENT"
  | "MATCHING_FAILED";

export type RetryStatus =
  | "already_assigned"
  | "quality_gate_hold"
  | "quality_state_inconsistent"
  | "duplicate_lead"
  | "lead_not_found"
  | "matched"
  | "waiting"
  | "failed";

export type RetryPrecondition =
  | "lead_not_found"
  | "duplicate_lead"
  | "quality_state_inconsistent"
  | "quality_gate_hold"
  | "already_assigned"
  | "proceed";

/** Loose stored-lead shape read by the recovery services (mirrors public.leads). */
export interface RecoveryLeadRow {
  id: string;
  name?: string | null;
  phone?: string | null;
  city?: string | null;
  area?: string | null;
  service_required?: string | null;
  category?: string | null;
  subcategory?: string | null;
  budget?: string | null;
  timeline?: string | null;
  property_type?: string | null;
  message?: string | null;
  share_consent?: boolean | null;
  location_consent?: boolean | null;
  location_source?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_place_id?: string | null;
  formatted_address?: string | null;
  area_normalized?: string | null;
  sublocality?: string | null;
  neighborhood?: string | null;
  is_duplicate?: boolean | null;
  lead_intent?: string | null;
  assignment_intent?: string | null;
  status?: string | null;
  // Quality mirror (previous decision).
  lead_quality_score?: number | null;
  lead_quality_class?: string | null;
  lead_quality_status?: string | null;
  lead_quality_hard_block_reason?: string | null;
  lead_quality_recommended_action?: string | null;
}

export interface RecoveryQualityDecision {
  score: number | null;
  class: string | null;
  status: string | null;
  hard_block_reason: string | null;
  recommended_action: string | null;
  score_model_version: string | null;
}

export interface RescoreChangeSummary {
  score_changed: boolean;
  class_changed: boolean;
  action_changed: boolean;
  hard_block_changed: boolean;
}

export interface RescoreResult {
  lead_id: string;
  previous: RecoveryQualityDecision;
  current: {
    score: number;
    class: string;
    status: string;
    hard_block_reason: string | null;
    recommended_action: string;
    score_model_version: string;
  };
  decision_changed: boolean;
  change_summary: RescoreChangeSummary;
}

export interface RetryQualityGate {
  passed: boolean;
  score: number | null;
  class: string | null;
  hard_block_reason: string | null;
  recommended_action: string | null;
}

export interface RetryMatchingSummary {
  run_status: string | null;
  eligible_vendor_count: number;
  selected_vendor_ids: string[];
  assigned_vendor_ids: string[];
  failure_reason: string | null;
}

export interface RetryLeadMatchingResult {
  lead_id: string;
  status: RetryStatus;
  quality_gate: RetryQualityGate;
  matching: RetryMatchingSummary;
  assignment_count: number;
}

// ---------------------------------------------------------------------------
// PART 2 — reconstruct Quality V2 input from the STORED lead.
// Maps only persisted fields. NEVER maps email or pincode. Message is passed
// through verbatim: Quality V2 hardcodes genuine-detail/explicit-intent to 0, so
// a system-generated metadata message can never masquerade as client authorship.
// `serviceable_city` is deliberately left unset — scoreAndStoreLead computes it.
// ---------------------------------------------------------------------------
export function buildRescoreQualityInput(lead: RecoveryLeadRow): LeadQualityInput {
  return {
    name: lead.name ?? null,
    phone: lead.phone ?? null,
    city: lead.city ?? null,
    area: lead.area ?? null,
    service_required: lead.service_required ?? null,
    category: lead.category ?? null,
    subcategory: lead.subcategory ?? null,
    budget: lead.budget ?? null,
    timeline: lead.timeline ?? null,
    property_type: lead.property_type ?? null,
    message: lead.message ?? null,
    share_consent: lead.share_consent ?? null,
    location_consent: lead.location_consent ?? null,
    location_source: lead.location_source ?? null,
    latitude: lead.latitude ?? null,
    longitude: lead.longitude ?? null,
    google_place_id: lead.google_place_id ?? null,
    formatted_address: lead.formatted_address ?? null,
    area_normalized: lead.area_normalized ?? null,
    sublocality: lead.sublocality ?? null,
    neighborhood: lead.neighborhood ?? null,
    is_duplicate: lead.is_duplicate ?? null,
    lead_intent: lead.lead_intent ?? null,
    assignment_intent: lead.assignment_intent ?? null,
    // serviceable_city omitted on purpose; email & pincode intentionally never mapped.
  };
}

/** Previous decision snapshot from the stored leads mirror + latest score model version. */
export function readPreviousDecision(lead: RecoveryLeadRow, latestScoreModelVersion: string | null): RecoveryQualityDecision {
  return {
    score: numOrNull(lead.lead_quality_score),
    class: strOrNull(lead.lead_quality_class),
    status: strOrNull(lead.lead_quality_status),
    hard_block_reason: strOrNull(lead.lead_quality_hard_block_reason),
    recommended_action: strOrNull(lead.lead_quality_recommended_action),
    score_model_version: latestScoreModelVersion,
  };
}

export function summarizeRescoreComparison(
  previous: RecoveryQualityDecision,
  current: RescoreResult["current"],
): { decision_changed: boolean; change_summary: RescoreChangeSummary } {
  const change_summary: RescoreChangeSummary = {
    score_changed: (previous.score ?? null) !== current.score,
    class_changed: !ciEq(previous.class, current.class),
    action_changed: !ciEq(previous.recommended_action, current.recommended_action),
    hard_block_changed: strOrNull(previous.hard_block_reason) !== strOrNull(current.hard_block_reason),
  };
  const decision_changed =
    change_summary.score_changed || change_summary.class_changed || change_summary.action_changed || change_summary.hard_block_changed;
  return { decision_changed, change_summary };
}

// ---------------------------------------------------------------------------
// PART 5/6 — explicit retry gate + precondition (no matcher logic here).
// ---------------------------------------------------------------------------
/** Mirrors canAutoDistributeLead: score>=70, class A/A+, no hard block, action auto_distribute. */
export function evaluateRetryQualityGate(decision: RecoveryQualityDecision): RetryQualityGate {
  const passed =
    (decision.score ?? 0) >= RETRY_QUALITY_MIN_SCORE &&
    (decision.class === "A" || decision.class === "A+") &&
    strOrNull(decision.hard_block_reason) === null &&
    decision.recommended_action === "auto_distribute";
  return {
    passed,
    score: numOrNull(decision.score),
    class: strOrNull(decision.class),
    hard_block_reason: strOrNull(decision.hard_block_reason),
    recommended_action: strOrNull(decision.recommended_action),
  };
}

/**
 * The explicit retry decision, in the required order:
 *   missing → duplicate → quality-state consistency → quality gate →
 *   already-assigned → proceed.
 * The consistency check (fail-closed) is BEFORE the gate: a lead whose latest
 * lead_scores decision disagrees with its leads mirror is held, not matched.
 * `already_assigned` is decided from ACTUAL lead_assignments count (Layer 1);
 * the DB RPC provides Layer 2 idempotency under races.
 */
export function classifyRetryPrecondition(input: {
  leadExists: boolean;
  isDuplicate: boolean;
  qualityConsistent: boolean;
  gatePassed: boolean;
  assignmentCount: number;
}): RetryPrecondition {
  if (!input.leadExists) return "lead_not_found";
  if (input.isDuplicate) return "duplicate_lead";
  if (!input.qualityConsistent) return "quality_state_inconsistent";
  if (!input.gatePassed) return "quality_gate_hold";
  if (input.assignmentCount > 0) return "already_assigned";
  return "proceed";
}

// ---------------------------------------------------------------------------
// Correction pass — quality-state consistency (fail-closed) + delivery reuse.
// ---------------------------------------------------------------------------
export interface QualityDecisionForCompare {
  score: number | null;
  class: string | null;
  recommended_action: string | null;
  hard_block_reason: string | null;
}

/**
 * Consistency contract (fail-closed): score EXACT numeric equality; class and
 * recommended_action case-insensitive; hard_block_reason null/empty-normalized.
 * A present-vs-missing side (e.g. a score row but an empty mirror) compares
 * UNEQUAL → inconsistent. Both-absent compares equal (a never-scored lead is not
 * a mismatch; the retry quality gate then holds it).
 */
export function qualityDecisionsConsistent(a: QualityDecisionForCompare, b: QualityDecisionForCompare): boolean {
  return (
    (a.score ?? null) === (b.score ?? null) &&
    ciEq(strOrNull(a.class), strOrNull(b.class)) &&
    ciEq(strOrNull(a.recommended_action), strOrNull(b.recommended_action)) &&
    strOrNull(a.hard_block_reason) === strOrNull(b.hard_block_reason)
  );
}

/** Post-rescore read-back: latest score, leads mirror, and the returned current must all agree. */
export function rescoreReadbackConsistent(
  scoreSide: QualityDecisionForCompare,
  mirrorSide: QualityDecisionForCompare,
  currentSide: QualityDecisionForCompare,
): boolean {
  return qualityDecisionsConsistent(scoreSide, mirrorSide) && qualityDecisionsConsistent(scoreSide, currentSide);
}

/**
 * RPC idempotent-status contract: `already_assigned` means the assignments (and
 * their delivery/preview logs) already exist, so the matcher must NOT recreate
 * delivery side effects. Mirrors the narrow guard in services/leadMatchingEngine.ts.
 */
export function deliverySuppressedForAssignmentStatus(status: string): boolean {
  return status === "already_assigned";
}

/** Normalize the matcher's AutoLeadMatchingResult.status → a terminal retry status. */
export function mapMatcherStatusToRetryStatus(matcherStatus: string): RetryStatus {
  switch (matcherStatus) {
    case "matched":
      return "matched";
    case "waiting":
      return "waiting";
    case "failed":
      return "failed";
    // "skipped" is REACHABLE since QF-MVP-80.01: the consent and duplicate gates
    // are already excluded upstream, but the automatic-assignment kill switch
    // (auto_assignment_mode = 'off') halts the matcher and returns "skipped"
    // with failure_reason "auto_assignment_off". Surfaced honestly as failed
    // rather than pretending it matched; the truthful reason travels alongside
    // in the caller's matching.failure_reason.
    default:
      return "failed";
  }
}

export const EMPTY_MATCHING_SUMMARY: RetryMatchingSummary = {
  run_status: null,
  eligible_vendor_count: 0,
  selected_vendor_ids: [],
  assigned_vendor_ids: [],
  failure_reason: null,
};

// ---- tiny pure helpers -----------------------------------------------------
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function strOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}
function ciEq(a: string | null, b: string | null): boolean {
  return (a === null ? "" : a.toLowerCase()) === (b === null ? "" : b.toLowerCase());
}
