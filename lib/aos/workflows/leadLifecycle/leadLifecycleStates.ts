import type { WorkflowStatus } from "../../workflow/workflowPersistenceTypes";

/**
 * QuickFurno Lead Lifecycle — declarative state model (Phase 2A).
 *
 * This is a pure, deterministic state-machine definition. It does NOT touch the
 * database, call any authoritative lead service, score leads, rank vendors,
 * assign vendors, deduct credits, or send any external message. It only models
 * the states a qualified client lead can occupy on its way (at most) to three
 * vendors.
 */

export const LEAD_LIFECYCLE_WORKFLOW_TYPE = "qf_lead_lifecycle";

export const LeadLifecycleState = {
  /** Lead has been received by the lifecycle; no scoring has happened yet. */
  RECEIVED: "RECEIVED",
  /** Waiting for an authoritative quality result (score is computed elsewhere). */
  QUALITY_SCORING_PENDING: "QUALITY_SCORING_PENDING",
  /** B-tier route: waiting for the client to answer clarification questions. */
  CLARIFICATION_PENDING: "CLARIFICATION_PENDING",
  /** Clarification answered; waiting for an authoritative rescore result. */
  RESCORE_PENDING: "RESCORE_PENDING",
  /** A+/A route: lead is ready to enter matching. */
  READY_FOR_MATCHING: "READY_FOR_MATCHING",
  /** Matching has been requested; waiting for a match result (no ranking here). */
  MATCHING_PENDING: "MATCHING_PENDING",
  /** Match recommendations are ready and awaiting a distribution decision. */
  MATCH_RECOMMENDATION_READY: "MATCH_RECOMMENDATION_READY",
  /** Controlled rollout: distribution requires an explicit approval event. */
  DISTRIBUTION_APPROVAL_PENDING: "DISTRIBUTION_APPROVAL_PENDING",
  /** Distribution has been authorized and is ready to be prepared. */
  DISTRIBUTION_PENDING: "DISTRIBUTION_PENDING",
  /** Lead has been distributed to its matched vendors (max 3, enforced elsewhere). */
  DISTRIBUTED: "DISTRIBUTED",
  /** C-tier route: lead is being nurtured for future qualification. */
  NURTURE_PENDING: "NURTURE_PENDING",
  /** Human review is required before the lead can proceed. */
  MANUAL_REVIEW_PENDING: "MANUAL_REVIEW_PENDING",
  /** Terminal: lead was rejected. */
  REJECTED: "REJECTED",
  /** Terminal: lifecycle is closed (success or benign end). */
  CLOSED: "CLOSED",
  /** Terminal: the workflow itself failed. */
  FAILED: "FAILED",
} as const;

export type LeadLifecycleStateValue =
  (typeof LeadLifecycleState)[keyof typeof LeadLifecycleState];

export const LEAD_LIFECYCLE_INITIAL_STATE: LeadLifecycleStateValue =
  LeadLifecycleState.RECEIVED;

/**
 * Terminal states. A workflow that reaches one of these cannot transition
 * further; the kernel's transition validator enforces this alongside the
 * terminal workflow status.
 */
export const LEAD_LIFECYCLE_TERMINAL_STATES: LeadLifecycleStateValue[] = [
  LeadLifecycleState.REJECTED,
  LeadLifecycleState.CLOSED,
  LeadLifecycleState.FAILED,
];

/**
 * Allowed transition graph. Every transition the handler can emit MUST appear
 * here, otherwise the kernel's `validateWorkflowTransition` will reject the
 * step with INVALID_TRANSITION. Keys with no outgoing edges (terminal states)
 * are intentionally omitted.
 */
