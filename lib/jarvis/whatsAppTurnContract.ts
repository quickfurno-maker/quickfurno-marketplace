import crypto from "crypto";

export const QFJ_WHATSAPP_TURN_PROTOCOL = "qfj.whatsapp.turn" as const;
export const QFJ_WHATSAPP_TURN_VERSION = 1 as const;
export const QFJ_WHATSAPP_TURN_PATH = "/internal/v1/quickfurno/whatsapp-turn" as const;
export const QFJ_WHATSAPP_TURN_SIGNING_DOMAIN = "qfj.whatsapp.turn.http.sig.v1" as const;
export const QFJ_WHATSAPP_TURN_KEY_ID_HEADER = "x-qfj-key-id" as const;
export const QFJ_WHATSAPP_TURN_SIGNATURE_HEADER = "x-qfj-signature" as const;
const CALLER = "quickfurno-core" as const;
const AUDIENCE = "qf-jarvis" as const;

export interface QfjWhatsAppTurnV1 {
  readonly protocol: typeof QFJ_WHATSAPP_TURN_PROTOCOL;
  readonly version: 1;
  readonly caller: typeof CALLER;
  readonly audience: typeof AUDIENCE;
  readonly requestId: string;
  readonly issuedAt: string;
  readonly conversationId: string;
  readonly conversationRevision: number;
  readonly inboundMessageId: string;
  readonly receivedAt: string;
  readonly assignedActor: "AAROHI" | "ANISHA" | "RIYA";
  readonly subjectType: "unknown" | "prospect" | "client" | "vendor";
  readonly normalizedText?: string;
}

export function qfjWhatsAppTurnSigningInput(args: {
  readonly requestId: string; readonly issuedAt: string; readonly keyId: string; readonly bodyDigest: string;
}): string {
  return [QFJ_WHATSAPP_TURN_SIGNING_DOMAIN, "POST", QFJ_WHATSAPP_TURN_PATH, CALLER, AUDIENCE,
    args.requestId, args.issuedAt, args.keyId, args.bodyDigest].join("\n");
}

export function signQfjWhatsAppTurn(rawBody: Uint8Array, requestId: string, issuedAt: string, keyId: string, privateKeyPem: string): string {
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(keyId) || !privateKeyPem.includes("PRIVATE KEY")) throw new Error("INVALID_JARVIS_SIGNING_KEY");
  const key = crypto.createPrivateKey(privateKeyPem);
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") throw new Error("INVALID_JARVIS_SIGNING_KEY");
  const bodyDigest = crypto.createHash("sha256").update(rawBody).digest("base64url");
  return crypto.sign(null, Buffer.from(qfjWhatsAppTurnSigningInput({ requestId, issuedAt, keyId, bodyDigest }), "utf8"), key).toString("base64url");
}

export function buildQfjWhatsAppTurn(input: Omit<QfjWhatsAppTurnV1,"protocol"|"version"|"caller"|"audience">): QfjWhatsAppTurnV1 {
  return Object.freeze({ protocol: QFJ_WHATSAPP_TURN_PROTOCOL, version: 1, caller: CALLER, audience: AUDIENCE, ...input });
}
