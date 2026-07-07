import type { JsonRecord } from "../../workflow/workflowPersistenceTypes";
import type {
  WorkflowHandlerContext,
  WorkflowHandlerResult,
  WorkflowTaskRequest,
} from "../../workflow/workflowTypes";
import {
  CLARIFICATION_ROUND_BY_RESCORE,
  CLARIFICATION_STATE_BY_ROUND,
  LEAD_LIFECYCLE_TRANSITIONS,
  LeadLifecycleState,
  MAX_CLARIFICATION_CYCLES,
  RESCORE_STATE_BY_CLARIFICATION,
  leadLifecycleStatusForState,
  type LeadLifecycleStateValue,
} from "./leadLifecycleStates";
import { LeadLifecycleEventType } from "./leadLifecycleEvents";
import {
  LeadLifecycleTaskIntent,
  buildLeadLifecycleTaskIdempotencyKey,
  type LeadLifecycleTaskIntentValue,
} from "./leadLifecycleTaskIntents";
import {
  resolveCanonicalLeadIdentity,
  validateManualReviewResolution,
  validateMatchingResult,
  validateQualityResult,
} from "./leadLifecycleValidation";
import {
  ManualReviewOutcome,
  type LeadQualityResult,
  type ManualReviewOutcomeValue,
} from "./leadLifecycleTypes";
import {
  validateDistributionApprovalRequired,
  validateDistributionApproved,
  validateDistributionCompleted,
} from "./distribution/leadDistributionValidation";

/**
 * QuickFurno Lead Lifecycle — deterministic handler (Phase 2A, corrected).
 *
 * This is a PURE function of its input context. It never writes to the database,
 * never calls the Lead Quality Engine, clarification service, matching engine,
 * assignment RPC, credit ledger, WhatsApp, n8n, or any AI model. It only decides
 * the next state and declares durable task intents.
 *
 * The score, vendor ranking, and vendor assignment are all produced by the
 * existing authoritative services in later phases — never here.
 */

/** Thrown for an event that is not valid in the current state / for the payload. */
export class LeadLifecycleTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadLifecycleTransitionError";
  }
}

/** Which durable task intent (if any) is opened on entering a given state. */
const STATE_TASK_INTENT: Partial<Record<LeadLifecycleStateValue, LeadLifecycleTaskIntentValue>> = {
  [LeadLifecycleState.QUALITY_SCORING_PENDING]: LeadLifecycleTaskIntent.QUALITY_SCORE,
  [LeadLifecycleState.CLARIFICATION_PENDING_1]: LeadLifecycleTaskIntent.CLARIFICATION_PREPARE,
  [LeadLifecycleState.CLARIFICATION_PENDING_2]: LeadLifecycleTaskIntent.CLARIFICATION_PREPARE,
  [LeadLifecycleState.RESCORE_PENDING_1]: LeadLifecycleTaskIntent.QUALITY_RESCORE,
  [LeadLifecycleState.RESCORE_PENDING_2]: LeadLifecycleTaskIntent.QUALITY_RESCORE,
  [LeadLifecycleState.MATCHING_PENDING]: LeadLifecycleTaskIntent.MATCHING_PREPARE,
  // Phase 3A: entering MATCH_RECOMMENDATION_READY opens the approval-preparation
  // task, which resolves the immutable recommendation snapshot bound to the
  // triggering lead.matching.completed event.
  [LeadLifecycleState.MATCH_RECOMMENDATION_READY]: LeadLifecycleTaskIntent.DISTRIBUTION_PREPARE_APPROVAL,
  [LeadLifecycleState.DISTRIBUTION_APPROVAL_PENDING]: LeadLifecycleTaskIntent.DISTRIBUTION_AWAIT_APPROVAL,
  [LeadLifecycleState.DISTRIBUTION_PENDING]: LeadLifecycleTaskIntent.DISTRIBUTION_PREPARE,
  [LeadLifecycleState.NURTURE_PENDING]: LeadLifecycleTaskIntent.NURTURE_PREPARE,
  [LeadLifecycleState.MANUAL_REVIEW_PENDING]: LeadLifecycleTaskIntent.MANUAL_REVIEW_PREPARE,
};

