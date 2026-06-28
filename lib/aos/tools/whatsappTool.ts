import { WHATSAPP_SENDING_ENABLED } from "@/lib/aos/config/featureFlags";

export interface QuickFurnoWhatsAppMessagePayload {
  templateKey: string;
  maskedTo: string | null;
  data: Record<string, unknown>;
  bodyPreview: string;
  mode: "safe_preview";
  createdAt: string;
}

export interface QuickFurnoWhatsAppSendResult {
  ok: true;
  status: "skipped";
  message: string;
  mockMode: true;
  whatsappSent: false;
  providerCalled: false;
  payload: QuickFurnoWhatsAppMessagePayload;
}

export function createWhatsAppToolPlaceholder() {
  return {
    name: "whatsappTool",
    enabled: false,
    canSend: false,
    description: "Placeholder only. This tool never sends WhatsApp messages in Phase 1.",
    // TODO(qf-whatsapp): require approved templates, audit logs, and admin rollback before enabling sends.
  };
}

export function prepareWhatsAppMessage(templateKey: string, data: Record<string, unknown> = {}): QuickFurnoWhatsAppMessagePayload {
  const recipient = firstString(data.to, data.phone, data.whatsapp, data.whatsappNumber, data.mobile, data.clientPhone);

  return {
    templateKey,
    maskedTo: recipient ? maskPhoneNumber(recipient) : null,
    data: maskSensitiveFields(data) as Record<string, unknown>,
    bodyPreview: `WhatsApp template "${templateKey}" prepared in safe preview mode.`,
    mode: "safe_preview",
    createdAt: new Date().toISOString(),
  };
}

export async function sendWhatsAppMessage(
  payload: QuickFurnoWhatsAppMessagePayload,
): Promise<QuickFurnoWhatsAppSendResult> {
  // TODO(qf-whatsapp-cloud-api): wire WhatsApp Cloud API only after production
  // secrets, approved templates, retry rules, and audit logging are reviewed.
  return {
    ok: true,
    status: "skipped",
    message: isWhatsAppSendingEnabled()
      ? "WhatsApp sending flag is on, but the provider is intentionally not connected in this foundation phase."
      : "WhatsApp sending is disabled. No provider was called and no message was sent.",
    mockMode: true,
    whatsappSent: false,
    providerCalled: false,
    payload,
  };
}

export function maskPhoneNumber(phone: unknown): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return "masked";
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(2, digits.length - 4))}${digits.slice(-4)}`;
}

export function isWhatsAppSendingEnabled(): boolean {
  return WHATSAPP_SENDING_ENABLED;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function maskSensitiveFields(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => maskSensitiveFields(item, depth + 1));
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (isSecretKey(key)) return [key, "[redacted]"];
      if (isPhoneKey(key)) return [key, maskPhoneNumber(item)];
      return [key, maskSensitiveFields(item, depth + 1)];
    }),
  );
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
