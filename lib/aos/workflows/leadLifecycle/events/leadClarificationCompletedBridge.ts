import { LeadLifecycleEventType } from "../leadLifecycleEvents";
import { LEAD_LIFECYCLE_WORKFLOW_TYPE, LEAD_ENTITY_TYPE } from "../leadLifecycleStates";
import type { JsonRecord } from "../../../workflow/workflowPersistenceTypes";

export interface ClarificationCompletedEventDraft {
  eventType: typeof LeadLifecycleEventType.CLARIFICATION_COMPLETED;
  entityType: typeof LEAD_ENTITY_TYPE;
  entityId: string;
  payload: JsonRecord;
}

export function buildClarificationCompletedEvent(input: {
  leadId: string;
  requestId?: string | null;
}): ClarificationCompletedEventDraft {
  const leadId = input.leadId.trim();
  if (!leadId) throw new Error("LEAD_ID_REQUIRED");

  return {
    eventType: LeadLifecycleEventType.CLARIFICATION_COMPLETED,
    entityType: LEAD_ENTITY_TYPE,
    entityId: leadId,
    payload: {
      workflow_type: LEAD_LIFECYCLE_WORKFLOW_TYPE,
      lead_id: leadId,
      request_id: input.requestId ?? null,
      source: "clarification_completion_bridge",
    },
  };
}
