import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
const source=JSON.parse(readFileSync(resolve(root,'ops/vox/staging-history-20261014.json'),'utf8'));
if(source.schema!=='qf.vox.staging.history.snapshot.v1'||
 source.projectRef!=='uckafzuochmbvtiodmcl'||source.sourceMigrationCount!==86||
 !Array.isArray(source.history)||source.history.length!==86)
 throw Error('VOX17_REFERENCE_STAGING_HISTORY_INVALID');
function normalize(x){
 const candidate=Array.isArray(x)?x:Array.isArray(x?.migrations)?x.migrations:x?.history;
 if(!Array.isArray(candidate))throw Error('CANDIDATE_HISTORY_MISSING');
 return candidate.map((m,i)=>{
  if(!m||typeof m.version!=='string'||typeof m.name!=='string'||
    !/^\d{14}$/.test(m.version)||!/^[a-z0-9_]+$/i.test(m.name))
   throw Error('CANDIDATE_MIGRATION_INVALID_AT_'+i);
  return {version:m.version,name:m.name};
 });
}
const parent=normalize(source.history);
if(new Set(parent.map(m=>m.version)).size!==86||
 parent.some((m,i)=>i>0&&m.version<=parent[i-1].version))
 throw Error('SOURCE_HISTORY_NOT_ORDERED_UNIQUE');
function prove(candidate,expectedProject='uckafzuochmbvtiodmcl'){
 if(expectedProject!==source.projectRef)return {ok:false,error:'WRONG_PARENT_PROJECT'};
 let records;
 try{records=normalize(candidate)}catch(e){return {ok:false,error:String(e)};}
 const a=parent,b=records;
 if(new Set(b.map(x=>x.version)).size!==b.length)return {ok:false,error:'DUPLICATE_VERSIONS'};
 for(let i=0;i<Math.max(a.length,b.length);i++){
  const x=a[i],y=b[i];
  if(!x)return {ok:false,error:'UNAPPROVED_EXTRA_MIGRATION',at:i,actual:y?.version};
  if(!y)return {ok:false,error:'CANDIDATE_HISTORY_INCOMPLETE',at:i,missing:a.length-b.length,
    firstMissing:x.version};
  if(x.version!==y.version||x.name!==y.name)
   return {ok:false,error:'CANDIDATE_HISTORY_DIVERGED',at:i,
    expectedVersion:x.version,actualVersion:y.version};
 }
 return {ok:true,matched:a.length,sourceProjectRef:source.projectRef,
  requiresLiveAuthenticatedSchemaAndRestore:true,permittedToApplyVox:false};
}
const versionFiles=readdirSync(resolve(root,'supabase/migrations'))
 .filter(x=>/^20261014\d{6}_vox.*\.sql$/.test(x));
assert.equal(versionFiles.length,7,'seven pinned VOX files required');
assert.equal(parent.filter(x=>x.version.startsWith('20261014')).length,0,'source cannot already contain VOX versions');
if(process.argv.includes('--self-test')){
 assert.equal(prove(source).ok,true);
 const truncated=prove({migrations:parent.slice(0,12)});
 assert.deepEqual([truncated.ok,truncated.error,truncated.missing,truncated.firstMissing],
  [false,'CANDIDATE_HISTORY_INCOMPLETE',74,'20260723001200']);
 assert.equal(prove({migrations:[...parent,parent.at(-1)]}).error,'DUPLICATE_VERSIONS');
 assert.equal(prove({migrations:parent.slice(0,86).reverse()}).error,'CANDIDATE_HISTORY_DIVERGED');
 assert.equal(prove({migrations:parent.map((x,i)=>i===6?{...x,name:'unknown'}:x)}).error,'CANDIDATE_HISTORY_DIVERGED');
 assert.equal(prove(source,'yqpgcsduqbxulrlzwzap').error,'WRONG_PARENT_PROJECT');
 console.log('VOX17_BRANCH_HISTORY_NEGATIVE_QA_PASS tests=6 source=86 failed_branch=12 denied=true');
}
const flag=process.argv.indexOf('--candidate');
const candidate=flag>=0?JSON.parse(readFileSync(resolve(process.argv[flag+1]||''),'utf8')):source;
const result=prove(candidate,process.env.QF_VOX_STAGE_REF||source.projectRef);
if(!result.ok){
 console.error('VOX17_STAGING_CLONE_HISTORY_FAIL_CLOSED '+JSON.stringify(result));
 process.exit(42);
}
console.log('VOX17_STAGING_HISTORY_SOURCE_PARITY_PASS '+JSON.stringify(result));
