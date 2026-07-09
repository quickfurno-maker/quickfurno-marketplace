// ============================================================================
// QuickFurno — lib/agents/campaignIntent.ts   (Phase 5F-A future-compat)
//
// PURE campaign-intent contracts. FUTURE-COMPATIBILITY ONLY: NO campaign execution,
// NO RCS sending, NO AI-generated campaign launch. A CampaignIntent is a declared
// PROPOSAL; it cannot dispatch, cannot select recipients live, and cannot be
// executed by this module. Any future execution routes through QuickFurno
// authorization → consent/suppression → channel/provider → CommunicationService.
// ============================================================================

import { type ApprovalRequirementValue } from "./agentRecommendation";
import { type CommunicationChannel } from "../communication/types";

export const CampaignObjective = {
  AWARENESS: "awareness",
  REACTIVATION: "reactivation",
  CROSS_SELL: "cross_sell",
  RETENTION: "retention",
  ANNOUNCEMENT: "announcement",
} as const;

export type CampaignObjectiveValue = (typeof CampaignObjective)[keyof typeof CampaignObjective];

export const KNOWN_CAMPAIGN_OBJECTIVES: readonly CampaignObjectiveValue[] =
  Object.freeze(Object.values(CampaignObjective));

/**
 * A REFERENCE to an audience definition — never an inline recipient list and never
 * a plaintext destination. Resolution + consent/suppression happen downstream at
 * authorized execution time, not here.
 */
export interface AudienceDefinitionReference {
  readonly audienceDefinitionId: string;
  readonly description: string | null;
  /** Coarse, non-PII estimate only. Never an enumerated recipient set. */
  readonly estimatedSizeBucket: "unknown" | "small" | "medium" | "large" | null;
}

/** Which channels a campaign PREFERS, in order. Declaration only — no send. */
export interface ChannelStrategy {
  readonly primaryChannel: CommunicationChannel;
  readonly additionalChannels: readonly CommunicationChannel[];
}

/** A declared fallback intent. Never auto-executed by this contract. */
export interface FallbackStrategy {
  readonly fallbackChannel: CommunicationChannel | null;
  readonly automaticFallbackAllowed: boolean;
}

export interface SuccessMetric {
  readonly metricKey: string;
  readonly targetValue: number | null;
  readonly comparison: "gte" | "lte" | "eq" | null;
}

/** A condition that would STOP a campaign. Declaration only — no execution loop. */
export interface StopCondition {
  readonly conditionKey: string;
  readonly thresholdValue: number | null;
}

/** A hard spend/volume guardrail. Declaration only. */
export interface BudgetGuardrail {
  readonly currency: string | null;
  readonly maxSpend: number | null;
  readonly maxMessages: number | null;
}

/**
 * A future campaign PROPOSAL. Inert data — it can never dispatch or send RCS. A
 * future execution phase must obtain QuickFurno authorization and pass
 * consent/suppression + a channel/provider decision before CommunicationService.
 */
export interface CampaignIntent {
  readonly campaignId: string;
  readonly objective: CampaignObjectiveValue;
  readonly audience: AudienceDefinitionReference;
  readonly channelStrategy: ChannelStrategy;
  readonly fallbackStrategy: FallbackStrategy;
  readonly successMetrics: readonly SuccessMetric[];
  readonly stopConditions: readonly StopCondition[];
  readonly budgetGuardrail: BudgetGuardrail;
  readonly approvalRequirement: ApprovalRequirementValue;
  readonly correlationId: string | null;
}

/**
 * THE hard guarantee: a campaign intent can never dispatch. Always false. A
 * mutation that lets a campaign intent dispatch is caught.
 */
export function campaignIntentCanDispatch(_intent?: CampaignIntent): boolean {
  return false;
}
