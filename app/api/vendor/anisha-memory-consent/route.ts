import { NextResponse } from 'next/server';
import { updateOwnAnishaMemoryConsent, readOwnAnishaMemoryConsent } from '@/services/anishaMemoryConsentService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const respond = (status: number, body: unknown) => NextResponse.json(body, {
  status, headers: { 'cache-control': 'no-store' },
});
/**
 * Staging-only vendor self-service control. Supabase Auth + active vendor
 * membership is the sole identity authority; no caller vendorId accepted.
 */
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin ||
      request.headers.get('sec-fetch-site') === 'cross-site') {
    return respond(403, { ok: false, code: 'FORBIDDEN' });
  }
  const raw = await request.text().catch(() => '');
  if (Buffer.byteLength(raw, 'utf8') > 256) return respond(400, { ok: false, code: 'INVALID' });
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return respond(400, { ok: false, code: 'INVALID' }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return respond(400, { ok: false, code: 'INVALID' });
  const body = input as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || (body.decision !== 'GRANT' && body.decision !== 'REVOKE')) {
    return respond(400, { ok: false, code: 'INVALID' });
  }
  const result = await updateOwnAnishaMemoryConsent(body.decision === 'GRANT');
  if (!result.ok) return respond(result.code === 'UNAUTHORIZED' ? 401 : 503, { ok: false, code: result.code });
  return respond(200, { ok: true, decision: result.decision, erasurePending: result.erasePending });
}


// Request-scoped vendor access checks are the same as POST; no vendor id is accepted.
export async function GET(): Promise<Response> {
  const result = await readOwnAnishaMemoryConsent();
  if (!result.ok) return respond(result.code === 'UNAUTHORIZED' ? 401 : 503,
    { ok: false, code: result.code });
  return respond(200, {
    ok: true, purpose: 'anisha_derived_preferences_v1',
    decision: result.decision, erasurePending: result.erasePending,
  });
}