/**
 * Manual review resolution outcome → destination lifecycle state.
 *
 * There is intentionally NO distribution destination here. Distribution only ever
 * proceeds through the dedicated controlled distribution states; generic manual
 * review can never bypass matching/approval to reach DISTRIBUTION_PENDING.
 */
const MANUAL_REVIEW_OUTCOME_STATE: Record<ManualReviewOutcomeValue, LeadLifecycleStateValue> = {
  [ManualReviewOutcome.APPROVE_FOR_MATCHING]: LeadLifecycleState.READY_FOR_MATCHING,
  // Human-gated override: routes into the bounded clarification sequence at round
  // 1. Each grant requires an explicit, auditable manual-review resolution, so
  // this is never automated retry behavior.
  [ManualReviewOutcome.ALLOW_CLARIFICATION]: LeadLifecycleState.CLARIFICATION_PENDING_1,
  [ManualReviewOutcome.SEND_TO_NURTURE]: LeadLifecycleState.NURTURE_PENDING,
  [ManualReviewOutcome.REJECT]: LeadLifecycleState.REJECTED,
  [ManualReviewOutcome.CLOSE]: LeadLifecycleState.CLOSED,
};

function assertTransitionAllowed(fromState: string, toState: LeadLifecycleStateValue): void {
  const allowed = LEAD_LIFECYCLE_TRANSITIONS[fromState];
  if (!allowed || !allowed.includes(toState)) {
    throw new LeadLifecycleTransitionError(`INVALID_TRANSITION:${fromState}->${toState}`);
  }
}

function assertSourceState(
  actual: string,
  expected: LeadLifecycleStateValue | LeadLifecycleStateValue[],
  eventType: string,
): void {
  const expectedList = Array.isArray(expected) ? expected : [expected];
  if (!(expectedList as string[]).includes(actual)) {
    throw new LeadLifecycleTransitionError(`INVALID_EVENT_FOR_STATE:${eventType}@${actual}`);
  }
}

/**
 * Authoritative quality routing. Consumes a validated result plus the durable
 * current state (which encodes the clarification round). It never computes or
 * re-thresholds a score, and it derives clarification progression from the
 * durable state — NOT from any caller-supplied counter.
 */
export function routeQualityResult(
  result: LeadQualityResult,
  currentState: string,
): { nextState: LeadLifecycleStateValue; reason: string; routing: JsonRecord } {
  const origin = currentState === LeadLifecycleState.QUALITY_SCORING_PENDING ? "initial" : "rescore";
  const baseRouting: JsonRecord = {
    tier: result.tier,
    origin,
    manual_review_required: result.manualReviewRequired,
    clarification_allowed: result.clarificationAllowed,
    reported_clarification_cycle: result.clarificationCycle,
    clarification_cap: MAX_CLARIFICATION_CYCLES,
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
          nextState: CLARIFICATION_STATE_BY_ROUND[1],
          reason: "Quality tier B routed to clarification round 1.",
          routing: { ...baseRouting, clarification_round: 1 },
        };
      }
      // Rescore: the current clarification round is derived from durable state.
      const currentRound = CLARIFICATION_ROUND_BY_RESCORE[currentState] ?? MAX_CLARIFICATION_CYCLES;
      const nextRound = currentRound + 1;
      const nextClarificationState = CLARIFICATION_STATE_BY_ROUND[nextRound];
      const withinCap = nextRound <= MAX_CLARIFICATION_CYCLES && Boolean(nextClarificationState);

      if (result.clarificationAllowed && withinCap) {
        return {
          nextState: nextClarificationState,
          reason: `Quality tier B re-entered clarification round ${nextRound} (within cap).`,
          routing: { ...baseRouting, clarification_round: nextRound },
        };
      }
      return {
        nextState: LeadLifecycleState.MANUAL_REVIEW_PENDING,
        reason: withinCap
          ? "Quality tier B on rescore without clarification authorization routed to manual review."
          : "Quality tier B on rescore exhausted the clarification cap; routed to manual review.",
        routing: {
          ...baseRouting,
          current_clarification_round: currentRound,
          loop_safety_applied: !withinCap,
          clarification_not_authorized: withinCap && !result.clarificationAllowed,
        },
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
      const exhaustive: never = result.tier;
      throw new LeadLifecycleTransitionError(`QUALITY_TIER_UNHANDLED:${String(exhaustive)}`);
    }
  }
}

