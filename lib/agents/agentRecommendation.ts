// ============================================================================
// QuickFurno — lib/agents/agentRecommendation.ts   (Phase 5F-A future-compat)
//
// PURE recommendation contracts. FUTURE-COMPATIBILITY ONLY: no autonomous
// execution engine, no LLM call, no action loop. A recommendation is a PROPOSAL for
// a human/policy to consider — it is NEVER an authorization or an execution.
//
// AUTHORITY BOUNDARY: an `approved` recommendation status does NOT bypass the
// Phase 4 Policy Engine. Even an approved recommendation must still pass Phase 4
// authorization, then consent/suppression, then a channel/provider decision, then
// CommunicationService, before anything is dispatched. `recommendationAuthorizes()`
// is a hard `false`.
// ============================================================================

import { LogicalAgent, type LogicalAgentValue } from "./agentAttribution";

// ----------------------------------------------------------------------------
// Risk + status + approval vocabularies
// ----------------------------------------------------------------------------
export const RecommendationRiskLevel = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
} as const;

export type RecommendationRiskLevelValue =
  (typeof RecommendationRiskLevel)[keyof typeof RecommendationRiskLevel];

export const KNOWN_RECOMMENDATION_RISK_LEVELS: readonly RecommendationRiskLevelValue[] =
  Object.freeze(Object.values(RecommendationRiskLevel));

export const RecommendationStatus = {
  DRAFT: "draft",
  PROPOSED: "proposed",
  UNDER_REVIEW: "under_review",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXPIRED: "expired",
  EXECUTED: "executed",
  CANCELLED: "cancelled",
} as const;

export type RecommendationStatusValue =
  (typeof RecommendationStatus)[keyof typeof RecommendationStatus];

export const KNOWN_RECOMMENDATION_STATUSES: readonly RecommendationStatusValue[] =
  Object.freeze(Object.values(RecommendationStatus));

export function isRecommendationStatus(value: unknown): value is RecommendationStatusValue {
  return typeof value === "string" && (KNOWN_RECOMMENDATION_STATUSES as string[]).includes(value);
}

/**
 * How a recommendation must be approved before it could ever be acted on. Every
 * mode still routes through Phase 4 authorization — `none` means "no EXTRA human
 * approval gate", NOT "skip authorization".
 */
export const ApprovalRequirement = {
  /** No additional human approval gate (still Phase 4 authorized downstream). */
  NONE: "none",
  SINGLE_ADMIN: "single_admin",
  DUAL_ADMIN: "dual_admin",
  SUPERADMIN: "superadmin",
  POLICY_ONLY: "policy_only",
} as const;

export type ApprovalRequirementValue = (typeof ApprovalRequirement)[keyof typeof ApprovalRequirement];

export const KNOWN_APPROVAL_REQUIREMENTS: readonly ApprovalRequirementValue[] =
  Object.freeze(Object.values(ApprovalRequirement));

// ----------------------------------------------------------------------------
// Observation + recommendation contracts (pure data)
// ----------------------------------------------------------------------------
/**
 * A read-only OBSERVATION an agent may make from QuickFurno data (via a narrow read
 * API). It carries no capability and no secret — only sanitized references and a
 * summary. It never mutates state.
 */
export interface AgentObservation {
  readonly observationId: string;
  readonly agent: LogicalAgentValue;
  readonly observedEntityType: string | null;
  readonly observedEntityId: string | null;
  /** A sanitized, non-secret summary. Never a raw payload or credential. */
  readonly safeSummary: Record<string, unknown>;
  readonly observedAt: string;
}

/**
 * A PROPOSAL from an agent. It is inert data: it cannot authorize, dispatch, or
 * execute. Acting on it requires (in order) Phase 4 authorization, an approval that
 * satisfies `approvalRequirement`, consent/suppression checks, and a channel/
 * provider decision.
 */
export interface AgentRecommendation {
  readonly recommendationId: string;
  readonly agent: LogicalAgentValue;
  readonly recommendationType: string;
  readonly riskLevel: RecommendationRiskLevelValue;
  readonly status: RecommendationStatusValue;
  readonly approvalRequirement: ApprovalRequirementValue;
  readonly approvalRequestId: string | null;
  readonly correlationId: string | null;
  readonly rationaleSafe: Record<string, unknown>;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

/**
 * THE hard guarantee: a recommendation NEVER authorizes anything — not even when
 * `status = 'approved'`. Always false. A mutation that lets an approved
 * recommendation authorize/dispatch is caught. The authorization authority is the
 * Phase 4 Policy Engine, not a recommendation status.
 */
export function recommendationAuthorizes(_recommendation?: AgentRecommendation): boolean {
  return false;
}

/**
 * The REQUIRED downstream path before any dispatch can result from a
 * recommendation. Documented as a constant so a test can assert it, and so no code
 * path collapses it. Phase 5F-A wires none of these steps to execution.
 */
export const RECOMMENDATION_TO_DISPATCH_PATH: readonly string[] = Object.freeze([
  "agent_recommendation",
  "quickfurno_authorization", // Phase 4 Policy Engine
  "consent_suppression_checks",
  "channel_provider_decision",
  "communication_service",
  "provider",
]);

/** All recognised logical agents may make recommendations — none is an auth role. */
export const RECOMMENDING_AGENTS: readonly LogicalAgentValue[] = Object.freeze([
  LogicalAgent.QF_JARVIS, LogicalAgent.RIYA, LogicalAgent.JITIN,
  LogicalAgent.KABIR, LogicalAgent.ARJUN, LogicalAgent.MEERA, LogicalAgent.VEER,
]);
