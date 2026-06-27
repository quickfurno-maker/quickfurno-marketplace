import type { AgentName, AgentTask } from "../types";

const TASK_AGENT_MAP: Record<string, AgentName> = {
  lead_quality_review: "QF-AOS-LeadLens",
  vendor_trust_review: "QF-AOS-TrustShield",
  vendor_matching_preview: "QF-AOS-MatchForge",
  lead_flow_preview: "QF-AOS-LeadFlow",
  ops_summary: "QF-AOS-OpsBrief",
  memory_lookup: "QF-AOS-FurnoMemory",
};

export function routeAgentTask(task: AgentTask): AgentName {
  return TASK_AGENT_MAP[task.type] ?? "QF-AOS-NexusKernel";
}

