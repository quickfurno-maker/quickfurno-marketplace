import type { WorkflowRegistry } from "../../workflow/workflowRegistry";
import { createLeadLifecycleWorkflowDefinition } from "./leadLifecycleDefinition";

/**
 * Registration helper for the QuickFurno Lead Lifecycle workflow (Phase 2A).
 *
 * IMPORTANT: This helper is intentionally NOT called from any production kernel
 * startup. Nothing in Phase 2A globally activates the lead lifecycle workflow.
 * Callers (tests, and future Phase 2B wiring) opt in explicitly by passing a
 * registry. The generic kernel and the isolated kernel test workflow are unaffected.
 */
export function registerLeadLifecycleWorkflow(registry: WorkflowRegistry): void {
  registry.register(createLeadLifecycleWorkflowDefinition());
}
