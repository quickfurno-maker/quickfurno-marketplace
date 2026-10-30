#!/usr/bin/env node
// RC8 genuine PG17 Core vendor pause/takeover with D2-C on SAME session.
// REVIEW ONLY. Synthetic identity+vendor. No AB7B source, no provider messages.
import {Pool} from "pg";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {build} from "esbuild";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const name="qf-vox-rc8-pg-core-vendor";
const docker=(args,stderr="ignore")=>execFileSync("docker",args,{
 encoding:"utf8",windowsHide:true,timeout:20000,stdio:["ignore","pipe",stderr]}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const eq=(a,b,label)=>{if(a!==b)throw Error(label+" expected="+b+" got="+a)};
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const A=id(1),TEAM=id(2),CITY=id(3),ZONE=id(4),VENDOR=id(5),
 C1=id(6),C2=id(7),C3=id(8),HASH="a".repeat(64);
let pool,created=false;
try{
 if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))
  throw Error("REMOTE_DOCKER_REFUSED");
 docker(["image","inspect","postgres:17-alpine"]);
 if(docker(["ps","-aq","--filter","name=^/"+name+"$"]))
  throw Error("CONTAINER_NAME_COLLISION");
 docker(["run","-d","--rm","--pull","never","--name",name,
  "-p","127.0.0.1::5432","-e","POSTGRES_PASSWORD=synthetic_only","postgres:17-alpine"]);
 created=true;
 let port;
 for(let i=0;i<110;i++){
  let ready=false;
  try{
   const ports=docker(["port",name,"5432/tcp"]);
   const found=ports.match(/^127\.0\.0\.1:(\d+)$/m);
   if(found)port=Number(found[1]);
   ready=docker(["exec",name,"psql","-X","-A","-t","-U","postgres","-d","postgres","-c","SELECT 1;"])==="1"&&
    docker(["logs",name]).includes("PostgreSQL init process complete; ready for start up.");
  }catch{}
  if(ready&&port)break;await sleep(160);
 }
 if(!port)throw Error("NO_LOOPBACK_PORT");
 pool=new Pool({host:"127.0.0.1",port,user:"postgres",password:"synthetic_only",
  database:"postgres",max:4,connectionTimeoutMillis:5000});
 for(let i=0;i<30;i++){try{await pool.query("SELECT 1");break}catch(e){
  if(i===29)throw e;await sleep(100);}}
 const fixture=[
 "CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;",
 "CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,is_active boolean)",
 "CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY,city_id uuid,is_active boolean)",
 "CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid PRIMARY KEY,team_id uuid,staff_role text,is_active boolean,revoked_at timestamptz,expires_at timestamptz)",
 "CREATE TABLE public.vox_staff_department_capabilities_v1(auth_user_id uuid,team_id uuid,city_id uuid,department text,revoked_at timestamptz,expires_at timestamptz)",
 "CREATE TABLE public.vox_staff_object_scopes_v1(auth_user_id uuid,scope_kind text,object_id uuid,revoked_at timestamptz,expires_at timestamptz)",
 "CREATE TABLE public.marketplace_service_zones(id uuid PRIMARY KEY,city_id uuid,is_active boolean)",
 "CREATE TABLE public.vendors(id uuid PRIMARY KEY,service_zone_id uuid)",
 "CREATE TABLE public.communication_conversations(id uuid PRIMARY KEY,tenant_id text,channel text,destination_hash text,subject_type text,subject_id uuid,state text,revision bigint,assigned_actor text,human_takeover boolean,jarvis_enabled boolean,updated_at timestamptz)",
 "CREATE TABLE public.communication_conversation_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid REFERENCES public.communication_conversations(id),event_type text,actor_type text,safe_summary text,event_data jsonb)",
 "CREATE TABLE public.communication_suppressions(id uuid PRIMARY KEY,scope text,reason text,policy_version text,is_active boolean,expires_at timestamptz,deactivated_at timestamptz,destination_hash text,channel text)",
 "CREATE TABLE public.communication_preferences(id uuid PRIMARY KEY,state text,policy_version text,consented_at timestamptz,withdrawn_at timestamptz,principal_type text,principal_id uuid,channel text,scope text)"
 ];
 for(const sql of fixture)await pool.query(sql);
 await pool.query("INSERT INTO public.profiles VALUES ($1,NULL,true)",[A]);
 await pool.query("INSERT INTO public.vox_staff_teams_v1 VALUES ($1,$2,true)",[TEAM,CITY]);
 await pool.query("INSERT INTO public.vox_staff_memberships_v1 VALUES ($1,$2,'operations_manager',true,NULL,clock_timestamp()+interval '30 days')",[A,TEAM]);
 await pool.query("INSERT INTO public.vox_staff_department_capabilities_v1 VALUES ($1,$2,$3,'client_success',NULL,clock_timestamp()+interval '30 days')",[A,TEAM,CITY]);
 await pool.query("INSERT INTO public.marketplace_service_zones VALUES ($1,$2,true)",[ZONE,CITY]);
 await pool.query("INSERT INTO public.vendors VALUES ($1,$2)",[VENDOR,ZONE]);
 for(const id of [C1,C2,C3]){
  await pool.query("INSERT INTO public.vox_staff_object_scopes_v1 VALUES($1,'conversation',$2,NULL,clock_timestamp()+interval '30 days')",[A,id]);
  await pool.query("INSERT INTO public.communication_conversations VALUES ($1,'quickfurno','whatsapp',$2,'vendor',$3,'OPEN',0,'ANISHA',false,true,clock_timestamp())",
   [id,HASH,VENDOR]);
 }
 const sql=readFileSync(resolve(root,"ops/vox/rc7-review-candidates/20261030020000_vox_rc8_conversation_operator_review_only.sql"),"utf8");
 await pool.query(sql);
 const outfile=resolve(root,"test-results/vox-rc8-core-real-pg-bundle.cjs");
 await build({entryPoints:[resolve(root,"services/vox/rc8PgVendorConversationOperator.ts")],
  bundle:true,platform:"node",format:"cjs",target:"node24",outfile,logLevel:"silent"});
 const {executeRc8PgVendorConversationOperator:execute,
  executeRc8PgVendorConversationOperatorProduction:prod,
  RC8_CORE_WRITER_INSTALLED}=await import(pathToFileURL(outfile).href);
 eq(RC8_CORE_WRITER_INSTALLED,false,"RELEASE_GATE_CLOSED");
 eq((await prod()).reason,"CORE_WRITER_RELEASE_GATE_CLOSED","PRODUCTION_DENIED");
 const make=(conversationId,nonce)=>({conversationId,nonce,expectedRevision:0,
  action:"TAKEOVER",verifiedStaff:{userId:A,aal:"aal2",expiresAtMs:Date.now()+600000}});
 const run=input=>execute(input,()=>pool.connect());
 let r=await run(make(C1,id(50)));
 eq(r.ok,true,"VENDOR_CORE_REAL_PG_COMMIT");eq(r.canonicalAb7bSourceReady,false,"NO_FALSE_AB7B");
 let rows=await pool.query("SELECT state,assigned_actor,human_takeover,jarvis_enabled,revision FROM public.communication_conversations WHERE id=$1",[C1]);
 eq(rows.rows[0].state,"HUMAN","STATE_HUMAN");eq(rows.rows[0].revision,"1","REVISION_1");
 const count=async table=>Number((await pool.query("SELECT count(*)::int AS n FROM "+table)).rows[0].n);
 eq(await count("public.communication_conversation_events"),1,"EVENT_1");
 eq(await count("public.vox_rc8_conversation_operator_receipts_candidate_v1"),1,"RECEIPT_1");
 r=await run(make(C2,id(50)));eq(r.ok,false,"REPLAY_NONCE_DENIED");
 rows=await pool.query("SELECT state,revision FROM public.communication_conversations WHERE id=$1",[C2]);
 eq(rows.rows[0].state,"OPEN","ROLLBACK_NO_STATE");
 eq(await count("public.communication_conversation_events"),1,"ROLLBACK_NO_EVENT");
 await pool.query("INSERT INTO public.communication_suppressions VALUES ($1,'transactional','user_stop','qf-consent-v1',true,NULL,NULL,$2,'whatsapp')",[id(91),HASH]);
 r=await run(make(C3,id(51)));eq(r.ok,false,"D2C_SUPPRESSION_DENIED");
 eq(await count("public.communication_conversation_events"),1,"CONSENT_NO_EVENT");
 await pool.query("DELETE FROM public.communication_suppressions");
 await pool.query("UPDATE public.vox_staff_memberships_v1 SET revoked_at=clock_timestamp() WHERE auth_user_id=$1",[A]);
 r=await run(make(C3,id(52)));eq(r.ok,false,"CURRENT_STAFF_REVOKED");
 eq(await count("public.vox_rc8_conversation_operator_receipts_candidate_v1"),1,"NO_UNAUTHORIZED_RECEIPT");
 console.log("VOX_RC8_CORE_REAL_PG17_VENDOR_CONSENT_WRITER_PASS "+
  "canonical_d2c=true source_state_event_nonce_atomic=true rollback_replay=true "+
  "staff_and_consent_revocation=true source_ab7b_blocked=true provider_messages=0 "+
  "managed_activation=false");
}catch(e){console.error("VOX_RC8_CORE_REAL_PG17_FAIL "+String(e?.stack||e));process.exitCode=1;}
finally{
 if(pool)try{await pool.end()}catch{}
 if(created)try{docker(["rm","-f","-v",name])}catch{}
}
