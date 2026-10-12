import crypto from "node:crypto";
import {execFileSync, spawnSync, spawn} from "node:child_process";
import http from "node:http";
import net from "node:net";
import {Pool} from "pg";
import {createServerClient} from "@supabase/ssr";
import {fileURLToPath} from "node:url";
import path from "node:path";
const tag=String(process.pid), network="qf-vl01-a-"+tag, db="qf-vl01-pg-"+tag, auth="qf-vl01-gotrue-"+tag;
const pass=crypto.randomBytes(24).toString("hex"),secret=crypto.randomBytes(32).toString("hex");
const docker=(...args)=>execFileSync("docker",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const sleep=n=>new Promise(r=>setTimeout(r,n));
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const readBody=async(req)=>{const buffers=[];for await(const part of req)buffers.push(part);return Buffer.concat(buffers);};
const freePort=async()=>{const server=net.createServer();await new Promise(done=>server.listen(0,"127.0.0.1",done));const port=server.address().port;await new Promise(done=>server.close(done));return port;};
let created=false;
try{
  docker("network","create",network);created=true;
  docker("run","--rm","-d","--name",db,"--network",network,"-p","127.0.0.1::5432","-e","POSTGRES_USER=vl01","-e","POSTGRES_PASSWORD="+pass,"-e","POSTGRES_DB=vl01","postgres:16-alpine");
  let up=false;for(let i=0;i<25;i++){try{docker("exec",db,"psql","-U","vl01","-d","vl01","-tAc","SELECT 1");up=true;break;}catch{await sleep(350)}}
  if(!up)throw Error("POSTGRES_NOT_READY");
  docker("exec",db,"psql","-U","vl01","-d","vl01","-c","CREATE SCHEMA IF NOT EXISTS auth;");
  docker("exec",db,"psql","-U","vl01","-d","vl01","-c","CREATE ROLE postgres SUPERUSER LOGIN;");
  docker("exec",db,"psql","-U","vl01","-d","vl01","-c","ALTER ROLE vl01 SET search_path TO auth,public;");
  docker("run","-d","--name",auth,"--network",network,"-p","127.0.0.1::9999",
  "-e","GOTRUE_DB_DRIVER=postgres",
  "-e","GOTRUE_DB_DATABASE_URL=postgres://vl01:"+pass+"@"+db+":5432/vl01?sslmode=disable",
  "-e","GOTRUE_DB_NAMESPACE=auth",
  "-e","GOTRUE_API_HOST=0.0.0.0",
  "-e","GOTRUE_API_PORT=9999",
  "-e","API_EXTERNAL_URL=http://localhost:9999",
  "-e","GOTRUE_API_EXTERNAL_URL=http://localhost:9999",
  "-e","GOTRUE_SITE_URL=http://localhost",
  "-e","GOTRUE_JWT_SECRET="+secret,
  "-e","GOTRUE_JWT_AUD=authenticated",
  "-e","GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
  "-e","GOTRUE_EXTERNAL_EMAIL_ENABLED=true",
  "-e","GOTRUE_MAILER_AUTOCONFIRM=true",
  "-e","GOTRUE_DISABLE_SIGNUP=false",
  "ghcr.io/supabase/gotrue:v2.196.0");
  console.log("CONTAINER_STATE",docker("inspect","--format","{{.State.Status}} {{.State.ExitCode}} {{json .HostConfig.PortBindings}}",auth));
  const bind=docker("port",auth,"9999/tcp").match(/127\.0\.0\.1:(\d+)/);if(!bind)throw Error("NOT_LOOPBACK_BOUND");console.log("GOTRUE_LOOPBACK_MAPPING_READY");
  let ok=false;let error="";
  for(let i=0;i<50;i++){const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),1800);try{const r=await fetch("http://127.0.0.1:"+bind[1]+"/health",{signal:abort.signal});if(r.status===200){ok=true;break;}error=String(r.status);}catch(e){error=e.name;}finally{clearTimeout(timer);}await sleep(450);}
  if(!ok){throw Error("GOTRUE_BOOT_FAILED_"+error);}
  const payload={email:"vl01-"+tag+"@example.invalid",password:"S-"+crypto.randomBytes(22).toString("hex")};
  const r=await fetch("http://127.0.0.1:"+bind[1]+"/signup",{method:"POST",headers:{"content-type":"application/json","apikey":"synthetic-local-test"},body:JSON.stringify(payload)});
  const j=await r.json();
  console.log("GOTRUE_STATUS",r.status,!!j.access_token,!!j.user?.id,!!j.error_code,"CODE",j.code||j.error_code||"none");
  if(r.status!==200||!j.access_token||!j.user?.id)throw Error("AUTH_SIGNUP_NO_SESSION");
  const g=await fetch("http://127.0.0.1:"+bind[1]+"/user",{headers:{"authorization":"Bearer "+j.access_token,"apikey":"synthetic-local-test"}});
  const u=await g.json();
  if(g.status!==200||u.id!==j.user.id)throw Error("GOTRUE_USER_VERIFICATION_FAILED");
  console.log("GOTRUE_SYNTHETIC_SIGNUP_AND_GETUSER_PASS");
  // Actual Next.js HTTP route with a real, disposable GoTrue session and SQL-backed REST gateway.
  const pgBind=docker("port",db,"5432/tcp").match(/127\.0\.0\.1:(\d+)/);
  if(!pgBind) throw Error("NO_LOOPBACK_PG_BINDING");
  const pgPool=new Pool({host:"127.0.0.1",port:Number(pgBind[1]),user:"vl01",password:pass,database:"vl01",max:6});
  let gateway, next;
  try {
    await pgPool.query(`
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text);
      CREATE TABLE public.automation_action_requests(id uuid PRIMARY KEY,action_type text,entity_type text,correlation_id text,decision_status text,decision_at timestamptz,decision_reason_code text,created_at timestamptz);
      CREATE TABLE public.automation_jobs(id uuid PRIMARY KEY,action_request_id uuid,status text,attempt_count integer DEFAULT 0,available_at timestamptz,locked_at timestamptz,completed_at timestamptz,created_at timestamptz,updated_at timestamptz,last_safe_code text);
      CREATE TABLE public.automation_execution_attempts(id uuid PRIMARY KEY,job_id uuid,attempt_number integer,status text,classification text,safe_code text,started_at timestamptz,finished_at timestamptz);
      CREATE TABLE public.automation_transport_requests(id uuid PRIMARY KEY,job_id uuid,attempt_id uuid,direction text,route_key text,state text,created_at timestamptz,finalized_at timestamptz);
    `);
    const json64=obj=>Buffer.from(JSON.stringify(obj)).toString("base64url");
    const now=Math.floor(Date.now()/1000);
    const input=json64({alg:"HS256",typ:"JWT"})+"."+json64({aud:"authenticated",role:"service_role",iat:now,exp:now+3600,iss:"supabase"});
    const serviceJwt=input+"."+crypto.createHmac("sha256",secret).update(input).digest("base64url");
    const patch=await fetch("http://127.0.0.1:"+bind[1]+"/admin/users/"+j.user.id,{method:"PUT",headers:{"authorization":"Bearer "+serviceJwt,"apikey":serviceJwt,"content-type":"application/json"},body:JSON.stringify({app_metadata:{admin_role:"Superadmin"}})});
    if(!patch.ok)throw Error("GOTRUE_ADMIN_METADATA_UPDATE_"+patch.status);
    const ownerSession=await patch.json();
    if(ownerSession.app_metadata?.admin_role!=="Superadmin")throw Error("GOTRUE_ADMIN_ROLE_NOT_SET");
    await pgPool.query("INSERT INTO public.profiles(id,role) VALUES($1,'admin')",[j.user.id]);
    const vendorEmail="vl01-vendor-"+tag+"@example.invalid",vendorPass="S-"+crypto.randomBytes(22).toString("hex");
    const reg=await fetch("http://127.0.0.1:"+bind[1]+"/signup",{method:"POST",headers:{"content-type":"application/json","apikey":"synthetic-local-test"},body:JSON.stringify({email:vendorEmail,password:vendorPass})});
    const vendor=await reg.json();
    if(!reg.ok||!vendor.user?.id)throw Error("GOTRUE_VENDOR_CREATE_"+reg.status);
    await pgPool.query("INSERT INTO public.profiles(id,role) VALUES($1,'vendor')",[vendor.user.id]);
    const reqId="ba2fbe9c-6f50-4f17-baf0-000000000111",jobId="ba2fbe9c-6f50-4f17-baf0-000000000222";
    await pgPool.query("INSERT INTO public.automation_action_requests VALUES($1,'vendor.lead_offer','lead','qf.trace:authstage-2026','authorized',NOW(),'QF_AUTH_VALID',NOW())",[reqId]);
    await pgPool.query("INSERT INTO public.automation_jobs(id,action_request_id,status,created_at,updated_at,available_at,completed_at,last_safe_code) VALUES($1,$2,'succeeded',NOW(),NOW(),NOW(),NOW(),'QF_COMM_ACCEPTED')",[jobId,reqId]);
    const pre=(await pgPool.query("SELECT count(*)::int AS n FROM public.automation_jobs")).rows[0].n;
    const tables=new Set(["profiles","automation_jobs","automation_action_requests","automation_execution_attempts","automation_transport_requests"]);
    gateway=http.createServer(async (req,res)=>{
      try {
        const url=new URL(req.url,"http://127.0.0.1");
        if(url.pathname.startsWith("/auth/v1/")){
          const target="http://127.0.0.1:"+bind[1]+url.pathname.slice(8)+url.search;
          const body=await readBody(req);
          const headers={};for(const key of ["authorization","apikey","content-type","x-client-info"])if(req.headers[key])headers[key]=req.headers[key];
          const source=await fetch(target,{method:req.method,headers,body:req.method==="GET"||req.method==="HEAD"?undefined:body});
          res.writeHead(source.status,{"content-type":source.headers.get("content-type")??"application/json"});
          res.end(Buffer.from(await source.arrayBuffer()));return;
        }
        if(!url.pathname.startsWith("/rest/v1/")||req.method!=="GET"){res.writeHead(405);res.end("{}");return;}
        const table=url.pathname.slice("/rest/v1/".length);
        if(!tables.has(table))throw Error("REST_TABLE_DENIED");
        const cols=url.searchParams.get("select")??"*";
        if(!/^(?:[a-z_]+(?:,[a-z_]+)*)|\*$/.test(cols))throw Error("REST_COLUMN_DENIED");
        const filters=[];const vals=[];
        for(const [k,v] of url.searchParams.entries())if(k!=="select"&&k!=="order"&&k!=="limit"){
          if(!/^[a-z_]+$/.test(k)||!v.startsWith("eq."))throw Error("REST_FILTER_DENIED");
          vals.push(v.slice(3));filters.push(k+"=$"+vals.length);
        }
        let query="SELECT "+cols+" FROM public."+table+(filters.length?" WHERE "+filters.join(" AND "):"");
        if(url.searchParams.has("order")){const v=url.searchParams.get("order");if(!/^[a-z_]+\.(asc|desc)$/.test(v))throw Error("ORDER_DENIED");query+=" ORDER BY "+v.replace("."," ");}
        if(url.searchParams.has("limit")){const lim=Number(url.searchParams.get("limit"));if(!Number.isInteger(lim)||lim<1||lim>100)throw Error("LIMIT_DENIED");query+=" LIMIT "+lim;}
        const rows=(await pgPool.query(query,vals)).rows;
        const single=(req.headers.accept??"").includes("application/vnd.pgrst.object+json");
        res.writeHead(single&&!rows.length?406:200,{"content-type":"application/json","cache-control":"no-store"});
        res.end(JSON.stringify(single?(rows[0]??{code:"PGRST116",message:"No rows"}):rows));
      }catch(e){res.writeHead(500,{"content-type":"application/json"});res.end(JSON.stringify({code:"VL01_GATEWAY_ERROR",message:e.message}));}
    });
    await new Promise(resolve=>gateway.listen(0,"127.0.0.1",resolve));
    const gatewayURL="http://127.0.0.1:"+gateway.address().port;
    const authCookies=async(email,password)=>{
      const jar=new Map();
      const sb=createServerClient(gatewayURL,"synthetic-local-anon-key",{cookies:{getAll:()=>Array.from(jar,([name,value])=>({name,value})),setAll:items=>items.forEach(x=>jar.set(x.name,x.value))}});
      const login=await sb.auth.signInWithPassword({email,password});
      if(login.error||!login.data.user)throw Error("REAL_GOTRUE_LOGIN_FAILED_"+login.error?.message);
      const user=await sb.auth.getUser();
      if(user.error||user.data.user?.id!==login.data.user.id)throw Error("REAL_GOTRUE_GET_USER_FAILED");
      return Array.from(jar,([name,value])=>name+"="+encodeURIComponent(value)).join("; ");
    };
    const ownerCookies=await authCookies(payload.email,payload.password);
    const vendorCookies=await authCookies(vendorEmail,vendorPass);
    const port=await freePort();
    const env={PATH:process.env.PATH,Path:process.env.Path,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,USERPROFILE:process.env.USERPROFILE,LOCALAPPDATA:process.env.LOCALAPPDATA,APPDATA:process.env.APPDATA,NODE_ENV:"development",CI:"true",NEXT_TELEMETRY_DISABLED:"1",NEXT_PUBLIC_SUPABASE_URL:gatewayURL,NEXT_PUBLIC_SUPABASE_ANON_KEY:"synthetic-local-anon-key",SUPABASE_SERVICE_ROLE_KEY:serviceJwt,PORT:String(port),QF_DEPLOYMENT_ENV:"staging"};
    next=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--hostname","127.0.0.1","-p",String(port)],{cwd:repoRoot,env,stdio:["ignore","pipe","pipe"],windowsHide:true});
    let nextOutput="";
    for(const stream of [next.stdout,next.stderr])stream.on("data",part=>nextOutput=(nextOutput+part.toString()).slice(-14000));
    const call=async(body,cookie)=>{
      const r=await fetch("http://127.0.0.1:"+port+"/api/admin/automation-studio",{method:"POST",headers:{"content-type":"application/json",...(cookie?{"cookie":cookie}:{})},body:typeof body==="string"?body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      const raw=await r.text();let responseBody;try{responseBody=JSON.parse(raw)}catch{responseBody={nonJson:raw.slice(0,900)}}return {status:r.status,body:responseBody,headers:r.headers};
    };
    let ready=false;
    for(let i=0;i<9;i++){
      if(next.exitCode!==null)throw Error("NEXT_EXITED_"+nextOutput.slice(-400));
      try{const x=await call({action:"trace",jobId});if(x.status===401){ready=true;break;}if(i===3){console.log("NEXT_PREFLIGHT_STATUS",x.status,"BODY",JSON.stringify(x.body).slice(0,550));console.log("NEXT_PREFLIGHT_LOG",nextOutput.slice(-1700));}}catch(e){if(i===3)console.log("NEXT_PREFLIGHT_EXCEPTION",e.name);}
      await sleep(1000);
    }
    if(!ready){console.log("NEXT_DEBUG_FIRST",nextOutput.slice(0,8500));throw Error("NEXT_NOT_READY_"+nextOutput.slice(-500));}
    const checks=[];
    const check=(label,ok)=>{if(!ok)throw Error("FAILED_REAL_AUTH_HTTP_"+label);checks.push(label);console.log("PASS",label);};
    check("anonymous rejected through actual Next HTTP", (await call({action:"trace",jobId})).status===401);
    check("real GoTrue vendor session rejected as nonsuperadmin",(await call({action:"trace",jobId},vendorCookies)).status===401);
    const good=await call({action:"trace",jobId},ownerCookies);
    check("real GoTrue superadmin session reads isolated SQL trace",good.status===200&&good.body.ok===true&&good.body.jobId===jobId&&good.body.providerDeliveryVerified===false);
    check("positive trace has Core decision not claimed as provider delivery",good.body.events.some(x=>x.title==="Core authorization: authorized"&&x.state==="observed"));
    check("malformed UUID is denied",(await call({action:"trace",jobId:"00000000-0000-0000-0000-000000000000"},ownerCookies)).status===400);
    check("nonexistent UUID returns 404",(await call({action:"trace",jobId:"ba2fbe9c-6f50-4f17-baf0-000000000333"},ownerCookies)).status===404);
    check("invalid JSON rejected",(await call("{bad",ownerCookies)).status===400);
    check("HTTP no-store",good.headers.get("cache-control")==="no-store");
    check("no database changes", (await pgPool.query("SELECT count(*)::int AS n FROM public.automation_jobs")).rows[0].n===pre);
    console.log("VL01_REAL_GOTRUE_NEXT_HTTP_PASS",checks.length+"/"+checks.length);
  } finally {
    if(next?.pid){try{spawnSync("taskkill",["/PID",String(next.pid),"/T","/F"],{encoding:"utf8",timeout:8000});}catch{};try{next.kill()}catch{}}
    if(gateway)await new Promise(done=>gateway.close(done));
    await pgPool.end();
  }

}catch(e){const safeMessage=String(e.message??"").replaceAll(pass,"[redacted]").replaceAll(secret,"[redacted]").replace(/Command failed: docker[^\n]*/g,"Docker subprocess failed");console.log("GOTRUE_TEST_FAILURE",e.code??e.name,"reason",safeMessage.slice(-360));try {const r=spawnSync("docker",["logs","--tail","15",auth],{encoding:"utf8"});const log=(r.stdout+"\n"+r.stderr).replaceAll(pass,"[secret]").replaceAll(secret,"[secret]");console.log("GOTRUE_BOOT_LOG",log.slice(-1800));}catch{};process.exitCode=1;}
finally {try{docker("rm","-f",auth)}catch{};try{docker("rm","-f",db)}catch{};if(created)try{docker("network","rm",network)}catch{};console.log("LOCAL_AUTH_TEST_CLEANUP_COMPLETE");}
