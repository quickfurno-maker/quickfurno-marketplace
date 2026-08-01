// ============================================================================
// QuickFurno — QF-MVP-50.1A Action Registry
//
// REQUESTABILITY only. Core remains the sole business authorization authority.
// ============================================================================

import type { AutomationRequestSource } from "./actionContract";

export const AUTOMATION_ACTION_TYPES = [
  "client.lead_confirmation",
  "client.requirement_collection",
  "client.missing_information_reminder",
  "client.matching_update",
  "client.lead_status_update",
  "client.transactional_followup",
  "vendor.lead_offer",
  "vendor.response_reminder",
  "vendor.onboarding_reminder",
  "vendor.document_reminder",
  "vendor.package_expiry_warning",
  "vendor.low_credit_warning",
  "campaign.execute_batch",
  "campaign.execute_recipient",
] as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export type AutomationWorkflowFamily =
  | "client_whatsapp"
  | "vendor_whatsapp"
  | "campaign_execution";

export interface AutomationActionDefinition {
  actionType: AutomationActionType;
  workflowFamily: AutomationWorkflowFamily;
  allowedRequestSources: readonly AutomationRequestSource[];
  agentRequestable: boolean;
}

const CORE_SOURCES = ["core", "admin", "system"] as const;
const CLIENT_AGENT_SOURCES = ["jarvis", "riya", "anisha"] as const;
const JARVIS_ONLY = ["jarvis"] as const;

export const AUTOMATION_ACTION_REGISTRY: Readonly<
  Record<AutomationActionType, AutomationActionDefinition>
> = Object.freeze({
  "client.lead_confirmation": definition(
    "client.lead_confirmation",
    "client_whatsapp",
    [...CORE_SOURCES, ...CLIENT_AGENT_SOURCES],
  ),
  "client.requirement_collection": definition(
    "client.requirement_collection",
    "client_whatsapp",
    [...CORE_SOURCES, ...CLIENT_AGENT_SOURCES],
  ),
  "client.missing_information_reminder": definition(
    "client.missing_information_reminder",
    "client_whatsapp",
    [...CORE_SOURCES, ...CLIENT_AGENT_SOURCES],
  ),
  "client.matching_update": definition(
    "client.matching_update",
    "client_whatsapp",
    [...CORE_SOURCES, ...CLIENT_AGENT_SOURCES],
  ),
  "client.lead_status_update": definition(
    "client.lead_status_update",
    "client_whatsapp",
    [...CORE_SOURCES, ...CLIENT_AGENT_SOURCES],
  ),
  "client.transactional_followup": definition(
    "client.transactional_followup",
    "client_whatsapp",
    [...CORE_SOURCES, ...CLIENT_AGENT_SOURCES],
  ),
  "vendor.lead_offer": definition(
    "vendor.lead_offer",
    "vendor_whatsapp",
    [...CORE_SOURCES],
  ),
  "vendor.response_reminder": definition(
    "vendor.response_reminder",
    "vendor_whatsapp",
    [...CORE_SOURCES, ...JARVIS_ONLY],
  ),
  "vendor.onboarding_reminder": definition(
    "vendor.onboarding_reminder",
    "vendor_whatsapp",
    [...CORE_SOURCES, ...JARVIS_ONLY],
  ),
  "vendor.document_reminder": definition(
    "vendor.document_reminder",
    "vendor_whatsapp",
    [...CORE_SOURCES, ...JARVIS_ONLY],
  ),
  "vendor.package_expiry_warning": definition(
    "vendor.package_expiry_warning",
    "vendor_whatsapp",
    [...CORE_SOURCES],
  ),
  "vendor.low_credit_warning": definition(
    "vendor.low_credit_warning",
    "vendor_whatsapp",
    [...CORE_SOURCES],
  ),
  "campaign.execute_batch": definition(
    "campaign.execute_batch",
    "campaign_execution",
    [...CORE_SOURCES],
  ),
  "campaign.execute_recipient": definition(
    "campaign.execute_recipient",
    "campaign_execution",
    [...CORE_SOURCES],
  ),
});

export function isAutomationActionType(
  value: unknown,
): value is AutomationActionType {
  return (
    typeof value === "string" &&
    AUTOMATION_ACTION_TYPES.includes(value as AutomationActionType)
  );
}

/**
 * This checks only whether a source may SUBMIT a request. A true result never
 * means the action is authorized. Core must still revalidate all business,
 * consent, suppression, evidence, mapping/provider and idempotency conditions.
 */
export function canSourceRequestAction(
  source: AutomationRequestSource,
  actionType: AutomationActionType,
): boolean {
  return AUTOMATION_ACTION_REGISTRY[actionType].allowedRequestSources.includes(
    source,
  );
}

export function getWorkflowFamilyForAction(
  actionType: AutomationActionType,
): AutomationWorkflowFamily {
  return AUTOMATION_ACTION_REGISTRY[actionType].workflowFamily;
}

function definition(
  actionType: AutomationActionType,
  workflowFamily: AutomationWorkflowFamily,
  allowedRequestSources: readonly AutomationRequestSource[],
): AutomationActionDefinition {
  const uniqueSources = [...new Set(allowedRequestSources)];
  return Object.freeze({
    actionType,
    workflowFamily,
    allowedRequestSources: Object.freeze(uniqueSources),
    agentRequestable: uniqueSources.some(
      (source) => source === "jarvis" || source === "riya" || source === "anisha",
    ),
  });
}
