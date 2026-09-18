export const QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL = "qfj.whatsapp.turn-material" as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_VERSION = 1 as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_PATH = "/api/internal/jarvis/whatsapp-turn-material" as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN = "qfj.whatsapp.turn-material.http.sig.v1" as const;

export interface QfjWhatsAppTurnMaterialRequestV1 {
  readonly protocol: typeof QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL;
  readonly version: 1;
  readonly caller: "qf-jarvis";
  readonly audience: "quickfurno-core";
  readonly requestId: string;
  readonly issuedAt: string;
  readonly conversationId: string;
  readonly inboundMessageId: string;
  readonly expectedRevision: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function parseQfjWhatsAppTurnMaterialRequest(value: unknown): QfjWhatsAppTurnMaterialRequestV1 | null {
  if (!isRecord(value)) return null;
  const expected = ["protocol","version","caller","audience","requestId","issuedAt","conversationId","inboundMessageId","expectedRevision"];
  if (Object.keys(value).sort().join(",") !== expected.sort().join(",")) return null;
  if (value.protocol !== QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL || value.version !== 1 ||
      value.caller !== "qf-jarvis" || value.audience !== "quickfurno-core") return null;
  if (typeof value.requestId !== "string" || !UUID.test(value.requestId)) return null;
  if (typeof value.issuedAt !== "string" || !INSTANT.test(value.issuedAt) || !Number.isFinite(Date.parse(value.issuedAt))) return null;
  if (typeof value.conversationId !== "string" || !UUID.test(value.conversationId)) return null;
  if (typeof value.inboundMessageId !== "string" || !UUID.test(value.inboundMessageId)) return null;
  if (typeof value.expectedRevision !== "number" || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) return null;
  return Object.freeze({
    protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL, version: 1, caller: "qf-jarvis", audience: "quickfurno-core",
    requestId: value.requestId, issuedAt: value.issuedAt, conversationId: value.conversationId,
    inboundMessageId: value.inboundMessageId, expectedRevision: value.expectedRevision,
  });
}