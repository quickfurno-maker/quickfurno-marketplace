import type { AgentMemory } from "../types";

export function getFurnoMemorySnapshot(): AgentMemory {
  return {
    agentName: "QF-AOS-FurnoMemory",
    namespace: "marketplace",
    entries: {
      mode: "placeholder",
      note: "TODO: Connect to approved memory tables after schema review.",
    },
    updatedAt: new Date().toISOString(),
  };
}

