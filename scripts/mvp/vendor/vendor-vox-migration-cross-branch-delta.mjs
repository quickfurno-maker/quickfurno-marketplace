#!/usr/bin/env node
/**
 * Compare exact Git migration trees across the separate Vendor and VOX drafts.
 * READ-ONLY local git ls-tree. Never merges, cherry-picks, executes SQL,
 * alters historical manifests, connects to Supabase, or grants release GO.
 */
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {MIGRATIONS} from "./vendor-seven-migration-fingerprint.mjs";
export const VENDOR_REF="f33b6dc4c62306cb5848756184a0e80b2291d535";
export const VOX_REF="49cf169eb84be743e6db30b23ee9d9cd57089976";
const SHA40=/^[a-f0-9]{40}$/;
const sql=/^supabase\/migrations\/\d{14}_[A-Za-z0-9_.-]+\.sql$/;
const sha=s=>createHash("sha256").update(s).digest("hex");
const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
export function collectMigrationTree(ref){
 if(!SHA40.test(ref))throw Error("REF_INVALID");
 const output=execFileSync("git",["ls-tree","-r",ref,"--","supabase/migrations"],{
  cwd:repoRoot,encoding:"utf8",timeout:20000,maxBuffer:5*1024*1024,windowsHide:true,
 });
 const rows=[];
 for(const line of output.split(/\r?\n/).filter(Boolean)){
  const match=line.match(/^100644 blob ([a-f0-9]{40})\t(.+)$/);
  if(!match||!sql.test(match[2]))throw Error("MIGRATION_TREE_ENTRY_INVALID");
  rows.push({path:match[2],blob:match[1]});
 }
 return rows;
}
export function compareMigrationTrees(vendor,vox){
 const blockers=[];
 const names=list=>list.map(x=>x.path);
 for(const [label,rows] of [["VENDOR",vendor],["VOX",vox]]){
  if(!Array.isArray(rows)||rows.some(x=>!x||!sql.test(x.path)||!SHA40.test(x.blob)))
    return {status:"SOURCE_DELTA_BLOCKED",blockedReasons:[label+"_INVALID_TREE"],releaseDecision:"HOLD"};
  if(new Set(names(rows)).size!==rows.length)blockers.push(label+"_DUPLICATE_SOURCE");
 }
 const v=new Map(vendor.map(x=>[x.path,x.blob]));
 const x=new Map(vox.map(x=>[x.path,x.blob]));
 const vendorOnly=[...v.keys()].filter(p=>!x.has(p)).sort();
 const voxOnly=[...x.keys()].filter(p=>!v.has(p)).sort();
 const sharedChanged=[...v].filter(([p,b])=>x.has(p)&&x.get(p)!==b).map(([p])=>p).sort();
 const expected=MIGRATIONS.map(([file])=>"supabase/migrations/"+file).sort();
 if(JSON.stringify(vendorOnly)!==JSON.stringify(expected))blockers.push("VENDOR_ONLY_SET_NOT_EXACT_SEVEN");
 if(voxOnly.length)blockers.push("VOX_ONLY_MIGRATIONS");
 if(sharedChanged.length)blockers.push("HISTORIC_SHARED_SQL_REWRITTEN");
 if(vendor.length!==169||vox.length!==162)blockers.push("SOURCE_COUNT_DRIFT_169_VS_162");
 const digest=rows=>sha(rows.slice().sort((a,b)=>a.path.localeCompare(b.path)).map(x=>x.path+" "+x.blob).join("\n")+"\n");
 return {
  schema:"qf.vendor.vox-migration-cross-branch-delta.v1",
  vendorRef:VENDOR_REF,voxRef:VOX_REF,
  vendorSqlCount:vendor.length,voxSqlCount:vox.length,
  vendorTreeSha256:digest(vendor),voxTreeSha256:digest(vox),
  vendorOnly,voxOnly,sharedChanged,
  status:blockers.length?"SOURCE_DELTA_BLOCKED":"EXACT_SEVEN_ADDITIVE_SOURCE_FILES",
  sourceDeltaErrors:blockers,
  releaseDecision:"HOLD",canMerge:false,canApplyStaging:false,canApplyProduction:false,
  managedLedgerReconciled:false,managedDatabaseConnected:false,
  historicRc22Rc40CertificationPassed:false,
  blockedReasons:[...blockers,"HISTORIC_RC22_RC40_MANIFEST_AND_QUARANTINE_MISMATCH",
    "MANAGED_STAGING_LEDGER_AND_DB_CATALOG_UNOBSERVED",
    "INDEPENDENT_RECOVERY_AND_OWNER_STAGING_GO_MISSING"]
 };
}
const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
 const args=process.argv.slice(2);
 if(args.length)throw Error("No arbitrary refs permitted; pinned source pair only.");
 try{
  const report=compareMigrationTrees(collectMigrationTree(VENDOR_REF),collectMigrationTree(VOX_REF));
  process.stdout.write(JSON.stringify(report,null,2)+"\n");
  if(report.status!=="EXACT_SEVEN_ADDITIVE_SOURCE_FILES")process.exitCode=1;
 }catch(e){
  process.stdout.write(JSON.stringify({schema:"qf.vendor.vox-migration-cross-branch-delta.v1",
    status:"SOURCE_DELTA_BLOCKED",releaseDecision:"HOLD",
    blockedReasons:["LOCAL_GIT_SOURCE_OBJECT_UNAVAILABLE_OR_INVALID"],
    canMerge:false,canApplyStaging:false,managedDatabaseConnected:false},null,2)+"\n");
  process.exitCode=1;
 }
}
