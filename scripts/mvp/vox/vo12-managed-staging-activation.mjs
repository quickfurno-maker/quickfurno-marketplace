#!/usr/bin/env node
// One-command offline readiness projection from a PRIVATE read-only Staging
// metadata snapshot. Do not read or publish bearer tokens, SQL, user records,
// login profiles, or personal data. Always emits a HOLD decision.
import {readFileSync,lstatSync} from "node:fs";
import {resolve,relative,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {assessCurrentStagingGate} from "../../../contracts/vox/vo12StagingActivationGate.mjs";
const ROOT=resolve(fileURLToPath(new URL("../../..",import.meta.url)));
const isInside=(dir,path)=>{const rel=relative(dir,path);
 return rel===""||(!rel.startsWith(".."+sep)&&rel!==".."&&!rel.startsWith(sep));};
export function run(args,io={log:console.log,err:console.error},env=process.env){
 if(args.length!==2||args[0]!=="--snapshot"||!args[1]){
  io.err("VO12_USAGE --snapshot <PRIVATE read-only counts JSON>");return 1;
 }
 for(const name of ["DATABASE_URL","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_DB_URL","SUPABASE_ACCESS_TOKEN","PGPASSWORD"]){
  if(typeof env[name]==="string"&&env[name].length>0){
   io.err("VO12_MANAGED_CREDENTIAL_PRESENT_REFUSED");return 1;
  }
 }
 try{
  const path=resolve(args[1]);
  if(isInside(ROOT,path)||!lstatSync(path).isFile()||lstatSync(path).size>8192)
   throw Error("VO12_PRIVATE_SNAPSHOT_REQUIRED");
  const raw=readFileSync(path,"utf8");
  if(/eyJ[\w-]{20,}\.[\w-]{10,}\.|sk_(?:live|test)_\w{8,}|PRIVATE KEY-----|password\s*[:=]/i.test(raw))
   throw Error("VO12_SECRETS_IN_SNAPSHOT");
  const obj=JSON.parse(raw);
  const result=assessCurrentStagingGate(obj);
  if(!result.ok)throw Error(result.reason);
  io.log(JSON.stringify(result,null,2));
  io.log("VO12_MANAGED_STAGING=HOLD noWrites=true");
  return 2;
 }catch(err){io.err(String(err?.message||err));return 1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 process.exitCode=run(process.argv.slice(2));
