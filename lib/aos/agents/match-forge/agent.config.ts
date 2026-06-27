import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const matchForgeAgentConfig: AgentConfig = {
  id: "match-forge",
  name: "QF-AOS-MatchForge",
  slug: "match-forge",
  status: "active",
  version: "0.1.0",
  description: "Previews lead-to-vendor matching logic without assignment.",
  capabilities: ["match preview", "max 3 vendors rule placeholder", "paid priority placeholder"],
  permissions: noExternalSideEffectsPermission,
};

export default matchForgeAgentConfig;

