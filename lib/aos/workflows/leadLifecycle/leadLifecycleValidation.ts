import type {
  DomainEventRecord,
  JsonRecord,
  WorkflowInstanceRecord,
} from "../../workflow/workflowPersistenceTypes";
import { LEAD_ENTITY_TYPE } from "./leadLifecycleStates";
import {
  LEAD_QUALITY_TIERS,
  MAX_VENDORS_PER_LEAD,
  ManualReviewOutcome,
  type CanonicalLeadIdentity,
  type DistributionResult,
  type LeadQualityResult,
  type LeadQualityTier,
  type ManualReviewOutcomeValue,
  type ManualReviewResolution,
  type MatchingResult,
} from "./leadLifecycleTypes";

/**
 * QuickFurno Lead Lifecycle — pure payload validation (Phase 2A).
 *
 * Validates the *shape* of authoritative results and identities. It does NOT
 * compute or re-threshold a score, never queries or ranks vendors, and never
 * fabricates identifiers. All checks are pure.
 */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isQualityTier(value: unknown): value is LeadQualityTier {
  return typeof value === "string" && (LEAD_QUALITY_TIERS as string[]).includes(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isNonEmptyString(item));
}

// ---------------------------------------------------------------------------
// Correction 1 — canonical lead identity
// ---------------------------------------------------------------------------

/**
 * Derive the canonical lead id from validated workflow/event entity identity.
 *
 * The kernel creates/loads the workflow from `domain_event.entity_id`, so entity
 * identity — not a caller-supplied `payload.lead_id` — is the source of truth.
 * `payload.lead_id` is accepted only when it exactly matches the entity id.
 */
export function resolveCanonicalLeadIdentity(
  workflow: Pick<WorkflowInstanceRecord, "entity_type" | "entity_id">,
  event: Pick<DomainEventRecord, "entity_type" | "entity_id" | "payload_json">,
): ValidationResult<CanonicalLeadIdentity> {
  if (event.entity_type !== LEAD_ENTITY_TYPE) {
    return { ok: false, message: "LEAD_ENTITY_TYPE_REQUIRED" };
  }
  if (!isNonEmptyString(event.entity_id)) {
    return { ok: false, message: "LEAD_ENTITY_ID_REQUIRED" };
  }
  if (workflow.entity_type !== LEAD_ENTITY_TYPE) {
    return { ok: false, message: "WORKFLOW_ENTITY_TYPE_MISMATCH" };
  }
  if (workflow.entity_id !== event.entity_id) {
    return { ok: false, message: "WORKFLOW_EVENT_ENTITY_MISMATCH" };
  }

  const payload = isPlainObject(event.payload_json) ? event.payload_json : {};
  if (payload.lead_id !== undefined) {
    if (!isNonEmptyString(payload.lead_id)) {
      return { ok: false, message: "LEAD_IDENTITY_MISMATCH" };
    }
    if (payload.lead_id.trim() !== event.entity_id) {
      return { ok: false, message: "LEAD_IDENTITY_MISMATCH" };
    }
  }

  return { ok: true, value: { leadId: event.entity_id } };
}

// ---------------------------------------------------------------------------
// Quality result
// ---------------------------------------------------------------------------

/**
 * Validate an authoritative quality result payload. Accepts either a top-level
 * `tier` field or a nested `quality.tier` field, so the contract tolerates both
 * flat and namespaced authoritative event shapes.
 */
