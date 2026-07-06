import type { JsonRecord } from "../../workflow/workflowPersistenceTypes";
import type {
  WorkflowHandlerContext,
  WorkflowHandlerResult,
  WorkflowTaskRequest,
} from "../../workflow/workflowTypes";
import {
  LEAD_LIFECYCLE_TRANSITIONS,
  LeadLifecycleState,
  leadLifecycleStatusForState,
  type LeadLifecycleStateValue,
} from "./leadLifecycleStates";
import { LeadLifecycleEventType } from "./leadLifecycleEvents";
import {
  LeadLifecycleTaskIntent,
  buildLeadLifecycleTaskIdempotencyKey,
  type LeadLifecycleTaskIntentValue,
} from "./leadLifecycleTaskIntents";
import { readLeadId, validateQualityResult } from "./leadLifecycleValidation";
import type { LeadQualityResult, QualityResultOrigin } from "./leadLifecycleTypes";

/**
 * QuickFurno Lead Lifecycle — deterministic handler (Phase 2A).
 *
 * This is a PURE function of its input context. It never writes to the database,
 * never calls the Lead Quality Engine, clarification service, matching engine,
 * assignment RPC, credit ledger, WhatsApp, n8n, or any AI model. It only decides
 * the next state and declares durable task intents.
 *
 * The score, vendor ranking, and vendor assignment are all produced by the
 * existing authoritative services in later phases — never here.
 */

/**
 * Loop-safety cap for clarification. This is NOT a scoring threshold and does
 * NOT change any business quality rule — it only prevents an unbounded
 * clarification loop when an authoritative rescore keeps returning tier B.
 */
export const MAX_CLARIFICATION_CYCLES = 2;

/** Thrown for an event that is not valid in the current state. */
export class LeadLifecycleTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadLifecycleTransitionError";
  }
}

/** Which durable task intent (if any) is opened on entering a given state. */
const STATE_TASK_INTENT: Partial<Record<LeadLifecycleStateValue, LeadLifecycleTaskIntentValue>> = {
  [LeadLifecycleState.QUALITY_SCORING_PENDING]: LeadLifecycleTaskIntent.QUALITY_SCORE,
  [LeadLifecycleState.CLARIFICATION_PENDING]: LeadLifecycleTaskIntent.CLARIFICATION_PREPARE,
  [LeadLifecycleState.RESCORE_PENDING]: LeadLifecycleTaskIntent.QUALITY_RESCORE,
  [LeadLifecycleState.MATCHING_PENDING]: LeadLifecycleTaskIntent.MATCHING_PREPARE,
  [LeadLifecycleState.DISTRIBUTION_APPROVAL_PENDING]: LeadLifecycleTaskIntent.DISTRIBUTION_AWAIT_APPROVAL,
  [LeadLifecycleState.DISTRIBUTION_PENDING]: LeadLifecycleTaskIntent.DISTRIBUTION_PREPARE,
  [LeadLifecycleState.NURTURE_PENDING]: LeadLifecycleTaskIntent.NURTURE_PREPARE,
  [LeadLifecycleState.MANUAL_REVIEW_PENDING]: LeadLifecycleTaskIntent.MANUAL_REVIEW_PREPARE,
};

function assertTransitionAllowed(fromState: string, toState: LeadLifecycleStateValue): void {
  const allowed = LEAD_LIFECYCLE_TRANSITIONS[fromState];
  if (!allowed || !allowed.includes(toState)) {
    throw new LeadLifecycleTransitionError(
      `INVALID_TRANSITION:${fromState}->${toState}`,
    );
  }
}

function assertSourceState(
  actual: string,
  expected: LeadLifecycleStateValue | LeadLifecycleStateValue[],
  eventType: string,
): void {
  const expectedList = Array.isArray(expected) ? expected : [expected];
  if (!(expectedList as string[]).includes(actual)) {
    throw new LeadLifecycleTransitionError(
      `INVALID_EVENT_FOR_STATE:${eventType}@${actual}`,
    );
  }
}

/**
 * Authoritative quality routing. Consumes a validated result and returns the
 * next state — it never computes or re-thresholds a score.
 */
