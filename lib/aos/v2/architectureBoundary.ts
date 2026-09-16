export const QUICKFURNO_PLATFORM_BOUNDARY = Object.freeze({
  core: Object.freeze({
    role: "business_truth_policy_authorization",
    integrationHub: true,
  }),
  aos: Object.freeze({
    role: "internal_business_intelligence",
    businessAuthority: false,
    customerConversation: false,
    directExternalExecutor: false,
  }),
  jarvis: Object.freeze({
    role: "customer_conversation_and_care",
    integration: "future_via_quickfurno_core",
    businessAuthority: false,
    directAosMutation: false,
  }),
  nativeAutomation: Object.freeze({
    role: "core_authorized_execution_orchestration",
    businessAuthority: false,
    queue: "automation_jobs",
  }),
  conversationTriggering: Object.freeze({
    standardKnownCondition: "quickfurno_core",
    intelligentNonStandardCondition: "aos_recommends_core_authorizes",
    executionHandoff: "native_worker_after_core_authorization",
    conversationOwner: "jarvis_riya_after_integration",
    resultAuthority: "quickfurno_core",
  }),
} as const);

export { QUICKFURNO_LEAD_GENERATION_BOUNDARY } from "../../marketplace/leadGenerationBoundary";
