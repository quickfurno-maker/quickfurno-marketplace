export const QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL = "qfj.whatsapp.turn-material" as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_VERSION = 2 as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_PATH = "/api/internal/jarvis/whatsapp-turn-material" as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN = "qfj.whatsapp.turn-material.http.sig.v2" as const;

interface QfjWhatsAppAuthorityReadBaseV2 {
  readonly protocol: typeof QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL;
  readonly version: 2;
  readonly caller: "qf-jarvis";
  readonly audience: "quickfurno-core";
  readonly requestId: string;
  readonly issuedAt: string;
  readonly tenantId: "quickfurno";
  readonly conversationId: string;
}

export interface QfjWhatsAppAuthorityReadRequestV2 extends QfjWhatsAppAuthorityReadBaseV2 {}

export interface QfjWhatsAppBoundTurnMaterialRequestV2 extends QfjWhatsAppAuthorityReadBaseV2 {
  readonly inboundMessageId: string;
  readonly expectedRevision: number;
}

export type QfjWhatsAppTurnMaterialRequestV2 =
  | QfjWhatsAppAuthorityReadRequestV2
  | QfjWhatsAppBoundTurnMaterialRequestV2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function baseValid(value: Record<string, unknown>): boolean {
  return value.protocol === QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL &&
    value.version === 2 &&
    value.caller === "qf-jarvis" &&
    value.audience === "quickfurno-core" &&
    value.tenantId === "quickfurno" &&
    typeof value.requestId === "string" && UUID.test(value.requestId) &&
    typeof value.issuedAt === "string" && INSTANT.test(value.issuedAt) &&
    Number.isFinite(Date.parse(value.issuedAt)) &&
    typeof value.conversationId === "string" && UUID.test(value.conversationId);
}

export function isQfjWhatsAppBoundTurnMaterialRequest(
  value: QfjWhatsAppTurnMaterialRequestV2,
): value is QfjWhatsAppBoundTurnMaterialRequestV2 {
  return "inboundMessageId" in value;
}

export function parseQfjWhatsAppTurnMaterialRequest(
  value: unknown,
): QfjWhatsAppTurnMaterialRequestV2 | null {
  if (!isRecord(value) || !baseValid(value)) return null;
  const base = [
    "protocol", "version", "caller", "audience", "requestId",
    "issuedAt", "tenantId", "conversationId",
  ] as const;

  if (exactKeys(value, base)) {
    return Object.freeze({
      protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
      version: 2,
      caller: "qf-jarvis",
      audience: "quickfurno-core",
      requestId: value.requestId as string,
      issuedAt: value.issuedAt as string,
      tenantId: "quickfurno",
      conversationId: value.conversationId as string,
    });
  }

  if (!exactKeys(value, [...base, "inboundMessageId", "expectedRevision"])) return null;
  if (typeof value.inboundMessageId !== "string" || !UUID.test(value.inboundMessageId)) return null;
  if (
    typeof value.expectedRevision !== "number" ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0
  ) return null;

  return Object.freeze({
    protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
    version: 2,
    caller: "qf-jarvis",
    audience: "quickfurno-core",
    requestId: value.requestId as string,
    issuedAt: value.issuedAt as string,
    tenantId: "quickfurno",
    conversationId: value.conversationId as string,
    inboundMessageId: value.inboundMessageId,
    expectedRevision: value.expectedRevision,
  });
}
