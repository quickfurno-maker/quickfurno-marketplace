import {
  parseQfWhatsAppExperience,
  type QfWhatsAppExperienceV1,
} from "./whatsAppExperience";

export const QFJ_WHATSAPP_REPLY_PROTOCOL = "qfj.whatsapp.reply" as const;
export const QFJ_WHATSAPP_REPLY_LEGACY_VERSION = 1 as const;
export const QFJ_WHATSAPP_REPLY_VERSION = 2 as const;
export const QFJ_WHATSAPP_REPLY_PATH = "/api/internal/jarvis/whatsapp-reply" as const;
export const QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN_V1 = "qfj.whatsapp.reply.http.sig.v1" as const;
export const QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN = "qfj.whatsapp.reply.http.sig.v2" as const;

interface QfjWhatsAppReplyBase {
  readonly protocol: typeof QFJ_WHATSAPP_REPLY_PROTOCOL;
  readonly caller: "qf-jarvis";
  readonly audience: "quickfurno-core";
  readonly requestId: string;
  readonly issuedAt: string;
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly proposalId: string;
  readonly idempotencyKey: string;
}

export interface QfjWhatsAppReplyRequestV1 extends QfjWhatsAppReplyBase {
  readonly version: 1;
  readonly body: string;
}
export interface QfjWhatsAppReplyRequestV2 extends QfjWhatsAppReplyBase {
  readonly version: 2;
  readonly actor: "AAROHI" | "ANISHA" | "RIYA";
  readonly experience: QfWhatsAppExperienceV1;
}

export type QfjWhatsAppReplyRequest = QfjWhatsAppReplyRequestV1 | QfjWhatsAppReplyRequestV2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function baseValid(r: Record<string, unknown>): boolean {
  return r.protocol === QFJ_WHATSAPP_REPLY_PROTOCOL && r.caller === "qf-jarvis" &&
    r.audience === "quickfurno-core" && typeof r.requestId === "string" && UUID.test(r.requestId) &&
    typeof r.issuedAt === "string" && INSTANT.test(r.issuedAt) && Number.isFinite(Date.parse(r.issuedAt)) &&
    typeof r.conversationId === "string" && UUID.test(r.conversationId) &&
    typeof r.expectedRevision === "number" && Number.isSafeInteger(r.expectedRevision) && r.expectedRevision >= 0 &&
    typeof r.proposalId === "string" && ID.test(r.proposalId) &&
    typeof r.idempotencyKey === "string" && HEX64.test(r.idempotencyKey);
}
export function parseQfjWhatsAppReplyRequest(value: unknown): QfjWhatsAppReplyRequest | null {
  if (!isRecord(value) || !baseValid(value)) return null;
  if (value.version === 1) {
    if (!exactKeys(value, [
      "protocol", "version", "caller", "audience", "requestId", "issuedAt",
      "conversationId", "expectedRevision", "proposalId", "body", "idempotencyKey",
    ])) return null;
    if (typeof value.body !== "string" || value.body.trim().length < 1 || value.body.trim().length > 4096) return null;
    return Object.freeze({
      protocol: QFJ_WHATSAPP_REPLY_PROTOCOL, version: 1, caller: "qf-jarvis", audience: "quickfurno-core",
      requestId: value.requestId as string, issuedAt: value.issuedAt as string,
      conversationId: value.conversationId as string, expectedRevision: value.expectedRevision as number,
      proposalId: value.proposalId as string, body: value.body.trim(), idempotencyKey: value.idempotencyKey as string,
    });
  }
  if (value.version !== 2) return null;
  if (!exactKeys(value, [
    "protocol", "version", "caller", "audience", "requestId", "issuedAt",
    "conversationId", "expectedRevision", "proposalId", "actor", "experience", "idempotencyKey",
  ])) return null;
  if (typeof value.actor !== "string" || !["AAROHI", "ANISHA", "RIYA"].includes(value.actor)) return null;
  const experience = parseQfWhatsAppExperience(value.experience);
  if (!experience || experience.actor !== value.actor) return null;
  return Object.freeze({
    protocol: QFJ_WHATSAPP_REPLY_PROTOCOL, version: 2, caller: "qf-jarvis", audience: "quickfurno-core",
    requestId: value.requestId as string, issuedAt: value.issuedAt as string,
    conversationId: value.conversationId as string, expectedRevision: value.expectedRevision as number,
    proposalId: value.proposalId as string, actor: value.actor as "AAROHI" | "ANISHA" | "RIYA",
    experience, idempotencyKey: value.idempotencyKey as string,
  });
}
export function qfjWhatsAppReplySigningDomain(version: 1 | 2): string {
  return version === 1 ? QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN_V1 : QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN;
}