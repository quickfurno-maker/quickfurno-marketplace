import type { DomainEventRecord, JsonRecord } from "../../../workflow/workflowPersistenceTypes";
import { LeadLifecycleEventType } from "../leadLifecycleEvents";
import { LEAD_ENTITY_TYPE, LEAD_LIFECYCLE_WORKFLOW_TYPE } from "../leadLifecycleStates";
import {
  LeadDistributionAuthorizationSource,
  MAX_DISTRIBUTION_VENDORS,
  type DistributionApprovalRequiredContract,
  type DistributionApprovedContract,
  type DistributionValidationResult,
  type LeadDistributionApprovedExpectation,
  type LeadDistributionApprovedSnapshot,
  type LeadDistributionAuthorizationSourceValue,
  type LeadDistributionRecommendationExpectation,
  type LeadDistributionRecommendationSnapshot,
} from "./leadDistributionTypes";

/**
 * QuickFurno Distribution Control — pure payload/snapshot validation (Phase 3A).
 *
 * Everything here is a pure function. It never loads data, never re-runs
 * matching, never ranks vendors, never assigns, and never mutates. Recommendation
 * order is treated as authoritative and is never reordered.
 */

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Normalize a raw value into a validated vendor-id list: it must be an array of
 * trimmed, non-empty, unique strings. Returns the trimmed list, or an error code.
 */
export function normalizeVendorIdList(
  raw: unknown,
  requiredMessage: string,
): DistributionValidationResult<string[]> {
  if (raw === undefined || raw === null) {
    return { ok: false, message: requiredMessage };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, message: "VENDOR_IDS_MUST_BE_ARRAY" };
  }
  const trimmed: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isNonEmptyString(item)) {
      return { ok: false, message: "VENDOR_ID_MUST_BE_NON_EMPTY_STRING" };
    }
    const id = item.trim();
    if (seen.has(id)) {
      return { ok: false, message: "VENDOR_IDS_MUST_BE_UNIQUE" };
    }
    seen.add(id);
    trimmed.push(id);
  }
  return { ok: true, value: trimmed };
}

/**
 * True iff `approved` is a subsequence of `recommended` that preserves the
 * authoritative recommendation order. Assumes both lists contain unique ids.
 *
 * Examples for recommended [A, B, C]:
 *   valid:   [A], [A, B], [A, B, C], [A, C]
 *   invalid: [B, A], [C, B], [A, D]
 */
