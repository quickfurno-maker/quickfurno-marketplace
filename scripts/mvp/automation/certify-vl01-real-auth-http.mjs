// VL-01: disposable real GoTrue + PostgREST + PostgreSQL + Next.js HTTP route proof.
// No remote Supabase access, no live vendor, no WhatsApp/payment, and no persistent DB.
// This certificate proves real token/cookie authentication against the existing route.
import { randomBytes, createHmac } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const require=createRequire(path.join(ROOT,"package.json"));
const { Client }=require("pg");
if(typeof globalThis.WebSocket === "undefined") globalThis.WebSocket=require("ws");
const {createServerClient}=require("@supabase/ssr");
// Two official distribution hosts for the SAME immutable PostgREST v16.1 digest.
// A CI registry rate limit must not turn a genuine auth test into a fake pass.
const POSTGREST_DIGEST="sha256:5922bde07147b82b1c9d8f749e48c1e5b99ebb233f3888bb7ab65f07cf4ac82d";
const POSTGREST_TEST_IMAGES=[
 "ghcr.io/supabase/postgrest:v16.1@"+POSTGREST_DIGEST,
 "public.ecr.aws/supabase/postgrest:v16.1@"+POSTGREST_DIGEST,
];
const suffix=String(process.pid), net="vl01-http-net-"+suffix, pgname="vl01-http-pg-"+suffix, gt="vl01-http-auth-"+suffix, rest="vl01-http-rest-"+suffix;
const pass=randomBytes(22).toString("hex"), jwtSecret=randomBytes(32).toString("hex");
const docker=(...args)=>execFileSync("docker",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const choosePinnedPostgrestImage=()=>{
 for(const ref of POSTGREST_TEST_IMAGES){
  try{
   // Prefer an already verified local image; avoid unnecessary registry requests.
   try{docker("image","inspect",ref);}catch{docker("pull",ref);}
   const repoDigests=JSON.parse(docker("image","inspect","--format","{{json .RepoDigests}}",ref));
   if(!Array.isArray(repoDigests)||!repoDigests.some(x=>typeof x==="string"&&x.endsWith("@"+POSTGREST_DIGEST)))
    throw Error("POSTGREST_DIGEST_NOT_VERIFIED");
   console.log("POSTGREST_PINNED_DIGEST_VERIFIED");
   return ref;
  }catch{/* Try second official host with the exact same digest; never skip HTTP QA. */}
 }
 throw Error("POSTGREST_PINNED_IMAGE_UNAVAILABLE");
};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const jwt=claims=>{const b=v=>Buffer.from(JSON.stringify(v)).toString("base64url");const head=b({alg:"HS256",typ:"JWT"});const payload=b(claims);const sig=createHmac("sha256",jwtSecret).update(head+"."+payload).digest("base64url");return head+"."+payload+"."+sig;};
const uid="d71a2711-5cab-4c4e-9a4d-c8e6bac8f6dd",req="fd133c10-87dd-4b5e-9ed8-8d7a5a9fb113",job="6ea50c8c-32ce-4c1f-9569-cd679d843d5f",attempt="9b1bc810-4814-44a7-8955-50f0eb531d92",transport="b2d4a319-6450-4479-80e3-b898a28fd645";
let pg=null,proxy=null,next=null,networkCreated=false, dbs=[],port=null,childLogs="",passes=0;const suite=(name,cond)=>{if(!cond)throw Error("CHECK_FAILED:"+name);passes++;console.log("PASS",name);};
async function freePort(){const s=createServer();s.listen(0,"127.0.0.1");await once(s,"listening");const n=s.address().port;await new Promise(r=>s.close(r));return n;}
const pgListen=async()=>{for(let i=0;i<40;i++){try{pg=new Client({host:"127.0.0.1",port:pgPort,user:"vl01",password:pass,database:"vl01",connectionTimeoutMillis:800});await pg.connect();return;}catch{try{await pg?.end()}catch{}pg=null;await delay(350);}}throw Error("PG_NOT_READY");};
async function ready(url){for(let i=0;i<50;i++){try{const r=await fetch(url);if(r.status<500)return;}catch{}await delay(350);}throw Error("SERVICE_NOT_READY:"+url);}
let pgPort;
try {
 if(process.env.DATABASE_URL||process.env.SUPABASE_URL||process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error("NO_EXTERNAL_DB_ENVS_ALLOWED");
 docker("network","create",net);networkCreated=true;
 docker("run","-d","--name",pgname,"--network",net,"-e","POSTGRES_USER=vl01","-e","POSTGRES_PASSWORD="+pass,"-e","POSTGRES_DB=vl01","-p","127.0.0.1::5432","postgres:16-alpine");dbs.push(pgname);
 pgPort=Number(docker("port",pgname,"5432/tcp").match(/127\.0\.0\.1:(\d+)/)?.[1]);if(!pgPort)throw Error("PG_LOOPBACK_PORT");
 await pgListen();
 await pg.query(`
  CREATE SCHEMA auth;
  CREATE ROLE postgres SUPERUSER LOGIN;
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE ROLE authenticator LOGIN PASSWORD '${pass}' NOINHERIT;
  GRANT anon,authenticated,service_role TO authenticator;
  GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
  CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text);
  CREATE TABLE public.automation_action_requests(id uuid PRIMARY KEY,action_type text,entity_type text,correlation_id text,decision_status text,decision_at timestamptz,decision_reason_code text,created_at timestamptz);
  CREATE TABLE public.automation_jobs(id uuid PRIMARY KEY,action_request_id uuid,status text,attempt_count int,available_at timestamptz,locked_at timestamptz,completed_at timestamptz,created_at timestamptz,updated_at timestamptz,last_safe_code text);
  CREATE TABLE public.automation_execution_attempts(id uuid PRIMARY KEY,job_id uuid,attempt_number int,status text,classification text,safe_code text,started_at timestamptz,finished_at timestamptz);
  CREATE TABLE public.automation_transport_requests(id uuid PRIMARY KEY,job_id uuid,attempt_id uuid,direction text,route_key text,state text,created_at timestamptz,finalized_at timestamptz);
  GRANT SELECT ON public.profiles TO authenticated,service_role;
  GRANT SELECT ON public.automation_jobs,public.automation_action_requests,public.automation_execution_attempts,public.automation_transport_requests TO service_role;
  ALTER ROLE vl01 SET search_path TO auth,public;
  INSERT INTO public.automation_action_requests VALUES ('${req}','vendor.lead_offer','lead','qf.trace:synthetic-1','authorized','2026-10-12T10:00:00Z','QF_AUTH_VALID','2026-10-12T10:00:00Z');
  INSERT INTO public.automation_jobs VALUES ('${job}','${req}','succeeded',1,'2026-10-12T10:00:00Z',null,'2026-10-12T10:00:00Z','2026-10-12T10:00:00Z','2026-10-12T10:00:00Z','QF_ACCEPTED');
  INSERT INTO public.automation_execution_attempts VALUES ('${attempt}','${job}',1,'succeeded','provider_accepted','QF_PROVIDER_ACCEPTED','2026-10-12T10:00:01Z','2026-10-12T10:00:02Z');
  INSERT INTO public.automation_transport_requests VALUES ('${transport}','${job}','${attempt}','outbound','execute_v1','completed','2026-10-12T10:00:02Z','2026-10-12T10:00:03Z');
 `);
 const adminJwt=jwt({role:"service_role",aud:"authenticated",iss:"supabase",iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600});
 const anonJwt=jwt({role:"anon",aud:"authenticated",iss:"supabase",iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600});
 docker("run","-d","--name",gt,"--network",net,"-p","127.0.0.1::9999",
  "-e","GOTRUE_DB_DRIVER=postgres","-e","GOTRUE_DB_DATABASE_URL=postgres://vl01:"+pass+"@"+pgname+":5432/vl01?sslmode=disable",
  "-e","GOTRUE_DB_NAMESPACE=auth","-e","GOTRUE_API_HOST=0.0.0.0","-e","GOTRUE_API_PORT=9999",
  "-e","GOTRUE_SITE_URL=http://localhost","-e","API_EXTERNAL_URL=http://localhost:9999","-e","GOTRUE_API_EXTERNAL_URL=http://localhost:9999",
  "-e","GOTRUE_JWT_SECRET="+jwtSecret,"-e","GOTRUE_JWT_AUD=authenticated","-e","GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
  "-e","GOTRUE_EXTERNAL_EMAIL_ENABLED=true","-e","GOTRUE_MAILER_AUTOCONFIRM=true",
  "-e","GOTRUE_DISABLE_SIGNUP=false","supabase/gotrue:v2.196.0");dbs.push(gt);
 const authPort=Number(docker("port",gt,"9999/tcp").match(/127\.0\.0\.1:(\d+)/)?.[1]);
 await ready("http://127.0.0.1:"+authPort+"/health");
 docker("run","-d","--name",rest,"--network",net,"-p","127.0.0.1::3000",
 "-e","PGRST_DB_URI=postgres://authenticator:"+pass+"@"+pgname+":5432/vl01",
 "-e","PGRST_DB_SCHEMAS=public","-e","PGRST_DB_ANON_ROLE=anon","-e","PGRST_JWT_SECRET="+jwtSecret,
 "-e","PGRST_SERVER_PORT=3000",choosePinnedPostgrestImage());dbs.push(rest);
 const restPort=Number(docker("port",rest,"3000/tcp").match(/127\.0\.0\.1:(\d+)/)?.[1]);
 await ready("http://127.0.0.1:"+restPort+"/");
 const server=createServer((request,response)=>{
  const dest=(request.url.startsWith("/auth/v1/")?"http://127.0.0.1:"+authPort+request.url.slice("/auth/v1".length):
             request.url.startsWith("/rest/v1/")?"http://127.0.0.1:"+restPort+request.url.slice("/rest/v1".length):null);
  if(!dest){response.writeHead(404);response.end();return;}
  const headers={...request.headers};delete headers.host;const chunks=[];request.on("data",x=>chunks.push(x));
  request.on("end",async()=>{
   try{const upstream=await fetch(dest,{method:request.method,headers,body:["GET","HEAD"].includes(request.method)?undefined:Buffer.concat(chunks),redirect:"manual"});
    const out={};for(const [k,v]of upstream.headers){if(!["transfer-encoding","connection","content-encoding"].includes(k))out[k]=v;}
    response.writeHead(upstream.status,out);response.end(Buffer.from(await upstream.arrayBuffer()));
   }catch{response.writeHead(502);response.end();}
  });
 });
 proxy=server;server.listen(0,"127.0.0.1");await once(server,"listening");
 const gateway="http://127.0.0.1:"+server.address().port;
 console.log("GO_TRUE_POSTGREST_PG_READY");
 const email="vl01-"+suffix+"@example.invalid",password="A-"+randomBytes(18).toString("hex");
 const registered=await fetch(gateway+"/auth/v1/signup",{method:"POST",headers:{"content-type":"application/json","apikey":anonJwt},body:JSON.stringify({email,password})});
 const signup=await registered.json();suite("genuine GoTrue signup and token",registered.status===200&&Boolean(signup.user?.id&&signup.access_token&&signup.refresh_token));
 await pg.query("INSERT INTO public.profiles (id,role) VALUES ($1,'vendor')",[signup.user.id]);
 const verify=await fetch(gateway+"/auth/v1/user",{headers:{"authorization":"Bearer "+signup.access_token,"apikey":anonJwt}});
 const gu=await verify.json();suite("genuine GoTrue getUser",verify.status===200&&gu.id===signup.user.id);
 const jar=new Map();
 const ssr=createServerClient(gateway,anonJwt,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:items=>items.forEach(item=>jar.set(item.name,item.value))}});
 const ssession=await ssr.auth.setSession({access_token:signup.access_token,refresh_token:signup.refresh_token});
 suite("real supabase/ssr session construction",!ssession.error&&jar.size>0);
 const sid=await ssr.auth.getUser();suite("supabase/ssr authenticated getUser",!sid.error&&sid.data.user?.id===signup.user.id);
 const cookieHeader=()=>[...jar].map(([n,v])=>n+"="+encodeURIComponent(v)).join("; ");
 const nextPort=await freePort();
 const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:gateway,NEXT_PUBLIC_SUPABASE_ANON_KEY:anonJwt,SUPABASE_SERVICE_ROLE_KEY:adminJwt,NODE_ENV:"development",NEXT_TELEMETRY_DISABLED:"1",QF_DEPLOYMENT_ENV:"staging",PORT:String(nextPort)};
 delete env.DATABASE_URL;delete env.SUPABASE_URL;
 next=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--turbopack","--hostname","127.0.0.1","-p",String(nextPort)],{cwd:ROOT,env,stdio:["ignore","pipe","pipe"],windowsHide:true});
 for(const stream of [next.stdout,next.stderr])stream.on("data",data=>{childLogs=(childLogs+data.toString()).slice(-40000)});
 async function post(cookie="",body={action:"trace",jobId:job}){
  const r=await fetch("http://127.0.0.1:"+nextPort+"/api/admin/automation-studio",{method:"POST",headers:{"content-type":"application/json",...(cookie?{"cookie":cookie}:{})},body:JSON.stringify(body)});
  const data=await r.json().catch(()=>({}));return {status:r.status,data,cache:r.headers.get("cache-control")};
 }
 let webReady=false;for(let i=0;i<12;i++){if(next.exitCode!==null)throw Error("NEXT_EXITED_EARLY");
  try{const r=await post();if(r.status===500){console.log("NEXT_FIRST_500_DIAGNOSTIC",JSON.stringify(r.data).slice(0,500));throw Error("NEXT_ROUTE_STATUS_500");}if(r.status!==502&&r.status!==503){webReady=true;break;}}catch{}
  await delay(900);
 }suite("real Next.js HTTP route boots",webReady);
 let r=await post();suite("real HTTP anonymous rejected",r.status===401);
 r=await post(cookieHeader());suite("real HTTP synthetic vendor rejected",r.status===401);
 await pg.query("UPDATE public.profiles SET role='admin' WHERE id=$1",[signup.user.id]);
 r=await post(cookieHeader());suite("real HTTP admin without Superadmin rejected",r.status===401);
 const update=await fetch(gateway+"/auth/v1/admin/users/"+signup.user.id,{method:"PUT",headers:{"content-type":"application/json","authorization":"Bearer "+adminJwt,"apikey":adminJwt},body:JSON.stringify({app_metadata:{admin_role:"Superadmin"}})});
 const upd=await update.json().catch(()=>({}));suite("GoTrue admin role update accepted",update.ok&&Boolean(upd.id));
 const reauth=await ssr.auth.refreshSession();suite("real SSR refreshed signed app_metadata",!reauth.error&&reauth.data.user?.app_metadata?.admin_role==="Superadmin");
 r=await post(cookieHeader());suite("real HTTP superadmin trace success",r.status===200&&r.data.ok===true);
 suite("real Core trace SQL evidence present",r.data.events?.some(e=>e.title?.includes("Attempt"))&&r.data.providerDeliveryVerified===false);
 suite("real HTTP cache control no-store",r.cache==="no-store");
 r=await post(cookieHeader(),{action:"trace",jobId:"bogus"});suite("real HTTP malformed id rejected",r.status===400);
 r=await post(cookieHeader(),{action:"trace",jobId:uid});suite("real HTTP missing job 404",r.status===404);
 const immutable=await pg.query("SELECT count(*)::int n FROM public.automation_jobs");suite("real SQL job count unchanged",immutable.rows[0].n===1);
 console.log("VL01_REAL_GOTRUE_NEXT_POSTGREST_POSTGRES_PASS",passes+"/"+passes);
}catch(e){console.log("VL01_AUTH_HTTP_FAILURE",String(e.message||e));console.log("NEXT_ERROR_CLASS",childLogs.slice(-6000).replaceAll(jwtSecret,"[redacted]").replaceAll(pass,"[redacted]"));process.exitCode=1}
finally{
 if(next){try{next.kill()}catch{}}
 if(proxy){try{await new Promise(r=>proxy.close(r))}catch{}}
 try{await pg?.end()}catch{}
 for(const n of dbs.reverse())try{docker("rm","-f",n)}catch{}
 if(networkCreated)try{docker("network","rm",net)}catch{}
 console.log("VL01_AUTH_HTTP_FIXTURES_CLEANED");
}
