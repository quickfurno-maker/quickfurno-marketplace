export const QFJ_WHATSAPP_CONVERSATION_CONTEXT_PROTOCOL =
  "qfj.whatsapp.conversation-context" as const;
export const QFJ_WHATSAPP_CONVERSATION_CONTEXT_VERSION = 1 as const;
export const QFJ_WHATSAPP_CONVERSATION_CONTEXT_PATH =
  "/api/internal/jarvis/whatsapp-conversation-context" as const;
export const QFJ_WHATSAPP_CONVERSATION_CONTEXT_SIGNING_DOMAIN =
  "qfj.whatsapp.conversation-context.http.sig.v1" as const;

export interface QfjWhatsAppConversationContextRequestV1 {
  readonly protocol: typeof QFJ_WHATSAPP_CONVERSATION_CONTEXT_PROTOCOL;
  readonly version: 1;
  readonly caller: "qf-jarvis";
  readonly audience: "quickfurno-core";
  readonly requestId: string;
  readonly issuedAt: string;
  readonly tenantId: "quickfurno";
  readonly conversationId: string;
  readonly inboundMessageId: string;
  readonly expectedRevision: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseQfjWhatsAppConversationContextRequest(
  value: unknown,
): QfjWhatsAppConversationContextRequestV1 | null {
  if (!isRecord(value)) return null;
  const expected = [
    "protocol", "version", "caller", "audience", "requestId", "issuedAt",
    "tenantId", "conversationId", "inboundMessageId", "expectedRevision",
  ].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return null;
  }
  if (
    value.protocol !== QFJ_WHATSAPP_CONVERSATION_CONTEXT_PROTOCOL ||
    value.version !== 1 ||
    value.caller !== "qf-jarvis" ||
    value.audience !== "quickfurno-core" ||
    value.tenantId !== "quickfurno" ||
    typeof value.requestId !== "string" ||
    !UUID.test(value.requestId) ||
    typeof value.issuedAt !== "string" ||
    !INSTANT.test(value.issuedAt) ||
    !Number.isFinite(Date.parse(value.issuedAt)) ||
    typeof value.conversationId !== "string" ||
    !UUID.test(value.conversationId) ||
    typeof value.inboundMessageId !== "string" ||
    !UUID.test(value.inboundMessageId) ||
    typeof value.expectedRevision !== "number" ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0
  ) return null;

  return Object.freeze({
    protocol: QFJ_WHATSAPP_CONVERSATION_CONTEXT_PROTOCOL,
    version: 1 as const,
    caller: "qf-jarvis" as const,
    audience: "quickfurno-core" as const,
    requestId: value.requestId,
    issuedAt: value.issuedAt,
    tenantId: "quickfurno" as const,
    conversationId: value.conversationId,
    inboundMessageId: value.inboundMessageId,
    expectedRevision: value.expectedRevision,
  });
}
