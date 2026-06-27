import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const vaultGuardAgentConfig: AgentConfig = {
  id: "vault-guard",
  name: "QF-AOS-VaultGuard",
  slug: "vault-guard",
  status: "future",
  version: "0.1.0",
  description: "Future security guard agent placeholder.",
  capabilities: [],
  permissions: noExternalSideEffectsPermission,
};

export default vaultGuardAgentConfig;

