export const QFJ_WHATSAPP_REPLY_PROTOCOL = "qfj.whatsapp.reply" as const;
export const QFJ_WHATSAPP_REPLY_VERSION = 1 as const;
export const QFJ_WHATSAPP_REPLY_PATH = "/api/internal/jarvis/whatsapp-reply" as const;
export const QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN = "qfj.whatsapp.reply.http.sig.v1" as const;

export interface QfjWhatsAppReplyRequestV1 {
  readonly protocol: typeof QFJ_WHATSAPP_REPLY_PROTOCOL;
  readonly version: 1;
  readonly caller: "qf-jarvis";
  readonly audience: "quickfurno-core";
  readonly requestId: string;
  readonly issuedAt: string;
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly proposalId: string;
  readonly body: string;
  readonly idempotencyKey: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function parseQfjWhatsAppReplyRequest(value: unknown): QfjWhatsAppReplyRequestV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(",");
  if (keys !== ["audience","body","caller","conversationId","expectedRevision","idempotencyKey","issuedAt","proposalId","protocol","requestId","version"].sort().join(",")) return null;
  if (r.protocol !== QFJ_WHATSAPP_REPLY_PROTOCOL || r.version !== 1 || r.caller !== "qf-jarvis" || r.audience !== "quickfurno-core") return null;
  if (typeof r.requestId !== "string" || !UUID.test(r.requestId)) return null;
  if (typeof r.issuedAt !== "string" || !INSTANT.test(r.issuedAt) || !Number.isFinite(Date.parse(r.issuedAt))) return null;
  if (typeof r.conversationId !== "string" || !UUID.test(r.conversationId)) return null;
  if (typeof r.expectedRevision !== "number" || !Number.isSafeInteger(r.expectedRevision) || r.expectedRevision < 0) return null;
  if (typeof r.proposalId !== "string" || !ID.test(r.proposalId)) return null;
  if (typeof r.body !== "string" || r.body.trim().length < 1 || r.body.trim().length > 4096) return null;
  if (typeof r.idempotencyKey !== "string" || !HEX64.test(r.idempotencyKey)) return null;
  return Object.freeze({
    protocol: QFJ_WHATSAPP_REPLY_PROTOCOL, version: 1, caller: "qf-jarvis", audience: "quickfurno-core",
    requestId: r.requestId, issuedAt: r.issuedAt, conversationId: r.conversationId,
    expectedRevision: r.expectedRevision, proposalId: r.proposalId, body: r.body.trim(), idempotencyKey: r.idempotencyKey,
  });
}
