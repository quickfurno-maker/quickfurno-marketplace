import assert from 'node:assert/strict';
import {projectStaffServiceDesk} from '../../../contracts/vox/serviceDesk.mjs';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const context={canReadContent:true,canMutate:false,
 supportThreadIds:[id(1)],vendorIds:[id(2)],prospectIds:[],conversationIds:[]};
const now=Date.parse('2026-10-14T08:00:00.000Z');
const seed={id:id(1),vendor_id:id(2),status:'vendor_replied',
 priority:'high',created_at:'2026-10-13T08:00:00.000Z',updated_at:'2026-10-13T11:00:00Z'};
const mk=(status,ctx=context,source=seed)=>projectStaffServiceDesk({
 threads:[{...source,status}],context:ctx,verifiedVendorIds:[id(2)],verifiedProspectIds:[],now}).support;
let n=0;function check(name,fn){fn();console.log('PASS '+name);n++}
for(const state of ['open','vendor_replied','admin_replied','closed']){
 check('canonical status '+state,()=>{const r=mk(state);assert.equal(r.length,1);assert.equal(r[0].state,state);
  assert.equal(r[0].canClose,false);assert.equal(r[0].slaStatus,'NOT_CONFIGURED');});
}
check('unrecognized pending state is not falsely supported',()=>assert.equal(mk('pending')[0].state,'UNKNOWN'));
check('unrecognized resolved state is not falsely supported',()=>assert.equal(mk('resolved')[0].state,'UNKNOWN'));
check('unassigned case hidden',()=>assert.equal(mk('open',{...context,supportThreadIds:[]}).length,0));
check('cross-vendor case hidden',()=>assert.equal(mk('open',context,{...seed,vendor_id:id(5)}).length,0));
check('aged support shown without invented SLA',()=>assert.equal(mk('open')[0].ageBand,'24_TO_72H'));
check('no provider message content in projection',()=>{
 const result=mk('open')[0];for(const key of ['phone','whatsapp','message','note','body'])assert.equal(key in result,false);
});
const web=readFileSync(resolve(import.meta.dirname,'../../../apps/vox-web/app/service-desk/page.tsx'),'utf8');
check('reply remains only approval proposal',()=>assert.match(web,/StaffProposalForm kind="SUPPORT_REPLY"/));
check('no direct WhatsApp send',()=>assert.match(web,/No direct WhatsApp sends/));
console.log('VOX16B_SERVICE_DESK_CANONICAL_STATUS_PASS '+n+'/'+n);
