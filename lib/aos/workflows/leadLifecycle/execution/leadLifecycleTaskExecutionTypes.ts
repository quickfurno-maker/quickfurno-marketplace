import type { JsonRecord } from "../../../workflow/workflowPersistenceTypes";
import type { LeadLifecycleTaskIntentValue } from "../leadLifecycleTaskIntents";

export type LeadLifecycleTaskExecutionStatus =
  | "completed"
  | "deferred_not_enabled"
  // Phase 3A: the prepare_approval task detected a non-standard route
  // (preferred-vendor / requirement-group) and safely deferred without
  // publishing any event or performing any side effect.
  | "deferred_special_route";

export interface LeadLifecycleTaskExecutionResult {
  status: LeadLifecycleTaskExecutionStatus;
  task_type: LeadLifecycleTaskIntentValue;
  lead_id: string;
  workflow_instance_id: string;
  result: JsonRecord;
}
