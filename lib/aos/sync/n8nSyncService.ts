import {
  AUTO_ASSIGNMENT_ENABLED,
  CREDIT_DEDUCTION_ENABLED,
  WHATSAPP_SENDING_ENABLED,
  AOS_RULE_BASED_FALLBACK_ENABLED,
} from "@/lib/aos/config/featureFlags";
import {
  createSafeSideEffectReport,
  getSupportedN8nEventTypes,
  isQuickFurnoN8nEventType,
  type QuickFurnoAosFailurePayload,
  type QuickFurnoN8nEventPayload,
  type QuickFurnoN8nEventResult,
  type QuickFurnoWebhookStatusPayload,
} from "@/lib/aos/events/n8nEventTypes";
import {
  QUICKFURNO_N8N_WORKFLOW_MAP,
  getWorkflowForN8nEvent,
} from "@/lib/aos/events/n8nWorkflowMap";
import {
  buildN8nEventPayload,
  createSafeN8nWebhookFailureResult,
  isN8nEnabled,
  isN8nOutboundWebhookEnabled,
  logN8nFailure,
  maskSensitiveFields,
  maskSensitiveText,
  sendEventToN8n,
  type N8nSecretValidationResult,
} from "@/lib/aos/tools/n8nTool";
import {
  maskPhoneNumber,
  prepareWhatsAppMessage,
  sendWhatsAppMessage,
} from "@/lib/aos/tools/whatsappTool";

export type QuickFurnoN8nApiStatus = "accepted" | "mocked" | "blocked";
export type QuickFurnoN8nApiSecurityMode = N8nSecretValidationResult["mode"] | "safe_fallback";

export interface QuickFurnoN8nApiResponse {
  ok: boolean;
  status: QuickFurnoN8nApiStatus;
  eventType: string;
  workflowName: string;
  message: string;
  mockMode: boolean;
  sideEffects: ReturnType<typeof createSafeSideEffectReport>;
  security: {
    mode: QuickFurnoN8nApiSecurityMode;
    message: string;
  };
}

export function formatN8nApiResponse(
  result: QuickFurnoN8nEventResult,
  security: { mode: QuickFurnoN8nApiSecurityMode; message: string },
): QuickFurnoN8nApiResponse {
  const responseSecurity = getSecurityOverride(result) ?? security;

  return {
    ok: result.ok,
    status: normalizeApiStatus(result.status),
    eventType: result.eventType ?? "unknown",
    workflowName: result.workflowName ?? "unknown",
    message: result.message,
    mockMode: result.mockMode,
    sideEffects: result.sideEffects,
    security: {
      mode: responseSecurity.mode,
      message: responseSecurity.message,
    },
  };
}

export function formatN8nBlockedApiResponse(
  security: { mode: QuickFurnoN8nApiSecurityMode; message: string },
  eventType = "unknown",
  workflowName = "unknown",
): QuickFurnoN8nApiResponse {
  return {
    ok: false,
    status: "blocked",
    eventType,
    workflowName,
    message: "n8n request blocked safely. No side effects executed.",
    mockMode: true,
    sideEffects: createSafeSideEffectReport(),
    security: {
      mode: security.mode,
      message: security.message,
    },
  };
}

export async function handleIncomingN8nEvent(payload: unknown): Promise<QuickFurnoN8nEventResult> {
  const normalized = normalizeN8nEventPayload(payload);
  if (!normalized) {
    return blockedResult("Unsupported or missing n8n event type.");
  }

  const event = buildN8nEventPayload(normalized);

  return {
    ok: true,
    status: "accepted",
    eventType: event.eventType,
    workflowName: event.workflowName,
    message: "Incoming n8n event accepted in safe mock mode. No side effects were executed.",
    mockMode: true,
    sideEffects: createSafeSideEffectReport(),
    details: {
      payload: event,
      databasePersisted: false,
      outboundWebhookCalled: false,
      whatsappSent: false,
      creditsDeducted: false,
      leadAutoAssigned: false,
    },
  };
}

