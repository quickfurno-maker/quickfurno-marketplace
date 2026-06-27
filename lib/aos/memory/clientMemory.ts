import type { AgentMemory } from "../types";

export function getClientMemorySnapshot(): AgentMemory {
  return {
    agentName: "QF-AOS-LeadFlow",
    namespace: "clients",
    entries: { privacyMode: "strict-placeholder" },
    updatedAt: new Date().toISOString(),
  };
}

