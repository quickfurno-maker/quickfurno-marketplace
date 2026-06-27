import type { AgentResult, AgentTask } from "../../types";
import { matchForgeAgentConfig } from "./agent.config";
import type { MatchForgeOutput } from "./schema";

export async function runMatchForge(task: AgentTask): Promise<AgentResult> {
  const output: MatchForgeOutput = {
    maxVendorsPerLead: 3,
    selectedVendorIds: [],
    recommendedNextStep: "No vendors assigned. This is a preview-only foundation result.",
  };

  return {
    taskId: task.id,
    agentName: matchForgeAgentConfig.name,
    status: "completed",
    summary: "MatchForge mock result generated with no lead distribution.",
    data: { output },
    decisions: ["No credits were deducted and no assignments were created."],
    warnings: ["TODO: Connect only after paid-priority and disabled-vendor rules are tested."],
    requiresApproval: true,
    createdAt: new Date().toISOString(),
  };
}