export async function handleN8nFailure(payload: unknown): Promise<QuickFurnoN8nEventResult> {
  const failure = normalizeFailurePayload(payload);
  const safeError = failure.errorMessage ?? "n8n failure received without an error message.";
  const logged = logN8nFailure(new Error(safeError));

  return {
    ok: true,
    status: "mocked",
    eventType: "aos.failure",
    workflowName: getWorkflowForN8nEvent("aos.failure"),
    message: "n8n failure accepted in safe mock mode. Stack traces and secrets are not exposed.",
    mockMode: true,
    sideEffects: createSafeSideEffectReport(),
    details: {
      failure,
      safeLog: logged.details,
      databasePersisted: false,
    },
  };
}

export async function handleWhatsAppStatusUpdate(payload: unknown): Promise<QuickFurnoN8nEventResult> {
  const statusPayload = normalizeWhatsAppStatusPayload(payload);
  const preview = prepareWhatsAppMessage("whatsapp_status_update", {
    ...statusPayload,
    phone: statusPayload.phone ? maskPhoneNumber(statusPayload.phone) : statusPayload.maskedPhone,
  });
  const sendResult = await sendWhatsAppMessage(preview);

  return {
    ok: true,
    status: "accepted",
    eventType: "whatsapp.status_updated",
    workflowName: getWorkflowForN8nEvent("whatsapp.status_updated"),
    message: "WhatsApp status update accepted in safe mock mode. No message was sent.",
    mockMode: true,
    sideEffects: createSafeSideEffectReport(),
    details: {
      statusPayload: {
        ...statusPayload,
        phone: statusPayload.phone ? maskPhoneNumber(statusPayload.phone) : undefined,
      },
      sendResult,
      databasePersisted: false,
    },
  };
}

export async function queueEventForN8n(payload: QuickFurnoN8nEventPayload | Record<string, unknown>): Promise<QuickFurnoN8nEventResult> {
  let result: QuickFurnoN8nEventResult;

  try {
    result = await sendEventToN8n(payload);
  } catch {
    result = createSafeN8nWebhookFailureResult(payload);
  }

  return {
    ...result,
    details: {
      ...result.details,
      queueMode: "safe_mock",
      databasePersisted: false,
    },
  };
}

export function getN8nWorkflowMap(): Record<string, string> {
  return { ...QUICKFURNO_N8N_WORKFLOW_MAP };
}

export function getN8nFoundationStatus() {
  return {
    status: "foundation",
    n8nEnabled: isN8nEnabled(),
    n8nOutboundWebhookEnabled: isN8nOutboundWebhookEnabled(),
    whatsappSendingEnabled: WHATSAPP_SENDING_ENABLED,
    autoAssignmentEnabled: AUTO_ASSIGNMENT_ENABLED,
    creditDeductionEnabled: CREDIT_DEDUCTION_ENABLED,
    ruleBasedFallbackEnabled: AOS_RULE_BASED_FALLBACK_ENABLED,
    supportedEvents: getSupportedN8nEventTypes(),
    workflows: getN8nWorkflowMap(),
    sideEffects: createSafeSideEffectReport(),
    notes: [
      "No real n8n webhook call is connected.",
      "No WhatsApp message is sent.",
      "No lead is auto-assigned.",
      "No vendor credit is deducted.",
      "No Supabase write is performed by this foundation service.",
    ],
  };
}

function normalizeN8nEventPayload(payload: unknown): QuickFurnoN8nEventPayload | null {
  const record = asRecord(payload);
  const rawType = getEventTypeAlias(record);
  if (!isQuickFurnoN8nEventType(rawType)) return null;

  return {
    eventType: rawType,
    id: stringOrUndefined(record.id),
    eventId: stringOrUndefined(record.eventId),
    source: stringOrUndefined(record.source) ?? "n8n",
    leadId: stringOrNull(record.leadId ?? record.lead_id),
    vendorId: stringOrNull(record.vendorId ?? record.vendor_id),
    clientId: stringOrNull(record.clientId ?? record.client_id),
    occurredAt: stringOrUndefined(record.occurredAt ?? record.createdAt),
    workflowName: getWorkflowForN8nEvent(rawType),
    data: maskSensitiveFields(record.data ?? record.payload ?? {}),
    metadata: maskSensitiveFields(record.metadata ?? {}),
  };
}

