import type { JsonRecord } from "../../workflow/workflowPersistenceTypes";
import { LEAD_QUALITY_TIERS, type LeadQualityResult, type LeadQualityTier } from "./leadLifecycleTypes";

/**
 * QuickFurno Lead Lifecycle — pure payload validation (Phase 2A).
 *
 * Validates the *shape* of an authoritative quality result. It does NOT compute,
 * infer, or re-threshold a score. It only accepts one of the authoritative tiers
 * (A+/A/B/C/D) plus optional, well-typed routing metadata.
 */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQualityTier(value: unknown): value is LeadQualityTier {
  return typeof value === "string" && (LEAD_QUALITY_TIERS as string[]).includes(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

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

/**
 * Read a stable lead identifier from an event payload for idempotency/metadata.
 * Falls back to null when absent — Phase 2A never fabricates identifiers.
 */
export function readLeadId(payload: JsonRecord): string | null {
  const value = payload.lead_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
