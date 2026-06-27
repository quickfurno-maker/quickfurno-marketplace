import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const revenueVaultAgentConfig: AgentConfig = {
  id: "revenue-vault",
  name: "QF-AOS-RevenueVault",
  slug: "revenue-vault",
  status: "future",
  version: "0.1.0",
  description: "Future revenue intelligence agent placeholder.",
  capabilities: [],
  permissions: noExternalSideEffectsPermission,
};

export default revenueVaultAgentConfig;

