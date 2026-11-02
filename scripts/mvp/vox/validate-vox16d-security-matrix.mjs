import assert from 'node:assert/strict';
import {resolveScopedStaff,filterHumanConversations} from '../../../contracts/vox/scopedStaff.mjs';
import {projectStaffServiceDesk} from '../../../contracts/vox/serviceDesk.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const now=Date.parse('2026-10-14T12:00:00Z'),until='2026-10-16T12:00:00Z';
const rolePerm={
 operations_manager:['prospect','vendor','support_thread','conversation'],
 acquisition_agent:['prospect','conversation'],
 vendor_success_agent:['vendor','support_thread','conversation'],
 support_agent:['vendor','support_thread','conversation'],
 auditor:['prospect','vendor'],
 team_leader:[]
};
const user=id(1),teamId=id(2),city=id(3),kinds=['prospect','vendor','support_thread','conversation'];
const make=(role,grants,opts={})=>resolveScopedStaff({
 userId:user,identityVerified:true,
 membership:{auth_user_id:user,staff_role:role,team_id:teamId,is_active:true,revoked_at:null,expires_at:until,...opts},
 team:{id:teamId,city_id:city,is_active:true},grants,now});
let n=0;
for(const [role,allowed] of Object.entries(rolePerm)){
 const scope=make(role,kinds.map((kind,i)=>({auth_user_id:user,scope_kind:kind,object_id:id(i+10),expires_at:until,revoked_at:null})));
 assert.ok(scope,'valid role '+role);
 for(let i=0;i<kinds.length;i++){
  const field={prospect:'prospectIds',vendor:'vendorIds',support_thread:'supportThreadIds',conversation:'conversationIds'}[kinds[i]];
  assert.deepEqual(scope[field],allowed.includes(kinds[i])?[id(i+10)]:[],role+' '+field);
  n++;
 }
 assert.equal(scope.canMutate,false);n++;
}
const base={auth_user_id:user,scope_kind:'vendor',object_id:id(11),expires_at:until,revoked_at:null};
for(const bad of [
 {...base,auth_user_id:id(99)}, {...base,object_id:'not-a-uuid'},
 {...base,revoked_at:'2026-10-14T11:00:00Z'},
 {...base,expires_at:'2026-10-14T11:00:00Z'},
 {...base,scope_kind:'invalid'}
]){
 const scope=make('vendor_success_agent',[bad]);
 assert.deepEqual(scope.vendorIds,[]);n++;
}
for(const props of [{is_active:false},{revoked_at:'2026-10-14T11:00:00Z'},{expires_at:'2026-10-13T00:00:00Z'},
 {staff_role:'superadmin'},{auth_user_id:id(9)}]){
 assert.equal(make('vendor_success_agent',[base],props),null);n++;
}
const scoped=make('vendor_success_agent',[
 {auth_user_id:user,scope_kind:'vendor',object_id:id(11),expires_at:until,revoked_at:null},
 {auth_user_id:user,scope_kind:'conversation',object_id:id(12),expires_at:until,revoked_at:null},
 {auth_user_id:user,scope_kind:'support_thread',object_id:id(13),expires_at:until,revoked_at:null}
]);
const rows=[
 {id:id(12),subject_type:'vendor',subject_id:id(11),state:'HUMAN',human_takeover:true,revision:7},
 {id:id(12),subject_type:'vendor',subject_id:id(11),state:'AI',human_takeover:true,revision:7},
 {id:id(12),subject_type:'vendor',subject_id:id(11),state:'HUMAN',human_takeover:false,revision:7},
 {id:id(77),subject_type:'vendor',subject_id:id(11),state:'HUMAN',human_takeover:true,revision:7},
 {id:id(12),subject_type:'vendor',subject_id:id(88),state:'HUMAN',human_takeover:true,revision:7},
 {id:id(12),subject_type:'client',subject_id:id(11),state:'HUMAN',human_takeover:true,revision:7}
];
assert.equal(filterHumanConversations(rows,scoped,[],[id(11)]).length,1);n++;
const projection=projectStaffServiceDesk({
 threads:[{id:id(13),vendor_id:id(11),status:'vendor_replied',priority:'high',created_at:'2026-10-14T10:00:00Z'}],
 conversations:rows,context:scoped,verifiedVendorIds:[id(11)],verifiedProspectIds:[],now});
assert.equal(projection.support.length,1);assert.equal(projection.humanInbox.length,1);
assert.equal(projection.support[0].canClose,false);assert.equal(projection.humanInbox[0].canReply,false);n+=4;
assert.equal(projectStaffServiceDesk({threads:[{id:id(13),vendor_id:id(77)}],
 context:scoped,verifiedVendorIds:[id(11)]}).support.length,0);n++;
console.log('VOX16D_STAFF_ROLE_REVOCATION_HUMAN_MATRIX_PASS '+n+'/'+n);
