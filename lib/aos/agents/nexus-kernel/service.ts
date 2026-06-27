import type { AgentResult, AgentTask } from "../../types";
import { runNexusKernel } from "../../kernel/nexusKernel";

export async function runNexusKernelAgent(task: AgentTask): Promise<AgentResult> {
  return runNexusKernel(task);
}

