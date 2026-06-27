import type { AgentMemory } from "../types";

export function getVendorMemorySnapshot(): AgentMemory {
  return {
    agentName: "QF-AOS-MatchForge",
    namespace: "vendors",
    entries: { disabledVendorsExcluded: true, paidPriorityFuture: true },
    updatedAt: new Date().toISOString(),
  };
}

