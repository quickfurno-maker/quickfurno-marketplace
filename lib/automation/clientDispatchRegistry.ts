// ============================================================================
// QuickFurno — QF-MVP-50.2C Client Dispatch Authority
//
// DISPATCH SEMANTICS only. `actionRegistry.ts` remains the REQUESTABILITY
// authority (who may ask for an action); this module answers a different
// question: given an already Core-authorized client action, what static Core
// policy governs how it would later be dispatched.
//
// Deliberately separate objects: merging requestability with dispatch would let
// a change to one silently widen the other.
//
// Pure module: no database, network, environment, clock, logging or provider
// import. It authorizes no send, resolves no destination and picks no provider.
// ============================================================================

import type { AutomationActionType } from "./actionRegistry";
import type { AutomationWorkflowFamily } from "./actionRegistry";

/**
 * The exact roadmap-50.2 client action set. Narrowed from the canonical
 * AutomationActionType union so a typo cannot invent a seventh action, and so
 * removing an action from the canonical registry breaks this file at compile time.
 */
export const CLIENT_AUTOMATION_ACTION_TYPES = [
  "client.lead_confirmation",
  "client.requirement_collection",
  "client.missing_information_reminder",
  "client.matching_update",
  "client.lead_status_update",
  "client.transactional_followup",
] as const satisfies readonly AutomationActionType[];

export type ClientAutomationActionType = (typeof CLIENT_AUTOMATION_ACTION_TYPES)[number];

/**
 * How Core resolves the destination for this action. `lead_direct` means the
 * authoritative contact stored on the lead row itself.
 *
 * It does NOT mean the lead is an authenticated client principal, that phone
 * equality proves account ownership, or that a lead id may be used as a
 * client_account id. Those remain separate authorities.
 */
export const CLIENT_RECIPIENT_STRATEGIES = ["lead_direct"] as const;
export type ClientRecipientStrategy = (typeof CLIENT_RECIPIENT_STRATEGIES)[number];

/** The entity a client action is scoped to. Closed — never a free string. */
export const CLIENT_DISPATCH_ENTITY_TYPES = ["lead"] as const;
export type ClientDispatchEntityType = (typeof CLIENT_DISPATCH_ENTITY_TYPES)[number];

/**
 * Existing Core communication vocabulary, restated as static dispatch policy.
 * `lane` is the ledger lane; `consentScope` is the governing consent scope —
 * they are distinct on purpose (the lane alone cannot separate transactional
 * from marketing).
 */
export type ClientDispatchLane = "business";
export type ClientDispatchConsentScope = "transactional";

export interface ClientAutomationDispatchDefinition {
  readonly actionType: ClientAutomationActionType;
  readonly workflowFamily: AutomationWorkflowFamily;
  readonly allowedEntityTypes: readonly ClientDispatchEntityType[];
  readonly recipientStrategy: ClientRecipientStrategy;
  readonly communicationLane: ClientDispatchLane;
  readonly consentScope: ClientDispatchConsentScope;
  /**
   * The INTENDED internal template key. This is Core dispatch intent only — it is
   * never proof that an approved provider template or an active provider mapping
   * exists. Real execution must still fail closed unless the communication
   * subsystem proves an exact active approved mapping at dispatch time.
   */
  readonly templateKey: string;
  /** Identity of the canonical action variable builder (see clientDispatchVariables). */
  readonly variableBuilderKey: ClientAutomationActionType;
}

function definition(
  actionType: ClientAutomationActionType,
  templateKey: string,
): ClientAutomationDispatchDefinition {
  return Object.freeze({
    actionType,
    workflowFamily: "client_whatsapp" as const,
    allowedEntityTypes: Object.freeze(["lead" as const]),
    recipientStrategy: "lead_direct" as const,
    communicationLane: "business" as const,
    consentScope: "transactional" as const,
    templateKey,
    variableBuilderKey: actionType,
  });
}

/**
 * Total over exactly the six client actions. There is no default entry and no
 * prefix parser: an unregistered action resolves to nothing and fails closed.
 */
export const CLIENT_DISPATCH_REGISTRY: Readonly<
  Record<ClientAutomationActionType, ClientAutomationDispatchDefinition>
> = Object.freeze({
  "client.lead_confirmation": definition("client.lead_confirmation", "lead_received"),
  "client.requirement_collection": definition("client.requirement_collection", "clarification_request"),
  "client.missing_information_reminder": definition("client.missing_information_reminder", "clarification_reminder"),
  "client.matching_update": definition("client.matching_update", "client_matching_update"),
  "client.lead_status_update": definition("client.lead_status_update", "client_lead_status_update"),
  "client.transactional_followup": definition("client.transactional_followup", "client_transactional_followup"),
});

export function isClientAutomationActionType(
  value: unknown,
): value is ClientAutomationActionType {
  return (
    typeof value === "string" &&
    (CLIENT_AUTOMATION_ACTION_TYPES as readonly string[]).includes(value)
  );
}

/** Returns null for anything that is not one of the six. Never a fallback definition. */
export function getClientDispatchDefinition(
  actionType: unknown,
): ClientAutomationDispatchDefinition | null {
  if (!isClientAutomationActionType(actionType)) return null;
  return CLIENT_DISPATCH_REGISTRY[actionType];
}

/** True only when the action is a client action AND the entity type is permitted. */
export function isAllowedClientDispatchEntityType(
  actionType: unknown,
  entityType: unknown,
): boolean {
  const def = getClientDispatchDefinition(actionType);
  if (!def) return false;
  return (
    typeof entityType === "string" &&
    (def.allowedEntityTypes as readonly string[]).includes(entityType)
  );
}

// ---------------------------------------------------------------------------
// Communication idempotency identity
// ---------------------------------------------------------------------------

/** Namespaced so an automation-originated send can never collide with another lane. */
export const AUTOMATION_COMMUNICATION_IDEMPOTENCY_PREFIX = "qf_auto_v1";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The durable communication idempotency key for ONE automation attempt.
 *
 * Derived by Core from re-proven job/attempt identity — n8n can neither supply
 * nor override it. Carries no destination, recipient, template or provider
 * information, so it is safe to surface as an opaque reference. The same attempt
 * always yields the same key (a repeated dispatch request returns the existing
 * communication row); a different attempt yields a different key.
 *
 * `actionType` is deliberately absent: jobId already determines it, and adding it
 * would let two keys describe the same attempt.
 */
export function buildAutomationCommunicationIdempotencyKey(
  jobId: unknown,
  attemptId: unknown,
): string | null {
  if (typeof jobId !== "string" || !UUID_RE.test(jobId)) return null;
  if (typeof attemptId !== "string" || !UUID_RE.test(attemptId)) return null;
  return `${AUTOMATION_COMMUNICATION_IDEMPOTENCY_PREFIX}:${jobId}:${attemptId}`;
}
