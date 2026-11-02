#!/usr/bin/env node
// Disposable PostgreSQL proof of historical Finance V1 migration blockers.
// REVIEW ONLY. No source rewrite, managed schema, provider, refund or credits.
import {readFileSync} from "node:fs";
import {execFileSync,spawnSync} from "node:child_process";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const file="supabase/migrations/20260912010000_qf_vendor_package_razorpay_testmode.sql";
const source=readFileSync(resolve(root,file),"utf8");
if(!/as \$\r?\n/.test(source) || !source.includes(
 "if v_order.provider_order_request_token is distinct from p_request_token then"))
 throw Error("LEGACY_V1_SOURCE_CHANGED_REVIEW_REQUIRED");
for(const key of ["DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","RAZORPAY_LIVE_KEY_SECRET"])
 if(process.env[key])throw Error("MANAGED_OR_PROVIDER_CREDENTIAL_DENIED_"+key);
if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))
 throw Error("REMOTE_DOCKER_DENIED");
const name="qf-vox-rc21-v1-parser-pg17";
const docker=(...args)=>execFileSync("docker",args,{encoding:"utf8",timeout:20000,
 stdio:["ignore","pipe","pipe"]}).trim();
let created=false;
try{
 docker("image","inspect","postgres:17-alpine");
 if(docker("ps","-aq","--filter","name=^/"+name+"$"))
  throw Error("EXISTING_CONTAINER_REFUSED");
 docker("run","--rm","--pull","never","--network","none","-d","--name",name,
  "-e","POSTGRES_PASSWORD=synthetic_only","postgres:17-alpine");
 created=true;
 let ready=false;
 for(let i=0;i<65;i++){
  if(spawnSync("docker",["exec",name,"pg_isready","-q","-h","127.0.0.1","-U","postgres","-d","postgres"],
   {encoding:"utf8",timeout:3000}).status===0){ready=true;break}
  await new Promise(r=>setTimeout(r,150));
 }
 if(!ready)throw Error("DISPOSABLE_PG17_UNAVAILABLE");
 const execute=sql=>spawnSync("docker",
  ["exec","-i","-e","PGPASSWORD=synthetic_only",name,"psql","-h","127.0.0.1","-X","-q","-A","-t","-U","postgres","-d","postgres",
   "-v","ON_ERROR_STOP=1"],{input:sql,encoding:"utf8",timeout:10000});
 // Initdb uses a temporary Unix-socket-only postmaster which can answer pg_isready just
 // before shutting down. TCP loopback tests only the final server, never the
 // temporary initdb Unix socket.
 let healthy=execute("SELECT 1 AS postgres_ready;");
 for(let i=0;i<55&&(healthy.status!==0||healthy.stdout.trim()!=="1");i++){
  await new Promise(r=>setTimeout(r,150));
  healthy=execute("SELECT 1 AS postgres_ready;");
 }
 if(healthy.status!==0||healthy.stdout.trim()!=="1")
  throw Error("PG17_BASELINE_QUERY_FAILED "+
   String(healthy.stderr||healthy.stdout).replace(/\s+/g," ").slice(0,200));
 const first=source.match(/create or replace function public\.qf_claim_vendor_package_razorpay_order_v1\([\s\S]*?^\$;/m);
 if(!first)throw Error("V1_FUNCTION_SOURCE_NOT_FOUND");
 const parse=execute(first[0]);
 const err=String(parse.stderr||"");
 if(parse.status===0 || !/syntax error|unterminated dollar-quoted/i.test(err))
  throw Error("LEGACY_V1_PARSER_EXPECTED_DENIAL_NOT_OBSERVED "+
   err.replace(/\s+/g," ").slice(0,240));
 const tokenSql="SELECT (NULL::uuid IS DISTINCT FROM "+
  "'00000000-0000-4000-8000-000000000001'::uuid)::text;";
 const token=execute(tokenSql);
 if(token.status!==0||token.stdout.trim()!=="true")
  throw Error("V1_NULL_TOKEN_SQL_SEMANTIC_NOT_CONFIRMED "+
   String(token.stdout||token.stderr).slice(0,130));
 console.log("VOX_RC21_LEGACY_V1_PG17_PARSER_BLOCKERS_CONFIRMED "+
  "original_function_syntax_denied=true null_first_claim_token_denied=true "+
  "historical_source_untouched=true managed_database_touched=false "+
  "review_only=true production_go=false");
}finally{
 if(created)spawnSync("docker",["rm","-f",name],{encoding:"utf8",timeout:10000});
}
