// Jarvis -> VOX source-only, read-only agent event contract.
// Verifies a short-lived signed server-to-server assertion; runtime MUST store
// (issuer,jti) to reject replay before accepting any requested state transition.
import { createHmac, timingSafeEqual } from 'node:crypto';
export const VOX_JARVIS_CONTRACT = 'qf.vox.agent.view.v1';
export const VOX_AGENT_CHANNELS = Object.freeze({
  AAROHI: 'ACQUISITION',
  ANISHA: 'VENDOR_SERVICE',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MSTATUS = Object.freeze([
  'DISABLED',
  'CONSENTED',
  'PENDING_CONSENT',
  'PAUSED',
  'ERASE_PENDING',
  'UNKNOWN',
]);
const ALLOWED_KEYS = new Set([
  'schema',
  'iss',
  'aud',
  'agent',
  'channel',
  'subjectType',
  'subjectId',
  'jti',
  'revision',
  'iat',
  'exp',
  'memoryStatus',
  'humanTakeover',
  'lastEvent',
]);
const sign = (body, secret) => createHmac('sha256', secret).update(body).digest('base64url');
const safe = (x, max) =>
  typeof x === 'string'
    ? [...x]
        .map((c) => (c.charCodeAt(0) < 32 ? ' ' : c))
        .join('')
        .trim()
        .slice(0, max)
    : '';
function validateEvent(e) {
  if (
    !e ||
    typeof e !== 'object' ||
    Array.isArray(e) ||
    Object.keys(e).some((k) => !ALLOWED_KEYS.has(k))
  )
    return false;
  if (
    !e ||
    e.schema !== VOX_JARVIS_CONTRACT ||
    e.iss !== 'qf-jarvis' ||
    e.aud !== 'vox-web' ||
    !Object.hasOwn(VOX_AGENT_CHANNELS, e.agent) ||
    e.channel !== VOX_AGENT_CHANNELS[e.agent] ||
    !UUID.test(String(e.subjectId)) ||
    !UUID.test(String(e.jti)) ||
    !Number.isSafeInteger(e.revision) ||
    e.revision < 0 ||
    !Number.isSafeInteger(e.iat) ||
    !Number.isSafeInteger(e.exp) ||
    e.exp - e.iat > 300 ||
    e.exp <= e.iat ||
    !MSTATUS.includes(e.memoryStatus)
  )
    return false;
  if (e.agent === 'AAROHI' && e.subjectType !== 'prospect') return false;
  if (e.agent === 'ANISHA' && e.subjectType !== 'vendor') return false;
  if (
    Object.hasOwn(e, 'outboundBody') ||
    Object.hasOwn(e, 'rawMemory') ||
    Object.hasOwn(e, 'phone') ||
    Object.hasOwn(e, 'coreVendorStatus') ||
    Object.hasOwn(e, 'wallet') ||
    Object.hasOwn(e, 'credits')
  )
    return false;
  return true;
}
function needSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32)
    throw new Error('VOX_JARVIS_SIGNING_KEY_MISSING');
}
export function signAgentView(event, secret) {
  needSecret(secret);
  if (!validateEvent(event)) throw new Error('INVALID_AGENT_VIEW');
  const body = Buffer.from(JSON.stringify(event), 'utf8').toString('base64url');
  return body + '.' + sign(body, secret);
}
export function verifyAgentView(token, secret, nowSecs = Math.floor(Date.now() / 1000)) {
  needSecret(secret);
  if (
    typeof token !== 'string' ||
    token.length > 6144 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  )
    throw new Error('INVALID_SIGNATURE');
  const [body, signature] = token.split('.');
  const expected = Buffer.from(sign(body, secret), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new Error('INVALID_SIGNATURE');
  let e;
  try {
    e = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Error('INVALID_PAYLOAD');
  }
  if (
    !validateEvent(e) ||
    !Number.isSafeInteger(nowSecs) ||
    e.iat > nowSecs + 30 ||
    e.exp <= nowSecs
  )
    throw new Error('INVALID_OR_EXPIRED_AGENT_VIEW');
  // Render a narrow projection, not arbitrary signed metadata. No raw transcripts,
  // model prompts, long-term memory, destination numbers or financial fields.
  return Object.freeze({
    schema: VOX_JARVIS_CONTRACT,
    agent: e.agent,
    channel: e.channel,
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    revision: e.revision,
    memoryStatus: e.memoryStatus,
    humanTakeover: e.humanTakeover === true,
    lastEvent: safe(e.lastEvent, 100),
    jti: e.jti,
    expiresAt: e.exp,
    replayCheckRequired: true,
    permissions: Object.freeze(['READ_ONLY']),
  });
}
