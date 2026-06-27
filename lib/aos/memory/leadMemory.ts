import type { AgentMemory } from "../types";

export function getLeadMemorySnapshot(): AgentMemory {
  return {
    agentName: "QF-AOS-LeadLens",
    namespace: "leads",
    entries: { maxMatchedVendors: 3, mode: "read-model-placeholder" },
    updatedAt: new Date().toISOString(),
  };
}

