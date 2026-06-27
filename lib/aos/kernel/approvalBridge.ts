import type { AgentName, ApprovalRequest } from "../types";

export function buildApprovalRequest(input: {
  id: string;
  agentName: AgentName;
  taskId: string;
  title: string;
  reason: string;
  metadata?: Record<string, unknown>;
}): ApprovalRequest {
  return {
    id: input.id,
    agentName: input.agentName,
    taskId: input.taskId,
    title: input.title,
    reason: input.reason,
    status: "pending",
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  };
}