function normalizeFailurePayload(payload: unknown): QuickFurnoAosFailurePayload {
  const record = asRecord(payload);
  const rawEventType = getEventTypeAlias(record);
  const eventType = isQuickFurnoN8nEventType(rawEventType) ? rawEventType : "unknown";

  return {
    failureId: stringOrUndefined(record.failureId ?? record.id),
    eventType,
    workflowName: stringOrUndefined(record.workflowName),
    agentKey: stringOrUndefined(record.agentKey ?? record.agent_key),
    taskType: stringOrUndefined(record.taskType ?? record.task_type),
    entityType: stringOrUndefined(record.entityType ?? record.entity_type),
    entityId: stringOrUndefined(record.entityId ?? record.entity_id),
    status: stringOrUndefined(record.status) ?? "failed",
    errorCode: stringOrUndefined(record.errorCode ?? record.error_code),
    errorMessage: stringOrMaskedUndefined(record.errorMessage ?? record.error ?? record.message),
    occurredAt: stringOrUndefined(record.occurredAt ?? record.createdAt) ?? new Date().toISOString(),
    metadata: maskSensitiveFields(record.metadata ?? {}),
  };
}

function normalizeWhatsAppStatusPayload(payload: unknown): QuickFurnoWebhookStatusPayload {
  const record = asRecord(payload);
  const phone = stringOrUndefined(record.phone ?? record.to ?? record.recipientPhone ?? record.whatsapp);

  return {
    messageId: stringOrUndefined(record.messageId ?? record.message_id),
    provider: stringOrUndefined(record.provider) ?? "whatsapp_cloud_api_future",
    status: stringOrUndefined(record.status) ?? "unknown",
    phone,
    maskedPhone: phone ? maskPhoneNumber(phone) : stringOrNull(record.maskedPhone ?? record.masked_phone),
    leadId: stringOrNull(record.leadId ?? record.lead_id),
    vendorId: stringOrNull(record.vendorId ?? record.vendor_id),
    occurredAt: stringOrUndefined(record.occurredAt ?? record.createdAt) ?? new Date().toISOString(),
    metadata: maskSensitiveFields(record.metadata ?? {}),
  };
}

function blockedResult(message: string): QuickFurnoN8nEventResult {
  return {
    ok: false,
    status: "blocked",
    message,
    mockMode: true,
    sideEffects: createSafeSideEffectReport(),
    details: {
      databasePersisted: false,
      supportedEvents: getSupportedN8nEventTypes(),
    },
  };
}

function normalizeApiStatus(status: QuickFurnoN8nEventResult["status"]): QuickFurnoN8nApiStatus {
  if (status === "accepted" || status === "blocked" || status === "mocked") return status;
  return "mocked";
}

function getSecurityOverride(result: QuickFurnoN8nEventResult): { mode: "safe_fallback"; message: string } | null {
  const details = asRecord(result.details);
  const security = asRecord(details.security);
  return security.mode === "safe_fallback" && typeof security.message === "string"
    ? { mode: "safe_fallback", message: security.message }
    : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getEventTypeAlias(record: Record<string, unknown>): unknown {
  return record.eventType ?? record.event_type ?? record.event ?? record.type;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringOrMaskedUndefined(value: unknown): string | undefined {
  const text = stringOrUndefined(value);
  return text ? maskSensitiveText(text) : undefined;
}

function stringOrNull(value: unknown): string | null {
  return stringOrUndefined(value) ?? null;
}
