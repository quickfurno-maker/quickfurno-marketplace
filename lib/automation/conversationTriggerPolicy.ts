// ============================================================================
// QuickFurno conversation-trigger ownership policy.
//
// Standard known conditions are Core-owned. AOS may recommend a conversation
// for a non-standard condition, but Core must authorize it. Jarvis/Riya conduct
// the conversation only after handoff; n8n orchestrates authorized execution.
// ============================================================================

import type { AutomationActionType } from "./actionRegistry";

export const STANDARD_CORE_CONVERSATION_ACTIONS = Object.freeze([
  "client.requirement_collection",
  "client.missing_information_reminder",
] as const satisfies readonly AutomationActionType[]);

export const AOS_INTELLIGENT_CONVERSATION_ACTIONS = Object.freeze([
  "client.requirement_collection",
] as const satisfies readonly AutomationActionType[]);

export type ConversationTriggerOrigin =
  | "core_rule"
  | "aos_recommendation"
  | "jarvis";

export type ConversationTriggerDecision =
  | "core_standard_authority"
  | "core_review_required"
  | "jarvis_not_trigger_authority"
  | "not_governed_conversation_action";

export function resolveConversationTriggerDecision(input: {
  origin: ConversationTriggerOrigin;
  actionType: AutomationActionType;
}): ConversationTriggerDecision {
  if (input.origin === "jarvis") return "jarvis_not_trigger_authority";

  if (
    input.origin === "core_rule" &&
    STANDARD_CORE_CONVERSATION_ACTIONS.includes(
      input.actionType as (typeof STANDARD_CORE_CONVERSATION_ACTIONS)[number],
    )
  ) {
    return "core_standard_authority";
  }

  if (
    input.origin === "aos_recommendation" &&
    AOS_INTELLIGENT_CONVERSATION_ACTIONS.includes(
      input.actionType as (typeof AOS_INTELLIGENT_CONVERSATION_ACTIONS)[number],
    )
  ) {
    return "core_review_required";
  }

  return "not_governed_conversation_action";
}
