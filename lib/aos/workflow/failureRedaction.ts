import type { JsonRecord } from "./workflowPersistenceTypes";

const SENSITIVE_KEY_PATTERN = /authorization|cookie|set-cookie|api_key|apikey|access_token|refresh_token|service_role|secret|password/i;

export function sanitizeWorkflowMetadata(value: unknown): JsonRecord {
  return sanitizeValue(value) as JsonRecord;
}

export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown workflow error");
  return message.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]").slice(0, 500);
}

export function classifyRetryableFailure(error: unknown): boolean {
  const message = safeErrorMessage(error).toLowerCase();
  if (/validation|invalid_transition|scope_mismatch|not_found|conflict/.test(message)) return false;
  return true;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === "object") {
    const out: JsonRecord = {};
    for (const [key, nested] of Object.entries(value as JsonRecord)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeValue(nested);
    }
    return out;
  }
  if (typeof value === "string") {
    return value.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
  }
  return value;
}