export function validateQualityResult(payload: JsonRecord): ValidationResult<LeadQualityResult> {
  if (!isPlainObject(payload)) {
    return { ok: false, message: "QUALITY_RESULT_PAYLOAD_REQUIRED" };
  }

  const nested = isPlainObject(payload.quality) ? payload.quality : payload;

  if (!("tier" in nested)) {
    return { ok: false, message: "QUALITY_TIER_REQUIRED" };
  }
  if (!isQualityTier(nested.tier)) {
    return { ok: false, message: "QUALITY_TIER_INVALID" };
  }

  const manualReviewRaw = nested.manual_review_required;
  if (manualReviewRaw !== undefined && typeof manualReviewRaw !== "boolean") {
    return { ok: false, message: "MANUAL_REVIEW_REQUIRED_MUST_BE_BOOLEAN" };
  }

  const clarificationAllowedRaw = nested.clarification_allowed;
  if (clarificationAllowedRaw !== undefined && typeof clarificationAllowedRaw !== "boolean") {
    return { ok: false, message: "CLARIFICATION_ALLOWED_MUST_BE_BOOLEAN" };
  }

  const clarificationCycleRaw = nested.clarification_cycle;
  if (clarificationCycleRaw !== undefined && !isNonNegativeInteger(clarificationCycleRaw)) {
    return { ok: false, message: "CLARIFICATION_CYCLE_MUST_BE_NON_NEGATIVE_INTEGER" };
  }

  return {
    ok: true,
    value: {
      tier: nested.tier,
      manualReviewRequired: manualReviewRaw === true,
      clarificationAllowed: clarificationAllowedRaw === true,
      clarificationCycle: isNonNegativeInteger(clarificationCycleRaw) ? clarificationCycleRaw : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Correction 4 — maximum 3-vendor contract guards
// ---------------------------------------------------------------------------

function validateBoundedVendorCount(
  rawCount: unknown,
  rawVendorIds: unknown,
  min: number,
  requiredMessage: string,
  invalidMessage: string,
): ValidationResult<{ count: number; vendorIds: string[] | null }> {
  if (rawCount === undefined) {
    return { ok: false, message: requiredMessage };
  }
  if (typeof rawCount !== "number" || !Number.isInteger(rawCount)) {
    return { ok: false, message: invalidMessage };
  }
  if (rawCount < min || rawCount > MAX_VENDORS_PER_LEAD) {
    return { ok: false, message: invalidMessage };
  }

  let vendorIds: string[] | null = null;
  if (rawVendorIds !== undefined && rawVendorIds !== null) {
    if (!isStringArray(rawVendorIds)) {
      return { ok: false, message: "VENDOR_IDS_MUST_BE_STRING_ARRAY" };
    }
    if (rawVendorIds.length !== rawCount) {
      return { ok: false, message: "VENDOR_IDS_COUNT_MISMATCH" };
    }
    vendorIds = [...rawVendorIds];
  }

  return { ok: true, value: { count: rawCount, vendorIds } };
}

/** MATCHING_COMPLETED: recommended_vendor_count must be an integer in [0, 3]. */
export function validateMatchingResult(payload: JsonRecord): ValidationResult<MatchingResult> {
  if (!isPlainObject(payload)) {
    return { ok: false, message: "MATCHING_RESULT_PAYLOAD_REQUIRED" };
  }
  const result = validateBoundedVendorCount(
    payload.recommended_vendor_count,
    payload.recommended_vendor_ids,
    0,
    "RECOMMENDED_VENDOR_COUNT_REQUIRED",
    "RECOMMENDED_VENDOR_COUNT_INVALID",
  );
  if (!result.ok) return result;
  return { ok: true, value: { recommendedVendorCount: result.value.count, vendorIds: result.value.vendorIds } };
}

/** DISTRIBUTION_COMPLETED: distributed_vendor_count must be an integer in [1, 3]. */
export function validateDistributionResult(payload: JsonRecord): ValidationResult<DistributionResult> {
  if (!isPlainObject(payload)) {
    return { ok: false, message: "DISTRIBUTION_RESULT_PAYLOAD_REQUIRED" };
  }
  const result = validateBoundedVendorCount(
    payload.distributed_vendor_count,
    payload.distributed_vendor_ids,
    1,
    "DISTRIBUTED_VENDOR_COUNT_REQUIRED",
    "DISTRIBUTED_VENDOR_COUNT_INVALID",
  );
  if (!result.ok) return result;
  return { ok: true, value: { distributedVendorCount: result.value.count, vendorIds: result.value.vendorIds } };
}

// ---------------------------------------------------------------------------
// Correction 3 — manual review resolution
// ---------------------------------------------------------------------------

const MANUAL_REVIEW_OUTCOMES = new Set<string>(Object.values(ManualReviewOutcome));

/** Validate a lead.manual_review.resolved payload with a strict outcome enum. */
export function validateManualReviewResolution(payload: JsonRecord): ValidationResult<ManualReviewResolution> {
  if (!isPlainObject(payload)) {
    return { ok: false, message: "MANUAL_REVIEW_RESOLUTION_PAYLOAD_REQUIRED" };
  }
  const outcomeRaw = payload.outcome;
  if (!isNonEmptyString(outcomeRaw) || !MANUAL_REVIEW_OUTCOMES.has(outcomeRaw)) {
    return { ok: false, message: "MANUAL_REVIEW_OUTCOME_INVALID" };
  }
  const outcome = outcomeRaw as ManualReviewOutcomeValue;

  const distributionAuthorized = payload.distribution_authorized === true;
  if (outcome === ManualReviewOutcome.APPROVE_DISTRIBUTION && !distributionAuthorized) {
    // Do not let a manual-review approval blindly bypass distribution safety:
    // it requires explicit authoritative review metadata.
    return { ok: false, message: "MANUAL_REVIEW_DISTRIBUTION_AUTHORIZATION_REQUIRED" };
  }

  const reviewedBy = isNonEmptyString(payload.reviewed_by) ? payload.reviewed_by.trim() : null;

  return { ok: true, value: { outcome, distributionAuthorized, reviewedBy } };
}
