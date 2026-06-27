import type { AgentResult, AgentTask } from "../../types";
import { getFurnoMemorySnapshot } from "../../memory/furnoMemory";
import { furnoMemoryAgentConfig } from "./agent.config";
import type { FurnoMemoryOutput } from "./schema";

export async function runFurnoMemory(task: AgentTask): Promise<AgentResult> {
  const memory = getFurnoMemorySnapshot();
  const output: FurnoMemoryOutput = {
    memoryMode: "mock-snapshot",
    entries: memory.entries,
  };

  return {
    taskId: task.id,
    agentName: furnoMemoryAgentConfig.name,
    status: "completed",
    summary: "FurnoMemory mock snapshot generated with no storage writes.",
    data: { output },
    decisions: ["No memory was persisted."],
    warnings: ["TODO: Add privacy-reviewed memory namespaces before storage."],
    requiresApproval: false,
    createdAt: new Date().toISOString(),
  };
}

