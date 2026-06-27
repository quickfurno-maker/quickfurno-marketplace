import type { AgentResult, AgentTask } from "../../types";
import { opsBriefAgentConfig } from "./agent.config";
import type { OpsBriefOutput } from "./schema";

export async function runOpsBrief(task: AgentTask): Promise<AgentResult> {
  const output: OpsBriefOutput = {
    briefMode: "mock-summary",
    highlights: ["AOS foundation is installed but not connected to live operations."],
  };

  return {
    taskId: task.id,
    agentName: opsBriefAgentConfig.name,
    status: "completed",
    summary: "OpsBrief mock result generated with no external delivery.",
    data: { output },
    decisions: ["No report was saved or sent."],
    warnings: ["TODO: Add dashboard-only summaries before email or WhatsApp delivery."],
    requiresApproval: false,
    createdAt: new Date().toISOString(),
  };
}

