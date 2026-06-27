import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const contentCraftAgentConfig: AgentConfig = {
  id: "content-craft",
  name: "QF-AOS-ContentCraft",
  slug: "content-craft",
  status: "future",
  version: "0.1.0",
  description: "Future content assistant agent placeholder.",
  capabilities: [],
  permissions: noExternalSideEffectsPermission,
};

export default contentCraftAgentConfig;

