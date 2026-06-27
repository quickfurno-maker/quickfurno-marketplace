import type { AgentLog, AgentName } from "../types";

export function createAgentLog(input: {
  id: string;
  agentName: AgentName;
  taskId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}): AgentLog {
  return {
    id: input.id,
    agentName: input.agentName,
    taskId: input.taskId,
    level: "info",
    message: input.message,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  };
}

