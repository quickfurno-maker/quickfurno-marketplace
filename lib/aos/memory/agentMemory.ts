import type { AgentMemory, AgentName } from "../types";

export function getAgentMemorySnapshot(agentName: AgentName): AgentMemory {
  return {
    agentName,
    namespace: "agent-runtime",
    entries: { lastRun: null, status: "mock-only" },
    updatedAt: new Date().toISOString(),
  };
}

