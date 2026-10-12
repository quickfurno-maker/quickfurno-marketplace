import { adminClient } from '../lib/supabase';
import { anishaMemoryConsentStagingEnabled } from '../lib/jarvis/anishaMemoryConsentContract';
import { ANISHA_PURGE_UUID, type AnishaPurgeClaimRequest, type AnishaPurgeAckRequest } from '../lib/jarvis/anishaMemoryPurgeContract';

export interface AnishaCorePurgeTask {
  readonly purgeId: string;
  readonly vendorId: string;
  readonly leaseToken: string;
}
export type AnishaPurgeServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: 'DISABLED' | 'UNAVAILABLE' };
const uuid = (v: unknown): v is string => typeof v === 'string' && ANISHA_PURGE_UUID.test(v);

export async function claimAnishaMemoryPurges(
  req: AnishaPurgeClaimRequest,
): Promise<AnishaPurgeServiceResult<readonly AnishaCorePurgeTask[]>> {
  if (!anishaMemoryConsentStagingEnabled()) return { ok: false, code: 'DISABLED' };
  try {
    const { data, error } = await adminClient().rpc('qf_claim_vendor_anisha_memory_purges_v1', {
      p_limit: req.maxItems,
    });
    if (error || !Array.isArray(data) || data.length > req.maxItems) {
      return { ok: false, code: 'UNAVAILABLE' };
    }
    const tasks: AnishaCorePurgeTask[] = [];
    for (const row of data as unknown[]) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return { ok: false, code: 'UNAVAILABLE' };
      const r = row as Record<string, unknown>;
      if (!uuid(r['purge_id']) || !uuid(r['vendor_id']) || !uuid(r['lease_token'])) {
        return { ok: false, code: 'UNAVAILABLE' };
      }
      tasks.push({ purgeId: r['purge_id'], vendorId: r['vendor_id'], leaseToken: r['lease_token'] });
    }
    return { ok: true, value: Object.freeze(tasks) };
  } catch { return { ok: false, code: 'UNAVAILABLE' }; }
}

export async function acknowledgeAnishaMemoryPurge(
  req: AnishaPurgeAckRequest,
): Promise<AnishaPurgeServiceResult<boolean>> {
  if (!anishaMemoryConsentStagingEnabled()) return { ok: false, code: 'DISABLED' };
  try {
    const { data, error } = await adminClient().rpc('qf_ack_vendor_anisha_memory_purge_v1', {
      p_purge_id: req.purgeId, p_vendor_id: req.vendorId, p_lease_token: req.leaseToken,
    });
    if (error || typeof data !== 'boolean') return { ok: false, code: 'UNAVAILABLE' };
    return { ok: true, value: data };
  } catch { return { ok: false, code: 'UNAVAILABLE' }; }
}
