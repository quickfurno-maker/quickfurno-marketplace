import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
const read=p=>readFileSync(resolve(root,p));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:12000}).trim();
let count=0;
for(const [label,sha] of [['source vendor retry PR #243','d6743dd8cfa4cd79a1f1a3fb7e48c1cf92a72054'],['Core full candidate PR #242','0554faf35d19714aab2932bc93584c6af7565771']]){
 assert.equal(git('merge-base','--is-ancestor',sha,'HEAD'),'');count++;
 console.log('PASS ancestry '+label);
}
for(const file of [
 'scripts/mvp/vox/validate-vox16-full-seven-pg17.ps1',
 '.github/workflows/vox-16e-rls-negative.yml',
 'docs/vox/VOX-16E-PG17-ROLE-NEGATIVE.md'
]){
 let expected=execFileSync('git',['show','2cd27c60ef06e5e95e857e1e5125d9dfd7defe17:'+file],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n');
 if(file==='scripts/mvp/vox/validate-vox16-full-seven-pg17.ps1'){
  // Sole reviewed historical change: fixture loader resolves seven quarantined SQL sources.
  const oldPath="(Join-Path $root 'supabase\\migrations')";
  const quarantinedPath="(Join-Path $root 'ops\\vox\\quarantined-migrations\\legacy-20261014')";
  assert.equal(expected.split(oldPath).length,2,'original exact baseline must contain one legacy source path');
  expected=expected.replace(oldPath,quarantinedPath);
 }
 const actual=read(file).toString('utf8').replace(/\r\n/g,'\n');
 assert.equal(actual,expected,'all sibling security semantics except the one reviewed source relocation must be unchanged: '+file);count++;
 console.log('PASS exact security sibling with quarantined source path '+file);
}
assert.match(read('apps/vox-web/app/vendor360/components/TaskCreator.tsx').toString('utf8'),/nonce:requestNonce/);count++;
const deployed=readdirSync(resolve(root,'supabase/migrations')).filter(x=>/^20261014\d{6}_vox.*\.sql$/.test(x));
assert.deepEqual(deployed,[],'seven historically unapproved VOX SQL files cannot be put back into managed migration discovery');count++;
const manifest=JSON.parse(read('ops/vox/certification/VOX-PR300-MANAGED-SQL-RELEASE-HOLD.json'));
assert.equal(manifest.schema,'qf.vox.release.migration.quarantine.v2');
assert.equal(manifest.legacyManagedMigrations.length,7);
for(const row of manifest.legacyManagedMigrations){
 assert.match(row.path,/^ops\/vox\/quarantined-migrations\/legacy-20261014\/20261014\d{6}_vox.*\.sql$/);
 assert.equal(existsSync(resolve(root,row.path)),true,'original seven quarantined source bytes must exist');
 const bytes=read(row.path);
 const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
 assert.equal(blob,row.gitBlobSha,'quarantine tamper detection for '+row.path);
}
count++;console.log('PASS seven frozen SQL blob hashes and no managed discovery');
const docs=read('docs/vox/VOX-16F-CONSOLIDATED-REVIEW.md').toString('utf8');
assert.match(docs,/RELEASE HOLD/);count++;
assert.match(docs,/UNMERGED/);count++;
console.log('VOX16F_CORE_SIBLING_INTEGRATION_GATE_PASS '+count+'/'+count+' source_only=true live_release_hold=true');
