// VOX Phase A — strict, offline staging migration-ledger reconciliation.
// Names or retimestamped filenames are NOT proof of equivalent SQL.
// Never apply, rename, rewrite or mark a managed Supabase migration as complete here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const REPO=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const PROJECT='uckafzuochmbvtiodmcl';
const LEDGER=join(REPO,'ops/vox/phase-a-live-staging-migrations-baseline-20261015.json');
const checksum=x=>createHash('sha256').update(x).digest('hex');
const version=/^[0-9]{14}$/;
export function reconcile(snapshot,files) {
  assert.equal(snapshot.schema,'qf.vox.stage.migration-history-baseline.v1');
  assert.equal(snapshot.sourceProjectRef,PROJECT);
  assert.equal(snapshot.exactCount,86);
  assert.equal(snapshot.records.length,86);
  const seen=new Set(),byVersion=new Map(),byName=new Map();
  for(const [i,m] of snapshot.records.entries()){
    assert.match(m.version,version,'BAD_STAGING_VERSION_'+i);
    assert.match(m.name,/^[a-z0-9_]+$/i,'BAD_STAGING_NAME_'+i);
    assert.ok(!seen.has(m.version),'DUPLICATE_STAGING_VERSION');
    seen.add(m.version);
  }
  for(const f of files) {
    assert.match(f.version,version);
    assert.match(f.name,/^[a-z0-9_]+$/i);
    assert.match(f.sha256,/^[a-f0-9]{64}$/);
    assert.ok(!byVersion.has(f.version),'DUPLICATE_LOCAL_VERSION');
    byVersion.set(f.version,f);
    byName.set(f.name,[...(byName.get(f.name)??[]),f]);
  }
  const results=snapshot.records.map(m=>{
    const sameVersion=byVersion.get(m.version);
    const aliases=byName.get(m.name)??[];
    if(sameVersion) return {version:m.version,name:m.name,status:sameVersion.name===m.name?'EXACT_VERSION_AND_NAME':'VERSION_MATCH_NAME_DRIFT',
      candidates:[{version:sameVersion.version,name:sameVersion.name,sha256:sameVersion.sha256}]};
    return {version:m.version,name:m.name,status:aliases.length?'SAME_NAME_DIFFERENT_VERSION_UNPROVEN':'STAGING_ONLY_SOURCE_MISSING',
      candidates:aliases.map(x=>({version:x.version,name:x.name,sha256:x.sha256}))};
  });
  const counts=Object.fromEntries(['EXACT_VERSION_AND_NAME','VERSION_MATCH_NAME_DRIFT','SAME_NAME_DIFFERENT_VERSION_UNPROVEN',
    'STAGING_ONLY_SOURCE_MISSING'].map(k=>[k,results.filter(r=>r.status===k).length]));
  const disputed=results.filter(r=>r.status!=='EXACT_VERSION_AND_NAME');
  return {
    schema:'qf.vox.staging.migration-reconciliation.offline.v1',stagingProjectRef:PROJECT,
    source:'pinned-authenticated-readonly-ledger-snapshot; local repository SQL hashes',
    baselineRows:86,localSqlFiles:files.length,counts,appliedHistoryAltered:false,
    localFilesAltered:false,sourceSqlProvenForAliases:false,
    safeToReplayFullHistory:disputed.length===0&&results.every(r=>r.status==='EXACT_VERSION_AND_NAME'),
    safeToApplyVox:false,releaseStatus:'RELEASE_HOLD',entries:results
  };
}
function localSql(root) {
  return readdirSync(join(root,'supabase/migrations'),{withFileTypes:true})
    .filter(f=>f.isFile()&&f.name.endsWith('.sql'))
    .map(f=>{
      const m=f.name.match(/^([0-9]{14})_([a-zA-Z0-9_]+)\.sql$/);
      assert.ok(m,'UNRECOGNIZED_MIGRATION_FILENAME_'+f.name);
      return {version:m[1],name:m[2],sha256:checksum(readFileSync(join(root,'supabase/migrations',f.name)))};
    });
}
export function run(coreRoot=REPO,output=null) {
  const snapshot=JSON.parse(readFileSync(LEDGER,'utf8'));
  const report=reconcile(snapshot,localSql(resolve(coreRoot)));
  if(output)writeFileSync(resolve(output),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return report;
}
function selfTest(){
  const snapshot={schema:'qf.vox.stage.migration-history-baseline.v1',sourceProjectRef:PROJECT,exactCount:86,
    records:Array.from({length:86},(_,i)=>({version:'202607'+String(i+1).padStart(8,'0'),name:'test_'+i}))};
  const files=snapshot.records.slice(0,84).map(m=>({...m,sha256:'a'.repeat(64)}));
  files.push({version:'20261011111111',name:snapshot.records[84].name,sha256:'b'.repeat(64)});
  const test=reconcile(snapshot,files);
  assert.equal(test.counts.EXACT_VERSION_AND_NAME,84);
  assert.equal(test.counts.SAME_NAME_DIFFERENT_VERSION_UNPROVEN,1);
  assert.equal(test.counts.STAGING_ONLY_SOURCE_MISSING,1);
  assert.equal(test.safeToReplayFullHistory,false);
  assert.equal(test.safeToApplyVox,false);
  assert.throws(()=>reconcile({...snapshot,sourceProjectRef:'production'},files));
  assert.throws(()=>reconcile({...snapshot,records:[...snapshot.records.slice(0,85),snapshot.records[0]]},files));
  assert.throws(()=>reconcile(snapshot,[...files,files[0]]));
  assert.throws(()=>reconcile(snapshot,files.map(f=>({...f,sha256:'bad'}))));
  const whole=run();
  assert.equal(whole.counts.EXACT_VERSION_AND_NAME,55);
  assert.equal(whole.counts.SAME_NAME_DIFFERENT_VERSION_UNPROVEN,25);
  assert.equal(whole.counts.STAGING_ONLY_SOURCE_MISSING,6);
  assert.equal(whole.counts.VERSION_MATCH_NAME_DRIFT,0);
  assert.equal(whole.safeToReplayFullHistory,false);
  console.log('VOX_MIGRATION_RECONCILE_FAIL_CLOSED_PASS local='+whole.localSqlFiles+' exact=55 aliases=25 missing=6 authorization=false');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--self-test')selfTest();
  else {
    const index=args.indexOf('--core-root'),output=args.indexOf('--output');
    assert.ok(args.length===0||(index!==-1&&index+1<args.length),'USE_CORE_ROOT_EXPLICITLY');
    const result=run(index===-1?REPO:args[index+1],output===-1?null:args[output+1]);
    console.log(JSON.stringify({counts:result.counts,localFiles:result.localSqlFiles,
      safeToReplay:result.safeToReplayFullHistory,status:result.releaseStatus}));
    if(result.safeToReplayFullHistory)throw Error('UNEXPECTED_HISTORY_ALREADY_RECONCILED_REVIEW_REQUIRED');
  }
}
