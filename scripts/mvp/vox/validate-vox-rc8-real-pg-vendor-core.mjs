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
 // Docker-exec psql can hit initdb's short-lived Unix socket. The actual
 // Core path uses host TCP, so require that same mapped endpoint to accept SQL.
 let port=0,ready=false,lastError="";
 for(let i=0;i<160;i++){
  try{
   const found=docker(["port",name,"5432/tcp"]).match(/^127\.0\.0\.1:(\d+)$/m);
   if(found)port=Number(found[1]);
   if(port){
    const client=new Pool({host:"127.0.0.1",port,user:"postgres",
     password:"synthetic_only",database:"postgres",max:1,connectionTimeoutMillis:1200});
    try{ready=(await client.query("SELECT 1 AS ready")).rows[0]?.ready===1}
    finally{await client.end()}
   }
  }catch(e){ready=false;lastError=String(e?.code||e?.message||e).slice(0,160)}
  if(ready)break;
  await sleep(160);
 }
 if(!port||!ready)throw Error("CORE_PG17_HOST_TCP_NOT_READY "+lastError);
 pool=new Pool({host:"127.0.0.1",port,user:"postgres",password:"synthetic_only",
  database:"postgres",max:4,connectionTimeoutMillis:5000});
 await pool.query("SELECT 1 AS ready");
 const fixture=[
 "CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;",
 "CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb NOT NULL)",
 "CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text,is_active boolean)",
 "CREATE TABLE public.vox_staff_teams_v1(id uuid PRIMARY KEY,city_id uuid,is_active boolean)",
 "CREATE TABLE public.vox_staff_memberships_v1(auth_user_id uuid PRIMARY KEY,team_id uuid,staff_role text,is_active boolean,revoked_at timestamptz,expires_at timestamptz)",
 "CREATE TABLE public.vox_staff_department_requests_v1(id uuid PRIMARY KEY,requested_by uuid,target_staff_id uuid,team_id uuid,city_id uuid,department text,decided_by uuid,decision_reference text,state text,revision integer,expires_at timestamptz)",
 "CREATE TABLE public.vox_staff_department_decisions_v1(request_id uuid,reviewer_id uuid,decision text,decision_reference text)",
 "CREATE TABLE public.vox_staff_department_capabilities_v1(id uuid PRIMARY KEY,request_id uuid,auth_user_id uuid,team_id uuid,city_id uuid,department text,granted_by uuid,revoked_at timestamptz,revision integer,expires_at timestamptz)",
 "CREATE TABLE public.vox_staff_department_activations_v1(request_id uuid,capability_id uuid,activated_by uuid)",
 "CREATE TABLE public.vox_staff_object_scopes_v1(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auth_user_id uuid,scope_kind text,object_id uuid,revoked_at timestamptz,expires_at timestamptz)",
 "CREATE TABLE public.cities(id uuid PRIMARY KEY,name text NOT NULL,slug text UNIQUE,is_active boolean NOT NULL DEFAULT true)",
 "CREATE TABLE public.marketplace_service_zones(id uuid PRIMARY KEY,canonical_city text NOT NULL,is_active boolean NOT NULL,matching_enabled boolean NOT NULL)",
 "CREATE TABLE public.vendors(id uuid PRIMARY KEY,service_zone_id uuid)",
 "CREATE TABLE public.client_accounts(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),status text NOT NULL)",
 "CREATE TABLE public.leads(id uuid PRIMARY KEY,service_zone_id uuid,location_verification_status text,city text)",
 "CREATE TABLE public.communication_conversations(id uuid PRIMARY KEY,tenant_id text,channel text,destination_hash text,subject_type text,subject_id uuid,state text,revision bigint,assigned_actor text,human_takeover boolean,jarvis_enabled boolean,updated_at timestamptz)",
 "CREATE TABLE public.communication_conversation_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid REFERENCES public.communication_conversations(id),event_type text,actor_type text,safe_summary text,event_data jsonb)",
 "CREATE TABLE public.communication_suppressions(id uuid PRIMARY KEY,scope text,reason text,policy_version text,is_active boolean,expires_at timestamptz,deactivated_at timestamptz,destination_hash text,channel text)",
 "CREATE TABLE public.communication_preferences(id uuid PRIMARY KEY,state text,policy_version text,consented_at timestamptz,withdrawn_at timestamptz,principal_type text,principal_id uuid,channel text,scope text)"
 ];
 for(const sql of fixture)await pool.query(sql);
 await pool.query("INSERT INTO public.profiles VALUES ($1,NULL,true)",[A]);
 await pool.query("INSERT INTO auth.users VALUES($1,'{\"qf_principal\":\"vox_staff\",\"vox_role\":\"operations_manager\"}')",[A]);
 await pool.query("INSERT INTO public.vox_staff_teams_v1 VALUES ($1,$2,true)",[TEAM,CITY]);
 await pool.query("INSERT INTO public.vox_staff_memberships_v1 VALUES ($1,$2,'operations_manager',true,NULL,clock_timestamp()+interval '30 days')",[A,TEAM]);
 // Synthetic but schema-faithful independent reviewed department authority.
 const TL=id(70),REQUESTER=id(71),REVIEW=id(72),CAP=id(73);
 await pool.query("INSERT INTO public.profiles VALUES($1,NULL,true),($2,NULL,true)",[TL,REQUESTER]);
 await pool.query("INSERT INTO auth.users VALUES($1,'{\"qf_principal\":\"vox_staff\",\"vox_role\":\"team_leader\"}')",[TL]);
 await pool.query("INSERT INTO public.vox_staff_memberships_v1 VALUES($1,$2,'team_leader',true,NULL,clock_timestamp()+interval '30 days')",[TL,TEAM]);
 await pool.query("INSERT INTO public.vox_staff_department_requests_v1 VALUES($1,$2,$3,$4,$5,'client_success',$6,'review-rc9-pass','APPROVED',1,clock_timestamp()+interval '30 days')",
  [REVIEW,REQUESTER,A,TEAM,CITY,TL]);
 await pool.query("INSERT INTO public.vox_staff_department_decisions_v1 VALUES($1,$2,'APPROVED','review-rc9-pass')",[REVIEW,TL]);
 await pool.query("INSERT INTO public.vox_staff_department_capabilities_v1 VALUES($1,$2,$3,$4,$5,'client_success',$6,NULL,2,clock_timestamp()+interval '30 days')",
  [CAP,REVIEW,A,TEAM,CITY,REQUESTER]);
 await pool.query("INSERT INTO public.vox_staff_department_activations_v1 VALUES($1,$2,$3)",[REVIEW,CAP,REQUESTER]);
 await pool.query("INSERT INTO public.cities VALUES ($1,'Pune','pune',true)",[CITY]);
 await pool.query("INSERT INTO public.marketplace_service_zones VALUES ($1,'  PUNE ',true,true)",[ZONE]);
 await pool.query("INSERT INTO public.vendors VALUES ($1,$2)",[VENDOR,ZONE]);
 for(const id of [C1,C2,C3]){
  await pool.query("INSERT INTO public.vox_staff_object_scopes_v1(auth_user_id,scope_kind,object_id,revoked_at,expires_at) VALUES($1,'conversation',$2,NULL,clock_timestamp()+interval '30 days')",[A,id]);
  await pool.query("INSERT INTO public.communication_conversations VALUES ($1,'quickfurno','whatsapp',$2,'vendor',$3,'OPEN',0,'ANISHA',false,true,clock_timestamp())",
   [id,HASH,VENDOR]);
 }
 const sql=readFileSync(resolve(root,"ops/vox/rc7-review-candidates/20261030020000_vox_rc8_conversation_operator_review_only.sql"),"utf8");
 await pool.query(sql);
 const clientSql=readFileSync(resolve(root,
  "ops/vox/rc7-review-candidates/20261030050000_vox_rc12_client_project_binding_review_only.sql"),"utf8");
 await pool.query(clientSql);
 // Install EXACT existing pinned F1 / nonce / AB7B source candidates. Do not
 // silently skip their original CORE_CONVERSATION blocking constraint.
 for(const file of [
  "20261017010000_vox_f1_four_source_attribution_candidate.sql",
  "20261017020000_vox_phaseb_nonce_ledger_candidate.sql",
  "20261018020000_vox_ab7b_nonwork_native_source_candidate.sql"]){
  await pool.query(readFileSync(resolve(root,"ops/vox/sql-candidates",file),"utf8"));
 }
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
 // Deterministically expire AAL2 after the write is staged but before COMMIT.
 // The entire transaction, including conversation/event/nonce, must roll back.
 const expiring=make(C3,id(66));
 r=await execute(expiring,async()=>{
  const raw=await pool.connect();
  return {
   query:async(sql,values)=>{
    const result=await raw.query(sql,values);
    if(sql.includes("INSERT INTO public.vox_rc8_conversation_operator_receipts_candidate_v1"))
     expiring.verifiedStaff.expiresAtMs=Date.now()-1;
    return result;
   },
   release:()=>raw.release()
  };
 });
 eq(r.reason,"STAFF_AAL2_EXPIRED_DURING_TRANSACTION","IN_FLIGHT_AAL2_EXPIRY_DENIED");
 eq(await count("public.communication_conversation_events"),1,"EXPIRED_AAL2_NO_EVENT");
 eq(await count("public.vox_rc8_conversation_operator_receipts_candidate_v1"),1,"EXPIRED_AAL2_NO_RECEIPT");
 const expiredState=await pool.query("SELECT state,revision FROM public.communication_conversations WHERE id=$1",[C3]);
 eq(expiredState.rows[0].state,"OPEN","EXPIRED_AAL2_NO_TAKEOVER");
 eq(Number(expiredState.rows[0].revision),0,"EXPIRED_AAL2_NO_REVISION");
 // A grant can expire after the original FOR SHARE check but before COMMIT.
 // Expire the scope inside the disposable transaction *after* staging receipt
 // and require the recheck to roll back the entire operator mutation.
 r=await execute(make(C3,id(67)),async()=>{
  const raw=await pool.connect();
  return {
   query:async(sql,values)=>{
    const result=await raw.query(sql,values);
    if(sql.includes("INSERT INTO public.vox_rc8_conversation_operator_receipts_candidate_v1"))
     await raw.query("UPDATE public.vox_staff_object_scopes_v1 "+
      "SET expires_at=clock_timestamp()-interval '1 second' "+
      "WHERE auth_user_id=$1 AND object_id=$2",[A,C3]);
    return result;
   },
   release:()=>raw.release()
  };
 });
 eq(r.reason,"CORE_GRANT_EXPIRED_DURING_TRANSACTION","IN_FLIGHT_SCOPE_EXPIRY_DENIED");
 eq(await count("public.communication_conversation_events"),1,"EXPIRED_SCOPE_NO_EVENT");
 eq(await count("public.vox_rc8_conversation_operator_receipts_candidate_v1"),1,
  "EXPIRED_SCOPE_NO_RECEIPT");
 const postExpiry=await pool.query("SELECT state,revision FROM public.communication_conversations WHERE id=$1",[C3]);
 eq(postExpiry.rows[0].state,"OPEN","EXPIRED_SCOPE_NO_TAKEOVER");
 eq(Number(postExpiry.rows[0].revision),0,"EXPIRED_SCOPE_NO_REVISION");
 // A concurrent zone disable must serialize with the vendor Core writer.
 // Lock the same zone, start the operator, then revoke before releasing it.
 // An old snapshot must not commit a takeover after eligibility disappears.
 const zoneBlocker=await pool.connect();
 try{
  await zoneBlocker.query("BEGIN");
  await zoneBlocker.query("SELECT id FROM public.marketplace_service_zones WHERE id=$1 FOR UPDATE",[ZONE]);
  const concurrentWriter=run(make(C3,id(60)));
  await sleep(100);
  await zoneBlocker.query("UPDATE public.marketplace_service_zones SET matching_enabled=false WHERE id=$1",[ZONE]);
  await zoneBlocker.query("COMMIT");
  r=await concurrentWriter;
  eq(r.ok,false,"CONCURRENT_ZONE_REVOCATION_DENIED");
  const unchanged=await pool.query("SELECT state,revision FROM public.communication_conversations WHERE id=$1",[C3]);
  eq(unchanged.rows[0].state,"OPEN","REVOCATION_NOT_APPLIED_AS_TAKEOVER");
  eq(Number(unchanged.rows[0].revision),0,"REVOCATION_NO_REVISION");
  eq(await count("public.communication_conversation_events"),1,"REVOCATION_NO_EVENT");
 }finally{
  try{await zoneBlocker.query("ROLLBACK")}catch{}
  zoneBlocker.release();
  await pool.query("UPDATE public.marketplace_service_zones SET matching_enabled=true WHERE id=$1",[ZONE]);
 }
 // Real marketplace zone authority: inactive matching never grants a city.
 await pool.query("UPDATE public.marketplace_service_zones SET matching_enabled=false WHERE id=$1",[ZONE]);
 r=await run(make(C3,id(53)));eq(r.ok,false,"ZONE_DISABLED_DENIED");
 await pool.query("UPDATE public.marketplace_service_zones SET matching_enabled=true WHERE id=$1",[ZONE]);
 // cities.name is NOT UNIQUE. Duplicate canonical city names must fail closed.
 await pool.query("INSERT INTO public.cities VALUES ($1,'pune','pune-duplicate',true)",[id(90)]);
 r=await run(make(C3,id(54)));eq(r.ok,false,"AMBIGUOUS_CANONICAL_CITY_DENIED");
 await pool.query("DELETE FROM public.cities WHERE id=$1",[id(90)]);
 // A directly present capability cannot substitute for an independent review.
 await pool.query("UPDATE public.vox_staff_department_decisions_v1 SET decision='REJECTED' WHERE request_id=$1",[REVIEW]);
 r=await run(make(C3,id(56)));eq(r.reason,"DEPARTMENT_INDEPENDENT_REVIEW_REQUIRED","UNREVIEWED_CAPABILITY_DENIED");
 await pool.query("UPDATE public.vox_staff_department_decisions_v1 SET decision='APPROVED' WHERE request_id=$1",[REVIEW]);
 await pool.query("UPDATE auth.users SET raw_app_meta_data='{}' WHERE id=$1",[TL]);
 r=await run(make(C3,id(58)));eq(r.reason,"DEPARTMENT_INDEPENDENT_REVIEW_REQUIRED","REVOKED_REVIEWER_ROLE_DENIED");
 await pool.query("UPDATE auth.users SET raw_app_meta_data='{\"qf_principal\":\"vox_staff\",\"vox_role\":\"team_leader\"}' WHERE id=$1",[TL]);
 await pool.query("UPDATE public.vox_staff_object_scopes_v1 SET revoked_at=clock_timestamp() WHERE object_id=$1",[C3]);
 r=await run(make(C3,id(57)));eq(r.reason,"CONVERSATION_OBJECT_GRANT_REVOKED","REVOKED_EXACT_SCOPE_DENIED");
 await pool.query("UPDATE public.vox_staff_object_scopes_v1 SET revoked_at=NULL WHERE object_id=$1",[C3]);
 await pool.query("UPDATE auth.users SET raw_app_meta_data='{}' WHERE id=$1",[A]);
 r=await run(make(C3,id(55)));eq(r.ok,false,"CURRENT_AUTH_METADATA_REVOKED");
 await pool.query("UPDATE auth.users SET raw_app_meta_data='{\"qf_principal\":\"vox_staff\",\"vox_role\":\"team_leader\"}' WHERE id=$1",[A]);
 r=await run(make(C3,id(59)));eq(r.reason,"CURRENT_STAFF_GRANT_OR_AAL2_DENIED","MISMATCHED_OPERATIONS_ROLE_DENIED");
 await pool.query("UPDATE auth.users SET raw_app_meta_data='{\"qf_principal\":\"vox_staff\",\"vox_role\":\"operations_manager\"}' WHERE id=$1",[A]);
 await pool.query("UPDATE public.vox_staff_memberships_v1 SET revoked_at=clock_timestamp() WHERE auth_user_id=$1",[A]);
 r=await run(make(C3,id(52)));eq(r.ok,false,"CURRENT_STAFF_REVOKED");
 eq(await count("public.vox_rc8_conversation_operator_receipts_candidate_v1"),1,"NO_UNAUTHORIZED_RECEIPT");
 // Client accounts DO NOT own leads by native FK. An independently reviewed,
 // explicit client+lead+zone+current TL binding is mandatory for the client lane.
 const CLIENT=id(20),OWNER=id(21),LEAD=id(22),C4=id(23),C5=id(24);
 await pool.query("INSERT INTO auth.users VALUES($1,'{}')",[OWNER]);
 await pool.query("INSERT INTO public.client_accounts VALUES($1,$2,'active')",[CLIENT,OWNER]);
 await pool.query("INSERT INTO public.leads VALUES($1,$2,'verified','Pune')",[LEAD,ZONE]);
 for(const cId of [C4,C5]){
  await pool.query("INSERT INTO public.communication_conversations VALUES($1,'quickfurno','whatsapp',$2,'client',$3,'OPEN',0,'RIYA',false,true,clock_timestamp())",[cId,HASH,CLIENT]);
  await pool.query("INSERT INTO public.vox_staff_object_scopes_v1(auth_user_id,scope_kind,object_id,revoked_at,expires_at) VALUES($1,'conversation',$2,NULL,clock_timestamp()+interval '30 days')",[A,cId]);
 }
 await pool.query("INSERT INTO public.vox_rc12_client_conversation_project_bindings_candidate_v1(conversation_id,client_account_id,lead_id,service_zone_id,approved_city_id,owner_user_id,reviewed_by,team_id,review_evidence_sha256,review_state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'APPROVED',clock_timestamp()+interval '7 days')",
  [C4,CLIENT,LEAD,ZONE,CITY,OWNER,TL,TEAM,"f".repeat(64)]);
 // Re-enable actual operator account after earlier revocation tests.
 await pool.query("UPDATE public.vox_staff_memberships_v1 SET revoked_at=NULL WHERE auth_user_id=$1",[A]);
 let client=await run(make(C5,id(61)));
 eq(client.ok,false,"UNBOUND_CLIENT_CANNOT_USE_OTHER_LEAD_CITY");
 client=await run(make(C4,id(62)));
 eq(client.ok,true,"REVIEWED_CLIENT_REAL_PG_ATOMIC_COMMIT");
 eq(client.state,"HUMAN","CLIENT_HUMAN");
 eq(await count("public.communication_conversation_events"),2,"CLIENT_EVENT_ADDED_ATOMICALLY");
 eq(await count("public.vox_rc8_conversation_operator_receipts_candidate_v1"),2,"CLIENT_RECEIPT_ADDED_ATOMICALLY");
 await pool.query("INSERT INTO public.vox_rc12_client_conversation_project_bindings_candidate_v1(conversation_id,client_account_id,lead_id,service_zone_id,approved_city_id,owner_user_id,reviewed_by,team_id,review_evidence_sha256,review_state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'APPROVED',clock_timestamp()+interval '7 days')",
  [C5,CLIENT,LEAD,ZONE,CITY,OWNER,TL,TEAM,"f".repeat(64)]);
 await pool.query("UPDATE auth.users SET raw_app_meta_data='{}' WHERE id=$1",[TL]);
 client=await run(make(C5,id(63)));eq(client.ok,false,"CLIENT_BINDING_REVIEWER_REVOKED");
 await pool.query("UPDATE auth.users SET raw_app_meta_data='{\"qf_principal\":\"vox_staff\",\"vox_role\":\"team_leader\"}' WHERE id=$1",[TL]);
 await pool.query("UPDATE public.leads SET location_verification_status='unverified' WHERE id=$1",[LEAD]);
 client=await run(make(C5,id(64)));eq(client.ok,false,"CLIENT_PROJECT_GEO_UNVERIFIED");
 eq(await count("public.communication_conversation_events"),2,"CLIENT_FAILS_NO_EVENT");
 // AB7B original remains blocked even for the otherwise eligible,
 // independently-reviewed client case. No source/event/receipt may survive.
 await pool.query("UPDATE public.leads SET location_verification_status='verified' WHERE id=$1",[LEAD]);
 // The client binding is immutable by DB trigger, so expiry must be
 // simulated by advancing the real PG clock, never updating its approval.
 // Use a dedicated disposable client conversation with a 2-second approval.
 const C6=id(25);
 await pool.query("INSERT INTO public.communication_conversations VALUES($1,'quickfurno','whatsapp',$2,'client',$3,'OPEN',0,'RIYA',false,true,clock_timestamp())",[C6,HASH,CLIENT]);
 await pool.query("INSERT INTO public.vox_staff_object_scopes_v1(auth_user_id,scope_kind,object_id,revoked_at,expires_at) VALUES($1,'conversation',$2,NULL,clock_timestamp()+interval '30 days')",[A,C6]);
 await pool.query("INSERT INTO public.vox_rc12_client_conversation_project_bindings_candidate_v1(conversation_id,client_account_id,lead_id,service_zone_id,approved_city_id,owner_user_id,reviewed_by,team_id,review_evidence_sha256,review_state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'APPROVED',clock_timestamp()+interval '2 seconds')",[C6,CLIENT,LEAD,ZONE,CITY,OWNER,TL,TEAM,"f".repeat(64)]);
 client=await execute(make(C6,id(69)),async()=>{
  const raw=await pool.connect();
  return {
   query:async(sql,values)=>{
    const result=await raw.query(sql,values);
    if(sql.includes("INSERT INTO public.vox_rc8_conversation_operator_receipts_candidate_v1"))
     await sleep(2500);
    return result;
   },release:()=>raw.release()
  };
 });
 eq(client.reason,"CLIENT_PROJECT_BINDING_EXPIRED_DURING_TRANSACTION","IN_FLIGHT_CLIENT_BINDING_EXPIRY");
 eq(await count("public.communication_conversation_events"),2,"EXPIRED_CLIENT_BINDING_NO_EVENT");
 eq(await count("public.vox_rc8_conversation_operator_receipts_candidate_v1"),2,"EXPIRED_CLIENT_BINDING_NO_RECEIPT");
 const afterClientExpiry=await pool.query("SELECT state,revision FROM public.communication_conversations WHERE id=$1",[C6]);
 eq(afterClientExpiry.rows[0].state,"OPEN","EXPIRED_CLIENT_BINDING_NO_TAKEOVER");
 eq(Number(afterClientExpiry.rows[0].revision),0,"EXPIRED_CLIENT_BINDING_NO_REVISION");
 client=await execute(make(C5,id(65)),()=>pool.connect(),
  {mode:"DISPOSABLE_RC12_AB7B_PROOF"});
 eq(client.ok,false,"AB7B_ORIGINAL_BLOCK_DENIES_NATIVE_SOURCE");
 eq(await count("public.vox_ab7b_native_source_actions_candidate_v1"),0,"NO_SOURCE_CREATED_WHILE_BLOCKED");
 eq(await count("public.vox_staff_source_events_candidate_v1"),0,"NO_F1_WHILE_BLOCKED");
 eq(await count("public.communication_conversation_events"),2,"AB7B_DENIAL_ATOMIC_ROLLBACK");
 // Apply the forward correction only to the synthetic disposable database.
 const originalSourceReview=readFileSync(resolve(root,
  "ops/vox/rc7-review-candidates/20261030060000_vox_rc12_core_original_source_review_only.sql"),"utf8");
 await pool.query(originalSourceReview);
 const dbPrivileges=await pool.query(
  "SELECT has_table_privilege('service_role','public.vox_ab7b_native_source_actions_candidate_v1','INSERT') AS src,"+
  "has_table_privilege('service_role','public.vox_staff_source_events_candidate_v1','INSERT') AS f1,"+
  "has_table_privilege('service_role','public.vox_staff_source_nonce_candidate_v1','INSERT') AS nonce");
 eq(dbPrivileges.rows[0].src,false,"SERVICE_ROLE_CANNOT_FORGE_AB7B");
 eq(dbPrivileges.rows[0].f1,false,"SERVICE_ROLE_CANNOT_FORGE_F1");
 eq(dbPrivileges.rows[0].nonce,false,"SERVICE_ROLE_CANNOT_FORGE_NONCE");
 client=await execute(make(C5,id(65)),()=>pool.connect(),
  {mode:"DISPOSABLE_RC12_AB7B_PROOF"});
 eq(client.ok,true,"RC12_REAL_NATIVE_CONVERSATION_AND_F1_COMMIT");
 eq(client.canonicalAb7bSourceReady,true,"F1_PERSISTED_SAME_TX");
 eq(await count("public.vox_ab7b_native_source_actions_candidate_v1"),1,"ONE_ORIGINAL_AB7B");
 eq(await count("public.vox_staff_source_events_candidate_v1"),1,"ONE_CANONICAL_F1");
 eq(await count("public.vox_staff_source_nonce_candidate_v1"),1,"ONE_CANONICAL_NONCE");
 eq(await count("public.communication_conversation_events"),3,"THREE_GENUINE_CONVERSATION_EVENTS");
 const ledger=await pool.query("SELECT a.subject_id,a.revision,a.actor_id,e.event_kind,"+
  "n.nonce FROM public.vox_ab7b_native_source_actions_candidate_v1 a "+
  "JOIN public.vox_staff_source_events_candidate_v1 e ON e.source_event_id=a.id "+
  "JOIN public.vox_staff_source_nonce_candidate_v1 n ON n.source_event_id=a.id");
 eq(ledger.rows[0].subject_id,C5,"CANONICAL_CLIENT_REF");
 eq(ledger.rows[0].actor_id,A,"CANONICAL_REAL_ACTOR");
 eq(ledger.rows[0].event_kind,"HUMAN_TAKEOVER","CANONICAL_ACTION");
 eq(ledger.rows[0].nonce,id(65),"SOURCE_NONCE_ATOMIC");
 // Even an administrator with direct SQL privileges cannot claim a source
 // without a matching immutable conversation receipt and current Auth scope.
 let forged=false;
 try{await pool.query("INSERT INTO public.vox_ab7b_native_source_actions_candidate_v1 "+
  "(id,source,subject_kind,subject_id,actor_id,team_id,city_id,revision,event_kind,nonce) "+
  "VALUES($1,'CORE_CONVERSATION','conversation',$2,$3,$4,$5,1,'HUMAN_TAKEOVER',$6)",
  [id(66),C4,A,TEAM,CITY,id(67)])}catch{forged=true}
 eq(forged,true,"FORGED_ORIGINAL_SOURCE_DENIED");
 eq(await count("public.vox_staff_source_events_candidate_v1"),1,"NO_FORGED_F1");
 console.log("VOX_RC12_REAL_PG17_AB7B_F1_SOURCE_ATOMIC_PASS "+
  "original_ab7b_block_proven=true forward_review_only=true "+
  "conversation_event_receipt_original_f1_nonce_same_tx=true "+
  "forged_source_denied=true managed_activation=false");
 console.log("VOX_RC12_REAL_PG17_CLIENT_REVIEWED_PROJECT_SCOPE_PASS "+
  "explicit_client_account_lead_zone=true scoped_riya=true unbound_and_revoked_denied=true "+
  "source_ab7b_blocked=true managed_activation=false");
 console.log("VOX_RC8_CORE_REAL_PG17_VENDOR_CONSENT_WRITER_PASS "+
  "canonical_d2c=true source_state_event_nonce_atomic=true rollback_replay=true "+
  "staff_and_consent_revocation=true source_ab7b_blocked=true provider_messages=0 "+
  "managed_activation=false");
}catch(e){console.error("VOX_RC8_CORE_REAL_PG17_FAIL "+String(e?.stack||e));process.exitCode=1;}
finally{
 if(pool)try{await pool.end()}catch{}
 if(created)try{docker(["rm","-f","-v",name])}catch{}
}
