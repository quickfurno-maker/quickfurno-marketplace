/** AN-A2c Core-owned purge job protocol; only Jarvis may claim/ack. */
export const ANISHA_PURGE_PROTOCOL = 'qfj.anisha.memory-purge' as const;
export const ANISHA_PURGE_CLAIM_PATH = '/api/internal/jarvis/anisha-memory-purge-claim';
export const ANISHA_PURGE_ACK_PATH = '/api/internal/jarvis/anisha-memory-purge-ack';
export const ANISHA_PURGE_CLAIM_DOMAIN = 'qfj.anisha.memory-purge.claim.http.sig.v1';
export const ANISHA_PURGE_ACK_DOMAIN = 'qfj.anisha.memory-purge.ack.http.sig.v1';
export const ANISHA_PURGE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const validTimestamp = (v: unknown): v is string => typeof v === 'string' &&
  INSTANT.test(v) && Number.isFinite(Date.parse(v)) &&
  new Date(Date.parse(v)).toISOString() === v;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).length === keys.length && keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));
const baseKeys = ['protocol','version','action','caller','audience','requestId','issuedAt'] as const;
const validBase = (v: Record<string, unknown>,action:'CLAIM'|'ACK') =>
  v.protocol===ANISHA_PURGE_PROTOCOL && v.version===1 && v.action===action &&
  v.caller==='qf-jarvis' && v.audience==='quickfurno-core' &&
  typeof v.requestId==='string' && ANISHA_PURGE_UUID.test(v.requestId) &&
  validTimestamp(v.issuedAt);
export interface AnishaPurgeClaimRequest {
  readonly protocol:typeof ANISHA_PURGE_PROTOCOL;readonly version:1;readonly action:'CLAIM';
  readonly caller:'qf-jarvis';readonly audience:'quickfurno-core';
  readonly requestId:string;readonly issuedAt:string;readonly maxItems:number;
}
export interface AnishaPurgeAckRequest {
  readonly protocol:typeof ANISHA_PURGE_PROTOCOL;readonly version:1;readonly action:'ACK';
  readonly caller:'qf-jarvis';readonly audience:'quickfurno-core';
  readonly requestId:string;readonly issuedAt:string;
  readonly purgeId:string;readonly vendorId:string;readonly leaseToken:string;
}
export function parseAnishaPurgeClaim(value:unknown):AnishaPurgeClaimRequest|null {
  if(!isRecord(value)||!exact(value,[...baseKeys,'maxItems'])||!validBase(value,'CLAIM')||
    !Number.isInteger(value.maxItems)||(value.maxItems as number)<1||(value.maxItems as number)>10) return null;
  return value as unknown as AnishaPurgeClaimRequest;
}
export function parseAnishaPurgeAck(value:unknown):AnishaPurgeAckRequest|null {
  if(!isRecord(value)||!exact(value,[...baseKeys,'purgeId','vendorId','leaseToken'])||
    !validBase(value,'ACK')|| !['purgeId','vendorId','leaseToken'].every(
      k=>typeof value[k]==='string'&&ANISHA_PURGE_UUID.test(value[k] as string))) return null;
  return value as unknown as AnishaPurgeAckRequest;
}
