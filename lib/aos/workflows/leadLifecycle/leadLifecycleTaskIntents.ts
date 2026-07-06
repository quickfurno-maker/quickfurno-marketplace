import { LEAD_LIFECYCLE_WORKFLOW_TYPE } from "./leadLifecycleStates";

/**
 * QuickFurno Lead Lifecycle — task intents (Phase 2A).
 *
 * Task intents are durable orchestration/persistence markers. They record that
 * some future work needs to happen (score, clarify, rescore, match, await
 * approval, prepare distribution, nurture, manual review). Phase 2A does NOT
 * implement any task executor and does NOT call any authoritative service — it
 * only declares the intent so the workflow's future work is durable.
 */

export const LeadLifecycleTaskIntent = {
  QUALITY_SCORE: "lead.quality.score",
  CLARIFICATION_PREPARE: "lead.clarification.prepare",
  QUALITY_RESCORE: "lead.quality.rescore",
  MATCHING_PREPARE: "lead.matching.prepare",
  DISTRIBUTION_AWAIT_APPROVAL: "lead.distribution.await_approval",
  DISTRIBUTION_PREPARE: "lead.distribution.prepare",
  NURTURE_PREPARE: "lead.nurture.prepare",
  MANUAL_REVIEW_PREPARE: "lead.manual_review.prepare",
} as const;

export type LeadLifecycleTaskIntentValue =
  (typeof LeadLifecycleTaskIntent)[keyof typeof LeadLifecycleTaskIntent];

/**
 * Build a deterministic task idempotency key from durable identity only.
 *
 * The key is reproducible from (workflow instance id, triggering event id, task
 * intent). It contains NO random values and NO timestamps, so replaying the same
 * event yields the same key — the atomic step RPC then de-duplicates it.
 */
export function buildLeadLifecycleTaskIdempotencyKey(
  workflowInstanceId: string,
  eventId: string,
  taskIntent: LeadLifecycleTaskIntentValue,
): string {
  return `${LEAD_LIFECYCLE_WORKFLOW_TYPE}:task:${workflowInstanceId}:${eventId}:${taskIntent}`;
}
