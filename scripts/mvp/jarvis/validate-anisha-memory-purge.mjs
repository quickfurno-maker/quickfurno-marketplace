import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANISHA_PURGE_PROTOCOL, ANISHA_PURGE_CLAIM_PATH, ANISHA_PURGE_ACK_PATH,
  ANISHA_PURGE_CLAIM_DOMAIN, ANISHA_PURGE_ACK_DOMAIN,
  parseAnishaPurgeClaim, parseAnishaPurgeAck,
} from '../../../lib/jarvis/anishaMemoryPurgeContract.ts';

let n = 0;
const check=(name,ok)=>{if(!ok)throw new Error('FAIL: '+name);n++;console.log('PASS '+name)};
const base={
  protocol:ANISHA_PURGE_PROTOCOL,version:1,caller:'qf-jarvis',audience:'quickfurno-core',
  requestId:'11111111-1111-4111-8111-111111111111',
  issuedAt:'2026-10-12T05:00:00.000Z',
};
const claim={...base,action:'CLAIM',maxItems:5};
const ack={...base,action:'ACK',purgeId:'22222222-2222-4222-8222-222222222222',
  vendorId:'33333333-3333-4333-8333-333333333333',leaseToken:'44444444-4444-4444-8444-444444444444'};
check('separate signed claim path/domain',ANISHA_PURGE_CLAIM_PATH.endsWith('purge-claim')&&ANISHA_PURGE_CLAIM_DOMAIN.includes('.claim.'));
check('separate signed ack path/domain',ANISHA_PURGE_ACK_PATH.endsWith('purge-ack')&&ANISHA_PURGE_ACK_DOMAIN.includes('.ack.'));
check('canonical bounded claim parses',parseAnishaPurgeClaim(claim)?.maxItems===5);
check('canonical exact lease ack parses',parseAnishaPurgeAck(ack)?.leaseToken===ack.leaseToken);
for(const [name,patch] of [
  ['wrong agent',{caller:'meta'}],['wrong audience',{audience:'jarvis'}],
  ['no action',{action:undefined}],['wrong method',{action:'ACK'}],
  ['zero tasks',{maxItems:0}],['oversized tasks',{maxItems:11}],
  ['extra vendor hint',{vendorId:ack.vendorId}],
  ['non UUID correlation',{requestId:'user-provided'}],
]) check('CLAIM denies '+name,parseAnishaPurgeClaim({...claim,...patch})===null);
for(const [name,patch] of [
  ['wrong action',{action:'CLAIM'}],['wrong agent',{caller:'client'}],
  ['missing lease',{leaseToken:undefined}],['invalid lease',{leaseToken:'abc'}],
  ['invalid purge ID',{purgeId:'abc'}],['missing vendor',{vendorId:undefined}],
  ['extra side effect',{chargeCredits:true}],
]) check('ACK denies '+name,parseAnishaPurgeAck({...ack,...patch})===null);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261012100000_anisha_memory_purge_delivery.sql'),'utf8');
const ledger=fs.readFileSync(path.join(root,'supabase/migrations/20261012080000_anisha_vendor_memory_consent_source.sql'),'utf8');
check('Core lease has expiry and skip locked',sql.includes('120 seconds')&&sql.includes('skip locked'));
check('no completion on claim',sql.includes('lease_token = gen_random_uuid()'));
check('ack requires exact nonexpired lease',sql.includes('q.lease_token=p_lease_token and q.leased_until>now()'));
check('ack alone lifts erase pending after no remaining tasks',sql.includes('not exists (')&&sql.includes('erase_required=false'));
check('delete vendor cannot discard outbox',ledger.includes('before delete on public.vendors')&&ledger.includes("values(old.id, 'vendor_erasure')"));
check('outbox vendor reference survives vendor delete',!ledger.includes('vendor_id uuid not null references public.vendors(id) on delete cascade'));
check('consent cannot be regranted while erase pending',ledger.includes('vendor_memory_erasure_pending'));
check('stage-outbox migrations not applied via this test',sql.startsWith('-- AN-A2c'));
console.log('RESULT '+n+' passed, 0 failed');
