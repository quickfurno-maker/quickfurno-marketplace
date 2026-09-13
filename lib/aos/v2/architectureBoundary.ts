export const QUICKFURNO_PLATFORM_BOUNDARY = Object.freeze({
  core: Object.freeze({
    role: "business_truth_policy_authorization",
    integrationHub: true,
  }),
  aos: Object.freeze({
    role: "internal_business_intelligence",
    businessAuthority: false,
    customerConversation: false,
    directN8n: false,
  }),
  jarvis: Object.freeze({
    role: "customer_conversation_and_care",
    integration: "future_via_quickfurno_core",
    businessAuthority: false,
    directAosMutation: false,
  }),
  n8n: Object.freeze({
    role: "authorized_execution_orchestration",
    businessAuthority: false,
  }),
  conversationTriggering: Object.freeze({
    standardKnownCondition: "quickfurno_core",
    intelligentNonStandardCondition: "aos_recommends_core_authorizes",
    executionHandoff: "n8n_after_core_authorization",
    conversationOwner: "jarvis_riya_after_integration",
    resultAuthority: "quickfurno_core",
  }),
} as const);

export { QUICKFURNO_LEAD_GENERATION_BOUNDARY } from "../../marketplace/leadGenerationBoundary";
