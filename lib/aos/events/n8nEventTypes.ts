export const QUICKFURNO_N8N_EVENT_TYPES = [
  "lead.created",
  "lead.qualified",
  "lead.assignment_preview",
  "lead.assignment_approved",
  "lead.assigned",
  "vendor.replied",
  "client.followup_due",
  "client.rating_due",
  "nurture.due",
  "report.daily",
  "vendor.low_credit",
  "complaint.created",
  "aos.failure",
  "whatsapp.status_updated",
] as const;

export type QuickFurnoN8nEventType = (typeof QUICKFURNO_N8N_EVENT_TYPES)[number];

export interface QuickFurnoSafeSideEffectReport {
  n8nWebhookCalled: boolean;
  whatsappSent: boolean;
  providerCalled: boolean;
  creditsDeducted: boolean;
  leadAutoAssigned: boolean;
  databaseWritten: boolean;
}

export interface QuickFurnoN8nEventPayload {
  id?: string;
  eventId?: string;
  eventType: QuickFurnoN8nEventType;
  type?: QuickFurnoN8nEventType;
  source?: string;
  leadId?: string | null;
  vendorId?: string | null;
  clientId?: string | null;
  occurredAt?: string;
  workflowName?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type QuickFurnoN8nEventResultStatus =
  | "accepted"
  | "skipped"
  | "mocked"
  | "blocked"
  | "failed";

export interface QuickFurnoN8nEventResult {
  ok: boolean;
  status: QuickFurnoN8nEventResultStatus;
  eventType?: QuickFurnoN8nEventType;
  workflowName?: string;
  message: string;
  mockMode: boolean;
  sideEffects: QuickFurnoSafeSideEffectReport;
  details?: Record<string, unknown>;
}

export interface QuickFurnoWebhookStatusPayload {
  messageId?: string;
  provider?: string;
  status?: string;
  phone?: string | null;
  maskedPhone?: string | null;
  leadId?: string | null;
  vendorId?: string | null;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface QuickFurnoAosFailurePayload {
  failureId?: string;
  eventType?: QuickFurnoN8nEventType | "unknown";
  workflowName?: string;
  agentKey?: string;
  taskType?: string;
  entityType?: string;
  entityId?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export function createSafeSideEffectReport(): QuickFurnoSafeSideEffectReport {
  return {
    n8nWebhookCalled: false,
    whatsappSent: false,
    providerCalled: false,
    creditsDeducted: false,
    leadAutoAssigned: false,
    databaseWritten: false,
  };
}

export function isQuickFurnoN8nEventType(value: unknown): value is QuickFurnoN8nEventType {
  return typeof value === "string" && QUICKFURNO_N8N_EVENT_TYPES.includes(value as QuickFurnoN8nEventType);
}

export function getSupportedN8nEventTypes(): QuickFurnoN8nEventType[] {
  return [...QUICKFURNO_N8N_EVENT_TYPES];
}
