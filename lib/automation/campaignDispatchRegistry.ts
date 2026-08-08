// ============================================================================
// QuickFurno — QF-MVP-50.4 Campaign Dispatch Authority
//
// DISPATCH SEMANTICS only, and deliberately thin. Campaign execution already
// has a complete Core-owned contract; this module does not restate it and must
// never become a second copy of it.
//
// WHAT REMAINS AUTHORITATIVE ELSEWHERE
//   audience            vendor_campaign_audience_members, frozen and immutable
//                       at prepare time (dense ordinals, UPDATE/DELETE blocked)
//   version             vendor_campaigns.revision
//   batching            qf_handoff_vendor_campaign_intents_v1, 1..500,
//                       default 100 — the ONLY campaign fan-out
//   per-recipient unit  public.communication_intents
//   consent/suppression/frequency
//                       decided at handoff and RE-PROVEN by Core at execution
//   execution seam      docs/QF-MVP-40-8-CAMPAIGN-RESULT-CONTRACT.md §7:
//                       buildCampaignExecutionPlan -> existing
//                       CommunicationService -> reconcileCampaignIntent
//   aggregation         getCampaignResultProjection, derived from durable truth
//
// n8n holds NONE of the above. It claims a Core-authorized job and drives the
// intent identity Core gave it — it never builds an audience, chooses a
// recipient, picks a template or provider, evaluates consent or frequency, or
// reports an aggregate.
//
// Pure module: no database, network, environment, clock, logging or provider
// import.
// ============================================================================

import type { AutomationActionType, AutomationWorkflowFamily } from "./actionRegistry";

/**
 * The ACTIVE QF-MVP-50.4 campaign action set — exactly one.
 *
 * `campaign.execute_recipient` is the per-recipient execution vehicle: one
 * automation job per already-authorized `communication_intent`.
 */
export const CAMPAIGN_AUTOMATION_ACTION_TYPES = [
  "campaign.execute_recipient",
] as const satisfies readonly AutomationActionType[];

export type CampaignAutomationActionType =
  (typeof CAMPAIGN_AUTOMATION_ACTION_TYPES)[number];

/**
 * REGISTERED BUT NOT PRODUCED by this phase.
 *
 * `campaign.execute_batch` stays in the frozen 14-action requestability
 * registry, but advancing a campaign to its next bounded batch remains the
 * existing Core-owned admin action over
 * `qf_handoff_vendor_campaign_intents_v1`. Producing a batch job here would add
 * a second fan-out layer beside the handoff's own 1..500 bound — exactly the
 * parallel authority this phase forbids.
 */
export const NON_PRODUCED_CAMPAIGN_ACTIONS: Readonly<
  Record<string, { readonly actionType: AutomationActionType; readonly reason: string }>
> = Object.freeze({
  "campaign.execute_batch": Object.freeze({
    actionType: "campaign.execute_batch" as const,
    reason: "BATCH_ADVANCE_REMAINS_CORE_OWNED_HANDOFF",
  }),
});

/**
 * The entity a campaign action is scoped to. Closed, and deliberately the
 * INTENT — not the campaign and not the vendor. Keying on the intent is what
 * makes the automation job a vehicle rather than a second recipient authority.
 */
export const CAMPAIGN_DISPATCH_ENTITY_TYPES = ["communication_intent"] as const;
export type CampaignDispatchEntityType =
  (typeof CAMPAIGN_DISPATCH_ENTITY_TYPES)[number];

/** The aggregate type on the shared outbox that marks a campaign intent. */
export const CAMPAIGN_INTENT_AGGREGATE_TYPE = "vendor_campaign" as const;

/**
 * Campaign consent scope is NOT fixed by this module. A campaign carries its own
 * `vendor_campaigns.consent_scope` (`transactional` or `marketing`) and the
 * handoff enforces the asymmetry: marketing requires an explicit current
 * opt-in, transactional treats only an explicit block as final. Restating a
 * scope here would let a campaign's real scope silently disagree with dispatch.
 */
export const CAMPAIGN_CONSENT_SCOPE_AUTHORITY =
  "vendor_campaigns.consent_scope" as const;

export interface CampaignAutomationDispatchDefinition {
  readonly actionType: CampaignAutomationActionType;
  readonly workflowFamily: AutomationWorkflowFamily;
  readonly allowedEntityTypes: readonly CampaignDispatchEntityType[];
  /** The intent's committed `template_purpose` is the template authority. */
  readonly templateAuthority: "communication_intents.template_purpose";
  /** The campaign row is the consent-scope authority. */
  readonly consentScopeAuthority: typeof CAMPAIGN_CONSENT_SCOPE_AUTHORITY;
  /** n8n may never supply any of these. Stated so a validator can pin it. */
  readonly n8nSuppliedAuthorities: readonly [];
}

export const CAMPAIGN_DISPATCH_REGISTRY: Readonly<
  Record<CampaignAutomationActionType, CampaignAutomationDispatchDefinition>
> = Object.freeze({
  "campaign.execute_recipient": Object.freeze({
    actionType: "campaign.execute_recipient" as const,
    workflowFamily: "campaign_execution" as const,
    allowedEntityTypes: Object.freeze(["communication_intent" as const]),
    templateAuthority: "communication_intents.template_purpose" as const,
    consentScopeAuthority: CAMPAIGN_CONSENT_SCOPE_AUTHORITY,
    n8nSuppliedAuthorities: Object.freeze([] as const),
  }),
});

/** The bounded batch contract, restated for assertion only — never re-implemented. */
export const CAMPAIGN_HANDOFF_BATCH_BOUNDS = Object.freeze({
  min: 1,
  max: 500,
  default: 100,
  authority: "qf_handoff_vendor_campaign_intents_v1",
});

/**
 * The campaign business status vocabulary, restated so a validator can prove it
 * is UNCHANGED by this phase. There is deliberately no `running`, `paused` or
 * `completed`: the campaign model does not expose execution states, and this
 * phase does not expand the state machine.
 */
export const CAMPAIGN_BUSINESS_STATUSES = [
  "draft",
  "ready_for_review",
  "approved",
  "cancelled",
  "archived",
] as const;

export function isCampaignAutomationActionType(
  value: unknown,
): value is CampaignAutomationActionType {
  return (
    typeof value === "string" &&
    (CAMPAIGN_AUTOMATION_ACTION_TYPES as readonly string[]).includes(value)
  );
}

/** Returns null for anything that is not the campaign recipient action. */
export function getCampaignDispatchDefinition(
  actionType: unknown,
): CampaignAutomationDispatchDefinition | null {
  if (!isCampaignAutomationActionType(actionType)) return null;
  return CAMPAIGN_DISPATCH_REGISTRY[actionType];
}

export function isAllowedCampaignDispatchEntityType(
  actionType: unknown,
  entityType: unknown,
): boolean {
  const def = getCampaignDispatchDefinition(actionType);
  if (!def) return false;
  return (def.allowedEntityTypes as readonly string[]).includes(String(entityType));
}

export function getNonProducedCampaignReason(actionType: unknown): string | null {
  if (typeof actionType !== "string") return null;
  return NON_PRODUCED_CAMPAIGN_ACTIONS[actionType]?.reason ?? null;
}
