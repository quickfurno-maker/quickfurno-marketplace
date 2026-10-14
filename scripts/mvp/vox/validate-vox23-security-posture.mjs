import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
const baseline=JSON.parse(readFileSync(resolve(root,'ops/vox/staging-security-posture-20261014.json'),'utf8'));
const publicColumns=["id","business_name","city","office_city","areas_covered","covers_full_city","service_categories","selected_subcategories","selected_category","business_type","experience","years_experience","starting_price","public_description","public_service_area_summary","public_business_hours","profile_image_url","cover_image_url","portfolio_urls","rating","completed_projects"];
const migration=readFileSync(resolve(root,'supabase/migrations/20260911000000_qf_launch_security_closeout.sql'),'utf8');
function validate(s){
 const errors=[];
 const fail=(condition,reason)=>{if(!condition)errors.push(reason);};
 fail(s?.schema==='qf.vox.security-posture.v1','BAD_SCHEMA');
 fail(s?.projectRef==='uckafzuochmbvtiodmcl','WRONG_STAGING_PROJECT');
 fail(s?.migrationCount===86 && s?.voxMigrationsApplied===0,'STAGING_MIGRATION_STATE_CHANGED_REASSESS');
 const l=s?.listing||{};
 fail(Array.isArray(l.columns)&&l.columns.length===21&&l.columns.every((col,i)=>col===publicColumns[i]),'PUBLIC_LISTING_COLUMN_DRIFT');
 fail(l.viewSecurityInvoker===false && l.anonymousViewSelect===true,'PUBLIC_DISCOVERY_VIEW_BROKEN');
 fail(l.anonymousBaseSelect===false && l.anonymousViewUpdate===false,'ANON_VENDOR_DATA_ESCALATION');
 fail(l.authenticatedViewSelect===true,'AUTHENTICATED_PUBLIC_LISTING_BROKEN');
 fail(Array.isArray(l.approvedVisibilityFilters)&&l.approvedVisibilityFilters.length===4&&
  ['status = \'Approved\'','is_active = true','public_visibility = true','remaining_credits > 0'].every(x=>l.approvedVisibilityFilters.includes(x)),'VIEW_ELIGIBILITY_FILTERS_CHANGED');
 for(const h of ['is_admin','owns_vendor']){
  const x=s?.helpers?.[h];
  fail(x?.securityDefiner===true && x?.anonymousExecute===false && x?.authenticatedExecute===true
   && x?.qualifiedReferences===true,'PRIVILEGED_HELPER_DRIFT_'+h);
 }
 fail(s?.roles?.anonCreatePublic===false&&s?.roles?.authenticatedCreatePublic===false,'PUBLIC_SCHEMA_CREATE_ESCALATION');
 fail(Number.isInteger(s?.denyAllTables?.withoutRlsPolicies)&&s.denyAllTables.withoutRlsPolicies>=0,'BAD_NO_POLICY_TABLE_COUNT');
 fail(s?.denyAllTables?.anonSelectGranted===0&&s?.denyAllTables?.authenticatedSelectGranted===0,'NO_POLICY_TABLE_GRANTED_SELECT');
 // Config owned by Supabase Auth; not a SQL code bypass. Preserve as an explicit P0 release hold.
 const authProtection=s?.auth?.leakedPasswordProtectionEnabled===true;
 fail(typeof s?.auth?.leakedPasswordProtectionEnabled==='boolean','AUTH_PROTECTION_UNVERIFIED');
 return {ok:errors.length===0,errors,sourceBaselinePassed:errors.length===0,
  authConfigPending:!authProtection,allowManagedStageMigration:false,
  allowProductionCutover:false};
}
function check(label,fn){fn();console.log('PASS '+label);}
if(process.argv.includes('--self-test')){
 check('current first-party reference baseline',()=>assert.equal(validate(baseline).ok,true));
 const mutate=(change)=>{const o=structuredClone(baseline);change(o);return validate(o);};
 check('extra vendor PII column rejected',()=>assert.equal(mutate(x=>x.listing.columns.push('user_id')).ok,false));
 check('anonymous base table grant rejected',()=>assert.equal(mutate(x=>x.listing.anonymousBaseSelect=true).ok,false));
 check('anonymous view mutation rejected',()=>assert.equal(mutate(x=>x.listing.anonymousViewUpdate=true).ok,false));
 check('anonymous listing broken detected',()=>assert.equal(mutate(x=>x.listing.viewSecurityInvoker=true).ok,false));
 check('approval filter drift rejected',()=>assert.equal(mutate(x=>x.listing.approvedVisibilityFilters.pop()).ok,false));
 check('anonymous privileged helper execution rejected',()=>assert.equal(mutate(x=>x.helpers.is_admin.anonymousExecute=true).ok,false));
 check('unsafe helper SQL reference rejected',()=>assert.equal(mutate(x=>x.helpers.owns_vendor.qualifiedReferences=false).ok,false));
 check('public CREATE privilege rejected',()=>assert.equal(mutate(x=>x.roles.authenticatedCreatePublic=true).ok,false));
 check('RLS no-policy anonymous SELECT grant rejected',()=>assert.equal(mutate(x=>x.denyAllTables.anonSelectGranted=1).ok,false));
 check('cross-project evidence rejected',()=>assert.equal(mutate(x=>x.projectRef='yqpgcsduqbxulrlzwzap').ok,false));
 check('changed managed migration history rejected',()=>assert.equal(mutate(x=>x.voxMigrationsApplied=1).ok,false));
 check('unknown Auth protection rejected',()=>assert.equal(mutate(x=>delete x.auth.leakedPasswordProtectionEnabled).ok,false));
 check('missing auth protection leaves HOLD',()=>assert.equal(validate(baseline).authConfigPending,true));
 check('lockdown migration explicitly preserves vendor listing and helper grants',()=>{
  assert.match(migration,/grant select on table public\.vendor_public_v to anon, authenticated, service_role/i);
  assert.match(migration,/revoke (?:all|insert|update|delete)/i);
  assert.match(migration,/public\.is_admin\(\)/);
  assert.match(migration,/public\.owns_vendor\(uuid\)/);
 });
 check('release hold never discharged by audit',()=>assert.equal(validate(baseline).allowProductionCutover,false));
}
const flag=process.argv.indexOf('--evidence');
let evidence=baseline;
if(flag>=0){
 if(!process.argv[flag+1])throw Error('EVIDENCE_PATH_REQUIRED');
 evidence=JSON.parse(readFileSync(resolve(process.argv[flag+1]),'utf8'));
}
const result=validate(evidence);
if(!result.ok){console.error('VOX23_SECURITY_POSTURE_DENY '+JSON.stringify(result));process.exit(42);}
console.log('VOX23_SECURITY_POSTURE_SOURCE_PASS '+JSON.stringify(result));
