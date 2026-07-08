import type { JsonRecord, WorkflowTaskRecord } from "../../../workflow/workflowPersistenceTypes";
import type { LeadLifecycleServicePorts } from "../adapters/leadLifecycleServicePorts";
import { LeadLifecycleEventType } from "../leadLifecycleEvents";
import { LEAD_LIFECYCLE_WORKFLOW_TYPE } from "../leadLifecycleStates";
import {
  LeadLifecycleTaskIntent,
  type LeadLifecycleTaskIntentValue,
} from "../leadLifecycleTaskIntents";
import type { LeadLifecycleEventPublisher } from "../events/leadLifecycleEventPublisher";
import {
  assertNoManualReviewResolution,
  mapQualityResultToLifecycleEvent,
} from "../events/leadLifecycleResultMapper";
import { resolveLeadDistributionRecommendation } from "../distribution/leadDistributionRecommendationResolver";
import { resolveLeadDistributionAuthorizationSnapshot } from "../distribution/leadDistributionAuthorizationSnapshotResolver";
import { resolveLeadDistributionRoute } from "../distribution/leadDistributionRouteGuard";
import {
  validateDistributionApprovalRequired,
  validateDistributionAuthorizationCompleted,
  validateDistributionCompleted,
} from "../distribution/leadDistributionValidation";
import { mapAssignmentResultToOutcome } from "../distribution/leadDistributionAssignmentResultMapper";
import { DistributionAssignmentManualReviewReason } from "../distribution/leadDistributionAssignmentTypes";
import type { LeadDistributionAssignmentPort } from "../distribution/leadDistributionAssignmentTypes";
import {
  LeadDistributionAuthorizationSource,
  type LeadDistributionAuthorizationSnapshot,
  type LeadDistributionRecommendationEventPort,
  type LeadDistributionRoutingPort,
} from "../distribution/leadDistributionTypes";
import {
  executeLeadDistributionPolicyEvaluationTask,
  type LeadLifecyclePolicyConfigPort,
  type LeadLifecycleResultEventReaderPort,
} from "../distribution/leadDistributionPolicyEvaluationExecutor";
import type { LeadLifecycleTaskExecutionResult } from "./leadLifecycleTaskExecutionTypes";

/**
 * Distribution ports for the prepare_approval (Phase 3A) and prepare (Phase 3B)
 * tasks. Optional so existing Phase 2B call sites/tests are unaffected; each task
 * fails loudly if a port it needs is missing. `recommendationEventPort` is a
 * generic "get durable domain event by id" port reused to load both the matching
 * event (3A) and the approved event (3B).
 */
export interface LeadLifecycleDistributionPorts {
  recommendationEventPort: LeadDistributionRecommendationEventPort;
  routingPort: LeadDistributionRoutingPort;
  /** Phase 3B: the standard-route credit-safe assignment boundary. */
  assignmentExecution?: LeadDistributionAssignmentPort;
  /** Phase 4B-2: durable policy config snapshot loader for the policy task. */
  policyConfig?: LeadLifecyclePolicyConfigPort;
  /** Phase 4B-2: optional retry-stable result-event pre-read for the policy task. */
  resultEventReader?: LeadLifecycleResultEventReaderPort;
}

export interface LeadLifecycleTaskExecutorDeps {
  ports: LeadLifecycleServicePorts;
  resultEventPublisher: LeadLifecycleEventPublisher;
  distribution?: LeadLifecycleDistributionPorts;
}

const ENABLED_TASKS = new Set<string>([
  LeadLifecycleTaskIntent.QUALITY_SCORE,
  LeadLifecycleTaskIntent.CLARIFICATION_PREPARE,
  LeadLifecycleTaskIntent.QUALITY_RESCORE,
  LeadLifecycleTaskIntent.MATCHING_PREPARE,
  LeadLifecycleTaskIntent.DISTRIBUTION_POLICY_EVALUATE,
  LeadLifecycleTaskIntent.DISTRIBUTION_PREPARE_APPROVAL,
  LeadLifecycleTaskIntent.DISTRIBUTION_AWAIT_APPROVAL,
  LeadLifecycleTaskIntent.DISTRIBUTION_PREPARE,
  LeadLifecycleTaskIntent.NURTURE_PREPARE,
  LeadLifecycleTaskIntent.MANUAL_REVIEW_PREPARE,
]);