export function routeQualityResult(
  result: LeadQualityResult,
  origin: QualityResultOrigin,
): { nextState: LeadLifecycleStateValue; reason: string; routing: JsonRecord } {
  const baseRouting: JsonRecord = {
    tier: result.tier,
    origin,
    manual_review_required: result.manualReviewRequired,
    clarification_allowed: result.clarificationAllowed,
    clarification_cycle: result.clarificationCycle,
  };

  switch (result.tier) {
    case "A+":
    case "A":
      return {
        nextState: LeadLifecycleState.READY_FOR_MATCHING,
        reason: `Quality tier ${result.tier} routed to matching readiness.`,
        routing: baseRouting,
      };

    case "B": {
      if (origin === "initial") {
        return {
          nextState: LeadLifecycleState.CLARIFICATION_PENDING,
          reason: "Quality tier B routed to first clarification cycle.",
          routing: baseRouting,
        };
      }
      // Rescore B: only re-enter clarification when an authoritative event
      // explicitly permits another cycle AND the loop-safety cap is not hit.
      const canClarifyAgain =
        result.clarificationAllowed && result.clarificationCycle < MAX_CLARIFICATION_CYCLES;
      if (canClarifyAgain) {
        return {
          nextState: LeadLifecycleState.CLARIFICATION_PENDING,
          reason: "Quality tier B re-entered clarification under explicit authorization.",
          routing: baseRouting,
        };
      }
      return {
        nextState: LeadLifecycleState.MANUAL_REVIEW_PENDING,
        reason: "Quality tier B on rescore without further clarification authorization routed to manual review.",
        routing: { ...baseRouting, loop_safety_applied: true },
      };
    }

    case "C":
      return {
        nextState: LeadLifecycleState.NURTURE_PENDING,
        reason: "Quality tier C routed to nurture.",
        routing: baseRouting,
      };

    case "D":
      if (result.manualReviewRequired) {
        return {
          nextState: LeadLifecycleState.MANUAL_REVIEW_PENDING,
          reason: "Quality tier D with manual review flag routed to manual review.",
          routing: baseRouting,
        };
      }
      return {
        nextState: LeadLifecycleState.REJECTED,
        reason: "Quality tier D routed to rejection.",
        routing: baseRouting,
      };

    default: {
      // Unreachable given validation, but kept exhaustive and safe.
      const exhaustive: never = result.tier;
      throw new LeadLifecycleTransitionError(`QUALITY_TIER_UNHANDLED:${String(exhaustive)}`);
    }
  }
}

function buildResult(
  context: WorkflowHandlerContext,
  nextState: LeadLifecycleStateValue,
  reason: string,
  metadata: JsonRecord,
): WorkflowHandlerResult {
  assertTransitionAllowed(context.workflow.current_state, nextState);

  const tasks: WorkflowTaskRequest[] = [];
  const taskIntent = STATE_TASK_INTENT[nextState];
  if (taskIntent) {
    tasks.push({
      taskType: taskIntent,
      payload: {
        lead_id: readLeadId(context.event.payload_json),
        workflow_instance_id: context.workflow.id,
        triggered_by_event: context.event.id,
        next_state: nextState,
      },
      idempotencyKey: buildLeadLifecycleTaskIdempotencyKey(
        context.workflow.id,
        context.event.id,
        taskIntent,
      ),
      priority: 100,
      maxAttempts: 5,
    });
  }

  return {
    nextState,
    workflowStatus: leadLifecycleStatusForState(nextState),
    reason,
    metadata: {
      ...metadata,
      from_state: context.workflow.current_state,
      driver_event: context.event.event_type,
    },
    tasks,
  };
}

/**
 * The QuickFurno lead lifecycle workflow handler. Deterministic and declarative.
 */
