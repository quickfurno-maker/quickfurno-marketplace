import {
  N8N_ENABLED,
  N8N_OUTBOUND_WEBHOOK_ENABLED,
} from "@/lib/aos/config/featureFlags";
import {
  createSafeSideEffectReport,
  isQuickFurnoN8nEventType,
  type QuickFurnoN8nEventPayload,
  type QuickFurnoN8nEventResult,
  type QuickFurnoN8nEventType,
} from "@/lib/aos/events/n8nEventTypes";
import { getWorkflowForN8nEvent } from "@/lib/aos/events/n8nWorkflowMap";
import { maskPhoneNumber } from "./whatsappTool";

const N8N_SECRET_HEADER = "x-qf-n8n-secret";
const N8N_SECRET_ENV_KEY = "QF_N8N_WEBHOOK_SECRET";

export interface N8nSecretValidationResult {
  ok: boolean;
  status: 200 | 401;
  mode: "validated" | "development_mock" | "missing_secret" | "invalid_secret";
  message: string;
}

export function createN8nToolPlaceholder() {
  return {
    name: "n8nTool",
    enabled: false,
    canCallWebhook: false,
    description: "Placeholder only. No n8n webhook is called in Phase 1.",
    // TODO(qf-n8n-production): connect n8n only after signed webhook validation and audit logs are reviewed.
  };
}

export function validateN8nSecret(request: Request): N8nSecretValidationResult {
  // TODO(qf-n8n-production): set QF_N8N_WEBHOOK_SECRET in production hosting secrets.
  // Do not store this value in .env or .env.local in this phase.
  const expectedSecret = process.env[N8N_SECRET_ENV_KEY]?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (!expectedSecret) {
    if (isProduction) {
      return {
        ok: false,
        status: 401,
        mode: "missing_secret",
        message: "n8n callback secret is not configured.",
      };
    }

    return {
      ok: true,
      status: 200,
      mode: "development_mock",
      message: "Development mock mode: n8n secret is missing, so no real callback is trusted or executed.",
    };
  }

  const providedSecret = request.headers.get(N8N_SECRET_HEADER)?.trim() ?? "";

  if (!timingSafeStringEqual(providedSecret, expectedSecret)) {
    return {
      ok: false,
      status: 401,
      mode: "invalid_secret",
      message: "Invalid n8n callback secret.",
    };
  }

  return {
    ok: true,
    status: 200,
    mode: "validated",
    message: "n8n callback secret validated.",
  };
}

export function buildN8nEventPayload(event: QuickFurnoN8nEventPayload | Record<string, unknown>): QuickFurnoN8nEventPayload {
  const record = isRecord(event) ? event : {};
  const rawType = getEventTypeAlias(record);
  const type: QuickFurnoN8nEventType = isQuickFurnoN8nEventType(rawType) ? rawType : "aos.failure";
  const eventId = firstString(record.eventId, record.id) ?? createEventId();

  return {
    id: eventId,
    eventId,
    eventType: type,
    source: firstString(record.source) ?? "aos",
    leadId: firstString(record.leadId, record.lead_id),
    vendorId: firstString(record.vendorId, record.vendor_id),
    clientId: firstString(record.clientId, record.client_id),
    occurredAt: firstString(record.occurredAt, record.createdAt) ?? new Date().toISOString(),
    workflowName: getWorkflowForN8nEvent(type),
    data: maskSensitiveFields(record.data ?? record.payload ?? {}),
    metadata: maskSensitiveFields(record.metadata ?? {}),
  };
}

export async function sendEventToN8n(
  event: QuickFurnoN8nEventPayload | Record<string, unknown>,
): Promise<QuickFurnoN8nEventResult> {
  const payload = buildN8nEventPayload(event);

  if (!isN8nEnabled()) {
    return skippedN8nResult(payload, "n8n is disabled. No webhook was called.");
  }

  if (!N8N_OUTBOUND_WEBHOOK_ENABLED) {
    return skippedN8nResult(payload, "n8n outbound webhook is disabled. No webhook was called.");
  }

  // TODO(qf-n8n-outbound): add reviewed fetch call to a server-side n8n webhook
  // after QF_N8N_WEBHOOK_SECRET, retry policy, and failure logging are ready.
  return skippedN8nResult(payload, "n8n outbound integration is not connected in this foundation phase.");
}

export function logN8nFailure(error: unknown): QuickFurnoN8nEventResult {
  const safeMessage = maskSensitiveText(error instanceof Error ? error.message : String(error ?? "Unknown n8n failure"));

  console.warn("[qf-n8n] safe failure captured", {
    message: safeMessage,
    stack: "redacted",
  });

  return {
    ok: false,
    status: "failed",
    eventType: "aos.failure",
    workflowName: getWorkflowForN8nEvent("aos.failure"),
    message: "n8n failure captured in safe placeholder mode.",
    mockMode: true,
    sideEffects: createSafeSideEffectReport(),
    details: {
      errorMessage: safeMessage,
      stack: "redacted",
      databasePersisted: false,
    },
  };
}

export function isN8nEnabled(): boolean {
  return N8N_ENABLED;
}

export function maskSensitiveFields(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 4) return { value: "[truncated]" };
  if (Array.isArray(value)) {
    return { items: value.map((item) => maskSensitiveValue("item", item, depth + 1)) };
  }
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, maskSensitiveValue(key, item, depth + 1)]),
  );
}

export function maskSensitiveText(value: string): string {
  return value
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(secret|token|api.?key|authorization|password)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (match) => maskPhoneNumber(match));
}

function skippedN8nResult(payload: QuickFurnoN8nEventPayload, message: string): QuickFurnoN8nEventResult {
  return {
    ok: true,
    status: "mocked",
    eventType: payload.eventType,
    workflowName: payload.workflowName,
    message,
    mockMode: true,
    sideEffects: createSafeSideEffectReport(),
    details: {
      payload,
      outboundWebhookEnabled: N8N_OUTBOUND_WEBHOOK_ENABLED,
      databasePersisted: false,
    },
  };
}

function maskSensitiveValue(key: string, value: unknown, depth: number): unknown {
  if (isSecretKey(key)) return "[redacted]";
  if (isPhoneKey(key)) return maskPhoneNumber(value);
  if (typeof value === "string") return maskSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => maskSensitiveValue("item", item, depth + 1));
  if (isRecord(value)) {
    if (depth > 4) return "[truncated]";
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [nestedKey, maskSensitiveValue(nestedKey, nestedValue, depth + 1)]),
    );
  }
  return value;
}

function timingSafeStringEqual(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;

  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

function createEventId(): string {
  return `qf_evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function getEventTypeAlias(record: Record<string, unknown>): unknown {
  return record.eventType ?? record.event_type ?? record.event ?? record.type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPhoneKey(key: string): boolean {
  return /(phone|mobile|whatsapp|contact)/i.test(key);
}

function isSecretKey(key: string): boolean {
  return /(secret|token|api.?key|authorization|password)/i.test(key);
}
