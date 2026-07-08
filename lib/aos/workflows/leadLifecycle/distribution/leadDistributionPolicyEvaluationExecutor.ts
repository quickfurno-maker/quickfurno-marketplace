import type { LeadQualityScoreResult } from "../../../../../services/leadQualityService";
import type {
  DomainEventRecord,
  JsonRecord,
} from "../../../workflow/workflowPersistenceTypes";
import {
  AutomationPolicyKey,
  DistributionAuthorizationDecision,
  evaluateDistributionAuthorizationPolicySafely,
  PolicyDecisionReason,
  type LeadDistributionAuthorizationFacts,
  type LeadDistributionRouteValue,
  type PolicyDecisionResult,
} from "../../../policy";
import type { LoadedAutomationPolicyConfigSnapshot } from "../../../policy/runtime/policyConfigStoreTypes";
import { LeadLifecycleEventType } from "../leadLifecycleEvents";
import {
  LEAD_ENTITY_TYPE,
  LEAD_LIFECYCLE_WORKFLOW_TYPE,
  LeadLifecycleState,
} from "../leadLifecycleStates";
import { LeadLifecycleTaskIntent } from "../leadLifecycleTaskIntents";
import {
  buildLeadLifecycleResultEventIdempotencyKey,
  type LeadLifecycleEventPublisher,
} from "../events/leadLifecycleEventPublisher";
import type { LeadLifecycleLatestQualityPort } from "../adapters/leadLifecycleServicePorts";
import type { LeadLifecycleTaskExecutionResult } from "../execution/leadLifecycleTaskExecutionTypes";
import { resolveLeadDistributionRecommendation } from "./leadDistributionRecommendationResolver";
import { resolveLeadDistributionRoute } from "./leadDistributionRouteGuard";
import { validateDistributionApprovalRequired } from "./leadDistributionValidation";
import { validateDistributionAutoAuthorized } from "./leadDistributionAutoAuthorizationValidation";
import {
  pickPolicyAuditFields,
  validatePolicyDecisionAuditContract,
} from "./leadDistributionPolicyAudit";
import {
  LeadDistributionAuthorizationSource,
  type LeadDistributionRecommendationEventPort,
  type LeadDistributionRecommendationSnapshot,
  type LeadDistributionRoutingPort,
} from "./leadDistributionTypes";

/**
 * QuickFurno Lead Lifecycle — policy-evaluation task executor (Phase 4B-2).
 *
 * Integrates the Phase 4A deterministic policy engine into the durable lead
 * lifecycle. On entering MATCH_RECOMMENDATION_READY the lifecycle opens a
 * DISTRIBUTION_POLICY_EVALUATE task; this module executes it. It:
 *
 *   1. pre-reads any durable result event already stored for this task (retry
 *      stability) and reuses it without re-evaluating,
 *   2. resolves the EXACT immutable recommendation snapshot from the triggering
 *      lead.matching.completed event (never reruns matching / reranks),
 *   3. defers a non-standard route with no event (special routes stay isolated),
 *   4. reads the LATEST authoritative persisted quality result (never rescoring),
 *   5. loads the durable policy config snapshot (safe default when no active
 *      pointer; throws on DB / integrity failure — fail closed),
 *   6. builds PII-free policy facts and evaluates the existing Phase 4A policy,
 *   7. verifies the decision is bound to the loaded config (key/version/fingerprint),
 *   8. maps the decision to at most one lifecycle event with a validated PII-free
 *      policy audit.
 *
 * It NEVER assigns vendors, deducts credits, performs credit math, reruns
 * matching, reranks, selects a different subset, appends vendors, sends WhatsApp,
 * calls n8n, or executes an outbox provider.
 */

export interface LeadLifecyclePolicyConfigPort {
  loadSnapshot(policyKey: string): Promise<LoadedAutomationPolicyConfigSnapshot>;
}

export interface LeadLifecycleResultEventReaderPort {
  findResultEventByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<DomainEventRecord | null>;
}