export async function executeLeadLifecycleTask(
  task: WorkflowTaskRecord,
  deps: LeadLifecycleTaskExecutorDeps,
): Promise<LeadLifecycleTaskExecutionResult> {
  const taskType = validateTaskType(task.task_type);
  const context = validateTaskContext(task);

  switch (taskType) {
    case LeadLifecycleTaskIntent.QUALITY_SCORE: {
      const score = await deps.ports.quality.scoreLead(context.leadId);
      const mapped = mapQualityResultToLifecycleEvent(score, "initial");
      assertNoManualReviewResolution(mapped);
      const event = await deps.resultEventPublisher.publish({
        workflowTaskId: task.id,
        leadId: context.leadId,
        eventType: mapped.eventType,
        payload: mapped.payload,
        correlationId: context.workflowInstanceId,
        causationId: context.triggeredByEvent,
      });
      return completed(taskType, context, {
        published_event_id: event.id,
        published_event_type: event.event_type,
        score_class: score.score_class,
        recommended_action: score.recommended_action,
      });
    }

    case LeadLifecycleTaskIntent.CLARIFICATION_PREPARE: {
      const metadata = await deps.ports.clarification.prepareClarification(context.leadId);
      return completed(taskType, context, {
        request_id: metadata.requestId,
        status: metadata.status,
        missing_fields: metadata.missingFields,
        questions_count: metadata.questionsCount,
        emitted_clarification_completed: false,
        communication_sent: false,
      });
    }

    case LeadLifecycleTaskIntent.QUALITY_RESCORE: {
      const score = await deps.ports.latestQuality.readLatestQualityResult(context.leadId);
      const mapped = mapQualityResultToLifecycleEvent(score, "rescore");
      assertNoManualReviewResolution(mapped);
      const event = await deps.resultEventPublisher.publish({
        workflowTaskId: task.id,
        leadId: context.leadId,
        eventType: mapped.eventType,
        payload: mapped.payload,
        correlationId: context.workflowInstanceId,
        causationId: context.triggeredByEvent,
      });
      return completed(taskType, context, {
        published_event_id: event.id,
        published_event_type: event.event_type,
        score_class: score.score_class,
        recommended_action: score.recommended_action,
        score_source: "latest_persisted_authoritative_score",
        recalculated_in_executor: false,
      });
    }

    case LeadLifecycleTaskIntent.MATCHING_PREPARE: {
      const recommendation = await deps.ports.matchingRecommendation.prepareRecommendations(context.leadId);
      const recommendedVendorIds = recommendation.recommendedVendorIds.slice(0, 3);
      const event = await deps.resultEventPublisher.publish({
        workflowTaskId: task.id,
        leadId: context.leadId,
        eventType: LeadLifecycleEventType.MATCHING_COMPLETED,
        payload: {
          matching: {
            source: "leadMatchingRecommendationAdapter",
            eligible_vendor_count: recommendation.eligibleVendorCount,
          },
          recommended_vendor_count: recommendedVendorIds.length,
          recommended_vendor_ids: recommendedVendorIds,
        },
        correlationId: context.workflowInstanceId,
        causationId: context.triggeredByEvent,
      });
      return completed(taskType, context, {
        published_event_id: event.id,
        published_event_type: event.event_type,
        recommended_vendor_count: recommendedVendorIds.length,
        recommended_vendor_ids: recommendedVendorIds,
        assignment_executed: false,
        delivery_executed: false,
      });
    }

    case LeadLifecycleTaskIntent.DISTRIBUTION_POLICY_EVALUATE: {
      const distribution = deps.distribution;
      if (!distribution) throw new Error("DISTRIBUTION_PORTS_REQUIRED");
      if (!distribution.policyConfig) throw new Error("DISTRIBUTION_POLICY_CONFIG_PORT_REQUIRED");
      // Correction 1 — the result-event reader is MANDATORY for the policy task.
      // Fail loudly BEFORE any authoritative read or the policy module runs.
      if (!distribution.resultEventReader) {
        throw new Error("DISTRIBUTION_POLICY_RESULT_EVENT_READER_REQUIRED");
      }
      if (!context.triggeredByEvent) throw new Error("RECOMMENDATION_EVENT_ID_REQUIRED");

      return executeLeadDistributionPolicyEvaluationTask(
        {
          taskId: task.id,
          leadId: context.leadId,
          workflowInstanceId: context.workflowInstanceId,
          triggeredByEvent: context.triggeredByEvent,
        },
        {
          latestQualityPort: deps.ports.latestQuality,
          recommendationEventPort: distribution.recommendationEventPort,
          routingPort: distribution.routingPort,
          policyConfigPort: distribution.policyConfig,
          resultEventPublisher: deps.resultEventPublisher,
          resultEventReader: distribution.resultEventReader,
        },
      );
    }

    case LeadLifecycleTaskIntent.DISTRIBUTION_PREPARE_APPROVAL: {
      const distribution = deps.distribution;
      if (!distribution) throw new Error("DISTRIBUTION_PORTS_REQUIRED");
      if (!context.triggeredByEvent) throw new Error("RECOMMENDATION_EVENT_ID_REQUIRED");

      // Resolve the immutable recommendation snapshot from the triggering
      // lead.matching.completed event (no matching rerun, no re-ranking).
      const resolved = await resolveLeadDistributionRecommendation(
        {
          recommendationEventId: context.triggeredByEvent,
          expectedWorkflowInstanceId: context.workflowInstanceId,
          expectedLeadId: context.leadId,
        },
        distribution.recommendationEventPort,
      );
      if (!resolved.ok) throw new Error(resolved.message);
      const snapshot = resolved.value;

      // Verify the standard route. Special routes are safely deferred with no
      // published event and no side effect.
      const route = await resolveLeadDistributionRoute(context.leadId, distribution.routingPort);
      if (!route.isStandardRoute) {
        return {
          status: "deferred_special_route",
          task_type: taskType,
          lead_id: context.leadId,
          workflow_instance_id: context.workflowInstanceId,
          result: {
            workflow_type: LEAD_LIFECYCLE_WORKFLOW_TYPE,
            lead_id: context.leadId,
            workflow_instance_id: context.workflowInstanceId,
            deferred_reason: "special_route_owned_by_existing_services",
            route_classification: route.classification,
            approval_event_published: false,
            manual_review_event_published: false,
            assignment_executed: false,
            credit_mutation_executed: false,
            delivery_executed: false,
          },
        };
      }

      // Zero recommendations → manual review (never approval_required).
      if (snapshot.recommendedVendorCount === 0) {
        const event = await deps.resultEventPublisher.publish({
          workflowTaskId: task.id,
          leadId: context.leadId,
          eventType: LeadLifecycleEventType.MANUAL_REVIEW_REQUIRED,
          payload: {
            reason: "no_distribution_recommendations",
            recommendation_event_id: snapshot.recommendationEventId,
          },
          correlationId: context.workflowInstanceId,
          causationId: context.triggeredByEvent,
        });
        return completed(taskType, context, {
          published_event_id: event.id,
          published_event_type: event.event_type,
          recommendation_event_id: snapshot.recommendationEventId,
          recommended_vendor_count: 0,
          manual_review_reason: "no_distribution_recommendations",
          approval_required_published: false,
          assignment_executed: false,
          credit_mutation_executed: false,
          delivery_executed: false,
        });
      }

      // 1..3 recommendations → approval_required with the bound snapshot.
      const approvalPayload = {
        recommendation_event_id: snapshot.recommendationEventId,
        recommended_vendor_count: snapshot.recommendedVendorCount,
        recommended_vendor_ids: [...snapshot.recommendedVendorIds],
      };
      // Belt-and-suspenders: never emit an invalid approval_required event.
      const validated = validateDistributionApprovalRequired(approvalPayload);
      if (!validated.ok) throw new Error(validated.message);

      const event = await deps.resultEventPublisher.publish({
        workflowTaskId: task.id,
        leadId: context.leadId,
        eventType: LeadLifecycleEventType.DISTRIBUTION_APPROVAL_REQUIRED,
        payload: approvalPayload,
        correlationId: context.workflowInstanceId,
        causationId: context.triggeredByEvent,
      });
      return completed(taskType, context, {
        published_event_id: event.id,
        published_event_type: event.event_type,
        recommendation_event_id: snapshot.recommendationEventId,
        recommended_vendor_count: snapshot.recommendedVendorCount,
        recommended_vendor_ids: [...snapshot.recommendedVendorIds],
        assignment_executed: false,
        credit_mutation_executed: false,
        delivery_executed: false,
      });
    }

    case LeadLifecycleTaskIntent.DISTRIBUTION_AWAIT_APPROVAL:
      return completed(taskType, context, {
        approval_event_fabricated: false,
        marker: "awaiting_explicit_distribution_approval",
      });

    case LeadLifecycleTaskIntent.DISTRIBUTION_PREPARE: {
      const distribution = deps.distribution;
      if (!distribution?.assignmentExecution) throw new Error("DISTRIBUTION_ASSIGNMENT_PORTS_REQUIRED");
      if (!context.triggeredByEvent) throw new Error("AUTHORIZATION_EVENT_ID_REQUIRED");

      // Phase 4B-2: resolve the neutral authorization snapshot from the triggering
      // event — lead.distribution.approved (human) OR lead.distribution.auto_authorized
      // (policy). No matching rerun, no re-ranking. The assignment boundary executes
      // ONLY snapshot.authorizedVendorIds (approved subset for human approval; the exact
      // recommendation set for policy auto-authorization).
      const resolved = await resolveLeadDistributionAuthorizationSnapshot(
        {
          authorizationEventId: context.triggeredByEvent,
          expectedWorkflowInstanceId: context.workflowInstanceId,
          expectedLeadId: context.leadId,
        },
        distribution.recommendationEventPort,
      );
      if (!resolved.ok) throw new Error(resolved.message);
      const snapshot = resolved.value;
      const isHuman = snapshot.authorizationSource === LeadDistributionAuthorizationSource.HUMAN_APPROVAL;

      // Standard route only. A route change after authorization → deterministic manual review.
      const route = await resolveLeadDistributionRoute(context.leadId, distribution.routingPort);
      if (!route.isStandardRoute) {
        const event = await deps.resultEventPublisher.publish({
          workflowTaskId: task.id,
          leadId: context.leadId,
          eventType: LeadLifecycleEventType.MANUAL_REVIEW_REQUIRED,
          payload: buildAuthorizationManualReviewPayload(
            snapshot,
            DistributionAssignmentManualReviewReason.ROUTE_CHANGED,
            route.classification,
          ),
          correlationId: context.workflowInstanceId,
          causationId: context.triggeredByEvent,
        });
        return completed(taskType, context, {
          published_event_id: event.id,
          published_event_type: event.event_type,
          manual_review_reason: DistributionAssignmentManualReviewReason.ROUTE_CHANGED,
          route_classification: route.classification,
          authorization_source: snapshot.authorizationSource,
          assignment_executed: false,
          aos_credit_math_executed: false,
          delivery_log_written: false,
          whatsapp_sent: false,
          n8n_called: false,
        });
      }

      // Execute ONLY the authorized vendor ids through the existing credit-safe boundary.
      // The port param name stays `approvedVendorIds` for Phase 3B compatibility; it carries
      // the neutral authorized set.
      const raw = await distribution.assignmentExecution.assignApprovedVendors({
        leadId: snapshot.leadId,
        approvedVendorIds: [...snapshot.authorizedVendorIds],
      });
      const outcome = mapAssignmentResultToOutcome(raw, {
        leadId: snapshot.leadId,
        approvedVendorIds: snapshot.authorizedVendorIds,
      });
      // Structural corruption of the authoritative result → fail loudly (retry/dead-letter).
      if (!outcome.ok) throw new Error(outcome.message);

      if (outcome.value.kind === "manual_review") {
        const event = await deps.resultEventPublisher.publish({
          workflowTaskId: task.id,
          leadId: context.leadId,
          eventType: LeadLifecycleEventType.MANUAL_REVIEW_REQUIRED,
          payload: buildAuthorizationManualReviewPayload(snapshot, outcome.value.reason, null),
          correlationId: context.workflowInstanceId,
          causationId: context.triggeredByEvent,
        });
        return completed(taskType, context, {
          published_event_id: event.id,
          published_event_type: event.event_type,
          manual_review_reason: outcome.value.reason,
          authorization_source: snapshot.authorizationSource,
          distributed_vendor_count: 0,
          assignment_executed: true,
          aos_credit_math_executed: false,
          delivery_log_written: false,
          whatsapp_sent: false,
          n8n_called: false,
        });
      }

      // 1..3 assigned → durable distribution.completed with the canonical partition.
      // The payload contains ONLY vendor ids/counts + durable event ids — no volatile
      // retry facts — so it is byte-identical across a fresh assignment and an
      // already_assigned replay, preserving one-task→one-result idempotency. Human
      // approvals keep the legacy completed shape (backward compatibility); policy
      // auto-authorizations use the neutral authorization shape.
      const completedPayload = buildAuthorizationCompletedPayload(snapshot, outcome.value);
      const validatedCompleted = isHuman
        ? validateDistributionCompleted(completedPayload)
        : validateDistributionAuthorizationCompleted(completedPayload);
      if (!validatedCompleted.ok) throw new Error(validatedCompleted.message);

      const event = await deps.resultEventPublisher.publish({
        workflowTaskId: task.id,
        leadId: context.leadId,
        eventType: LeadLifecycleEventType.DISTRIBUTION_COMPLETED,
        payload: completedPayload,
        correlationId: context.workflowInstanceId,
        causationId: context.triggeredByEvent,
      });
      return completed(taskType, context, {
        published_event_id: event.id,
        published_event_type: event.event_type,
        ...(isHuman
          ? { approval_event_id: snapshot.authorizationEventId }
          : {
              authorization_event_id: snapshot.authorizationEventId,
              authorization_source: snapshot.authorizationSource,
            }),
        distributed_vendor_count: outcome.value.distributedVendorIds.length,
        distributed_vendor_ids: outcome.value.distributedVendorIds,
        skipped_vendor_ids: outcome.value.skippedVendorIds,
        assignment_executed: true,
        // Credits are handled inside the boundary RPC; the AOS layer does no credit math.
        aos_credit_math_executed: false,
        // Authoritative dashboard delivery = the lead_assignments row itself. No legacy
        // delivery-log / preview insert is coupled to this retryable task.
        delivery_log_written: false,
        whatsapp_sent: false,
        n8n_called: false,
      });
    }

    case LeadLifecycleTaskIntent.NURTURE_PREPARE:
    case LeadLifecycleTaskIntent.MANUAL_REVIEW_PREPARE:
      return {
        status: "deferred_not_enabled",
        task_type: taskType,
        lead_id: context.leadId,
        workflow_instance_id: context.workflowInstanceId,
        result: {
          deferred_reason: "phase_2b_side_effects_not_enabled",
          assignment_executed: false,
          credit_mutation_executed: false,
          delivery_executed: false,
          whatsapp_sent: false,
          n8n_called: false,
          outbox_command_created: false,
          manual_review_decision_fabricated: false,
        },
      };

    default: {
      const exhaustive: never = taskType;
      throw new Error(`LEAD_LIFECYCLE_TASK_UNHANDLED:${String(exhaustive)}`);
    }
  }
}

