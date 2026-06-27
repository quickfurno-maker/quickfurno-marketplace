import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const leadLensAgentConfig: AgentConfig = {
  id: "lead-lens",
  name: "QF-AOS-LeadLens",
  slug: "lead-lens",
  status: "active",
  version: "0.1.0",
  description: "Reviews lead quality signals in mock-only foundation mode.",
  capabilities: ["lead quality preview", "duplicate signal placeholder", "invalid lead flag placeholder"],
  permissions: noExternalSideEffectsPermission,
};

export default leadLensAgentConfig;

