// Fail-closed VOX read-only security-catalog regression boundary.
// This DOES NOT query a real database, grant privileges or remediate a view.
// Each release still requires independent live catalog + actual role/IDOR tests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const baseline=JSON.parse(readFileSync(new URL('../../ops/vox/phase-a-security-catalog-20261015.json',import.meta.url),'utf8'));
const columns=['id','business_name','city','office_city','areas_covered',
 'covers_full_city','service_categories','selected_subcategories',
 'selected_category','business_type','experience','years_experience',
 'starting_price','public_description','public_service_area_summary',
 'public_business_hours','profile_image_url','cover_image_url',
 'portfolio_urls','rating','completed_projects'];
const filters=["status = 'Approved'","is_active = true","public_visibility = true","remaining_credits > 0"];
export function validateCatalog(x){
 if(!x||x.schema!=='qf.vox.phase-a.security-catalog.v1'||
   x.projectRef!=='uckafzuochmbvtiodmcl')throw Error('WRONG_PROJECT');
 const v=x.vendorPublicView;
 if(!v||v.name!=='public.vendor_public_v'||v.securityInvoker!==false||
   v.anonSelect!==true||v.authenticatedSelect!==true||
   v.anonBaseVendorsSelect!==false||
   JSON.stringify(v.expectedColumns)!==JSON.stringify(columns)||
   JSON.stringify(v.requiredPredicates)!==JSON.stringify(filters))
  throw Error('PUBLIC_VIEW_EXPOSURE_CHANGED_UNREVIEWED');
 if(!Array.isArray(x.helpers)||x.helpers.length!==2)throw Error('RLS_HELPER_COUNT_CHANGED');
 const admin=x.helpers.find(y=>y.name==='public.is_admin()');
 const own=x.helpers.find(y=>y.name==='public.owns_vendor(uuid)');
 if(!admin||!own||[admin,own].some(h=>h.securityDefiner!==true||
   h.anonExecute!==false||h.authenticatedExecute!==true||
   h.searchPath!=='public')||admin.coreAdminClaim!=="profiles.role='admin'"||
   own.usesAuthUid!==true)throw Error('PRIVILEGED_HELPERS_CHANGED_UNREVIEWED');
 if(x.riskDecision!=='OWNER_REVIEW_REQUIRED'||x.managedStagingChanged!==false)
  throw Error('UNAUTHORIZED_RELEASE_APPROVAL');
 return Object.freeze({schema:'qf.vox.phase-a.catalog.review.v1',snapshotVerified:true,
  realTimeDbRecheckCompleted:false,privilegedViewAndHelpersRemediated:false,
  riskSignoffReceived:false,status:'RELEASE_HOLD'});
}
function test(){
 const result=validateCatalog(baseline);
 assert.equal(result.status,'RELEASE_HOLD');
 let rejects=0;
 for(const mutate of [
  x=>x.vendorPublicView.expectedColumns.push('raw_aadhaar_number'),
  x=>x.vendorPublicView.anonBaseVendorsSelect=true,
  x=>x.vendorPublicView.requiredPredicates.pop(),
  x=>x.vendorPublicView.securityInvoker=true,
  x=>x.vendorPublicView.anonSelect=false,
  x=>x.helpers[0].anonExecute=true,
  x=>x.helpers[1].searchPath='untrusted',
  x=>x.helpers[0].coreAdminClaim='all-staff',
  x=>x.riskDecision='APPROVED',
  x=>x.managedStagingChanged=true
 ]){
  const x=JSON.parse(JSON.stringify(baseline));mutate(x);
  assert.throws(()=>validateCatalog(x));rejects++;
 }
 console.log('VOX_A_SECURITY_CATALOG_SNAPSHOT_GUARD_PASS positive=1 negatives='+rejects+
  ' managedDbNotQueried=true ownerSignoff=false releaseHold=true');
}
if(process.argv.includes('--self-test'))test();
else{console.error('VOX_SECURITY_CATALOG_RELEASE_HOLD: --self-test only; real DB verification is separate');process.exitCode=42;}
