import { noExternalSideEffectsPermission, type AgentConfig } from "../../types";

export const nexusKernelAgentConfig: AgentConfig = {
  id: "nexus-kernel",
  name: "QF-AOS-NexusKernel",
  slug: "nexus-kernel",
  status: "active",
  version: "0.1.0",
  description: "Coordinates AOS task routing in mock-only foundation mode.",
  capabilities: ["task routing placeholder", "permission gate placeholder", "approval bridge placeholder"],
  permissions: noExternalSideEffectsPermission,
};

export default nexusKernelAgentConfig;

