import crypto from "crypto";
import type { QfjCoreDecisionCommandV2 } from "./coreDecisionContract";

export const QFJ_CORE_DECISION_METHOD = "POST" as const;
export const QFJ_CORE_DECISION_PATH = "/api/internal/jarvis/core-decision" as const;
export const QFJ_CORE_DECISION_CALLER = "qf-jarvis" as const;
export const QFJ_CORE_DECISION_AUDIENCE = "quickfurno-core" as const;
export const QFJ_CORE_DECISION_SIGNING_DOMAIN = "qfj.core.decision.http.sig.v1" as const;
export const QFJ_KEY_ID_HEADER = "x-qfj-key-id" as const;
export const QFJ_SIGNATURE_HEADER = "x-qfj-signature" as const;
export const QFJ_CORE_DECISION_FRESHNESS_MS = 60_000;

export interface QfjVerificationKey { readonly keyId: string; readonly publicKeyPem: string; }
const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export function rawQfjBodyDigest(rawBody: Uint8Array): string {
  return crypto.createHash("sha256").update(rawBody).digest("base64url");
}

export function qfjCoreDecisionSigningInput(args: {
  readonly commandId: string; readonly createdAt: string; readonly keyId: string; readonly bodyDigest: string;
}): string {
  return [QFJ_CORE_DECISION_SIGNING_DOMAIN, QFJ_CORE_DECISION_METHOD, QFJ_CORE_DECISION_PATH,
    QFJ_CORE_DECISION_CALLER, QFJ_CORE_DECISION_AUDIENCE, args.commandId, args.createdAt, args.keyId, args.bodyDigest].join("\n");
}

export function parseQfjVerificationKeys(raw: string | undefined): readonly QfjVerificationKey[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 4) return null;
    const seen = new Set<string>();
    const keys: QfjVerificationKey[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      if (Object.keys(record).sort().join(",") !== "keyId,publicKeyPem") return null;
      if (typeof record.keyId !== "string" || !KEY_ID.test(record.keyId) || seen.has(record.keyId)) return null;
      if (typeof record.publicKeyPem !== "string" || record.publicKeyPem.length === 0 || record.publicKeyPem.includes("PRIVATE KEY")) return null;
      const key = crypto.createPublicKey(record.publicKeyPem);
      if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") return null;
      seen.add(record.keyId); keys.push({ keyId: record.keyId, publicKeyPem: record.publicKeyPem });
    }
    return Object.freeze(keys);
  } catch { return null; }
}

export function verifyQfjCoreDecisionSignature(args: {
  readonly rawBody: Uint8Array; readonly command: QfjCoreDecisionCommandV2; readonly keyId: string | null;
  readonly signature: string | null; readonly keys: readonly QfjVerificationKey[]; readonly now: string;
}): boolean {
  if (!args.keyId || !KEY_ID.test(args.keyId) || !args.signature || !/^[A-Za-z0-9_-]{1,512}$/.test(args.signature)) return false;
  const current = Date.parse(args.now); const created = Date.parse(args.command.createdAt);
  if (!Number.isFinite(current) || !Number.isFinite(created) || Math.abs(current - created) > QFJ_CORE_DECISION_FRESHNESS_MS) return false;
  const configured = args.keys.find((entry) => entry.keyId === args.keyId); if (!configured) return false;
  let signatureBytes: Buffer; try { signatureBytes = Buffer.from(args.signature, "base64url"); } catch { return false; }
  if (signatureBytes.length !== 64) return false;
  try {
    const key = crypto.createPublicKey(configured.publicKeyPem);
    const input = Buffer.from(qfjCoreDecisionSigningInput({ commandId: args.command.commandId, createdAt: args.command.createdAt,
      keyId: args.keyId, bodyDigest: rawQfjBodyDigest(args.rawBody) }), "utf8");
    return crypto.verify(null, input, key, signatureBytes);
  } catch { return false; }
}
