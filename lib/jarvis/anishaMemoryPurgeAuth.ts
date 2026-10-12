import { parseQfjVerificationKeys } from './coreDecisionAuth';
import { QFJ_KEY_ID_HEADER, QFJ_SIGNATURE_HEADER, verifyQfjSignedRequestSignature } from './signedRequestAuth';

/** Reuse the established Jarvis -> Core Ed25519 trust boundary. */
export function verifyAnishaMemoryPurgeRequest(input: {
  readonly raw: Uint8Array;
  readonly request: Request;
  readonly domain: string;
  readonly path: string;
  readonly requestId: string;
  readonly issuedAt: string;
}): boolean {
  const keys = parseQfjVerificationKeys(process.env.QF_JARVIS_CORE_VERIFICATION_KEYS_JSON);
  if (!keys) return false;
  return verifyQfjSignedRequestSignature({
    rawBody: input.raw, requestHeaders: input.request.headers,
    domain: input.domain, path: input.path,
    requestId: input.requestId, issuedAt: input.issuedAt,
    keyId: input.request.headers.get(QFJ_KEY_ID_HEADER),
    signature: input.request.headers.get(QFJ_SIGNATURE_HEADER),
    keys, now: new Date().toISOString(),
  });
}
