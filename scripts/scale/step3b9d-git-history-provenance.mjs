// 3B-9D: source discovery in Git history. Does NOT assert SQL was executed or semantically equivalent.
import {spawnSync} from "node:child_process";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const version=process.env.STEP3B9DEF_GIT_SCAN_MODE ?? "ordinary";
const ledger=JSON.parse(readFileSync(resolve(ROOT,"ops/vox/certification/STEP3B6-DIVERGENCE-20261023.json")));
function git(args){const x=spawnSync("git",["-C",ROOT,...args],{encoding:"utf8",maxBuffer:10*1024*1024,timeout:30000});if(x.status!==0)throw new Error("git command failed: "+args[0]+": "+x.stderr.slice(0,300));return x.stdout;}
const txt=git(["log","--all","--format=COMMIT:%H","--name-only","--diff-filter=AM","--","supabase/migrations"]);
let commit="";const found=new Map();let pathsScanned=0;
for(const s of txt.split(String.fromCharCode(10))){
 if(s.startsWith("COMMIT:")){commit=s.slice(7).trim();continue;}
 const m=new RegExp("^supabase/migrations/([0-9]{14})_.*[.]sql$").exec(s.trim());
 if(!m||!commit)continue;
 pathsScanned++;
 if(!found.has(m[1]))found.set(m[1],{commit,path:s.trim()});
}
const verified=new Map();let unresolved=0,historyLocated=0,withRunnable=0;
const rows=ledger.records.map(item=>{
 const locator=found.get(item.version);
 let discovered=null;
 if(locator){
  const proof=git(["rev-parse",locator.commit+":"+locator.path]).trim();
  if(!/^[0-9a-f]{40}$/.test(proof))throw new Error("invalid historical blob");
  discovered={type:"GIT_OBJECT_LOCATOR_ONLY",commit:locator.commit,path:locator.path,gitBlobSha1:proof};
  historyLocated++;
 }else unresolved++;
 if(item.versionInRunnableSource)withRunnable++;
 return {...item,historicalGitLocator:discovered,checkedAcrossCurrentGitRefs:true,
  semanticEquivalence:"UNREVIEWED",dbaDecision:"PENDING_INDEPENDENT_DBA",
  reversibleOrSafeToExecute:false};
});
const priorMissing=rows.filter(x=>!x.versionInRunnableSource),recovered=priorMissing.filter(x=>!!x.historicalGitLocator);
const out={schema:"qf.vox.step3b9d.git-history-provenance.v1",scope:"LOCAL_GIT_REFS_ONLY_NOT_DATABASE_TRUTH",
  sourceBaseline:"0b17ec8d432d641fcf6a5d04f5abc867fa770044",
  gitPathsScanned:pathsScanned,distinctVersionPaths:found.size,
  counts:{totalDivergent:rows.length,priorNotRunnable:priorMissing.length,priorRunnable:withRunnable,
    historicalPathLocated:historyLocated,notLocatedInGitHistory:unresolved,
    amongPreviouslyNotRunnableLocated:recovered.length,
    amongPreviouslyNotRunnableStillMissing:priorMissing.length-recovered.length},
  caution:"Git history locator is not applied SQL, semantic equivalence, complete repo/history or source authorization. Obtain trusted original SQL and DBA signoff; never apply these historical blobs directly.",
  independentDbaSigned:false,managedSchemaChangeAuthorized:false,releaseStatus:"HOLD",rows};
const dest=resolve(ROOT,"ops/vox/certification/STEP3B9D-GIT-HISTORY-PROVENANCE-20261023.json");
writeFileSync(dest,JSON.stringify(out,null,2)+"\n");
console.log("STEP3B9D_GIT_PROVENANCE "+JSON.stringify(out.counts));
