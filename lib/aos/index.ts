export * from "./types";

export { default as nexusKernelAgentConfig } from "./agents/nexus-kernel/agent.config";
export { default as furnoMemoryAgentConfig } from "./agents/furno-memory/agent.config";
export { default as leadLensAgentConfig } from "./agents/lead-lens/agent.config";
export { default as trustShieldAgentConfig } from "./agents/trust-shield/agent.config";
export { default as matchForgeAgentConfig } from "./agents/match-forge/agent.config";
export { default as leadFlowAgentConfig } from "./agents/lead-flow/agent.config";
export { default as opsBriefAgentConfig } from "./agents/ops-brief/agent.config";

export { default as clientCareAgentConfig } from "./agents/client-care/agent.config";
export { default as vendorPulseAgentConfig } from "./agents/vendor-pulse/agent.config";
export { default as revenueVaultAgentConfig } from "./agents/revenue-vault/agent.config";
export { default as reviewShieldAgentConfig } from "./agents/review-shield/agent.config";
export { default as growthRadarAgentConfig } from "./agents/growth-radar/agent.config";
export { default as contentCraftAgentConfig } from "./agents/content-craft/agent.config";
export { default as adminCopilotAgentConfig } from "./agents/admin-copilot/agent.config";
export { default as vaultGuardAgentConfig } from "./agents/vault-guard/agent.config";

// Phase 1D — future inactive agents (16–30). Config metadata only; no services
// are exported here, so importing this barrel triggers no agent execution.
export { default as leadNurtureAgentConfig } from "./agents/lead-nurture/agent.config";
export { default as calendarSyncAgentConfig } from "./agents/calendar-sync/agent.config";
export { default as sourceTrackerAgentConfig } from "./agents/source-tracker/agent.config";
export { default as adBrainAgentConfig } from "./agents/ad-brain/agent.config";
export { default as cityScoutAgentConfig } from "./agents/city-scout/agent.config";
export { default as vendorOnboardAgentConfig } from "./agents/vendor-onboard/agent.config";
export { default as dealTrackerAgentConfig } from "./agents/deal-tracker/agent.config";
export { default as qualityAuditAgentConfig } from "./agents/quality-audit/agent.config";
export { default as packageAdvisorAgentConfig } from "./agents/package-advisor/agent.config";
export { default as whatsappPilotAgentConfig } from "./agents/whatsapp-pilot/agent.config";
export { default as replacementDeskAgentConfig } from "./agents/replacement-desk/agent.config";
export { default as fraudRadarAgentConfig } from "./agents/fraud-radar/agent.config";
export { default as seoScoutAgentConfig } from "./agents/seo-scout/agent.config";
export { default as salesCoachAgentConfig } from "./agents/sales-coach/agent.config";
export { default as executiveBriefAgentConfig } from "./agents/executive-brief/agent.config";

export { AOS_AGENT_REGISTRY, AOS_AGENT_COUNT, getAgentRegistryEntry, getAgentsByStatus } from "./agents/agentRegistry";

export { runNexusKernel } from "./kernel/nexusKernel";
export { routeAgentTask } from "./kernel/taskRouter";
export { checkAgentPermission } from "./kernel/permissionGate";
export { buildAOSContext } from "./kernel/contextBuilder";
export { createEventBus } from "./events/eventBus";
export { aosEventTypes } from "./events/eventTypes";
