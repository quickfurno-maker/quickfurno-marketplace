import type { AgentTask } from "../types";

export interface AOSContext {
  taskId: string;
  dryRun: boolean;
  marketplace: "QuickFurno";
  maxVendorsPerLead: 3;
  notes: string[];
}

export function buildAOSContext(task: AgentTask): AOSContext {
  return {
    taskId: task.id,
    dryRun: task.dryRun,
    marketplace: "QuickFurno",
    maxVendorsPerLead: 3,
    notes: [
      "Phase 1 context is static and read-safe.",
      "TODO: Add Supabase read models after approval.",
    ],
  };
}

