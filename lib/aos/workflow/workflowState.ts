import type { WorkflowDefinition } from "./workflowTypes";
import type { WorkflowStatus } from "./workflowPersistenceTypes";

export interface TransitionValidationResult {
  ok: boolean;
  code?: "UNKNOWN_STATE" | "INVALID_TRANSITION" | "TERMINAL_WORKFLOW";
  message?: string;
}

const TERMINAL_STATUSES = new Set<WorkflowStatus>(["completed", "failed", "cancelled"]);

export function isTerminalWorkflowStatus(status: WorkflowStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isTerminalState(definition: WorkflowDefinition, state: string): boolean {
  return (definition.terminalStates ?? []).includes(state);
}

export function validateWorkflowTransition(
  definition: WorkflowDefinition,
  fromState: string,
  toState: string,
  currentStatus: WorkflowStatus,
): TransitionValidationResult {
  if (isTerminalWorkflowStatus(currentStatus) || isTerminalState(definition, fromState)) {
    return {
      ok: false,
      code: "TERMINAL_WORKFLOW",
      message: "Terminal workflows cannot transition.",
    };
  }

  const allowed = definition.transitions[fromState];
  if (!allowed) {
    return {
      ok: false,
      code: "UNKNOWN_STATE",
      message: `Unknown workflow state: ${fromState}`,
    };
  }

  if (!allowed.includes(toState)) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `Transition ${fromState} -> ${toState} is not allowed.`,
    };
  }

  return { ok: true };
}

export function normalizeWorkflowStatus(status: WorkflowStatus | undefined): WorkflowStatus {
  return status ?? "active";
}

