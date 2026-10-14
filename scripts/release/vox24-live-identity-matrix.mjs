// VOX Phase A identity-route smoke: read-only GET requests against approved STAGING.
// This is NOT a login, credential issuer, database migration or rollout action.
// Never log JWTs, HTTP bodies, contacts, response details, or account identifiers.
import assert from 'node:assert/strict';

export const STAGING_CORE='https://staging-core.quickfurno.in';
const ROLES=['owner','staff','leader','vendor'];
const cases=Object.freeze([
 {role:'owner',path:'/api/vox/v1/overview',allow:true,schema:'qf.vox.overview.v1'},
 {role:'staff',path:'/api/vox/v1/overview',allow:false},
 {role:'leader',path:'/api/vox/v1/overview',allow:false},
 {role:'vendor',path:'/api/vox/v1/overview',allow:false},
 {role:'staff',path:'/api/vox/v1/my-work',allow:true,schema:'qf.vox.overview.v1'},
 {role:'leader',path:'/api/vox/v1/my-work',allow:true,schema:'qf.vox.overview.v1'},
 {role:'vendor',path:'/api/vox/v1/my-work',allow:false},
 {role:'leader',path:'/api/vox/v1/staff-review-queue',allow:true,schema:'qf.vox.staff.review.queue.v1'},
 {role:'staff',path:'/api/vox/v1/staff-review-queue',allow:false},
 {role:'vendor',path:'/api/vox/v1/staff-review-queue',allow:false}
]);
const jwt=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export async function runReadOnlyIdentityMatrix({fetchImpl,credentials}){
 assert.equal(typeof fetchImpl,'function','FETCH_REQUIRED');
 assert.equal(credentials!==null&&typeof credentials==='object',true,'TOKENS_REQUIRED');
 for(const r of ROLES){
  assert.equal(typeof credentials[r],'string','MISSING_ROLE_'+r);
  assert.equal(credentials[r].length>=100&&credentials[r].length<=8192&&jwt.test(credentials[r]),true,
   'INVALID_TOKEN_'+r);
 }
 assert.equal(new Set(ROLES.map(r=>credentials[r])).size,4,true,'ROLE_CREDENTIAL_REUSE_FORBIDDEN');
 let pass=0;
 for(const check of cases){
  // NO cross-site, mutation or arbitrary path ever accepted by this harness.
  assert(check.path.startsWith('/api/vox/v1/'));
  const res=await fetchImpl(STAGING_CORE+check.path,{
    method:'GET',
    headers:{authorization:'Bearer '+credentials[check.role],accept:'application/json'},
    redirect:'error',cache:'no-store',signal:AbortSignal.timeout(3500)
  });
  if(check.allow){
   assert.equal(res.status,200,'POSITIVE_ROLE_GATE_'+check.role+'_'+check.path);
   assert(res.headers?.get('content-type')?.startsWith('application/json'),'CONTENT_TYPE');
   const data=await res.json();
   assert.equal(data?.ok,true,'POSITIVE_BODY');
   assert.equal(data?.schema||data?.view?.schema,check.schema,'SCHEMA_MISMATCH');
   if(check.path.endsWith('/staff-review-queue')){
    assert.equal(data.mode,'READ_ONLY');
    assert.equal(data.canSelfApprove,false);
   }else{
    assert.equal(data.view?.actionsEnabled,false,'BUSINESS_ACTIONS_UNEXPECTED');
   }
  }else{
   // A disabled service (503) is NOT a passing unauthorized-role proof.
   assert([401,403].includes(res.status),'UNAUTHORIZED_ACCESS_OR_NO_PROOF_'+check.role+'_'+check.path);
  }
  pass++;
 }
 return Object.freeze({schema:'qf.vox.phase-a.route-matrix.v1',readOnly:true,checked:pass,
  authority:'EXTERNAL_STAGING_OPERATOR_EVIDENCE_ONLY',
  backupVerified:false,stagingMigrationAuthorized:false,productionPromotionAuthorized:false});
}
function fake(){
 const credentials=Object.fromEntries(ROLES.map((r,i)=>[r,'a'.repeat(50)+'.'+String(i).repeat(100)+'.'+'b'.repeat(50)]));
 const roleOf=new Map(ROLES.map(r=>['Bearer '+credentials[r],r]));
 return {credentials,async fetchImpl(url,opts){
   assert.equal(opts.method,'GET');
   assert.equal(opts.redirect,'error');
   assert.equal(opts.cache,'no-store');
   assert(url.startsWith(STAGING_CORE+'/api/vox/v1/'));
   const role=roleOf.get(opts.headers.authorization);
   const matching=cases.find(x=>x.path===url.slice(STAGING_CORE.length)&&x.role===role);
   if(!matching)throw Error('UNLISTED_CALL');
   const body=matching.path.endsWith('/staff-review-queue')
    ?{ok:true,schema:matching.schema,mode:'READ_ONLY',canSelfApprove:false}
    :{ok:true,view:{schema:matching.schema,actionsEnabled:false}};
   return {status:matching.allow?200:403,
      headers:{get:()=> 'application/json'},json:async()=>body};
 }};
}
async function selfTest(){
 const f=fake();
 const positive=await runReadOnlyIdentityMatrix(f);
 assert.equal(positive.checked,10);
 assert.equal(positive.productionPromotionAuthorized,false);
 let negatives=0;
 const rejects=async(failure)=>{
  await assert.rejects(async()=>runReadOnlyIdentityMatrix(failure));
  negatives++;
 };
 await rejects({...f,credentials:{...f.credentials,staff:f.credentials.owner}});
 await rejects({...f,credentials:{...f.credentials,owner:'bad'}});
 await rejects({...f,fetchImpl:async(u,o)=>{
   const original=await f.fetchImpl(u,o);
   if(u.endsWith('/overview')&&o.headers.authorization==='Bearer '+f.credentials.staff)
    return {...original,status:200};
   return original;
 }});
 await rejects({...f,fetchImpl:async(u,o)=>{
   const original=await f.fetchImpl(u,o);
   if(u.endsWith('/overview')&&o.headers.authorization==='Bearer '+f.credentials.staff)
    return {...original,status:503};
   return original;
 }});
 await rejects({...f,fetchImpl:async(u,o)=>{
   const original=await f.fetchImpl(u,o);
   if(u.endsWith('/my-work')&&o.headers.authorization==='Bearer '+f.credentials.staff)
    return {...original,status:200,json:async()=>({ok:true,view:{schema:'qf.vox.overview.v1',actionsEnabled:true}})};
   return original;
 }});
 console.log('VOX_PHASE_A_READ_ONLY_IDENTITY_MATRIX_SYNTHETIC_PASS positives='+positive.checked+
   ' mutationGuards='+negatives+' realStagingCertified=false');
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replace(/\\/g,'/'))){
 if(process.argv.includes('--self-test'))await selfTest();
 else if(process.argv.includes('--live')){
  try{
   assert.equal(process.env.VOX_PHASE_A_REAL_STAGING_QA_APPROVED,'YES_I_HAVE_TEST_ACCOUNTS',
     'REAL_STAGING_QA_OPT_IN_REQUIRED');
   const credentials=Object.fromEntries(ROLES.map(r=>[r,process.env['VOX_PHASE_A_'+r.toUpperCase()+'_JWT']]));
   const result=await runReadOnlyIdentityMatrix({fetchImpl:fetch,credentials});
   console.log(JSON.stringify(result));
  }catch(e){
   console.error('VOX_PHASE_A_STAGING_NOT_CERTIFIED '+String(e));
   process.exitCode=42;
  }
 }else{
  console.error('VOX_PHASE_A_RELEASE_HOLD: use --self-test; real testing only via explicit --live and approved private environment');
  process.exitCode=42;
 }
}