export interface LeadDistributionPolicyEvaluationDeps {
  latestQualityPort: LeadLifecycleLatestQualityPort;
  recommendationEventPort: LeadDistributionRecommendationEventPort;
  routingPort: LeadDistributionRoutingPort;
  policyConfigPort: LeadLifecyclePolicyConfigPort;
  resultEventPublisher: LeadLifecycleEventPublisher;
  /**
   * MANDATORY (Correction 1). Retry-stable result-event pre-read is always
   * executed before any authoritative read; the policy task may never silently
   * skip it. The shared distribution-port interface keeps it optional for
   * historical non-policy tasks, but the DISTRIBUTION_POLICY_EVALUATE branch
   * requires it and fails loudly if it is missing.
   */
  resultEventReader: LeadLifecycleResultEventReaderPort;
}

export interface LeadDistributionPolicyEvaluationParams {
  taskId: string;
  leadId: string;
  workflowInstanceId: string;
  triggeredByEvent: string | null;
}

// ---------------------------------------------------------------------------
// PART 3 — exact PII-free policy facts
// ---------------------------------------------------------------------------

/**
 * Build the immutable, PII-FREE authorization facts from authoritative inputs.
 * Consumes ONLY the four authoritative quality fields; no client PII is read.
 */
export function buildLeadDistributionAuthorizationFacts(input: {
  workflowInstanceId: string;
  leadId: string;
  routeClassification: LeadDistributionRouteValue;
  quality: LeadQualityScoreResult;
  recommendation: LeadDistributionRecommendationSnapshot;
}): LeadDistributionAuthorizationFacts {
  return {
    policyKey: AutomationPolicyKey.LEAD_DISTRIBUTION_AUTHORIZATION,
    workflowType: LEAD_LIFECYCLE_WORKFLOW_TYPE,
    workflowInstanceId: input.workflowInstanceId,
    leadId: input.leadId,
    currentLifecycleState: LeadLifecycleState.MATCH_RECOMMENDATION_READY,
    routeClassification: input.routeClassification,
    quality: {
      scoreClass: input.quality.score_class,
      totalScore: input.quality.total_score,
      hardBlockReason: input.quality.hard_block_reason,
      recommendedAction: input.quality.recommended_action,
    },
    recommendation: {
      recommendationEventId: input.recommendation.recommendationEventId,
      recommendedVendorCount: input.recommendation.recommendedVendorCount,
      recommendedVendorIds: [...input.recommendation.recommendedVendorIds],
    },
  };
}

// ---------------------------------------------------------------------------
// PART 5 — reusable deterministic policy audit payload builder
// ---------------------------------------------------------------------------

/**
 * Convert a PolicyDecisionResult + the loaded config snapshot into the Phase 4B-1
 * policy audit contract fields. Deterministic and PII-free: no timestamp, attempt,
 * worker id, hostname, or random id.
 */
export function buildPolicyDecisionAuditPayload(
  decision: PolicyDecisionResult,
  snapshot: LoadedAutomationPolicyConfigSnapshot,
): JsonRecord {
  return {
    policy_key: decision.policyKey,
    policy_version: decision.policyVersion,
    policy_fingerprint: decision.policyFingerprint,
    policy_decision: decision.decision,
    policy_reason_code: decision.reasonCode,
    policy_config_id: snapshot.configId,
    policy_config_source: snapshot.source,
    policy_facts_summary: { ...decision.evaluatedFactsSummary },
    policy_passed_gates: [...decision.passedGates],
    policy_failed_gates: [...decision.failedGates],
  };
}

