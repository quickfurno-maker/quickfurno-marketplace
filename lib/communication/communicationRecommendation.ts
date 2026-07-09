// ============================================================================
// QuickFurno — lib/communication/communicationRecommendation.ts  (5F-A future-compat)
//
// PURE contract for a FUTURE communication recommendation an agent (e.g. Riya or
// QF Jarvis) could make. It is INERT DATA: it MUST NOT — and structurally CANNOT —
// call CommunicationService or any provider. It imports NO service and NO adapter.
//
// REQUIRED FUTURE PATH (never collapsed):
//   agent recommendation
//     → QuickFurno authorization (Phase 4 Policy Engine)
//     → consent / suppression checks
//     → channel / provider decision
//     → CommunicationService
//     → provider
// This module is only the first node; it wires none of the rest.
// ============================================================================

import { type CommunicationChannel } from "./types";
// NOTE: this module imports ONLY the pure channel type. It deliberately imports
// NEITHER CommunicationService NOR any provider adapter — a recommendation cannot
// dispatch. A test asserts these imports never appear.

// ----------------------------------------------------------------------------
// Vocabularies
// ----------------------------------------------------------------------------
export const CommunicationRecommendationUrgency = {
  LOW: "low",
  NORMAL: "normal",
  HIGH: "high",
  CRITICAL: "critical",
} as const;

export type CommunicationRecommendationUrgencyValue =
  (typeof CommunicationRecommendationUrgency)[keyof typeof CommunicationRecommendationUrgency];

export const KNOWN_COMMUNICATION_RECOMMENDATION_URGENCIES: readonly CommunicationRecommendationUrgencyValue[] =
  Object.freeze(Object.values(CommunicationRecommendationUrgency));

/** The next action a recommendation PROPOSES — a suggestion, never an execution. */
export const CommunicationNextAction = {
  PROPOSE_MESSAGE: "propose_message",
  REQUEST_APPROVAL: "request_approval",
  HOLD: "hold",
  ESCALATE_TO_ADMIN: "escalate_to_admin",
} as const;

export type CommunicationNextActionValue =
  (typeof CommunicationNextAction)[keyof typeof CommunicationNextAction];

// ----------------------------------------------------------------------------
// The pure recommendation contract
// ----------------------------------------------------------------------------
/**
 * A proposed communication. Every field is a declaration; nothing here dispatches.
 * `recipientScopeReference` is a REFERENCE (an audience/segment id), never a
 * plaintext destination and never an enumerated recipient list.
 */
export interface CommunicationRecommendation {
  readonly recommendationId: string;
  readonly purpose: string;
  /** A reference to WHO — a scope/segment id. Never a phone/email/enumerated list. */
  readonly recipientScopeReference: string;
  readonly messageGoal: string;
  readonly urgency: CommunicationRecommendationUrgencyValue;
  readonly preferredChannel: CommunicationChannel;
  readonly allowedFallback: CommunicationChannel | null;
  readonly nextAction: CommunicationNextActionValue;
  readonly correlationId: string | null;
}

/** The required downstream path — documented so no code path can collapse it. */
export const COMMUNICATION_RECOMMENDATION_PATH: readonly string[] = Object.freeze([
  "agent_recommendation",
  "quickfurno_authorization",
  "consent_suppression_checks",
  "channel_provider_decision",
  "communication_service",
  "provider",
]);

/**
 * THE hard guarantee: a communication recommendation can never directly dispatch.
 * Always false. A mutation that lets a recommendation dispatch is caught.
 */
export function communicationRecommendationCanDispatch(_rec?: CommunicationRecommendation): boolean {
  return false;
}