export function isApprovedSubsetPreservingOrder(
  recommended: readonly string[],
  approved: readonly string[],
): { ok: true } | { ok: false; message: string } {
  let lastIndex = -1;
  for (const id of approved) {
    const index = recommended.indexOf(id);
    if (index === -1) {
      return { ok: false, message: "DISTRIBUTION_APPROVED_VENDOR_NOT_RECOMMENDED" };
    }
    if (index <= lastIndex) {
      return { ok: false, message: "DISTRIBUTION_APPROVED_ORDER_NOT_PRESERVED" };
    }
    lastIndex = index;
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Recommendation snapshot resolution from an authoritative matching event
// ---------------------------------------------------------------------------

/**
 * Validate a loaded `lead.matching.completed` domain event and normalize it into
 * an immutable recommendation snapshot bound to the expected lead + workflow.
 *
 * This NEVER re-runs matching and NEVER re-ranks vendors. The order of
 * `recommended_vendor_ids` on the event is preserved exactly.
 */
export function validateRecommendationEventSnapshot(
  event: DomainEventRecord,
  expectation: LeadDistributionRecommendationExpectation,
): DistributionValidationResult<LeadDistributionRecommendationSnapshot> {
  if (event.id !== expectation.recommendationEventId) {
    return { ok: false, message: "RECOMMENDATION_EVENT_ID_MISMATCH" };
  }
  if (event.event_type !== LeadLifecycleEventType.MATCHING_COMPLETED) {
    return { ok: false, message: "RECOMMENDATION_EVENT_TYPE_INVALID" };
  }
  if (event.entity_type !== LEAD_ENTITY_TYPE) {
    return { ok: false, message: "RECOMMENDATION_EVENT_ENTITY_TYPE_INVALID" };
  }
  if (!isNonEmptyString(expectation.expectedLeadId)) {
    return { ok: false, message: "RECOMMENDATION_EXPECTED_LEAD_REQUIRED" };
  }
  if (event.entity_id !== expectation.expectedLeadId) {
    return { ok: false, message: "RECOMMENDATION_EVENT_LEAD_MISMATCH" };
  }
  if (!isNonEmptyString(expectation.expectedWorkflowInstanceId)) {
    return { ok: false, message: "RECOMMENDATION_EXPECTED_WORKFLOW_REQUIRED" };
  }
  // Our matching executor stamps correlation_id with the workflow instance id,
  // so the snapshot is bound to the same workflow that produced it.
  if (event.correlation_id !== expectation.expectedWorkflowInstanceId) {
    return { ok: false, message: "RECOMMENDATION_EVENT_WORKFLOW_MISMATCH" };
  }

  const payload = isPlainObject(event.payload_json) ? event.payload_json : null;
  if (!payload) {
    return { ok: false, message: "RECOMMENDATION_EVENT_PAYLOAD_REQUIRED" };
  }
  if (payload.workflow_type !== LEAD_LIFECYCLE_WORKFLOW_TYPE) {
    return { ok: false, message: "RECOMMENDATION_EVENT_WORKFLOW_TYPE_INVALID" };
  }
  if (payload.lead_id !== expectation.expectedLeadId) {
    return { ok: false, message: "RECOMMENDATION_EVENT_LEAD_MISMATCH" };
  }

  if (!isIntegerInRange(payload.recommended_vendor_count, 0, MAX_DISTRIBUTION_VENDORS)) {
    return { ok: false, message: "RECOMMENDATION_VENDOR_COUNT_INVALID" };
  }
  const count = payload.recommended_vendor_count;

  const ids = normalizeVendorIdList(
    payload.recommended_vendor_ids,
    "RECOMMENDATION_VENDOR_IDS_REQUIRED",
  );
  if (!ids.ok) return ids;
  if (ids.value.length !== count) {
    return { ok: false, message: "RECOMMENDATION_VENDOR_IDS_COUNT_MISMATCH" };
  }

  const snapshot: LeadDistributionRecommendationSnapshot = Object.freeze({
    recommendationEventId: expectation.recommendationEventId,
    leadId: expectation.expectedLeadId,
    workflowInstanceId: expectation.expectedWorkflowInstanceId,
    recommendedVendorIds: Object.freeze([...ids.value]),
    recommendedVendorCount: count,
  });
  return { ok: true, value: snapshot };
}

// ---------------------------------------------------------------------------
// Lifecycle event contract validation (handler-facing)
// ---------------------------------------------------------------------------

/**
 * Validate a `lead.distribution.approval_required` payload. Empty/unvalidated
 * approval events are rejected. approval_required only carries 1..3 vendors
 * (zero recommendations must go to manual review instead).
 */
export function validateDistributionApprovalRequired(
  payload: JsonRecord,
): DistributionValidationResult<DistributionApprovalRequiredContract> {
  if (!isPlainObject(payload)) {
    return { ok: false, message: "DISTRIBUTION_APPROVAL_REQUIRED_PAYLOAD_REQUIRED" };
  }
  if (!isNonEmptyString(payload.recommendation_event_id)) {
    return { ok: false, message: "DISTRIBUTION_RECOMMENDATION_EVENT_ID_REQUIRED" };
  }
  if (!isIntegerInRange(payload.recommended_vendor_count, 1, MAX_DISTRIBUTION_VENDORS)) {
    return { ok: false, message: "DISTRIBUTION_RECOMMENDED_COUNT_INVALID" };
  }
  const count = payload.recommended_vendor_count;
  const ids = normalizeVendorIdList(
    payload.recommended_vendor_ids,
    "DISTRIBUTION_RECOMMENDED_IDS_REQUIRED",
  );
  if (!ids.ok) return ids;
  if (ids.value.length !== count) {
    return { ok: false, message: "DISTRIBUTION_RECOMMENDED_IDS_COUNT_MISMATCH" };
  }
  return {
    ok: true,
    value: {
      recommendationEventId: payload.recommendation_event_id.trim(),
      recommendedVendorCount: count,
      recommendedVendorIds: ids.value,
    },
  };
}

/**
 * Validate a `lead.distribution.approved` payload. Enforces the approved-subset
 * rules and recommendation-order preservation before any state transition.
 */
export function validateDistributionApproved(
  payload: JsonRecord,
): DistributionValidationResult<DistributionApprovedContract> {
  if (!isPlainObject(payload)) {
    return { ok: false, message: "DISTRIBUTION_APPROVED_PAYLOAD_REQUIRED" };
  }
  if (!isNonEmptyString(payload.recommendation_event_id)) {
    return { ok: false, message: "DISTRIBUTION_RECOMMENDATION_EVENT_ID_REQUIRED" };
  }
  if (!isIntegerInRange(payload.recommended_vendor_count, 1, MAX_DISTRIBUTION_VENDORS)) {
    return { ok: false, message: "DISTRIBUTION_RECOMMENDED_COUNT_INVALID" };
  }
  const recommendedCount = payload.recommended_vendor_count;
  const recommended = normalizeVendorIdList(
    payload.recommended_vendor_ids,
    "DISTRIBUTION_RECOMMENDED_IDS_REQUIRED",
  );
  if (!recommended.ok) return recommended;
  if (recommended.value.length !== recommendedCount) {
    return { ok: false, message: "DISTRIBUTION_RECOMMENDED_IDS_COUNT_MISMATCH" };
  }

  if (!isIntegerInRange(payload.approved_vendor_count, 1, MAX_DISTRIBUTION_VENDORS)) {
    return { ok: false, message: "DISTRIBUTION_APPROVED_COUNT_INVALID" };
  }
  const approvedCount = payload.approved_vendor_count;
  const approved = normalizeVendorIdList(
    payload.approved_vendor_ids,
    "DISTRIBUTION_APPROVED_IDS_REQUIRED",
  );
  if (!approved.ok) return approved;
  if (approved.value.length !== approvedCount) {
    return { ok: false, message: "DISTRIBUTION_APPROVED_IDS_COUNT_MISMATCH" };
  }

  const subset = isApprovedSubsetPreservingOrder(recommended.value, approved.value);
  if (!subset.ok) return subset;

  if (!isNonEmptyString(payload.approved_by)) {
    return { ok: false, message: "DISTRIBUTION_APPROVED_BY_REQUIRED" };
  }

  const approvalReason = isNonEmptyString(payload.approval_reason)
    ? payload.approval_reason.trim()
    : null;

  return {
    ok: true,
    value: {
      recommendationEventId: payload.recommendation_event_id.trim(),
      recommendedVendorCount: recommendedCount,
      recommendedVendorIds: recommended.value,
      approvedVendorCount: approvedCount,
      approvedVendorIds: approved.value,
      approvedBy: payload.approved_by.trim(),
      approvalReason,
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 3B — approved-event snapshot resolution + distribution.completed contract
// ---------------------------------------------------------------------------

/**
 * Validate a loaded `lead.distribution.approved` domain event and normalize it
 * into an immutable snapshot bound to the expected lead + workflow. Reuses the
 * approved-payload contract (subset + recommendation-order rules). NEVER reruns
 * matching or reranks.
 */
export function validateApprovedEventSnapshot(
  event: DomainEventRecord,
  expectation: LeadDistributionApprovedExpectation,
): DistributionValidationResult<LeadDistributionApprovedSnapshot> {
  if (event.id !== expectation.approvalEventId) {
    return { ok: false, message: "APPROVED_EVENT_ID_MISMATCH" };
  }
  if (event.event_type !== LeadLifecycleEventType.DISTRIBUTION_APPROVED) {
    return { ok: false, message: "APPROVED_EVENT_TYPE_INVALID" };
  }
  if (event.entity_type !== LEAD_ENTITY_TYPE) {
    return { ok: false, message: "APPROVED_EVENT_ENTITY_TYPE_INVALID" };
  }
  if (!isNonEmptyString(expectation.expectedLeadId)) {
    return { ok: false, message: "APPROVED_EXPECTED_LEAD_REQUIRED" };
  }
  if (event.entity_id !== expectation.expectedLeadId) {
    return { ok: false, message: "APPROVED_EVENT_LEAD_MISMATCH" };
  }
  if (!isNonEmptyString(expectation.expectedWorkflowInstanceId)) {
    return { ok: false, message: "APPROVED_EXPECTED_WORKFLOW_REQUIRED" };
  }
  if (event.correlation_id !== expectation.expectedWorkflowInstanceId) {
    return { ok: false, message: "APPROVED_EVENT_WORKFLOW_MISMATCH" };
  }

  const payload = isPlainObject(event.payload_json) ? event.payload_json : null;
  if (!payload) {
    return { ok: false, message: "APPROVED_EVENT_PAYLOAD_REQUIRED" };
  }
  if (payload.workflow_type !== LEAD_LIFECYCLE_WORKFLOW_TYPE) {
    return { ok: false, message: "APPROVED_EVENT_WORKFLOW_TYPE_INVALID" };
  }
  if (payload.lead_id !== expectation.expectedLeadId) {
    return { ok: false, message: "APPROVED_EVENT_LEAD_MISMATCH" };
  }

  const approved = validateDistributionApproved(payload);
  if (!approved.ok) return approved;

  const snapshot: LeadDistributionApprovedSnapshot = Object.freeze({
    approvalEventId: expectation.approvalEventId,
    recommendationEventId: approved.value.recommendationEventId,
    leadId: expectation.expectedLeadId,
    workflowInstanceId: expectation.expectedWorkflowInstanceId,
    recommendedVendorIds: Object.freeze([...approved.value.recommendedVendorIds]),
    recommendedVendorCount: approved.value.recommendedVendorCount,
    approvedVendorIds: Object.freeze([...approved.value.approvedVendorIds]),
    approvedVendorCount: approved.value.approvedVendorCount,
    approvedBy: approved.value.approvedBy,
  });
  return { ok: true, value: snapshot };
}

export interface DistributionCompletedContract {
  approvalEventId: string;
  recommendationEventId: string;
  approvedVendorCount: number;
  approvedVendorIds: string[];
  distributedVendorCount: number;
  distributedVendorIds: string[];
  skippedVendorIds: string[];
}

/**
 * Strict `lead.distribution.completed` payload validation. Enforces that
 * distributed + skipped **exactly partition** the approved set, both preserving
 * approved order, disjoint, with distributed a non-empty approved subset.
 */
export function validateDistributionCompleted(
  payload: JsonRecord,
): DistributionValidationResult<DistributionCompletedContract> {
  if (!isPlainObject(payload)) {
    return { ok: false, message: "DISTRIBUTION_COMPLETED_PAYLOAD_REQUIRED" };
  }
  if (!isNonEmptyString(payload.approval_event_id)) {
    return { ok: false, message: "DISTRIBUTION_APPROVAL_EVENT_ID_REQUIRED" };
  }
  if (!isNonEmptyString(payload.recommendation_event_id)) {
    return { ok: false, message: "DISTRIBUTION_RECOMMENDATION_EVENT_ID_REQUIRED" };
  }

  if (!isIntegerInRange(payload.approved_vendor_count, 1, MAX_DISTRIBUTION_VENDORS)) {
    return { ok: false, message: "DISTRIBUTION_APPROVED_COUNT_INVALID" };
  }
  const approvedCount = payload.approved_vendor_count;
  const approved = normalizeVendorIdList(payload.approved_vendor_ids, "DISTRIBUTION_APPROVED_IDS_REQUIRED");
  if (!approved.ok) return approved;
  if (approved.value.length !== approvedCount) {
    return { ok: false, message: "DISTRIBUTION_APPROVED_IDS_COUNT_MISMATCH" };
  }

  if (!isIntegerInRange(payload.distributed_vendor_count, 1, MAX_DISTRIBUTION_VENDORS)) {
    return { ok: false, message: "DISTRIBUTION_DISTRIBUTED_COUNT_INVALID" };
  }
  const distributedCount = payload.distributed_vendor_count;
  const distributed = normalizeVendorIdList(payload.distributed_vendor_ids, "DISTRIBUTION_DISTRIBUTED_IDS_REQUIRED");
  if (!distributed.ok) return distributed;
  if (distributed.value.length !== distributedCount) {
    return { ok: false, message: "DISTRIBUTION_DISTRIBUTED_IDS_COUNT_MISMATCH" };
  }

  // skipped is required (present) but may be an empty array (full distribution).
  if (payload.skipped_vendor_ids === undefined || payload.skipped_vendor_ids === null) {
    return { ok: false, message: "DISTRIBUTION_SKIPPED_IDS_REQUIRED" };
  }
  const skipped = normalizeVendorIdList(payload.skipped_vendor_ids, "DISTRIBUTION_SKIPPED_IDS_REQUIRED");
  if (!skipped.ok) return skipped;

  // distributed ⊆ approved, preserving approved order.
  const distSubset = isApprovedSubsetPreservingOrder(approved.value, distributed.value);
  if (!distSubset.ok) {
    return { ok: false, message: distSubset.message === "DISTRIBUTION_APPROVED_ORDER_NOT_PRESERVED" ? "DISTRIBUTION_DISTRIBUTED_ORDER_NOT_PRESERVED" : "DISTRIBUTION_DISTRIBUTED_NOT_APPROVED_SUBSET" };
  }
  // skipped ⊆ approved, preserving approved order.
  const skipSubset = isApprovedSubsetPreservingOrder(approved.value, skipped.value);
  if (!skipSubset.ok) {
    return { ok: false, message: skipSubset.message === "DISTRIBUTION_APPROVED_ORDER_NOT_PRESERVED" ? "DISTRIBUTION_SKIPPED_ORDER_NOT_PRESERVED" : "DISTRIBUTION_SKIPPED_NOT_APPROVED_SUBSET" };
  }

  // distributed and skipped must be disjoint and exactly partition approved.
  const distSet = new Set(distributed.value);
  for (const id of skipped.value) {
    if (distSet.has(id)) {
      return { ok: false, message: "DISTRIBUTION_DISTRIBUTED_SKIPPED_NOT_DISJOINT" };
    }
  }
  if (distributed.value.length + skipped.value.length !== approved.value.length) {
    return { ok: false, message: "DISTRIBUTION_PARTITION_INCOMPLETE" };
  }

  return {
    ok: true,
    value: {
      approvalEventId: payload.approval_event_id.trim(),
      recommendationEventId: payload.recommendation_event_id.trim(),
      approvedVendorCount: approvedCount,
      approvedVendorIds: approved.value,
      distributedVendorCount: distributedCount,
      distributedVendorIds: distributed.value,
      skippedVendorIds: skipped.value,
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 4B-2 — neutral distribution.completed authorization contract
// ---------------------------------------------------------------------------

/**
 * Neutral completed contract for both human-approved and policy-auto-authorized
 * distribution. `authorizedVendorIds` is the set that was authorized for
 * assignment (approved subset for human approval; exact recommendation set for
 * policy auto-authorization). The partition rules are IDENTICAL to the legacy
 * contract: distributed + skipped exactly partition the authorized set, both
 * preserving authorized order, disjoint, with 1..3 distributed.
 */
export interface DistributionAuthorizationCompletedContract {
  authorizationEventId: string;
  authorizationSource: LeadDistributionAuthorizationSourceValue;
  recommendationEventId: string;
  authorizedVendorCount: number;
  authorizedVendorIds: string[];
  distributedVendorCount: number;
  distributedVendorIds: string[];
  skippedVendorIds: string[];
}

/** Strict validation of the NEUTRAL completed authorization payload. */
export function validateDistributionAuthorizationCompleted(
  payload: JsonRecord,
): DistributionValidationResult<DistributionAuthorizationCompletedContract> {
  if (!isPlainObject(payload)) {
    return { ok: false, message: "DISTRIBUTION_COMPLETED_PAYLOAD_REQUIRED" };
  }
  if (!isNonEmptyString(payload.authorization_event_id)) {
    return { ok: false, message: "DISTRIBUTION_AUTHORIZATION_EVENT_ID_REQUIRED" };
  }
  if (
    payload.authorization_source !== LeadDistributionAuthorizationSource.HUMAN_APPROVAL &&
    payload.authorization_source !== LeadDistributionAuthorizationSource.POLICY_AUTO_AUTHORIZATION
  ) {
    return { ok: false, message: "DISTRIBUTION_AUTHORIZATION_SOURCE_INVALID" };
  }
  if (!isNonEmptyString(payload.recommendation_event_id)) {
    return { ok: false, message: "DISTRIBUTION_RECOMMENDATION_EVENT_ID_REQUIRED" };
  }

  if (!isIntegerInRange(payload.authorized_vendor_count, 1, MAX_DISTRIBUTION_VENDORS)) {
    return { ok: false, message: "DISTRIBUTION_AUTHORIZED_COUNT_INVALID" };
  }
  const authorizedCount = payload.authorized_vendor_count;
  const authorized = normalizeVendorIdList(payload.authorized_vendor_ids, "DISTRIBUTION_AUTHORIZED_IDS_REQUIRED");
  if (!authorized.ok) return authorized;
  if (authorized.value.length !== authorizedCount) {
    return { ok: false, message: "DISTRIBUTION_AUTHORIZED_IDS_COUNT_MISMATCH" };
  }

  if (!isIntegerInRange(payload.distributed_vendor_count, 1, MAX_DISTRIBUTION_VENDORS)) {
    return { ok: false, message: "DISTRIBUTION_DISTRIBUTED_COUNT_INVALID" };
  }
  const distributedCount = payload.distributed_vendor_count;
  const distributed = normalizeVendorIdList(payload.distributed_vendor_ids, "DISTRIBUTION_DISTRIBUTED_IDS_REQUIRED");
  if (!distributed.ok) return distributed;
  if (distributed.value.length !== distributedCount) {
    return { ok: false, message: "DISTRIBUTION_DISTRIBUTED_IDS_COUNT_MISMATCH" };
  }

  if (payload.skipped_vendor_ids === undefined || payload.skipped_vendor_ids === null) {
    return { ok: false, message: "DISTRIBUTION_SKIPPED_IDS_REQUIRED" };
  }
  const skipped = normalizeVendorIdList(payload.skipped_vendor_ids, "DISTRIBUTION_SKIPPED_IDS_REQUIRED");
  if (!skipped.ok) return skipped;

  const distSubset = isApprovedSubsetPreservingOrder(authorized.value, distributed.value);
  if (!distSubset.ok) {
    return { ok: false, message: distSubset.message === "DISTRIBUTION_APPROVED_ORDER_NOT_PRESERVED" ? "DISTRIBUTION_DISTRIBUTED_ORDER_NOT_PRESERVED" : "DISTRIBUTION_DISTRIBUTED_NOT_AUTHORIZED_SUBSET" };
  }
  const skipSubset = isApprovedSubsetPreservingOrder(authorized.value, skipped.value);
  if (!skipSubset.ok) {
    return { ok: false, message: skipSubset.message === "DISTRIBUTION_APPROVED_ORDER_NOT_PRESERVED" ? "DISTRIBUTION_SKIPPED_ORDER_NOT_PRESERVED" : "DISTRIBUTION_SKIPPED_NOT_AUTHORIZED_SUBSET" };
  }

  const distSet = new Set(distributed.value);
  for (const id of skipped.value) {
    if (distSet.has(id)) {
      return { ok: false, message: "DISTRIBUTION_DISTRIBUTED_SKIPPED_NOT_DISJOINT" };
    }
  }
  if (distributed.value.length + skipped.value.length !== authorized.value.length) {
    return { ok: false, message: "DISTRIBUTION_PARTITION_INCOMPLETE" };
  }

  return {
    ok: true,
    value: {
      authorizationEventId: payload.authorization_event_id.trim(),
      authorizationSource: payload.authorization_source,
      recommendationEventId: payload.recommendation_event_id.trim(),
      authorizedVendorCount: authorizedCount,
      authorizedVendorIds: authorized.value,
      distributedVendorCount: distributedCount,
      distributedVendorIds: distributed.value,
      skippedVendorIds: skipped.value,
    },
  };
}

/**
 * Accepts BOTH the neutral completed authorization payload AND the legacy human
 * completed payload (approval_event_id / approved_*), normalizing legacy into the
 * neutral contract with authorizationSource = human_approval. Used by the handler
 * so historical human completion events remain valid.
 */
export function validateDistributionCompletedAuthorization(
  payload: JsonRecord,
): DistributionValidationResult<DistributionAuthorizationCompletedContract> {
  if (!isPlainObject(payload)) {
    return { ok: false, message: "DISTRIBUTION_COMPLETED_PAYLOAD_REQUIRED" };
  }
  const isNeutral =
    "authorization_event_id" in payload ||
    "authorization_source" in payload ||
    "authorized_vendor_ids" in payload ||
    "authorized_vendor_count" in payload;

  if (isNeutral) {
    return validateDistributionAuthorizationCompleted(payload);
  }

  // Legacy human completed payload → normalize (behavior identical to the legacy
  // validator; only the field names change to the neutral contract).
  const legacy = validateDistributionCompleted(payload);
  if (!legacy.ok) return legacy;
  return {
    ok: true,
    value: {
      authorizationEventId: legacy.value.approvalEventId,
      authorizationSource: LeadDistributionAuthorizationSource.HUMAN_APPROVAL,
      recommendationEventId: legacy.value.recommendationEventId,
      authorizedVendorCount: legacy.value.approvedVendorCount,
      authorizedVendorIds: legacy.value.approvedVendorIds,
      distributedVendorCount: legacy.value.distributedVendorCount,
      distributedVendorIds: legacy.value.distributedVendorIds,
      skippedVendorIds: legacy.value.skippedVendorIds,
    },
  };
}
