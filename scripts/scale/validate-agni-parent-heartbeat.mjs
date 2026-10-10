import {readFileSync} from 'node:fs';
import {strict as assert} from 'node:assert';
const source=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const r=source('app/api/internal/agni/owner-snapshot/route.ts');
const c=source('lib/agni/ownerContract.ts');
const s=source('services/agniParentHeartbeatService.ts');
const checks=[
 ['strict signed M2M ingress unchanged',r.includes('verifyQfjScaleWebRequest')&&r.includes('allowLegacy:false')&&r.includes('AGNI_OWNER_ACTOR')],
 ['no new public route',r.includes('AGNI_OWNER_SNAPSHOT_PATH')&&r.includes('getAgniQuickFurnoParentHeartbeat')],
 ['source-attested revision and identity',s.includes('process.env.QF_RELEASE_SHA')&&s.includes('sourceId:"quickfurno-core"')],
 ['independent database probe',s.includes('adminClient().from("cities")')&&!s.includes('getAgniOwnerQuickFurnoSnapshot')],
 ['exact version and random nonce validation',c.includes('AGNI_PARENT_HEARTBEAT_PROTOCOL')&&c.includes('challenge:z.string().regex')],
 ['no business mutation',!s.includes('.insert(')&&!s.includes('.update(')&&!s.includes('.delete(')&&!s.includes('openai')],
 ['missing revision refuses green',s.includes('sourceRevision===null?"UNKNOWN"')],
 ['read-only identity and authority',s.includes('executionAuthority:"NONE"')&&s.includes('authority:"READ_ONLY"')],
];
for(const [name,ok] of checks)console.log((ok?'PASS ':'FAIL ')+name);
assert(checks.every(x=>x[1]),'QUICKFURNO_PARENT_HEARTBEAT_CONTRACT_REFUSED');
console.log('QF_PARENT_HEARTBEAT_CONTRACT_PASS '+checks.length);
