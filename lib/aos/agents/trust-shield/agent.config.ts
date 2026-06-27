import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const trustShieldAgentConfig: AgentConfig = {
  id: "trust-shield",
  name: "QF-AOS-TrustShield",
  slug: "trust-shield",
  status: "active",
  version: "0.1.0",
  description: "Reviews vendor trust and safety signals in mock-only foundation mode.",
  capabilities: ["vendor trust preview", "document review placeholder", "risk flag placeholder"],
  permissions: noExternalSideEffectsPermission,
};

export default trustShieldAgentConfig;

