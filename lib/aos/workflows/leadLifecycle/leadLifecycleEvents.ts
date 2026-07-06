/**
 * QuickFurno Lead Lifecycle — event contract (Phase 2A).
 *
 * These are the typed domain-event contracts the lifecycle understands. They
 * are NOT emitted into the live application in Phase 2A. Events fall into two
 * groups:
 *
 *   - Driver events: inbound events the handler consumes to advance state.
 *   - Contract-only events: names reserved for outputs/requests that the
 *     lifecycle models as task intents in Phase 2A rather than re-entrant
 *     events. They are declared here so the full contract is documented and
 *     stable for Phase 2B.
 */

export const LeadLifecycleEventType = {
  // --- Driver events (advance state) ---
  LIFECYCLE_STARTED: "lead.lifecycle.started",
  QUALITY_RESULTED: "lead.quality.resulted",
  CLARIFICATION_COMPLETED: "lead.clarification.completed",
  MATCHING_REQUESTED: "lead.matching.requested",
  MATCHING_COMPLETED: "lead.matching.completed",
  DISTRIBUTION_APPROVAL_REQUIRED: "lead.distribution.approval_required",
  DISTRIBUTION_APPROVED: "lead.distribution.approved",
  DISTRIBUTION_AUTO_AUTHORIZED: "lead.distribution.auto_authorized",
  DISTRIBUTION_COMPLETED: "lead.distribution.completed",
  MANUAL_REVIEW_REQUIRED: "lead.manual_review.required",
  MANUAL_REVIEW_RESOLVED: "lead.manual_review.resolved",
  NURTURE_REQUALIFICATION_REQUESTED: "lead.nurture.requalification_requested",
  REJECTED: "lead.rejected",
  CLOSED: "lead.closed",

  // --- Contract-only events (modeled as task intents in Phase 2A) ---
  QUALITY_SCORING_REQUESTED: "lead.quality.scoring_requested",
  RESCORE_REQUESTED: "lead.rescore.requested",
  NURTURE_SCHEDULED: "lead.nurture.scheduled",
} as const;

export type LeadLifecycleEventTypeValue =
  (typeof LeadLifecycleEventType)[keyof typeof LeadLifecycleEventType];

/**
 * The subset of events the Phase 2A handler acts on as state drivers.
 */
export const LEAD_LIFECYCLE_DRIVER_EVENTS: LeadLifecycleEventTypeValue[] = [
  LeadLifecycleEventType.LIFECYCLE_STARTED,
  LeadLifecycleEventType.QUALITY_RESULTED,
  LeadLifecycleEventType.CLARIFICATION_COMPLETED,
  LeadLifecycleEventType.MATCHING_REQUESTED,
  LeadLifecycleEventType.MATCHING_COMPLETED,
  LeadLifecycleEventType.DISTRIBUTION_APPROVAL_REQUIRED,
  LeadLifecycleEventType.DISTRIBUTION_APPROVED,
  LeadLifecycleEventType.DISTRIBUTION_AUTO_AUTHORIZED,
  LeadLifecycleEventType.DISTRIBUTION_COMPLETED,
  LeadLifecycleEventType.MANUAL_REVIEW_REQUIRED,
  LeadLifecycleEventType.MANUAL_REVIEW_RESOLVED,
  LeadLifecycleEventType.NURTURE_REQUALIFICATION_REQUESTED,
  LeadLifecycleEventType.REJECTED,
  LeadLifecycleEventType.CLOSED,
];

export function isLeadLifecycleDriverEvent(eventType: string): boolean {
  return (LEAD_LIFECYCLE_DRIVER_EVENTS as string[]).includes(eventType);
}