/** Fail loudly if a decision is not bound to the config that produced it. */
function assertDecisionBoundToConfig(
  decision: PolicyDecisionResult,
  snapshot: LoadedAutomationPolicyConfigSnapshot,
): void {
  if (decision.policyKey !== snapshot.policyKey) {
    throw new Error("POLICY_DECISION_CONFIG_KEY_MISMATCH");
  }
  if (decision.policyVersion !== snapshot.policyVersion) {
    throw new Error("POLICY_DECISION_CONFIG_VERSION_MISMATCH");
  }
  if (decision.policyFingerprint !== snapshot.fingerprint) {
    throw new Error("POLICY_DECISION_CONFIG_FINGERPRINT_MISMATCH");
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function executeLeadDistributionPolicyEvaluationTask(
  params: LeadDistributionPolicyEvaluationParams,
  deps: LeadDistributionPolicyEvaluationDeps,
): Promise<LeadLifecycleTaskExecutionResult> {
  if (!params.triggeredByEvent) {
    throw new Error("RECOMMENDATION_EVENT_ID_REQUIRED");
  }
  const triggeredByEvent = params.triggeredByEvent;

  // Correction 1 — the result-event pre-read is MANDATORY and runs FIRST, before
  // any authoritative read (recommendation, route, quality, config), any policy
  // evaluation, and any event publication. A missing reader fails loudly here.
  if (!deps.resultEventReader) {
    throw new Error("DISTRIBUTION_POLICY_RESULT_EVENT_READER_REQUIRED");
  }
  const resultKey = buildLeadLifecycleResultEventIdempotencyKey(params.taskId);
  const existing = await deps.resultEventReader.findResultEventByIdempotencyKey(resultKey);
  if (existing) {
    // Reuse WITHOUT reloading config, re-reading quality, re-resolving the
    // recommendation, re-evaluating the policy, or republishing.
    return reuseExistingPolicyResultEvent(existing, params, triggeredByEvent);
  }

  // (2) Exact recommendation snapshot from the triggering matching event.
  const resolved = await resolveLeadDistributionRecommendation(
    {
      recommendationEventId: triggeredByEvent,
      expectedWorkflowInstanceId: params.workflowInstanceId,
      expectedLeadId: params.leadId,
    },
    deps.recommendationEventPort,
  );
  if (!resolved.ok) throw new Error(resolved.message);
  const recommendation = resolved.value;

  // (3) Route ownership. A non-standard route is deferred with NO event and NO
  // side effect; it never depends on policy config / quality availability.
  const route = await resolveLeadDistributionRoute(params.leadId, deps.routingPort);
  if (!route.isStandardRoute) {
    return deferredSpecialRouteResult(params, route.classification, recommendation);
  }

  // (4) Latest authoritative persisted quality (NEVER rescored here).
  const quality = await deps.latestQualityPort.readLatestQualityResult(params.leadId);

  // (5) Durable policy config snapshot. The loader returns the safe default when
  // no active pointer exists and THROWS on DB / integrity failure (fail closed —
  // never auto-authorizes on a config read/integrity error).
  const snapshot = await deps.policyConfigPort.loadSnapshot(
    AutomationPolicyKey.LEAD_DISTRIBUTION_AUTHORIZATION,
  );

  // (6) PII-free facts + Phase 4A deterministic policy evaluation.
  const facts = buildLeadDistributionAuthorizationFacts({
    workflowInstanceId: params.workflowInstanceId,
    leadId: params.leadId,
    routeClassification: route.classification,
    quality,
    recommendation,
  });
  const decision = evaluateDistributionAuthorizationPolicySafely(facts, snapshot.config);

  // (7) Bind the decision to the exact config that produced it.
  assertDecisionBoundToConfig(decision, snapshot);

  // Deterministic PII-free audit, validated before any publish.
  const auditPayload = buildPolicyDecisionAuditPayload(decision, snapshot);
  const auditValidated = validatePolicyDecisionAuditContract(auditPayload);
  if (!auditValidated.ok) {
    throw new Error(`POLICY_DECISION_AUDIT_INVALID:${auditValidated.message}`);
  }

  // (8) Decision mapping.
  switch (decision.decision) {
    case DistributionAuthorizationDecision.REQUIRE_HUMAN_APPROVAL:
      return publishApprovalRequired(params, triggeredByEvent, recommendation, decision, auditPayload, deps);
    case DistributionAuthorizationDecision.AUTO_AUTHORIZE:
      return publishAutoAuthorized(params, triggeredByEvent, recommendation, decision, auditPayload, deps);
    case DistributionAuthorizationDecision.MANUAL_REVIEW:
      return publishManualReview(params, triggeredByEvent, recommendation, decision, auditPayload, deps);
    case DistributionAuthorizationDecision.DEFER_SPECIAL_ROUTE:
      // Unreachable: a standard route can never evaluate to defer. Fail loudly
      // rather than silently stalling a standard-route lead.
      throw new Error("POLICY_DEFER_UNEXPECTED_FOR_STANDARD_ROUTE");
    default: {
      const exhaustive: never = decision.decision;
      throw new Error(`POLICY_DECISION_UNHANDLED:${String(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// PART 6 — decision mapping publishers
// ---------------------------------------------------------------------------

async function publishApprovalRequired(
  params: LeadDistributionPolicyEvaluationParams,
  triggeredByEvent: string,
  recommendation: LeadDistributionRecommendationSnapshot,
  decision: PolicyDecisionResult,
  auditPayload: JsonRecord,
  deps: LeadDistributionPolicyEvaluationDeps,
): Promise<LeadLifecycleTaskExecutionResult> {
  const payload: JsonRecord = {
    recommendation_event_id: recommendation.recommendationEventId,
    recommended_vendor_count: recommendation.recommendedVendorCount,
    recommended_vendor_ids: [...recommendation.recommendedVendorIds],
    ...auditPayload,
  };
  const validated = validateDistributionApprovalRequired(payload);
  if (!validated.ok) throw new Error(validated.message);

  const event = await deps.resultEventPublisher.publish({
    workflowTaskId: params.taskId,
    leadId: params.leadId,
    eventType: LeadLifecycleEventType.DISTRIBUTION_APPROVAL_REQUIRED,
    payload,
    correlationId: params.workflowInstanceId,
    causationId: triggeredByEvent,
  });

  return completedPolicyResult(params, {
    published_event_id: event.id,
    published_event_type: event.event_type,
    policy_decision: decision.decision,
    policy_reason_code: decision.reasonCode,
    recommendation_event_id: recommendation.recommendationEventId,
    recommended_vendor_count: recommendation.recommendedVendorCount,
    approval_required_published: true,
    auto_authorized_published: false,
    manual_review_event_published: false,
    assignment_executed: false,
    credit_mutation_executed: false,
    matching_reran: false,
    policy_result_reused: false,
  });
}

async function publishAutoAuthorized(
  params: LeadDistributionPolicyEvaluationParams,
  triggeredByEvent: string,
  recommendation: LeadDistributionRecommendationSnapshot,
  decision: PolicyDecisionResult,
  auditPayload: JsonRecord,
  deps: LeadDistributionPolicyEvaluationDeps,
): Promise<LeadLifecycleTaskExecutionResult> {
  // authorized_vendor_ids MUST exactly equal recommended_vendor_ids (same count,
  // same order). No subset, reorder, replacement, truncation, or extra vendor.
  const payload: JsonRecord = {
    workflow_type: LEAD_LIFECYCLE_WORKFLOW_TYPE,
    lead_id: params.leadId,
    recommendation_event_id: recommendation.recommendationEventId,
    recommended_vendor_count: recommendation.recommendedVendorCount,
    recommended_vendor_ids: [...recommendation.recommendedVendorIds],
    authorized_vendor_count: recommendation.recommendedVendorCount,
    authorized_vendor_ids: [...recommendation.recommendedVendorIds],
    authorization_source: LeadDistributionAuthorizationSource.POLICY_AUTO_AUTHORIZATION,
    ...auditPayload,
  };
  // Strict Phase 4B-1 validator (also rejects a safe-default source, an empty
  // config id, non-empty failed gates, or authorized != recommended).
  const validated = validateDistributionAutoAuthorized(payload);
  if (!validated.ok) throw new Error(`AUTO_AUTHORIZED_INVALID:${validated.message}`);

  const event = await deps.resultEventPublisher.publish({
    workflowTaskId: params.taskId,
    leadId: params.leadId,
    eventType: LeadLifecycleEventType.DISTRIBUTION_AUTO_AUTHORIZED,
    payload,
    correlationId: params.workflowInstanceId,
    causationId: triggeredByEvent,
  });

  return completedPolicyResult(params, {
    published_event_id: event.id,
    published_event_type: event.event_type,
    policy_decision: decision.decision,
    policy_reason_code: decision.reasonCode,
    recommendation_event_id: recommendation.recommendationEventId,
    authorized_vendor_count: recommendation.recommendedVendorCount,
    authorized_vendor_ids: [...recommendation.recommendedVendorIds],
    authorization_source: LeadDistributionAuthorizationSource.POLICY_AUTO_AUTHORIZATION,
    approval_required_published: false,
    auto_authorized_published: true,
    manual_review_event_published: false,
    assignment_executed: false,
    credit_mutation_executed: false,
    matching_reran: false,
    policy_result_reused: false,
  });
}

async function publishManualReview(
  params: LeadDistributionPolicyEvaluationParams,
  triggeredByEvent: string,
  recommendation: LeadDistributionRecommendationSnapshot,
  decision: PolicyDecisionResult,
  auditPayload: JsonRecord,
  deps: LeadDistributionPolicyEvaluationDeps,
): Promise<LeadLifecycleTaskExecutionResult> {
  // The manual-review reason is deterministic and derived from the policy reason.
  const payload: JsonRecord = {
    reason: decision.reasonCode,
    recommendation_event_id: recommendation.recommendationEventId,
    ...auditPayload,
  };
  const event = await deps.resultEventPublisher.publish({
    workflowTaskId: params.taskId,
    leadId: params.leadId,
    eventType: LeadLifecycleEventType.MANUAL_REVIEW_REQUIRED,
    payload,
    correlationId: params.workflowInstanceId,
    causationId: triggeredByEvent,
  });

  return completedPolicyResult(params, {
    published_event_id: event.id,
    published_event_type: event.event_type,
    policy_decision: decision.decision,
    policy_reason_code: decision.reasonCode,
    manual_review_reason: decision.reasonCode,
    recommendation_event_id: recommendation.recommendationEventId,
    approval_required_published: false,
    auto_authorized_published: false,
    manual_review_event_published: true,
    assignment_executed: false,
    credit_mutation_executed: false,
    matching_reran: false,
    policy_result_reused: false,
  });
}

// ---------------------------------------------------------------------------
// PART 6.D — special-route defer (no event, PII-free decision metadata)
// ---------------------------------------------------------------------------

function deferredSpecialRouteResult(
  params: LeadDistributionPolicyEvaluationParams,
  routeClassification: LeadDistributionRouteValue,
  recommendation: LeadDistributionRecommendationSnapshot,
): LeadLifecycleTaskExecutionResult {
  return {
    status: "deferred_special_route",
    task_type: LeadLifecycleTaskIntent.DISTRIBUTION_POLICY_EVALUATE,
    lead_id: params.leadId,
    workflow_instance_id: params.workflowInstanceId,
    result: {
      workflow_type: LEAD_LIFECYCLE_WORKFLOW_TYPE,
      lead_id: params.leadId,
      workflow_instance_id: params.workflowInstanceId,
      policy_decision: DistributionAuthorizationDecision.DEFER_SPECIAL_ROUTE,
      policy_reason_code: PolicyDecisionReason.SPECIAL_ROUTE_OWNED_ELSEWHERE,
      route_classification: routeClassification,
      recommendation_event_id: recommendation.recommendationEventId,
      deferred_reason: "special_route_owned_by_existing_services",
      approval_required_published: false,
      auto_authorized_published: false,
      manual_review_event_published: false,
      assignment_executed: false,
      credit_mutation_executed: false,
      delivery_executed: false,
    },
  };
}

// ---------------------------------------------------------------------------
// PART 7 — replay validation + reuse
// ---------------------------------------------------------------------------

const ALLOWED_POLICY_RESULT_EVENT_TYPES = new Set<string>([
  LeadLifecycleEventType.DISTRIBUTION_APPROVAL_REQUIRED,
  LeadLifecycleEventType.DISTRIBUTION_AUTO_AUTHORIZED,
  LeadLifecycleEventType.MANUAL_REVIEW_REQUIRED,
]);

function replayError(detail: string): Error {
  return new Error(`POLICY_RESULT_REPLAY_INTEGRITY_ERROR:${detail}`);
}

function reuseExistingPolicyResultEvent(
  existing: DomainEventRecord,
  params: LeadDistributionPolicyEvaluationParams,
  triggeredByEvent: string,
): LeadLifecycleTaskExecutionResult {
  if (!ALLOWED_POLICY_RESULT_EVENT_TYPES.has(existing.event_type)) {
    throw replayError(`EVENT_TYPE:${existing.event_type}`);
  }
  if (existing.entity_type !== LEAD_ENTITY_TYPE) throw replayError("ENTITY_TYPE");
  if (existing.entity_id !== params.leadId) throw replayError("LEAD");
  if (existing.correlation_id !== params.workflowInstanceId) throw replayError("WORKFLOW");
  if (existing.causation_id !== triggeredByEvent) throw replayError("CAUSATION");

  const payload = isPlainObject(existing.payload_json) ? existing.payload_json : null;
  if (!payload) throw replayError("PAYLOAD_MISSING");
  if (payload.lead_id !== params.leadId) throw replayError("PAYLOAD_LEAD");
  // Recommendation/causation binding: the stored recommendation event id must
  // equal the triggering matching event (== causation id).
  if (payload.recommendation_event_id !== triggeredByEvent) {
    throw replayError("RECOMMENDATION_BINDING");
  }

  if (existing.event_type === LeadLifecycleEventType.DISTRIBUTION_APPROVAL_REQUIRED) {
    const contract = validateDistributionApprovalRequired(payload);
    if (!contract.ok) throw replayError(`APPROVAL_PAYLOAD:${contract.message}`);
    const audit = validatePolicyDecisionAuditContract(pickPolicyAuditFields(payload));
    if (!audit.ok) throw replayError(`APPROVAL_AUDIT:${audit.message}`);
    if (audit.value.policy_decision !== DistributionAuthorizationDecision.REQUIRE_HUMAN_APPROVAL) {
      throw replayError("APPROVAL_DECISION");
    }
    return reusedPolicyResult(existing, params, DistributionAuthorizationDecision.REQUIRE_HUMAN_APPROVAL);
  }

  if (existing.event_type === LeadLifecycleEventType.DISTRIBUTION_AUTO_AUTHORIZED) {
    const contract = validateDistributionAutoAuthorized(payload);
    if (!contract.ok) throw replayError(`AUTO_PAYLOAD:${contract.message}`);
    return reusedPolicyResult(existing, params, DistributionAuthorizationDecision.AUTO_AUTHORIZE);
  }

  // MANUAL_REVIEW_REQUIRED
  const audit = validatePolicyDecisionAuditContract(pickPolicyAuditFields(payload));
  if (!audit.ok) throw replayError(`MANUAL_AUDIT:${audit.message}`);
  if (audit.value.policy_decision !== DistributionAuthorizationDecision.MANUAL_REVIEW) {
    throw replayError("MANUAL_DECISION");
  }
  if (!isNonEmptyString(payload.reason)) throw replayError("MANUAL_REASON");
  // Correction 3 — the durable manual-review reason must be exactly the
  // deterministic reason the policy decision produced (its audit reason code).
  if (payload.reason !== audit.value.policy_reason_code) {
    throw replayError("MANUAL_REASON_MISMATCH");
  }
  return reusedPolicyResult(existing, params, DistributionAuthorizationDecision.MANUAL_REVIEW);
}

function reusedPolicyResult(
  existing: DomainEventRecord,
  params: LeadDistributionPolicyEvaluationParams,
  decision: string,
): LeadLifecycleTaskExecutionResult {
  return completedPolicyResult(params, {
    published_event_id: existing.id,
    published_event_type: existing.event_type,
    policy_decision: decision,
    policy_result_reused: true,
    config_reloaded: false,
    quality_reread: false,
    policy_reevaluated: false,
    republished: false,
    assignment_executed: false,
    credit_mutation_executed: false,
    matching_reran: false,
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function completedPolicyResult(
  params: LeadDistributionPolicyEvaluationParams,
  result: JsonRecord,
): LeadLifecycleTaskExecutionResult {
  return {
    status: "completed",
    task_type: LeadLifecycleTaskIntent.DISTRIBUTION_POLICY_EVALUATE,
    lead_id: params.leadId,
    workflow_instance_id: params.workflowInstanceId,
    result: {
      ...result,
      workflow_type: LEAD_LIFECYCLE_WORKFLOW_TYPE,
      lead_id: params.leadId,
      workflow_instance_id: params.workflowInstanceId,
    },
  };
}

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
