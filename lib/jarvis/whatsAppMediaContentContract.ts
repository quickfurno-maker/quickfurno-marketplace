export const QFJ_WHATSAPP_MEDIA_CONTENT_PROTOCOL = "qfj.whatsapp.media-content" as const;
export const QFJ_WHATSAPP_MEDIA_CONTENT_VERSION = 1 as const;
export const QFJ_WHATSAPP_MEDIA_CONTENT_PATH =
  "/api/internal/jarvis/whatsapp-media-content" as const;
export const QFJ_WHATSAPP_MEDIA_CONTENT_SIGNING_DOMAIN =
  "qfj.whatsapp.media-content.http.sig.v1" as const;

export const QFJ_WHATSAPP_MEDIA_REQUEST_ID_HEADER = "x-qfj-media-request-id" as const;
export const QFJ_WHATSAPP_MEDIA_CONVERSATION_ID_HEADER =
  "x-qfj-media-conversation-id" as const;
export const QFJ_WHATSAPP_MEDIA_INBOUND_ID_HEADER = "x-qfj-media-inbound-id" as const;
export const QFJ_WHATSAPP_MEDIA_REVISION_HEADER = "x-qfj-media-revision" as const;
export const QFJ_WHATSAPP_MEDIA_ID_HEADER = "x-qfj-media-id" as const;
export const QFJ_WHATSAPP_MEDIA_KIND_HEADER = "x-qfj-media-kind" as const;
export const QFJ_WHATSAPP_MEDIA_SHA256_HEADER = "x-qfj-media-sha256" as const;

export type QfjWhatsAppMediaKind = "image" | "document" | "audio" | "video" | "sticker";

export interface QfjWhatsAppMediaContentRequestV1 {
  readonly protocol: typeof QFJ_WHATSAPP_MEDIA_CONTENT_PROTOCOL;
  readonly version: 1;
  readonly caller: "qf-jarvis";
  readonly audience: "quickfurno-core";
  readonly requestId: string;
  readonly issuedAt: string;
  readonly tenantId: "quickfurno";
  readonly conversationId: string;
  readonly inboundMessageId: string;
  readonly expectedRevision: number;
  readonly mediaId: string;
  readonly mediaKind: QfjWhatsAppMediaKind;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MEDIA_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const MEDIA_KINDS = new Set<QfjWhatsAppMediaKind>([
  "image", "document", "audio", "video", "sticker",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
export function parseQfjWhatsAppMediaContentRequest(
  value: unknown,
): QfjWhatsAppMediaContentRequestV1 | null {
  if (!isRecord(value)) return null;
  const keys = [
    "protocol", "version", "caller", "audience", "requestId", "issuedAt", "tenantId",
    "conversationId", "inboundMessageId", "expectedRevision", "mediaId", "mediaKind",
  ] as const;
  if (!exactKeys(value, keys)) return null;
  if (
    value.protocol !== QFJ_WHATSAPP_MEDIA_CONTENT_PROTOCOL ||
    value.version !== 1 ||
    value.caller !== "qf-jarvis" ||
    value.audience !== "quickfurno-core" ||
    value.tenantId !== "quickfurno"
  ) return null;
  if (
    typeof value.requestId !== "string" || !UUID.test(value.requestId) ||
    typeof value.issuedAt !== "string" || !INSTANT.test(value.issuedAt) ||
    !Number.isFinite(Date.parse(value.issuedAt)) ||
    typeof value.conversationId !== "string" || !UUID.test(value.conversationId) ||
    typeof value.inboundMessageId !== "string" || !UUID.test(value.inboundMessageId)
  ) return null;
  if (
    typeof value.expectedRevision !== "number" ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0 ||
    typeof value.mediaId !== "string" ||
    !MEDIA_ID.test(value.mediaId) ||
    typeof value.mediaKind !== "string" ||
    !MEDIA_KINDS.has(value.mediaKind as QfjWhatsAppMediaKind)
  ) return null;

  return Object.freeze({
    protocol: QFJ_WHATSAPP_MEDIA_CONTENT_PROTOCOL,
    version: 1,
    caller: "qf-jarvis",
    audience: "quickfurno-core",
    requestId: value.requestId,
    issuedAt: value.issuedAt,
    tenantId: "quickfurno",
    conversationId: value.conversationId,
    inboundMessageId: value.inboundMessageId,
    expectedRevision: value.expectedRevision,
    mediaId: value.mediaId,
    mediaKind: value.mediaKind as QfjWhatsAppMediaKind,
  });
}
