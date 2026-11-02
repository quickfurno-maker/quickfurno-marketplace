import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
const ROOT=resolve(import.meta.dirname,"../../..");
const read=f=>readFileSync(resolve(ROOT,f),"utf8");
const git=(...args)=>execFileSync("git",args,{cwd:ROOT,encoding:"utf8",timeout:10000}).trim();
const chain=[
 ["230","e00516b59127390166c5868dd36e30459b96ff7a"],
 ["231","a11fd22eb93326be20e3344a0791b24c7d4fa39b"],
 ["232","af2abfd86c0da0391a8f7b9eb88706001cfc8787"],
 ["233","d6e246f2d429cb253a49696a6870fad69d4cc523"],
 ["234","0cd558d65bd99436e3765aa2cfd9efe3f4384cdc"]
];
let n=0;
for(const [number,sha] of chain){
 assert.equal(git("cat-file","-t",sha),"commit");
 assert.equal(git("merge-base","--is-ancestor",sha,"HEAD")||"", "");
 console.log("PASS exact ancestor #"+number+" "+sha.slice(0,8));n++;
}
for(let i=1;i<chain.length;i++){
 assert.equal(git("merge-base",chain[i-1][1],chain[i][1]),chain[i-1][1]);
 n++;console.log("PASS ordered ancestry "+chain[i-1][0]+" -> "+chain[i][0]);
}
const absent=[
 ["core","app/api/vox/v1/agent-subject-access/route.ts","VOX_AGENT_SUBJECT_AUTH_ENABLED"],
 ["task","app/api/vox/v1/support-task/route.ts","VOX_SUPPORT_INTERNAL_TASKS_ENABLED"],
 ["intent","app/api/vox/v1/action-intents/route.ts","VOX_OPERATIONAL_INTENTS_ENABLED"],
 ["approved task","app/api/vox/v1/execute-followup/route.ts","VOX_APPROVED_FOLLOWUP_EXECUTION_ENABLED"]
];
for(const [name,file,flag] of absent){
 const s=read(file);
 assert(s.includes('process.env.'+flag+'!=="staging"')||s.includes('process.env.'+flag+'!=="staging"'));
 n++;console.log("PASS gated "+name);
}
const release=read("docs/vox/VOX-16B-MAIN-CANDIDATE.md");
assert.match(release,/RELEASE HOLD/);n++;
assert.match(release,/0cd558d65bd99436e3765aa2cfd9efe3f4384cdc/);n++;
assert.match(release,/unmerged/);n++;
console.log("VOX16B_CONSOLIDATED_ANCESTRY_AND_RELEASE_HOLD_PASS "+n+"/"+n);