/**
 * Build the DISTRIBUTION_COMPLETED payload for the neutral authorization snapshot.
 * Human approvals keep the legacy shape (approval_event_id / approved_*) so
 * historical Phase 3B behavior is byte-identical; policy auto-authorizations use
 * the neutral shape (authorization_event_id / authorization_source / authorized_*).
 */
function buildAuthorizationCompletedPayload(
  snapshot: LeadDistributionAuthorizationSnapshot,
  outcome: { distributedVendorIds: string[]; skippedVendorIds: string[] },
): JsonRecord {
  const distributed_vendor_count = outcome.distributedVendorIds.length;
  if (snapshot.authorizationSource === LeadDistributionAuthorizationSource.HUMAN_APPROVAL) {
    return {
      approval_event_id: snapshot.authorizationEventId,
      recommendation_event_id: snapshot.recommendationEventId,
      approved_vendor_count: snapshot.authorizedVendorCount,
      approved_vendor_ids: [...snapshot.authorizedVendorIds],
      distributed_vendor_count,
      distributed_vendor_ids: outcome.distributedVendorIds,
      skipped_vendor_ids: outcome.skippedVendorIds,
    };
  }
  return {
    authorization_event_id: snapshot.authorizationEventId,
    authorization_source: snapshot.authorizationSource,
    recommendation_event_id: snapshot.recommendationEventId,
    authorized_vendor_count: snapshot.authorizedVendorCount,
    authorized_vendor_ids: [...snapshot.authorizedVendorIds],
    distributed_vendor_count,
    distributed_vendor_ids: outcome.distributedVendorIds,
    skipped_vendor_ids: outcome.skippedVendorIds,
  };
}

