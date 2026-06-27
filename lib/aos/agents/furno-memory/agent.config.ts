import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const furnoMemoryAgentConfig: AgentConfig = {
  id: "furno-memory",
  name: "QF-AOS-FurnoMemory",
  slug: "furno-memory",
  status: "active",
  version: "0.1.0",
  description: "Provides placeholder memory snapshots for future AOS context.",
  capabilities: ["memory snapshot placeholder", "agent context placeholder"],
  permissions: noExternalSideEffectsPermission,
};

export default furnoMemoryAgentConfig;

