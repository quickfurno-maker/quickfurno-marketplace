import type { AgentResult, AgentTask } from "../../types";
import { leadLensAgentConfig } from "./agent.config";
import type { LeadLensOutput } from "./schema";

export async function runLeadLens(task: AgentTask): Promise<AgentResult> {
  const output: LeadLensOutput = {
    qualityLabel: "mock-review-only",
    riskFlags: [],
    recommendedNextStep: "Keep lead in existing workflow. No automated action taken.",
  };

  return {
    taskId: task.id,
    agentName: leadLensAgentConfig.name,
    status: "completed",
    summary: "LeadLens mock result generated with no side effects.",
    data: { output },
    decisions: ["No lead score was persisted."],
    warnings: ["TODO: Add read-only Supabase context after Phase 1 approval."],
    requiresApproval: false,
    createdAt: new Date().toISOString(),
  };
}

