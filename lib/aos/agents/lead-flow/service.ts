import type { AgentResult, AgentTask } from "../../types";
import { leadFlowAgentConfig } from "./agent.config";
import type { LeadFlowOutput } from "./schema";

export async function runLeadFlow(task: AgentTask): Promise<AgentResult> {
  const output: LeadFlowOutput = {
    lifecycleMode: "mock-preview",
    nextStatusSuggestion: "No status change in Phase 1.",
    replacementPolicy: "replace_not_refund",
  };

  return {
    taskId: task.id,
    agentName: leadFlowAgentConfig.name,
    status: "completed",
    summary: "LeadFlow mock result generated with no workflow changes.",
    data: { output },
    decisions: ["No lead status was updated."],
    warnings: ["TODO: Add replacement workflow only after admin approval screens exist."],
    requiresApproval: true,
    createdAt: new Date().toISOString(),
  };
}

