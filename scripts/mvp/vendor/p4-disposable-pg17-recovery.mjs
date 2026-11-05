#!/usr/bin/env node
/**
 * Phase 4 disposable PostgreSQL 17 schema+recovery rehearsal.
 * Local existing image ONLY; Docker --network none --pull never.
 * No Supabase, SSH, provider, Cloudflare, secrets or managed DB.
 * Passing does NOT certify an actual Staging backup or recovery.
 */
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {createHash,randomBytes} from "node:crypto";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const NAME_PREFIX="qf-p4-offline-";
const IMAGE="postgres:17-alpine";
export const PG17_STEPS=Object.freeze([
 "scripts/mvp/vendor/fixtures/vendor-private-pg-bootstrap.sql",
 "supabase/migrations/20261104090000_vendor_registration_consent_receipt.sql",
 "supabase/migrations/20261104140000_vendor_private_otp_and_verification_foundation.sql",
 "scripts/mvp/vendor/vendor-private-pg-acceptance.sql",
 "supabase/migrations/20261104153000_vendor_atomic_pending_registration.sql",
 "scripts/mvp/vendor/vendor-atomic-pg-acceptance.sql",
 "scripts/mvp/vendor/fixtures/vendor-owner-assignment-pg-bootstrap.sql",
 "ops/vendor/vendor-before-migration-readonly-preflight-20261105.sql",
 "supabase/migrations/20261104160000_vendor_owner_review_assignment_gate.sql",
 "scripts/mvp/vendor/vendor-owner-assignment-pg-acceptance.sql",
 "supabase/migrations/20261104163000_vendor_private_document_intake.sql",
 "scripts/mvp/vendor/vendor-private-intake-pg-acceptance.sql",
 "supabase/migrations/20261104170000_vox_owner_vendor_review_queue.sql",
 "scripts/mvp/vendor/vendor-vox-owner-queue-pg-acceptance.sql",
 "supabase/migrations/20261104173000_vendor_private_scan_quarantine.sql",
 "scripts/mvp/vendor/vendor-private-scan-pg-acceptance.sql",
 "ops/vendor/vendor-launch-readonly-preflight-20261104.sql",
]);
export const MIGRATION_COUNT=PG17_STEPS.filter(x=>x.startsWith("supabase/migrations/")).length;
const CATALOG_SIGNATURE=String.raw`WITH objects AS (
SELECT 'T:'||c.relname||':'||c.relrowsecurity::text AS sig
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p')
UNION ALL
SELECT 'F:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||
md5(pg_get_functiondef(p.oid)) AS sig
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
UNION ALL
SELECT 'P:'||c.relname||':'||pol.polname||':'||coalesce(pg_get_expr(pol.polqual,c.oid),'') AS sig
FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public')
SELECT count(*)||':'||md5(string_agg(sig,E'\\n' ORDER BY sig)) FROM objects`;
function docker(args,options={}){
 const r=spawnSync("docker",args,{
  cwd:root,encoding:null,timeout:120000,maxBuffer:32*1024*1024,
  windowsHide:true,...options,
 });
 if(r.error||r.status!==0){
  const msg=Buffer.isBuffer(r.stderr)?r.stderr.toString("utf8"):String(r.stderr??"");
  throw Error("P4_DOCKER_STEP_FAILED:"+args[0]+":"+(r.status??"error")+":"+msg.slice(-250));
 }
 return r.stdout??Buffer.alloc(0);
}
const exec=(name,args,options)=>docker(["exec",...args,name],options); // unused for SQL, commands are ordered properly below
const psql=(name,database,query)=>docker(["exec",name,"psql","-X","-U","postgres","-d",database,"-Atqc",query]).toString("utf8").trim();
const filePsql=(name,path)=>docker(["exec","-i",name,"psql","-X","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"],{
 input:readFileSync(resolve(root,path)),timeout:120000,
});
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
export async function runOfflinePg17Recovery(){
 const name=NAME_PREFIX+randomBytes(5).toString("hex");
 let started=false;
 const startedAt=Date.now();
 try{
  docker(["run","--rm","--pull=never","-d","--name",name,"--network","none",
   "-e","POSTGRES_PASSWORD=qf_synthetic_pg17_only",IMAGE]);
  started=true;
  let ready=false;
  for(let i=0;i<80;i++){
   try{
    if(psql(name,"postgres","SELECT 1")==="1"){
     await new Promise(r=>setTimeout(r,1200));
     if(psql(name,"postgres","SELECT 1")==="1"){ready=true;break;}
    }
   }catch{}
   await new Promise(r=>setTimeout(r,500));
  }
  if(!ready)throw Error("P4_LOCAL_PG17_STARTUP_TIMEOUT");
  for(const path of PG17_STEPS)filePsql(name,path);
  const before=psql(name,"postgres",CATALOG_SIGNATURE);
  if(!/^\d+:[a-f0-9]{32}$/.test(before))throw Error("P4_INVALID_SOURCE_SCHEMA_SIGNATURE");
  const dump=docker(["exec",name,"pg_dump","-Fc","-U","postgres","-d","postgres"],{timeout:120000});
  if(dump.length<200)throw Error("P4_LOCAL_PG_BACKUP_EMPTY");
  docker(["exec",name,"createdb","-U","postgres","p4_disposable_restore"]);
  docker(["exec","-i",name,"pg_restore","--exit-on-error","-U","postgres","-d","p4_disposable_restore"],{
   input:dump,timeout:120000,
  });
  const restored=psql(name,"p4_disposable_restore",CATALOG_SIGNATURE);
  if(before!==restored)throw Error("P4_LOCAL_RESTORE_CATALOG_MISMATCH");
  return {
   schema:"qf.launch.p4.disposable-pg17-recovery.v1",
   sourceMigrationCount:MIGRATION_COUNT,sqlFixtureSteps:PG17_STEPS.length,
   offlineDockerImage:IMAGE,networkMode:"none",pullOccurred:false,
   syntheticDumpBytes:dump.byteLength,syntheticDumpSha256:sha(dump),
   beforeCatalogSignature:before,restoredCatalogSignature:restored,
   restoredSchemaEquivalent:true,
   actualManagedBackupVerified:false,actualStagingRestored:false,
   actualProductionRestored:false,actualProviderCalled:false,
   managedDatabaseModified:false,approvalGranted:false,
   canDeploy:false,releaseDecision:"HOLD",elapsedMs:Date.now()-startedAt,
  };
 }finally{
  if(started){
   try{docker(["stop",name],{timeout:20000});}catch{}
  }
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runOfflinePg17Recovery().then(x=>{process.stdout.write(JSON.stringify(x,null,2)+"\n");}).catch(e=>{
  process.stderr.write("LOCAL_PG17_RECOVERY_FAILED: "+String(e.message)+"\n");process.exitCode=1;
 });
}
