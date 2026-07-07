import type { WorkflowTaskRecord } from "../../../workflow/workflowPersistenceTypes";
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
import { resolveLeadDistributionRoute } from "../distribution/leadDistributionRouteGuard";
import { validateDistributionApprovalRequired } from "../distribution/leadDistributionValidation";
import type {
  LeadDistributionRecommendationEventPort,
  LeadDistributionRoutingPort,
} from "../distribution/leadDistributionTypes";
import type { LeadLifecycleTaskExecutionResult } from "./leadLifecycleTaskExecutionTypes";

/**
 * Phase 3A distribution ports required ONLY by the prepare_approval task. They
 * are optional so existing Phase 2B call sites/tests remain unaffected; the
 * prepare_approval case fails loudly if they are missing.
 */
export interface LeadLifecycleDistributionPorts {
  recommendationEventPort: LeadDistributionRecommendationEventPort;
  routingPort: LeadDistributionRoutingPort;
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

    case LeadLifecycleTaskIntent.DISTRIBUTION_PREPARE:
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
