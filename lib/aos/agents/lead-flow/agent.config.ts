import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const leadFlowAgentConfig: AgentConfig = {
  id: "lead-flow",
  name: "QF-AOS-LeadFlow",
  slug: "lead-flow",
  status: "active",
  version: "0.1.0",
  description: "Models lead lifecycle steps without changing live lead state.",
  capabilities: ["lead workflow preview", "delivery-state preview", "replacement placeholder"],
  permissions: noExternalSideEffectsPermission,
};

export default leadFlowAgentConfig;

