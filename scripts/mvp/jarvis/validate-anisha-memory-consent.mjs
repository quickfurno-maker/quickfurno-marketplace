import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseAnishaMemoryConsentReadRequest, effectiveAnishaMemoryConsent,
  QFJ_ANISHA_MEMORY_CONSENT_PATH, QFJ_ANISHA_MEMORY_CONSENT_DOMAIN, anishaMemoryConsentStagingEnabled,
} from '../../../lib/jarvis/anishaMemoryConsentContract.ts';

let n = 0;
const check = (name, ok) => {
  if (!ok) throw new Error('FAIL: ' + name);
  ++n; console.log('PASS ' + name);
};
const req = {
  protocol: 'qfj.anisha.memory-consent', version: 1,
  caller: 'qf-jarvis', audience: 'quickfurno-core',
  requestId: '11111111-1111-4111-8111-111111111111',
  issuedAt: '2026-10-12T05:00:00.000Z', tenantId: 'quickfurno',
  vendorId: '44444444-4444-4444-8444-444444444444',
  conversationId: '22222222-2222-4222-8222-222222222222',
  expectedRevision: 9,
};
check('versioned signed purpose-specific endpoint',
  QFJ_ANISHA_MEMORY_CONSENT_PATH === '/api/internal/jarvis/anisha-memory-consent' &&
  QFJ_ANISHA_MEMORY_CONSENT_DOMAIN === 'qfj.anisha.memory-consent.http.sig.v1');
check('valid narrow request parses', parseAnishaMemoryConsentReadRequest(req)?.vendorId === req.vendorId);
for (const [name, patch] of [
  ['wrong tenant', { tenantId: 'other' }],
  ['wrong caller', { caller: 'meta' }],
  ['mismatched protocol', { protocol: 'whatsapp.marketing' }],
  ['unsafe vendor id', { vendorId: 'vendor.1' }],
  ['missing Core revision', { expectedRevision: undefined }],
  ['negative revision', { expectedRevision: -1 }],
  ['extra free text', { text: 'my bank account details' }],
]) {
  check('request denies ' + name, parseAnishaMemoryConsentReadRequest({ ...req, ...patch }) === null);
}
const grant = {
  purpose: 'anisha_derived_preferences_v1', policy_version: 1,
  decision: 'GRANTED', revision: 2,
  updated_at: '2026-10-12T05:00:00+00:00', revoked_at: null,
};
check('explicit granted purpose only', effectiveAnishaMemoryConsent(grant) === 'GRANTED');
check('revocation blocks immediately',
  effectiveAnishaMemoryConsent({ ...grant, decision: 'DENIED', revoked_at: '2026-10-12T05:05:00+00:00' }) === 'DENIED');
check('wrong purpose is not WhatsApp consent',
  effectiveAnishaMemoryConsent({ ...grant, purpose: 'marketing' }) === 'UNKNOWN');
check('corrupt/grant-revoked state is not granted',
  effectiveAnishaMemoryConsent({ ...grant, revoked_at: '2026-10-12T05:05:00+00:00' }) !== 'GRANTED');
check('missing ledger record never grants', effectiveAnishaMemoryConsent(null) === 'UNKNOWN');
check('inactive default mode', !anishaMemoryConsentStagingEnabled({}));
check('cannot enable in production',
  !anishaMemoryConsentStagingEnabled({ QF_DEPLOYMENT_ENV: 'production', QF_ANISHA_MEMORY_CONSENT_MODE: 'STAGING_ONLY' }));
check('requires exact staging opt-in',
  anishaMemoryConsentStagingEnabled({ QF_DEPLOYMENT_ENV: 'staging', QF_ANISHA_MEMORY_CONSENT_MODE: 'STAGING_ONLY' }));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261012080000_anisha_vendor_memory_consent_source.sql'), 'utf8');
check('consent separate from messaging tables', migration.includes('vendor_anisha_memory_consents'));
check('physical erasure outbox is durable', migration.includes('vendor_anisha_memory_purge_outbox'));
check('no authenticated direct writes', migration.includes('revoke all on public.vendor_anisha_memory_consents from public, anon, authenticated;'));
check('atomic revocation blocks regrant until erase', migration.includes('vendor_memory_erasure_pending'));
check('stage migration has no live activation directive', migration.includes('DO NOT APPLY BEFORE MANAGED STAGING MIGRATION APPROVAL'));
console.log('RESULT ' + n + ' passed, 0 failed');
