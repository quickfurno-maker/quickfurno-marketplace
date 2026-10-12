import { adminClient } from '../lib/supabase';
import { requireVendorAccess } from './vendorAccessService';
import { readJarvisWhatsAppAuthorityState } from './conversationalWhatsAppService';
import { effectiveAnishaMemoryConsent, anishaMemoryConsentStagingEnabled, type AnishaMemoryConsentReadRequest } from '../lib/jarvis/anishaMemoryConsentContract';

export type AnishaConsentResult =
  | { readonly ok: true; readonly decision: 'GRANTED' | 'DENIED' | 'UNKNOWN'; readonly observedAt: string }
  | { readonly ok: false; readonly code: 'DISABLED' | 'UNAUTHORIZED' | 'UNAVAILABLE' };

/** Read is scoped to live Core conversation AND canonical vendor identity. */
export async function readAnishaMemoryConsent(
  req: AnishaMemoryConsentReadRequest,
): Promise<AnishaConsentResult> {
  if (!anishaMemoryConsentStagingEnabled()) return { ok: false, code: 'DISABLED' };
  try {
    const authority = await readJarvisWhatsAppAuthorityState({
      tenantId: req.tenantId, conversationId: req.conversationId,
    });
    if (!authority.ok) return { ok: false, code: 'UNAVAILABLE' };
    const a = authority.value;
    if (a.revision !== req.expectedRevision || a.assignedActor !== 'ANISHA' ||
      a.subjectType !== 'vendor' || a.subjectRef !== req.vendorId ||
      a.partyType !== 'VENDOR' || a.conversationState !== 'OPEN' ||
      !a.jarvisAllowed || a.aiPaused || a.humanTakeover || a.cancelled ||
      a.subjectStatus !== 'clear') return { ok: false, code: 'UNAUTHORIZED' };
    const { data, error } = await adminClient().from('vendor_anisha_memory_consents')
      .select('purpose, policy_version, decision, revision, updated_at, revoked_at, erase_required')
      .eq('vendor_id', req.vendorId).maybeSingle();
    if (error) return { ok: false, code: 'UNAVAILABLE' };
    const decision = data?.erase_required === true ? 'DENIED' : effectiveAnishaMemoryConsent(data);
    return { ok: true, decision, observedAt: new Date().toISOString() };
  } catch { return { ok: false, code: 'UNAVAILABLE' }; }
}

/**
 * Vendor self-service transition. Identity comes ONLY from the canonical
 * dashboard session resolver, never an inbound vendor id.
 * A confirmed revoke creates a physical-erasure outbox event inside Core.
 */
export async function updateOwnAnishaMemoryConsent(
  grant: boolean,
): Promise<{ readonly ok: true; readonly decision: 'GRANTED' | 'DENIED'; readonly erasePending: boolean }
  | { readonly ok: false; readonly code: 'DISABLED' | 'UNAUTHORIZED' | 'UNAVAILABLE' }> {
  if (!anishaMemoryConsentStagingEnabled()) return { ok: false, code: 'DISABLED' };
  const access = await requireVendorAccess();
  if (!access.ok) return { ok: false, code: 'UNAUTHORIZED' };
  try {
    const { data, error } = await adminClient().rpc('qf_set_vendor_anisha_memory_consent_v1', {
      p_vendor_id: access.data.vendorId, p_grant: grant,
    });
    if (error || !Array.isArray(data) || data.length !== 1) {
      return { ok: false, code: 'UNAVAILABLE' };
    }
    const row = data[0] as Record<string, unknown>;
    if (row.decision !== (grant ? 'GRANTED' : 'DENIED') || typeof row.erase_required !== 'boolean') {
      return { ok: false, code: 'UNAVAILABLE' };
    }
    return { ok: true, decision: grant ? 'GRANTED' : 'DENIED', erasePending: row.erase_required };
  } catch { return { ok: false, code: 'UNAVAILABLE' }; }
}


/**
 * Vendor self-service view: decisions are about this logged-in vendor ONLY.
 * Missing records are UNKNOWN (no opt-in), never inferred as granted.
 */
export async function readOwnAnishaMemoryConsent(): Promise<
  { readonly ok: true; readonly decision: 'GRANTED' | 'DENIED' | 'UNKNOWN'; readonly erasePending: boolean }
  | { readonly ok: false; readonly code: 'DISABLED' | 'UNAUTHORIZED' | 'UNAVAILABLE' }
> {
  if (!anishaMemoryConsentStagingEnabled()) return { ok: false, code: 'DISABLED' };
  const access = await requireVendorAccess();
  if (!access.ok) return { ok: false, code: 'UNAUTHORIZED' };
  try {
    const { data, error } = await adminClient().from('vendor_anisha_memory_consents')
      .select('purpose,policy_version,decision,revision,updated_at,revoked_at,erase_required')
      .eq('vendor_id', access.data.vendorId).maybeSingle();
    if (error) return { ok: false, code: 'UNAVAILABLE' };
    const erasePending = data?.erase_required === true;
    return {
      ok: true,
      decision: erasePending ? 'DENIED' : effectiveAnishaMemoryConsent(data),
      erasePending,
    };
  } catch { return { ok: false, code: 'UNAVAILABLE' }; }
}