export function leadLifecycleHandler(context: WorkflowHandlerContext): WorkflowHandlerResult {
  const state = context.workflow.current_state;
  const eventType = context.event.event_type;
  const payload = context.event.payload_json;

  switch (eventType) {
    case LeadLifecycleEventType.LIFECYCLE_STARTED: {
      assertSourceState(state, LeadLifecycleState.RECEIVED, eventType);
      return buildResult(
        context,
        LeadLifecycleState.QUALITY_SCORING_PENDING,
        "Lead lifecycle started; awaiting authoritative quality result.",
        { lead_id: readLeadId(payload) },
      );
    }

    case LeadLifecycleEventType.QUALITY_RESULTED: {
      assertSourceState(
        state,
        [LeadLifecycleState.QUALITY_SCORING_PENDING, LeadLifecycleState.RESCORE_PENDING],
        eventType,
      );
      const validation = validateQualityResult(payload);
      if (!validation.ok) {
        throw new LeadLifecycleTransitionError(validation.message);
      }
      const origin: QualityResultOrigin =
        state === LeadLifecycleState.QUALITY_SCORING_PENDING ? "initial" : "rescore";
      const routed = routeQualityResult(validation.value, origin);
      return buildResult(context, routed.nextState, routed.reason, {
        lead_id: readLeadId(payload),
        quality: routed.routing,
      });
    }

    case LeadLifecycleEventType.CLARIFICATION_COMPLETED: {
      assertSourceState(state, LeadLifecycleState.CLARIFICATION_PENDING, eventType);
      return buildResult(
        context,
        LeadLifecycleState.RESCORE_PENDING,
        "Clarification completed; awaiting authoritative rescore result.",
        { lead_id: readLeadId(payload) },
      );
    }

    case LeadLifecycleEventType.MATCHING_REQUESTED: {
      assertSourceState(state, LeadLifecycleState.READY_FOR_MATCHING, eventType);
      return buildResult(
        context,
        LeadLifecycleState.MATCHING_PENDING,
        "Matching requested; awaiting authoritative match result.",
        { lead_id: readLeadId(payload) },
      );
    }

    case LeadLifecycleEventType.MATCHING_COMPLETED: {
      assertSourceState(state, LeadLifecycleState.MATCHING_PENDING, eventType);
      return buildResult(
        context,
        LeadLifecycleState.MATCH_RECOMMENDATION_READY,
        "Match recommendations ready; awaiting distribution decision.",
        { lead_id: readLeadId(payload) },
      );
    }

    case LeadLifecycleEventType.DISTRIBUTION_APPROVAL_REQUIRED: {
      assertSourceState(state, LeadLifecycleState.MATCH_RECOMMENDATION_READY, eventType);
      return buildResult(
        context,
        LeadLifecycleState.DISTRIBUTION_APPROVAL_PENDING,
        "Distribution requires explicit approval (controlled rollout).",
        { lead_id: readLeadId(payload) },
      );
    }

    case LeadLifecycleEventType.DISTRIBUTION_APPROVED: {
      assertSourceState(state, LeadLifecycleState.DISTRIBUTION_APPROVAL_PENDING, eventType);
      return buildResult(
        context,
        LeadLifecycleState.DISTRIBUTION_PENDING,
        "Distribution explicitly approved; ready to prepare distribution.",
        { lead_id: readLeadId(payload) },
      );
    }

    case LeadLifecycleEventType.DISTRIBUTION_AUTO_AUTHORIZED: {
      // Future capability: state-machine only. This does NOT activate automatic
      // distribution, assign vendors, or deduct credits — it merely models that
      // an authoritative auto-authorization event could skip manual approval.
      assertSourceState(state, LeadLifecycleState.MATCH_RECOMMENDATION_READY, eventType);
      return buildResult(
        context,
        LeadLifecycleState.DISTRIBUTION_PENDING,
        "Distribution auto-authorized (future capability; no execution in Phase 2A).",
        { lead_id: readLeadId(payload), auto_authorized: true },
      );
    }

    case LeadLifecycleEventType.DISTRIBUTION_COMPLETED: {
      assertSourceState(state, LeadLifecycleState.DISTRIBUTION_PENDING, eventType);
      return buildResult(
        context,
        LeadLifecycleState.DISTRIBUTED,
        "Distribution completed; lead delivered to matched vendors.",
        { lead_id: readLeadId(payload) },
      );
    }

    case LeadLifecycleEventType.MANUAL_REVIEW_REQUIRED: {
      // Valid from any non-terminal state whose transition map permits it.
      return buildResult(
        context,
        LeadLifecycleState.MANUAL_REVIEW_PENDING,
        "Manual review explicitly required.",
        { lead_id: readLeadId(payload) },
      );
    }

    case LeadLifecycleEventType.REJECTED: {
      return buildResult(
        context,
        LeadLifecycleState.REJECTED,
        "Lead explicitly rejected.",
        { lead_id: readLeadId(payload) },
      );
    }

    case LeadLifecycleEventType.CLOSED: {
      return buildResult(
        context,
        LeadLifecycleState.CLOSED,
        "Lead lifecycle closed.",
        { lead_id: readLeadId(payload) },
      );
    }

    default:
      throw new LeadLifecycleTransitionError(`UNSUPPORTED_EVENT:${eventType}`);
  }
}
