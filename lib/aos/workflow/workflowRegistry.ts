import type { WorkflowDefinition } from "./workflowTypes";

export interface WorkflowRegistry {
  register(definition: WorkflowDefinition): void;
  resolve(workflowType: string): WorkflowDefinition | null;
  listWorkflowTypes(): string[];
}

export function createWorkflowRegistry(): WorkflowRegistry {
  const definitions = new Map<string, WorkflowDefinition>();

  return {
    register(definition: WorkflowDefinition) {
      const workflowType = definition.workflowType.trim();
      if (!workflowType) {
        throw new Error("WORKFLOW_TYPE_REQUIRED");
      }
      if (definitions.has(workflowType)) {
        throw new Error("WORKFLOW_DEFINITION_ALREADY_REGISTERED");
      }
      definitions.set(workflowType, { ...definition, workflowType });
    },

    resolve(workflowType: string) {
      return definitions.get(workflowType.trim()) ?? null;
    },

    listWorkflowTypes() {
      return [...definitions.keys()].sort();
    },
  };
}