/**
 * Build a manual-review payload for the neutral authorization snapshot. Human
 * approvals keep the legacy identity fields; policy auto-authorizations use the
 * neutral identity fields. `routeClassification` is included only for a
 * route-changed-after-authorization review.
 */
function buildAuthorizationManualReviewPayload(
  snapshot: LeadDistributionAuthorizationSnapshot,
  reason: string,
  routeClassification: string | null,
): JsonRecord {
  const payload: JsonRecord =
    snapshot.authorizationSource === LeadDistributionAuthorizationSource.HUMAN_APPROVAL
      ? {
          reason,
          approval_event_id: snapshot.authorizationEventId,
          recommendation_event_id: snapshot.recommendationEventId,
          approved_vendor_count: snapshot.authorizedVendorCount,
          approved_vendor_ids: [...snapshot.authorizedVendorIds],
        }
      : {
          reason,
          authorization_event_id: snapshot.authorizationEventId,
          authorization_source: snapshot.authorizationSource,
          recommendation_event_id: snapshot.recommendationEventId,
          authorized_vendor_count: snapshot.authorizedVendorCount,
          authorized_vendor_ids: [...snapshot.authorizedVendorIds],
        };
  if (routeClassification) payload.route_classification = routeClassification;
  return payload;
}

function completed(
  taskType: LeadLifecycleTaskIntentValue,
  context: ValidatedTaskContext,
  result: Record<string, unknown>,
): LeadLifecycleTaskExecutionResult {
  return {
    status: "completed",
    task_type: taskType,
    lead_id: context.leadId,
    workflow_instance_id: context.workflowInstanceId,
    result: {
      ...result,
      workflow_type: LEAD_LIFECYCLE_WORKFLOW_TYPE,
      lead_id: context.leadId,
      workflow_instance_id: context.workflowInstanceId,
    },
  };
}

