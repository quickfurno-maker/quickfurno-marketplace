import type { JsonRecord } from "../../../workflow/workflowPersistenceTypes";
import type { LeadLifecycleTaskIntentValue } from "../leadLifecycleTaskIntents";

export type LeadLifecycleTaskExecutionStatus =
  | "completed"
  | "deferred_not_enabled";

export interface LeadLifecycleTaskExecutionResult {
  status: LeadLifecycleTaskExecutionStatus;
  task_type: LeadLifecycleTaskIntentValue;
  lead_id: string;
  workflow_instance_id: string;
  result: JsonRecord;
}
