export const QUICKFURNO_AUTOMATION_EVENT_TYPES = [
  "lead.created", "lead.scored", "lead.qualified", "lead.clarification_required",
  "lead.rejected_quality", "lead.assignment_preview", "lead.assignment_approved",
  "lead.assignment_queued", "lead.assignment_queue_rechecked", "lead.assigned",
  "vendor.profile_interest_captured", "vendor.recharge_prompt_preview", "vendor.replied",
  "client.followup_due", "client.rating_due", "nurture.due", "report.daily",
  "vendor.low_credit", "complaint.created", "aos.failure", "whatsapp.status_updated",
] as const;

export type QuickFurnoAutomationEventType = (typeof QUICKFURNO_AUTOMATION_EVENT_TYPES)[number];

export interface QuickFurnoSafeSideEffectReport {
  automationEventQueued: boolean;
  whatsappSent: boolean;
  vendorNotified: boolean;
  providerCalled: boolean;
  creditsDeducted: boolean;
  leadAutoAssigned: boolean;
  databaseWritten: boolean;
}
export interface QuickFurnoAutomationEventResult {
  ok: boolean;
  status: "accepted" | "skipped" | "mocked" | "blocked" | "failed";
  eventType?: QuickFurnoAutomationEventType;
  workflowName?: string;
  message: string;
  mockMode: boolean;
  sideEffects: QuickFurnoSafeSideEffectReport;
  details?: Record<string, unknown>;
}

export function createSafeSideEffectReport(): QuickFurnoSafeSideEffectReport {
  return {
    automationEventQueued: false,
    whatsappSent: false,
    vendorNotified: false,
    providerCalled: false,
    creditsDeducted: false,
    leadAutoAssigned: false,
    databaseWritten: false,
  };
}
export function isQuickFurnoAutomationEventType(value: unknown): value is QuickFurnoAutomationEventType {
  return typeof value === "string" && QUICKFURNO_AUTOMATION_EVENT_TYPES.includes(value as QuickFurnoAutomationEventType);
}

export function getSupportedAutomationEventTypes(): QuickFurnoAutomationEventType[] {
  return [...QUICKFURNO_AUTOMATION_EVENT_TYPES];
}
