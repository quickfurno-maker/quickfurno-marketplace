import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const adminCopilotAgentConfig: AgentConfig = {
  id: "admin-copilot",
  name: "QF-AOS-AdminCopilot",
  slug: "admin-copilot",
  status: "future",
  version: "0.1.0",
  description: "Future admin copilot placeholder.",
  capabilities: [],
  permissions: noExternalSideEffectsPermission,
};

export default adminCopilotAgentConfig;

