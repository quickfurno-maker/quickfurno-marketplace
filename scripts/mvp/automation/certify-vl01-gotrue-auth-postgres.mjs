import crypto from "node:crypto";
import {execFileSync, spawnSync} from "node:child_process";
const tag=String(process.pid), network="qf-vl01-a-"+tag, db="qf-vl01-pg-"+tag, auth="qf-vl01-gotrue-"+tag;
const pass=crypto.randomBytes(24).toString("hex"),secret=crypto.randomBytes(32).toString("hex");
const docker=(...args)=>execFileSync("docker",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const sleep=n=>new Promise(r=>setTimeout(r,n));
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
  const bind=docker("port",auth,"9999/tcp").match(/127\.0\.0\.1:(\d+)/);if(!bind)throw Error("NOT_LOOPBACK_BOUND");
  let ok=false;let error="";
  for(let i=0;i<50;i++){try{const r=await fetch("http://127.0.0.1:"+bind[1]+"/health");if(r.status===200){ok=true;break;}error=String(r.status);}catch(e){error=e.name;}await sleep(450);}
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
}catch(e){console.log("GOTRUE_TEST_FAILURE",e.code??e.name,"safe_stderr",String(e.stderr??"").replaceAll(pass,"[redacted]").replaceAll(secret,"[redacted]").slice(-420));try {const r=spawnSync("docker",["logs","--tail","15",auth],{encoding:"utf8"});const log=(r.stdout+"\n"+r.stderr).replaceAll(pass,"[secret]").replaceAll(secret,"[secret]");console.log("GOTRUE_BOOT_LOG",log.slice(-1800));}catch{};process.exitCode=1;}
finally {try{docker("rm","-f",auth)}catch{};try{docker("rm","-f",db)}catch{};if(created)try{docker("network","rm",network)}catch{};console.log("LOCAL_AUTH_TEST_CLEANUP_COMPLETE");}
