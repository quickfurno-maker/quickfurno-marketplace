import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
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
 const expected=execFileSync('git',['show','2cd27c60ef06e5e95e857e1e5125d9dfd7defe17:'+file],{cwd:root,encoding:'utf8'});
 const actual=readFileSync(resolve(root,file),'utf8');
 assert.equal(actual.replace(/\r\n/g,'\n'),expected.replace(/\r\n/g,'\n'));count++;
 console.log('PASS exact no-drop SQL security sibling '+file);
}
assert.match(readFileSync(resolve(root,'apps/vox-web/app/vendor360/components/TaskCreator.tsx'),'utf8'),/nonce:requestNonce/);count++;
assert.equal(readdirSync(resolve(root,'supabase/migrations')).filter(x=>/^20261014\d{6}_vox.*\.sql$/.test(x)).length,7);count++;
const docs=readFileSync(resolve(root,'docs/vox/VOX-16F-CONSOLIDATED-REVIEW.md'),'utf8');
assert.match(docs,/RELEASE HOLD/);count++;
assert.match(docs,/UNMERGED/);count++;
console.log('VOX16F_CORE_SIBLING_INTEGRATION_GATE_PASS '+count+'/'+count);
