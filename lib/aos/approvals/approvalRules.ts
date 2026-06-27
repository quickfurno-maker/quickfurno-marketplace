import type { AgentTask } from "../types";

export function requiresHumanApproval(task: AgentTask): boolean {
  return !task.dryRun || ["database-write", "send-whatsapp", "auto-assign-lead"].includes(task.type);
}

