import crypto from "crypto";

export const QFJ_RIYA_INGRESS_PROTOCOL = "qfj.riya.web.ingress" as const;
export const QFJ_RIYA_INGRESS_CALLER = "quickfurno-core" as const;
export const QFJ_RIYA_INGRESS_AUDIENCE = "qf-jarvis-private-riya-web" as const;
export const QFJ_RIYA_INGRESS_METHOD = "POST" as const;
export const QFJ_RIYA_INGRESS_PATH = "/internal/v1/riya/web-turn" as const;
export const QFJ_RIYA_INGRESS_SIGNING_DOMAIN = "qfj.riya.web.ingress.sig.v1" as const;
export const QFJ_RIYA_KEY_ID_HEADER = "x-qfj-key-id" as const;
export const QFJ_RIYA_SIGNATURE_HEADER = "x-qfj-signature" as const;

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export interface QfjPrivateRiyaIngressRequestV1 {
  readonly protocol: typeof QFJ_RIYA_INGRESS_PROTOCOL; readonly version: 1; readonly caller: typeof QFJ_RIYA_INGRESS_CALLER;
  readonly audience: typeof QFJ_RIYA_INGRESS_AUDIENCE; readonly requestId: string; readonly issuedAt: string; readonly tenantId: string;
  readonly conversationId: string; readonly messageId: string; readonly receivedAt: string; readonly webTurnRef: string;
  readonly subjectRef?: string; readonly normalizedText?: string;
}
export interface QfjPrivateRiyaAuthorizedReplyV1 {
  readonly version: 1; readonly proposalId: string; readonly boundRevision: number;
  readonly proposalKind: "REPLY" | "FOLLOW_UP"; readonly replyBody: string;
}
export interface QfjPrivateRiyaIngressResponseV1 {
  readonly protocol: typeof QFJ_RIYA_INGRESS_PROTOCOL; readonly version: 1; readonly requestId: string; readonly tenantId: string;
  readonly conversationId: string; readonly messageId: string; readonly disposition: "PROCESSED" | "REFUSED" | "NOT_READY";
  readonly reason: string | null; readonly authorizedReply: QfjPrivateRiyaAuthorizedReplyV1 | null;
}
function instant(value: string): boolean { return INSTANT.test(value) && Number.isFinite(Date.parse(value)); }
function exact(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const a = Object.keys(record).sort(); const b = [...keys].sort(); return a.length === b.length && a.every((key, i) => key === b[i]);
}
export function buildQfjPrivateRiyaIngressRequest(input: Omit<QfjPrivateRiyaIngressRequestV1, "protocol" | "version" | "caller" | "audience">): QfjPrivateRiyaIngressRequestV1 {
  for (const id of [input.requestId, input.tenantId, input.conversationId, input.messageId]) if (!ID.test(id)) throw new Error("INVALID_RIYA_INGRESS_REQUEST");
  if (!instant(input.issuedAt) || !instant(input.receivedAt) || input.webTurnRef.length < 1 || input.webTurnRef.length > 256) throw new Error("INVALID_RIYA_INGRESS_REQUEST");
  if (input.subjectRef !== undefined && !ID.test(input.subjectRef)) throw new Error("INVALID_RIYA_INGRESS_REQUEST");
  if (input.normalizedText !== undefined && input.normalizedText.length > 4096) throw new Error("INVALID_RIYA_INGRESS_REQUEST");
  return Object.freeze({ protocol: QFJ_RIYA_INGRESS_PROTOCOL, version: 1, caller: QFJ_RIYA_INGRESS_CALLER, audience: QFJ_RIYA_INGRESS_AUDIENCE, ...input });
}
export function parseQfjPrivateRiyaIngressResponse(value: unknown): QfjPrivateRiyaIngressResponseV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null; const r = value as Record<string, unknown>;
  if (!exact(r, ["protocol","version","requestId","tenantId","conversationId","messageId","disposition","reason","authorizedReply"])) return null;
  if (r.protocol !== QFJ_RIYA_INGRESS_PROTOCOL || r.version !== 1 || typeof r.requestId !== "string" || !ID.test(r.requestId) || typeof r.tenantId !== "string" || !ID.test(r.tenantId) || typeof r.conversationId !== "string" || !ID.test(r.conversationId) || typeof r.messageId !== "string" || !ID.test(r.messageId)) return null;
  if (r.disposition !== "PROCESSED" && r.disposition !== "REFUSED" && r.disposition !== "NOT_READY") return null;
  if (r.reason !== null && (typeof r.reason !== "string" || r.reason.length > 128)) return null;
  if (r.authorizedReply !== null) {
    if (!r.authorizedReply || typeof r.authorizedReply !== "object" || Array.isArray(r.authorizedReply)) return null; const a = r.authorizedReply as Record<string, unknown>;
    if (!exact(a, ["version","proposalId","boundRevision","proposalKind","replyBody"]) || a.version !== 1 || typeof a.proposalId !== "string" || !ID.test(a.proposalId) || typeof a.boundRevision !== "number" || !Number.isSafeInteger(a.boundRevision) || a.boundRevision < 0 || (a.proposalKind !== "REPLY" && a.proposalKind !== "FOLLOW_UP") || typeof a.replyBody !== "string" || a.replyBody.length < 1 || a.replyBody.length > 8192) return null;
  }
  return r as unknown as QfjPrivateRiyaIngressResponseV1;
}
export function qfjRiyaIngressSigningInput(args: { requestId: string; issuedAt: string; keyId: string; bodyDigest: string }): string {
  return [QFJ_RIYA_INGRESS_SIGNING_DOMAIN,QFJ_RIYA_INGRESS_METHOD,QFJ_RIYA_INGRESS_PATH,QFJ_RIYA_INGRESS_CALLER,QFJ_RIYA_INGRESS_AUDIENCE,args.requestId,args.issuedAt,args.keyId,args.bodyDigest].join("\n");
}
export function signQfjPrivateRiyaIngressBody(args: { rawBody: Uint8Array; requestId: string; issuedAt: string; keyId: string; privateKeyPem: string }): string {
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(args.keyId) || !args.privateKeyPem.includes("PRIVATE KEY")) throw new Error("INVALID_RIYA_SIGNING_KEY");
  const key = crypto.createPrivateKey(args.privateKeyPem); if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") throw new Error("INVALID_RIYA_SIGNING_KEY");
  const digest = crypto.createHash("sha256").update(args.rawBody).digest("base64url");
  return crypto.sign(null, Buffer.from(qfjRiyaIngressSigningInput({ requestId: args.requestId, issuedAt: args.issuedAt, keyId: args.keyId, bodyDigest: digest }), "utf8"), key).toString("base64url");
}
