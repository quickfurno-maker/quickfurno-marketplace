import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {isNeutralVoxStaffPrincipal} from '../../../contracts/vox/neutralStaffPrincipal.mjs';
const root=resolve(import.meta.dirname,'../../..');
const read=x=>readFileSync(resolve(root,x),'utf8');
const profile={id:'11111111-1111-4111-8111-111111111111',role:null,is_active:true};
const identity={id:profile.id,app_metadata:{qf_principal:'vox_staff'}};
let pos=0,neg=0;
const allow=(name,value)=>{assert.equal(isNeutralVoxStaffPrincipal(...value),true,name);pos++};
const deny=(name,value)=>{assert.equal(isNeutralVoxStaffPrincipal(...value),false,name);neg++};
allow('trusted neutral VOX staff', [profile,identity]);
allow('staff Team Leader metadata without Core admin', [profile,{...identity,app_metadata:{...identity.app_metadata,vox_role:'team_leader'}}]);
deny('legacy Core admin principal', [{...profile,role:'admin'},identity]);
deny('vendor principal', [{...profile,role:'vendor'},identity]);
deny('inactive staff', [{...profile,is_active:false},identity]);
deny('role omission from profile', [{id:profile.id,is_active:true},identity]);
deny('forged user role in user_metadata', [profile,{...identity,app_metadata:{},user_metadata:{qf_principal:'vox_staff'}}]);
deny('server-set admin tag', [profile,{...identity,app_metadata:{...identity.app_metadata,admin_role:'Superadmin'}}]);
deny('wrong principal category', [profile,{...identity,app_metadata:{qf_principal:'vendor'}}]);
deny('wrong identity subject', [profile,{...identity,id:'22222222-2222-4222-8222-222222222222'}]);
deny('unverified identity absent', [profile,null]);
deny('null Core profile', [null,identity]);
deny('absent trusted app metadata', [profile,{id:profile.id}]);
const scoped=read('services/vox/verifiedScopedStaff.ts');
assert.match(scoped,/isNeutralVoxStaffPrincipal\(profile\.data,user\)/);
assert.match(scoped,/verifySupabaseBearerUser\(raw\)/);
assert.match(scoped,/jwt\.aal!==\"aal2\"/);
assert.doesNotMatch(scoped,/profile\.data\?\.role!==\"admin\"/);
const grants=read('app/api/vox/v1/staff-grants/route.ts');
assert.match(grants,/target\.data\?\.role!==null/);
for(const [path,required] of [
 ['ops/vox/quarantined-migrations/legacy-20261014/20261014030000_vox_v1_approved_grant_finalizer.sql',1],
 ['ops/vox/quarantined-migrations/legacy-20261014/20261014050000_vox_v1_team_leader_review_policy.sql',3]
]){
 const sql=read(path);
 assert.equal((sql.match(/role is null/gi)||[]).length,required,path+' neutral roles');
 assert.equal((sql.match(/qf_principal'='vox_staff'/g)||[]).length,required,path+' trusted metadata');
 assert.equal((sql.match(/admin_role' is null/g)||[]).length,required,path+' no Core admin tag');
}
for(const path of [
 'ops/vox/quarantined-migrations/legacy-20261014/20261014060000_vox_operational_intent_review.sql',
 'ops/vox/quarantined-migrations/legacy-20261014/20261014070000_vox_approved_followup_executor.sql'
]){
 const sql=read(path);
 assert.match(sql,/p\.role is null/);
 assert.match(sql,/qf_principal'='vox_staff'/);
 assert.match(sql,/VOX_(SCOPE_REVOKED_BEFORE_REVIEW|FOLLOWUP_SCOPE_REVOKED)/);
}
const enroll=read('apps/vox-web/app/api/auth/mfa/enroll/route.ts');
const confirm=read('apps/vox-web/app/api/auth/mfa/confirm/route.ts');
for(const source of [enroll,confirm]){
 assert.match(source,/VOX_STAFF_MFA_ENROLL_ENABLED===\"staging\"/);
 assert.match(source,/app_metadata\?\.qf_principal===\"vox_staff\"/);
 assert.match(source,/app_metadata\?\.admin_role==null/);
 assert.match(source,/email_confirmed_at/);
 assert.doesNotMatch(source.replace(/^\s*\/\/.*$/gm,''),/(?:user\.)?user_metadata\s*(?:\?\.|\.|\[)|raw_user_meta_data/);
}
const flags=read('apps/vox-web/.env.example');
assert.match(flags,/VOX_STAFF_MFA_ENROLL_ENABLED=disabled/);
// SQL must still exist for source review, but never be auto-discoverable.
assert.equal(readdirSync(resolve(root,'supabase/migrations')).filter(x=>/^20261014\d{6}_vox.*\.sql$/.test(x)).length,0);
assert.equal(readdirSync(resolve(root,'ops/vox/quarantined-migrations/legacy-20261014'))
 .filter(x=>/^20261014\d{6}_vox.*\.sql$/.test(x)).length,7);
console.log('VOX_PHASE_A_NON_ADMIN_PRINCIPAL_SOURCE_PASS positive='+pos+' negative='+neg+
 ' databaseApplied=false staffInvitationsSent=false');
