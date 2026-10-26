import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const migration=read('supabase/migrations/20260723000600_qf_mvp_public_projection_privilege_hardening.sql');
const helpers=read('supabase/migrations/20260620000002_rls_policies.sql');
const manifest=JSON.parse(read('ops/vox/staging-security-posture-20261014.json'));
const cols=[
'id','business_name','city','office_city','areas_covered','covers_full_city',
'service_categories','selected_subcategories','selected_category','business_type',
'experience','years_experience','starting_price','public_description',
'public_service_area_summary','public_business_hours','profile_image_url',
'cover_image_url','portfolio_urls','rating','completed_projects'
];
const normalized=s=>s.replace(/\s+/g,'').toLowerCase();
function checkPublicProjection(sql){
 const m=sql.match(/create\s+or\s+replace\s+view\s+public\.vendor_public_v\s+as\s+select\s+([\s\S]*?)\s+from\s+public\.vendors\s+v\s+where\s+([\s\S]*?);/i);
 if(!m) return {ok:false,error:'VIEW_DEFINITION_MISSING'};
 const actual=m[1].split(',').map(x=>x.trim());
 if(actual.length!==cols.length||actual.some((x,i)=>normalized(x)!=='v.'+cols[i])){
  return {ok:false,error:'PUBLIC_VIEW_COLUMN_ALLOWLIST_CHANGED',columnCount:actual.length};
 }
 const where=normalized(m[2]).replace(/^\(+|\)+$/g,'');
 const expected=normalized("v.status='Approved' and v.is_active=true and v.public_visibility=true and v.remaining_credits>0");
 if(where!==expected)return {ok:false,error:'PUBLIC_VIEW_ROW_SCOPE_CHANGED'};
 if(!/revoke\s+all\s+on\s+table\s+public\.vendor_public_v\s+from\s+public\s*;/i.test(sql))
  return {ok:false,error:'PUBLIC_ROLE_VIEW_REVOKE_MISSING'};
 if(!/grant\s+select\s+on\s+table\s+public\.vendor_public_v\s+to\s+anon\s*,\s*authenticated\s*,\s*service_role\s*;/i.test(sql))
  return {ok:false,error:'EXPLICIT_PUBLIC_VIEW_READ_GRANT_MISSING'};
 if(!/revoke\s+all\s+privileges\s+on\s+table\s+public\.vendors\s+from\s+public\s*;/i.test(sql))
  return {ok:false,error:'PUBLIC_VENDOR_REVOKE_MISSING'};
 return {ok:true,columnCount:cols.length};
}
function checkRlsHelpers(sql){
 for(const fn of ['is_admin','owns_vendor']){
  const re=new RegExp('create\\s+or\\s+replace\\s+function\\s+public\\.'+fn+'\\s*\\([\\s\\S]*?\\)\\s*returns\\s+boolean\\s+language\\s+sql\\s+stable\\s+security\\s+definer\\s+set\\s+search_path\\s*=\\s*public\\s+as\\s+\\$\\$([\\s\\S]*?)\\$\\$','i');
  const m=sql.match(re);
  if(!m)return {ok:false,error:'RLS_HELPER_CONTRACT_CHANGED_'+fn};
  if(!m[1].includes('auth.uid()'))return {ok:false,error:'RLS_HELPER_MISSING_AUTH_IDENTITY_'+fn};
  if(/execute\s|format\s*\(|set_config\s*\(/i.test(m[1]))return {ok:false,error:'RLS_HELPER_UNSAFE_DYNAMIC_SQL_'+fn};
 }
 return {ok:true,helpers:2};
}
const view=checkPublicProjection(migration),rls=checkRlsHelpers(helpers);
assert.equal(view.ok,true,JSON.stringify(view));
assert.equal(rls.ok,true,JSON.stringify(rls));
assert.equal(manifest.schema,'qf.vox.security.exception-evidence.v1');
assert.equal(manifest.stagingProjectRef,'uckafzuochmbvtiodmcl');
assert.equal(manifest.allowedPublicColumns,21);
assert.equal(manifest.realStagingMigrationCount,86);
assert.equal(manifest.realStagingVoxApplied,0);
assert.equal(manifest.advisorWarningsRemainOpen,true);
assert.equal(manifest.releaseHold,true);
assert.equal(manifest.ownerRiskAcceptanceGranted,false);
const deny=(want,value)=>assert.equal(value.error,want);
if(process.argv.includes('--self-test')){
 deny('PUBLIC_VIEW_COLUMN_ALLOWLIST_CHANGED',checkPublicProjection(migration.replace('v.completed_projects\n','v.completed_projects, v.owner_name\n')));
 deny('PUBLIC_VIEW_ROW_SCOPE_CHANGED',checkPublicProjection(migration.replace('and v.remaining_credits > 0;','or v.remaining_credits > 0;')));
 deny('PUBLIC_VIEW_ROW_SCOPE_CHANGED',checkPublicProjection(migration.replace("where v.status = 'Approved'","where v.status = 'Pending'")));
 deny('EXPLICIT_PUBLIC_VIEW_READ_GRANT_MISSING',checkPublicProjection(migration.replace('grant select on table public.vendor_public_v to anon, authenticated, service_role;','')));
 deny('RLS_HELPER_MISSING_AUTH_IDENTITY_is_admin',checkRlsHelpers(helpers.replace('where id = auth.uid()','where id = null')));
 console.log('VOX23_SECURITY_EXCEPTION_NEGATIVE_TESTS_PASS 5/5');
}
console.log('VOX23_SECURITY_EXCEPTION_SOURCE_GATE_PASS '+JSON.stringify({columns:view.columnCount,functions:rls.helpers,protectedRowPredicate:true,sourceOnly:true,realStagingAdvisorOpen:true,releaseHold:true}));