function buildResult(
  context: WorkflowHandlerContext,
  leadId: string,
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
        // Canonical lead id from validated entity identity — never trusted from payload.
        lead_id: leadId,
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
      lead_id: leadId,
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
  // Correction 1: canonical lead identity is validated up-front for every event.
  const identity = resolveCanonicalLeadIdentity(context.workflow, context.event);
  if (!identity.ok) {
    throw new LeadLifecycleTransitionError(identity.message);
  }
  const leadId = identity.value.leadId;

  const state = context.workflow.current_state;
  const eventType = context.event.event_type;
  const payload = context.event.payload_json;

  switch (eventType) {
    case LeadLifecycleEventType.LIFECYCLE_STARTED: {
      assertSourceState(state, LeadLifecycleState.RECEIVED, eventType);
      return buildResult(
        context,
        leadId,
        LeadLifecycleState.QUALITY_SCORING_PENDING,
        "Lead lifecycle started; awaiting authoritative quality result.",
        {},
      );
    }

    case LeadLifecycleEventType.QUALITY_RESULTED: {
      assertSourceState(
        state,
        [
          LeadLifecycleState.QUALITY_SCORING_PENDING,
          LeadLifecycleState.RESCORE_PENDING_1,
          LeadLifecycleState.RESCORE_PENDING_2,
        ],
        eventType,
      );
      const validation = validateQualityResult(payload);
      if (!validation.ok) {
        throw new LeadLifecycleTransitionError(validation.message);
      }
      const routed = routeQualityResult(validation.value, state);
      return buildResult(context, leadId, routed.nextState, routed.reason, { quality: routed.routing });
    }

    case LeadLifecycleEventType.CLARIFICATION_COMPLETED: {
      assertSourceState(
        state,
        [LeadLifecycleState.CLARIFICATION_PENDING_1, LeadLifecycleState.CLARIFICATION_PENDING_2],
        eventType,
      );
      const rescoreState = RESCORE_STATE_BY_CLARIFICATION[state];
      return buildResult(
        context,
        leadId,
        rescoreState,
        "Clarification completed; awaiting authoritative rescore result.",
        {},
      );
    }

    case LeadLifecycleEventType.MATCHING_REQUESTED: {
      assertSourceState(state, LeadLifecycleState.READY_FOR_MATCHING, eventType);
      return buildResult(
        context,
        leadId,
        LeadLifecycleState.MATCHING_PENDING,
        "Matching requested; awaiting authoritative match result.",
        {},
      );
    }

    case LeadLifecycleEventType.MATCHING_COMPLETED: {
      assertSourceState(state, LeadLifecycleState.MATCHING_PENDING, eventType);
      // Correction 4: guard the 3-vendor rule against impossible authoritative results.
      const matching = validateMatchingResult(payload);
      if (!matching.ok) {
        throw new LeadLifecycleTransitionError(matching.message);
      }
      return buildResult(
        context,
        leadId,
        LeadLifecycleState.MATCH_RECOMMENDATION_READY,
        "Match recommendations ready; awaiting distribution decision.",
        { recommended_vendor_count: matching.value.recommendedVendorCount },
      );
    }

    case LeadLifecycleEventType.DISTRIBUTION_APPROVAL_REQUIRED: {
      assertSourceState(state, LeadLifecycleState.MATCH_RECOMMENDATION_READY, eventType);
      // Phase 3A: reject empty/unvalidated approval-required events.
      const approvalRequired = validateDistributionApprovalRequired(payload);
      if (!approvalRequired.ok) {
        throw new LeadLifecycleTransitionError(approvalRequired.message);
      }
      return buildResult(
        context,
        leadId,
        LeadLifecycleState.DISTRIBUTION_APPROVAL_PENDING,
        "Distribution requires explicit approval (controlled rollout).",
        {
          recommendation_event_id: approvalRequired.value.recommendationEventId,
          recommended_vendor_count: approvalRequired.value.recommendedVendorCount,
        },
      );
    }

    case LeadLifecycleEventType.DISTRIBUTION_APPROVED: {
      assertSourceState(state, LeadLifecycleState.DISTRIBUTION_APPROVAL_PENDING, eventType);
      // Phase 3A: enforce the approved-subset + recommendation-order contract
      // before authorizing distribution.
      const approved = validateDistributionApproved(payload);
      if (!approved.ok) {
        throw new LeadLifecycleTransitionError(approved.message);
      }
      return buildResult(
        context,
        leadId,
        LeadLifecycleState.DISTRIBUTION_PENDING,
        "Distribution explicitly approved; ready to prepare distribution.",
        {
          recommendation_event_id: approved.value.recommendationEventId,
          approved_vendor_count: approved.value.approvedVendorCount,
          approved_by: approved.value.approvedBy,
        },
      );
    }

    case LeadLifecycleEventType.DISTRIBUTION_AUTO_AUTHORIZED: {
      // Future capability: state-machine only. This does NOT activate automatic
      // distribution, assign vendors, or deduct credits.
      assertSourceState(state, LeadLifecycleState.MATCH_RECOMMENDATION_READY, eventType);
      return buildResult(
        context,
        leadId,
        LeadLifecycleState.DISTRIBUTION_PENDING,
        "Distribution auto-authorized (future capability; no execution in Phase 2A).",
        { auto_authorized: true },
      );
    }

    case LeadLifecycleEventType.DISTRIBUTION_COMPLETED: {
      assertSourceState(state, LeadLifecycleState.DISTRIBUTION_PENDING, eventType);
      // Phase 3B: strict partition contract — distributed + skipped must exactly
      // partition the approved set (order-preserving, disjoint), with 1..3 distributed.
      const distribution = validateDistributionCompleted(payload);
      if (!distribution.ok) {
        throw new LeadLifecycleTransitionError(distribution.message);
      }
      return buildResult(
        context,
        leadId,
        LeadLifecycleState.DISTRIBUTED,
        "Distribution completed; lead delivered to matched vendors.",
        {
          approval_event_id: distribution.value.approvalEventId,
          distributed_vendor_count: distribution.value.distributedVendorCount,
        },
      );
    }

    case LeadLifecycleEventType.MANUAL_REVIEW_REQUIRED: {
      // Valid from any non-terminal state whose transition map permits it.
      return buildResult(
        context,
        leadId,
        LeadLifecycleState.MANUAL_REVIEW_PENDING,
        "Manual review explicitly required.",
        {},
      );
    }

    case LeadLifecycleEventType.MANUAL_REVIEW_RESOLVED: {
      // Correction 3: resolve manual review into an explicit, typed outcome.
      assertSourceState(state, LeadLifecycleState.MANUAL_REVIEW_PENDING, eventType);
      const resolution = validateManualReviewResolution(payload);
      if (!resolution.ok) {
        throw new LeadLifecycleTransitionError(resolution.message);
      }
      const nextState = MANUAL_REVIEW_OUTCOME_STATE[resolution.value.outcome];
      return buildResult(
        context,
        leadId,
        nextState,
        `Manual review resolved: ${resolution.value.outcome} by ${resolution.value.reviewedBy}.`,
        {
          manual_review_outcome: resolution.value.outcome,
          reviewed_by: resolution.value.reviewedBy,
        },
      );
    }

    case LeadLifecycleEventType.NURTURE_REQUALIFICATION_REQUESTED: {
      // Optional capability: an authoritative event re-enters scoring. Phase 2A
      // does not schedule or trigger nurture, and calls no external channel.
      assertSourceState(state, LeadLifecycleState.NURTURE_PENDING, eventType);
      return buildResult(
        context,
        leadId,
        LeadLifecycleState.QUALITY_SCORING_PENDING,
        "Nurtured lead requalification requested; re-entering quality scoring.",
        { requalification: true },
      );
    }

    case LeadLifecycleEventType.REJECTED: {
      return buildResult(context, leadId, LeadLifecycleState.REJECTED, "Lead explicitly rejected.", {});
    }

    case LeadLifecycleEventType.CLOSED: {
      return buildResult(context, leadId, LeadLifecycleState.CLOSED, "Lead lifecycle closed.", {});
    }

    default:
      throw new LeadLifecycleTransitionError(`UNSUPPORTED_EVENT:${eventType}`);
  }
}
