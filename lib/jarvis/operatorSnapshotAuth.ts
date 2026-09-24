import crypto from "node:crypto";

import {
  QFJ_OPERATOR_SNAPSHOT_AUDIENCE,
  QFJ_OPERATOR_SNAPSHOT_CALLER,
  QFJ_OPERATOR_SNAPSHOT_FRESHNESS_MS,
  QFJ_OPERATOR_SNAPSHOT_PATH,
  QFJ_OPERATOR_SNAPSHOT_SIGNING_DOMAIN,
  type QfjOperatorSnapshotRequestV1,
} from "./operatorSnapshotContract";
import { rawQfjBodyDigest, type QfjVerificationKey } from "./coreDecisionAuth";

const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{1,512}$/;

export function qfjOperatorSnapshotSigningInput(args: {
  readonly requestId: string;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly bodyDigest: string;
}): string {
  return [
    QFJ_OPERATOR_SNAPSHOT_SIGNING_DOMAIN,
    "POST",
    QFJ_OPERATOR_SNAPSHOT_PATH,
    QFJ_OPERATOR_SNAPSHOT_CALLER,
    QFJ_OPERATOR_SNAPSHOT_AUDIENCE,
    args.requestId,
    args.issuedAt,
    args.keyId,
    args.bodyDigest,
  ].join("\n");
}

export function verifyQfjOperatorSnapshotSignature(args: {
  readonly rawBody: Uint8Array;
  readonly request: QfjOperatorSnapshotRequestV1;
  readonly keyId: string | null;
  readonly signature: string | null;
  readonly keys: readonly QfjVerificationKey[];
  readonly now: string;
}): boolean {
  if (!args.keyId || !KEY_ID.test(args.keyId) || !args.signature || !SIGNATURE.test(args.signature)) return false;
  const current = Date.parse(args.now);
  const issued = Date.parse(args.request.issuedAt);
  if (!Number.isFinite(current) || !Number.isFinite(issued) || Math.abs(current - issued) > QFJ_OPERATOR_SNAPSHOT_FRESHNESS_MS) return false;
  const configured = args.keys.find((entry) => entry.keyId === args.keyId);
  if (!configured) return false;
  let signatureBytes: Buffer;
  try { signatureBytes = Buffer.from(args.signature, "base64url"); } catch { return false; }
  if (signatureBytes.length !== 64) return false;
  try {
    const key = crypto.createPublicKey(configured.publicKeyPem);
    const input = qfjOperatorSnapshotSigningInput({
      requestId: args.request.requestId,
      issuedAt: args.request.issuedAt,
      keyId: args.keyId,
      bodyDigest: rawQfjBodyDigest(args.rawBody),
    });
    return crypto.verify(null, Buffer.from(input, "utf8"), key, signatureBytes);
  } catch {
    return false;
  }
}
