import type { WorkflowDefinition } from "../../workflow/workflowTypes";
import {
  LEAD_LIFECYCLE_INITIAL_STATE,
  LEAD_LIFECYCLE_TERMINAL_STATES,
  LEAD_LIFECYCLE_TRANSITIONS,
  LEAD_LIFECYCLE_WORKFLOW_TYPE,
} from "./leadLifecycleStates";
import { leadLifecycleHandler } from "./leadLifecycleHandler";

/**
 * QuickFurno Lead Lifecycle workflow definition (Phase 2A).
 *
 * Declarative only. This definition is NOT globally activated in the production
 * kernel runtime. It is registered explicitly via `registerLeadLifecycleWorkflow`
 * for isolated tests and future Phase 2B wiring. It shares the generic Workflow
 * Kernel and never replaces or interferes with the isolated kernel test workflow.
 */
export function createLeadLifecycleWorkflowDefinition(): WorkflowDefinition {
  return {
    workflowType: LEAD_LIFECYCLE_WORKFLOW_TYPE,
    initialState: LEAD_LIFECYCLE_INITIAL_STATE,
    activeStatus: "active",
    terminalStates: [...LEAD_LIFECYCLE_TERMINAL_STATES],
    transitions: LEAD_LIFECYCLE_TRANSITIONS,
    handler: leadLifecycleHandler,
  };
}