export const LEAD_LIFECYCLE_TRANSITIONS: Record<string, LeadLifecycleStateValue[]> = {
  [LeadLifecycleState.RECEIVED]: [LeadLifecycleState.QUALITY_SCORING_PENDING],
  [LeadLifecycleState.QUALITY_SCORING_PENDING]: [
    LeadLifecycleState.READY_FOR_MATCHING,
    LeadLifecycleState.CLARIFICATION_PENDING,
    LeadLifecycleState.NURTURE_PENDING,
    LeadLifecycleState.MANUAL_REVIEW_PENDING,
    LeadLifecycleState.REJECTED,
    LeadLifecycleState.FAILED,
  ],
  [LeadLifecycleState.CLARIFICATION_PENDING]: [
    LeadLifecycleState.RESCORE_PENDING,
    LeadLifecycleState.MANUAL_REVIEW_PENDING,
    LeadLifecycleState.REJECTED,
    LeadLifecycleState.CLOSED,
    LeadLifecycleState.FAILED,
  ],
  [LeadLifecycleState.RESCORE_PENDING]: [
    LeadLifecycleState.READY_FOR_MATCHING,
    LeadLifecycleState.CLARIFICATION_PENDING,
    LeadLifecycleState.NURTURE_PENDING,
    LeadLifecycleState.MANUAL_REVIEW_PENDING,
    LeadLifecycleState.REJECTED,
    LeadLifecycleState.FAILED,
  ],
  [LeadLifecycleState.READY_FOR_MATCHING]: [
    LeadLifecycleState.MATCHING_PENDING,
    LeadLifecycleState.MANUAL_REVIEW_PENDING,
    LeadLifecycleState.FAILED,
  ],
  [LeadLifecycleState.MATCHING_PENDING]: [
    LeadLifecycleState.MATCH_RECOMMENDATION_READY,
    LeadLifecycleState.MANUAL_REVIEW_PENDING,
    LeadLifecycleState.FAILED,
  ],
  [LeadLifecycleState.MATCH_RECOMMENDATION_READY]: [
    LeadLifecycleState.DISTRIBUTION_APPROVAL_PENDING,
    LeadLifecycleState.DISTRIBUTION_PENDING,
    LeadLifecycleState.MANUAL_REVIEW_PENDING,
    LeadLifecycleState.FAILED,
  ],
  [LeadLifecycleState.DISTRIBUTION_APPROVAL_PENDING]: [
    LeadLifecycleState.DISTRIBUTION_PENDING,
    LeadLifecycleState.MANUAL_REVIEW_PENDING,
    LeadLifecycleState.REJECTED,
    LeadLifecycleState.FAILED,
  ],
  [LeadLifecycleState.DISTRIBUTION_PENDING]: [
    LeadLifecycleState.DISTRIBUTED,
    LeadLifecycleState.MANUAL_REVIEW_PENDING,
    LeadLifecycleState.FAILED,
  ],
  [LeadLifecycleState.DISTRIBUTED]: [LeadLifecycleState.CLOSED],
  [LeadLifecycleState.NURTURE_PENDING]: [
    LeadLifecycleState.CLOSED,
    LeadLifecycleState.REJECTED,
    LeadLifecycleState.MANUAL_REVIEW_PENDING,
  ],
  [LeadLifecycleState.MANUAL_REVIEW_PENDING]: [
    LeadLifecycleState.READY_FOR_MATCHING,
    LeadLifecycleState.CLARIFICATION_PENDING,
    LeadLifecycleState.NURTURE_PENDING,
    LeadLifecycleState.DISTRIBUTION_PENDING,
    LeadLifecycleState.REJECTED,
    LeadLifecycleState.CLOSED,
    LeadLifecycleState.FAILED,
  ],
};

/**
 * Canonical workflow status for a given lifecycle state. Non-terminal states
 * remain `active` so the kernel permits further transitions. DISTRIBUTED stays
 * `active` on purpose so it can still be CLOSED.
 */
export function leadLifecycleStatusForState(state: string): WorkflowStatus {
  switch (state) {
    case LeadLifecycleState.REJECTED:
      return "cancelled";
    case LeadLifecycleState.CLOSED:
      return "completed";
    case LeadLifecycleState.FAILED:
      return "failed";
    default:
      return "active";
  }
}

export function isLeadLifecycleTerminalState(state: string): boolean {
  return (LEAD_LIFECYCLE_TERMINAL_STATES as string[]).includes(state);
}

export function isKnownLeadLifecycleState(state: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    LEAD_LIFECYCLE_TRANSITIONS,
    state,
  ) || isLeadLifecycleTerminalState(state);
}
