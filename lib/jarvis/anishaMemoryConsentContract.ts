/**
 * AN-A2b vendor-personal-memory PURPOSE consent, separate from WhatsApp
 * messaging, marketing, support and generic AI processing consent.
 * Signed Jarvis requests are narrowly bound to Core conversation authority.
 */
export const QFJ_ANISHA_MEMORY_CONSENT_PATH = '/api/internal/jarvis/anisha-memory-consent' as const;
export const QFJ_ANISHA_MEMORY_CONSENT_PROTOCOL = 'qfj.anisha.memory-consent' as const;
export const QFJ_ANISHA_MEMORY_CONSENT_DOMAIN = 'qfj.anisha.memory-consent.http.sig.v1' as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const DB_INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
const validDbInstant = (v: unknown): v is string =>
  typeof v === 'string' && DB_INSTANT.test(v) && Number.isFinite(Date.parse(v));
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(v, key));
const validTime = (v: unknown): v is string =>
  typeof v === 'string' && INSTANT.test(v) && Number.isFinite(Date.parse(v))
    && new Date(Date.parse(v)).toISOString() === v;

export interface AnishaMemoryConsentReadRequest {
  readonly protocol: typeof QFJ_ANISHA_MEMORY_CONSENT_PROTOCOL;
  readonly version: 1;
  readonly caller: 'qf-jarvis';
  readonly audience: 'quickfurno-core';
  readonly requestId: string;
  readonly issuedAt: string;
  readonly tenantId: 'quickfurno';
  readonly vendorId: string;
  readonly conversationId: string;
  readonly expectedRevision: number;
}

export function parseAnishaMemoryConsentReadRequest(value: unknown): AnishaMemoryConsentReadRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (!exact(obj, ['protocol', 'version', 'caller', 'audience', 'requestId',
    'issuedAt', 'tenantId', 'vendorId', 'conversationId', 'expectedRevision'])) return null;
  if (obj.protocol !== QFJ_ANISHA_MEMORY_CONSENT_PROTOCOL || obj.version !== 1 ||
    obj.caller !== 'qf-jarvis' || obj.audience !== 'quickfurno-core' ||
    obj.tenantId !== 'quickfurno' ||
    typeof obj.requestId !== 'string' || !UUID.test(obj.requestId) ||
    !validTime(obj.issuedAt) ||
    typeof obj.vendorId !== 'string' || !UUID.test(obj.vendorId) ||
    typeof obj.conversationId !== 'string' || !UUID.test(obj.conversationId) ||
    !Number.isSafeInteger(obj.expectedRevision) || (obj.expectedRevision as number) < 0) return null;
  return Object.freeze(obj as unknown as AnishaMemoryConsentReadRequest);
}

export type AnishaMemoryDecision = 'GRANTED' | 'DENIED' | 'UNKNOWN';
export const MEMORY_POLICY_VERSION = 1 as const;

export function effectiveAnishaMemoryConsent(value: unknown): AnishaMemoryDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'UNKNOWN';
  const v = value as Record<string, unknown>;
  // Any corrupt/malformed row is UNKNOWN, never GRANTED.
  if (v.policy_version !== MEMORY_POLICY_VERSION || v.purpose !== 'anisha_derived_preferences_v1' ||
    !Number.isSafeInteger(v.revision) || (v.revision as number) < 1 ||
    !validDbInstant(v.updated_at) ||
    (v.decision !== 'GRANTED' && v.decision !== 'DENIED')) return 'UNKNOWN';
  if (v.erase_required === true) return 'DENIED';
  if (v.decision === 'GRANTED' && v.revoked_at === null) return 'GRANTED';
  return 'DENIED';
}

/** Staging-only purpose-consent policy; unavailable by default. */
export function anishaMemoryConsentStagingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.QF_DEPLOYMENT_ENV === 'staging' &&
    env.QF_ANISHA_MEMORY_CONSENT_MODE === 'STAGING_ONLY';
}