function validateTaskType(taskType: string): LeadLifecycleTaskIntentValue {
  if (!ENABLED_TASKS.has(taskType)) {
    throw new Error(`LEAD_LIFECYCLE_TASK_NOT_SUPPORTED:${taskType}`);
  }
  return taskType as LeadLifecycleTaskIntentValue;
}

type ValidatedTaskContext = {
  leadId: string;
  workflowInstanceId: string;
  triggeredByEvent: string | null;
};

function validateTaskContext(task: WorkflowTaskRecord): ValidatedTaskContext {
  if (task.status !== "processing") {
    throw new Error(`WORKFLOW_TASK_STATUS_INVALID:${task.status}`);
  }
  if (!task.workflow_instance_id) {
    throw new Error("WORKFLOW_TASK_WORKFLOW_INSTANCE_ID_REQUIRED");
  }

  const payload = task.payload_json ?? {};
  const leadId = readNonEmptyText(payload.lead_id, "WORKFLOW_TASK_LEAD_ID_REQUIRED");
  const payloadWorkflowId = readNonEmptyText(
    payload.workflow_instance_id,
    "WORKFLOW_TASK_PAYLOAD_WORKFLOW_INSTANCE_ID_REQUIRED",
  );

  if (payloadWorkflowId !== task.workflow_instance_id) {
    throw new Error("WORKFLOW_TASK_WORKFLOW_INSTANCE_ID_MISMATCH");
  }

  return {
    leadId,
    workflowInstanceId: task.workflow_instance_id,
    triggeredByEvent: textOrNull(payload.triggered_by_event),
  };
}

function readNonEmptyText(value: unknown, errorCode: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(errorCode);
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
