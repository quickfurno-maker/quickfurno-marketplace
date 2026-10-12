import { NextResponse } from 'next/server';
import { parseQfjVerificationKeys } from '@/lib/jarvis/coreDecisionAuth';
import { QFJ_KEY_ID_HEADER, QFJ_SIGNATURE_HEADER, verifyQfjSignedRequestSignature } from '@/lib/jarvis/signedRequestAuth';
import { QFJ_ANISHA_MEMORY_CONSENT_PATH, QFJ_ANISHA_MEMORY_CONSENT_DOMAIN,
  QFJ_ANISHA_MEMORY_CONSENT_PROTOCOL, parseAnishaMemoryConsentReadRequest } from '@/lib/jarvis/anishaMemoryConsentContract';
import { readAnishaMemoryConsent } from '@/services/anishaMemoryConsentService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const respond = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
export async function POST(request: Request): Promise<Response> {
  const raw = new Uint8Array(await request.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (raw.byteLength < 2 || raw.byteLength > 4096) return respond(400, { error: 'invalid_request' });
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(raw).toString('utf8')); }
  catch { return respond(400, { error: 'invalid_request' }); }
  const input = parseAnishaMemoryConsentReadRequest(parsed);
  if (!input) return respond(400, { error: 'invalid_request' });
  const keys = parseQfjVerificationKeys(process.env.QF_JARVIS_CORE_VERIFICATION_KEYS_JSON);
  if (!keys) return respond(503, { error: 'service_unavailable' });
  if (!verifyQfjSignedRequestSignature({
    rawBody: raw, domain: QFJ_ANISHA_MEMORY_CONSENT_DOMAIN,
    path: QFJ_ANISHA_MEMORY_CONSENT_PATH, requestId: input.requestId,
    issuedAt: input.issuedAt, keyId: request.headers.get(QFJ_KEY_ID_HEADER),
    signature: request.headers.get(QFJ_SIGNATURE_HEADER), keys,
    requestHeaders: request.headers, now: new Date().toISOString(),
  })) return respond(401, { error: 'authentication_failed' });
  const result = await readAnishaMemoryConsent(input);
  if (!result.ok) return respond(result.code === 'UNAUTHORIZED' ? 403 : 503, { error: 'unavailable' });
  return respond(200, {
    protocol: QFJ_ANISHA_MEMORY_CONSENT_PROTOCOL, version: 1, requestId: input.requestId,
    vendorId: input.vendorId, conversationId: input.conversationId,
    expectedRevision: input.expectedRevision, source: 'QUICKFURNO_CORE',
    decision: result.decision, observedAt: result.observedAt,
  });
}
