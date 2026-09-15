import crypto from "crypto";
import {
  QFJ_CORE_DECISION_AUDIENCE,
  QFJ_CORE_DECISION_CALLER,
  QFJ_KEY_ID_HEADER,
  QFJ_SIGNATURE_HEADER,
  QFJ_CORE_DECISION_FRESHNESS_MS,
  rawQfjBodyDigest,
  type QfjVerificationKey,
} from "./coreDecisionAuth";

export { QFJ_KEY_ID_HEADER, QFJ_SIGNATURE_HEADER };

const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{1,512}$/;

export function qfjSignedRequestSigningInput(args: {
  readonly domain: string;
  readonly path: string;
  readonly requestId: string;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly bodyDigest: string;
}): string {
  return [args.domain, "POST", args.path, QFJ_CORE_DECISION_CALLER, QFJ_CORE_DECISION_AUDIENCE,
    args.requestId, args.issuedAt, args.keyId, args.bodyDigest].join("\n");
}

export function verifyQfjSignedRequestSignature(args: {
  readonly rawBody: Uint8Array;
  readonly domain: string;
  readonly path: string;
  readonly requestId: string;
  readonly issuedAt: string;
  readonly keyId: string | null;
  readonly signature: string | null;
  readonly keys: readonly QfjVerificationKey[];
  readonly now: string;
}): boolean {
  if (!args.keyId || !KEY_ID.test(args.keyId) || !args.signature || !SIGNATURE.test(args.signature)) return false;
  const current = Date.parse(args.now);
  const issued = Date.parse(args.issuedAt);
  if (!Number.isFinite(current) || !Number.isFinite(issued) || Math.abs(current - issued) > QFJ_CORE_DECISION_FRESHNESS_MS) return false;
  const configured = args.keys.find((entry) => entry.keyId === args.keyId);
  if (!configured) return false;
  let signatureBytes: Buffer;
  try { signatureBytes = Buffer.from(args.signature, "base64url"); } catch { return false; }
  if (signatureBytes.length !== 64) return false;
  try {
    const key = crypto.createPublicKey(configured.publicKeyPem);
    const input = qfjSignedRequestSigningInput({
      domain: args.domain,
      path: args.path,
      requestId: args.requestId,
      issuedAt: args.issuedAt,
      keyId: args.keyId,
      bodyDigest: rawQfjBodyDigest(args.rawBody),
    });
    return crypto.verify(null, Buffer.from(input, "utf8"), key, signatureBytes);
  } catch { return false; }
}