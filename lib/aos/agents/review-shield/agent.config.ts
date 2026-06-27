import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const reviewShieldAgentConfig: AgentConfig = {
  id: "review-shield",
  name: "QF-AOS-ReviewShield",
  slug: "review-shield",
  status: "future",
  version: "0.1.0",
  description: "Future review trust agent placeholder.",
  capabilities: [],
  permissions: noExternalSideEffectsPermission,
};

export default reviewShieldAgentConfig;

