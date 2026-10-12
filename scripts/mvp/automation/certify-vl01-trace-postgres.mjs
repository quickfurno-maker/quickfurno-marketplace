// Vendor OS VL-01 — authenticated route + real isolated PostgreSQL trace certification.
// Generates disposable local test data only; never connects to Supabase or production.
// Execution: node scripts/mvp/automation/certify-vl01-trace-postgres.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const container = "qf-vl01-trace-cert-" + process.pid;
const password = randomBytes(24).toString("hex");
let dockerStarted = false;
let sql;
let passed = 0;
const uuid = (i) => "f56b6c10-75d7-4cb8-aea0-" + i.toString(16).padStart(12, "0");
function run(cmd,args) { return execFileSync(cmd,args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim(); }
async function check(name,fn) { await fn(); passed++; console.log("PASS", name); }
function assertSafeServer() {
  if (process.env.DATABASE_URL || process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("VL01_FORBIDS_EXTERNAL_DATABASE_ENV");
  }
}
class SelectQuery {
  constructor(table) {
    if (!["automation_jobs","automation_action_requests","automation_execution_attempts","automation_transport_requests"].includes(table)) {
      throw Error("VL01_FORBIDDEN_TABLE");
    }
    this.table = table; this.columns = "*"; this.filters = []; this.sort = null; this.take = null;
  }
  ident(value) { if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw Error("VL01_BAD_IDENTIFIER"); return value; }
  select(cols) { this.columns = cols.split(",").map(x => this.ident(x.trim())).join(","); return this; }
  eq(name,val) { this.filters.push([this.ident(name),val]); return this; }
  order(name, opts = {}) { this.sort = this.ident(name) + (opts.ascending ? " ASC" : " DESC"); return this; }
  limit(n) { assert(Number.isSafeInteger(n) && n>0 && n<1000); this.take=n; return this; }
  async resolve() {
    const values = this.filters.map(([,v])=>v);
    let query="SELECT "+this.columns+" FROM "+this.table;
    if(this.filters.length) query+=" WHERE "+this.filters.map(([column],i)=>column+"=$"+(i+1)).join(" AND ");
    if(this.sort) query+=" ORDER BY "+this.sort;
    if(this.take) query+=" LIMIT "+this.take;
    const result=await sql.query(query,values);
    return {data:result.rows,error:null};
  }
  async maybeSingle() { const r=await this.resolve(); return {data:r.data[0]??null,error:null}; }
  then(yes,no) { return this.resolve().then(yes,no); }
}
const totalRows=async () => {
  const r=await sql.query("SELECT (SELECT count(*)::int FROM automation_jobs) AS jobs, (SELECT count(*)::int FROM automation_action_requests) AS requests, (SELECT count(*)::int FROM automation_execution_attempts) AS attempts, (SELECT count(*)::int FROM automation_transport_requests) AS transports");
  return r.rows[0];
};
async function addJob(i, {type="vendor.lead_offer",status="succeeded",code="QF_COMM_ACCEPTED",corr="qf.trace:ok-1",attempts=0,transports=0,decision="authorized"}={}) {
  const req=uuid(i+1000),job=uuid(i+2000), now="2026-10-12T10:00:00Z";
  await sql.query("INSERT INTO automation_action_requests (id,action_type,entity_type,correlation_id,decision_status,decision_at,decision_reason_code,created_at) VALUES ($1,$2,'lead',$3,$4,$5,'QF_AUTH_VALID',$5)",[req,type,corr,decision,now]);
  await sql.query("INSERT INTO automation_jobs (id,action_request_id,status,created_at,updated_at,available_at,completed_at,last_safe_code) VALUES ($1,$2,$3,$4,$4,$4,$4,$5)",[job,req,status,now,code]);
  for(let k=0;k<attempts;k++) {
    const a=uuid(i*1000+k+3000);
    await sql.query("INSERT INTO automation_execution_attempts (id,job_id,attempt_number,status,classification,safe_code,started_at,finished_at) VALUES ($1,$2,$3,'failed','retryable','QF_TEST_FAILED',$4,$4)",[a,job,k+1,new Date(Date.parse(now)+(k+1)*1000).toISOString()]);
  }
  for(let k=0;k<transports;k++) {
    const a=uuid(i*1000+k+7000);
    await sql.query("INSERT INTO automation_transport_requests (id,job_id,direction,route_key,state,created_at,finalized_at) VALUES ($1,$2,'outbound','execute_v1','completed',$3,$3)",[a,job,new Date(Date.parse(now)+(k+1)*1000).toISOString()]);
  }
  return job;
}
async function routeModule() {
  const buildOut=await build({
    entryPoints:[path.join(root,"app/api/admin/automation-studio/route.ts")],
    write:false,bundle:true,format:"esm",platform:"node",target:"node20",logLevel:"silent",
    plugins:[{name:"vl01-auth-db-stubs",setup(plugin){
      plugin.onResolve({filter:/^@\//},(args)=>{
        {
          if(args.path==="@/app/actions"||args.path==="@/lib/supabase"||args.path==="@/services/automationStudioService")
            return {path:args.path,namespace:"vl01"};
        }
        const base=path.resolve(root,args.path.slice(2));
        const actual=[base,base+".ts",base+".tsx",base+".js",path.join(base,"index.ts")].find(fs.existsSync);
        if(!actual) throw Error("UNRESOLVED_VL01_ALIAS "+args.path);
        return {path:actual};
      });
      plugin.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"vl01"}));
      plugin.onLoad({filter:/.*/,namespace:"vl01"},(args)=>{
        if(args.path==="@/app/actions") return {contents:"export async function getAdminSession(){return globalThis.__vl01Session;}",loader:"js"};
        if(args.path==="@/lib/supabase") return {contents:"export function adminClient(){return globalThis.__vl01Client;}",loader:"js"};
        if(args.path==="server-only") return {contents:"",loader:"js"};
        if(args.path==="@/services/automationStudioService") return {contents: [
          "export function getAutomationStudioWorkflowKeyForFamily(f){return f==='vendor_whatsapp'?'vendor_journey': f==='client_whatsapp'?'client_journey':'unknown'}",
          ...["getAutomationStudioOverview","publishAutomationStudioDraft","rollbackAutomationStudioWorkflow","saveAutomationStudioDraft","setAutomationStudioGlobalEnabled","setAutomationStudioWorkflowEnabled"].map(n=>"export async function "+n+"(){throw Error('VL01_DISABLED_MUTATION')}")].join(";"),loader:"js"};
        throw Error("unexpected mock "+args.path);
      });
    }}]
  });
  const code=buildOut.outputFiles[0].text;
  return import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));
}
async function post(handler,body,session={isLoggedIn:true,isSuperadmin:true,userId:"synthetic-owner"}) {
  globalThis.__vl01Session=session;
  const request=new Request("http://127.0.0.1/api/admin/automation-studio",{method:"POST",headers:{"content-type":"application/json"},body:typeof body==="string"?body:JSON.stringify(body)});
  const response=await handler(request);
  return {status:response.status, headers:response.headers, body:await response.json()};
}
try {
  assertSafeServer();
  console.log("VL01_CERT_START: disposable local postgres; no external database credentials");
  run("docker",["run","--rm","-d","--name",container,"-e","POSTGRES_DB=vl01","-e","POSTGRES_USER=vl01","-e","POSTGRES_PASSWORD="+password,"-p","127.0.0.1::5432","postgres:16-alpine"]);
  dockerStarted=true;
  const map=run("docker",["port",container,"5432/tcp"]);
  const match=map.match(/127\.0\.0\.1:(\d+)/);
  if(!match) throw Error("LOOPBACK_ONLY_PORT_REQUIRED");
  const connection={host:"127.0.0.1",port:Number(match[1]),user:"vl01",password,database:"vl01",connectionTimeoutMillis:1000};
  for(let n=0;n<35;n++) {
    try { sql=new pg.Client(connection); await sql.connect(); break; }
    catch { try{await sql?.end()}catch{}; sql=null; await new Promise(r=>setTimeout(r,500)); }
  }
  if(!sql) throw Error("VL01_POSTGRES_NOT_READY");
  await sql.query(`
    CREATE TABLE automation_action_requests (id uuid primary key,action_type text,entity_type text,correlation_id text,decision_status text,decision_at timestamptz,decision_reason_code text,created_at timestamptz);
    CREATE TABLE automation_jobs (id uuid primary key,action_request_id uuid not null references automation_action_requests(id),status text,attempt_count int default 0,available_at timestamptz,locked_at timestamptz,completed_at timestamptz,created_at timestamptz,updated_at timestamptz,last_safe_code text);
    CREATE TABLE automation_execution_attempts (id uuid primary key,job_id uuid references automation_jobs(id),attempt_number int,status text,classification text,safe_code text,started_at timestamptz,finished_at timestamptz);
    CREATE TABLE automation_transport_requests (id uuid primary key,job_id uuid references automation_jobs(id),attempt_id uuid,direction text,route_key text,state text,created_at timestamptz,finalized_at timestamptz);
  `);
  const good=await addJob(1,{attempts:1,transports:1});
  const empty=await addJob(2,{attempts:0,transports:0,status:"uncertain",corr:"customer_9876543210"});
  const huge=await addJob(3,{attempts:43,transports:42,status:"failed"});
  await sql.query("SET default_transaction_read_only = on");
  const readOnly=await sql.query("SHOW default_transaction_read_only");
  assert.equal(readOnly.rows[0].default_transaction_read_only,"on");
  const originalQuery=sql.query.bind(sql);
  let queryQueue=Promise.resolve();
  sql.query=(...args)=>{ const step=queryQueue.then(()=>originalQuery(...args)); queryQueue=step.then(()=>{},()=>{}); return step; };
  const before=await totalRows();
  globalThis.__vl01Client={from:(table)=>new SelectQuery(table)};
  const api=await routeModule();
  await check("unauthenticated rejected before query",async()=>{
    const x=await post(api.POST,{action:"trace",jobId:good},{isLoggedIn:false,isSuperadmin:false,userId:null});
    assert.equal(x.status,401);assert.equal(x.body.ok,false);
  });
  await check("ordinary admin rejected",async()=>{
    const x=await post(api.POST,{action:"trace",jobId:good},{isLoggedIn:true,isAdmin:true,isSuperadmin:false,userId:"synthetic-admin"});
    assert.equal(x.status,401);
  });
  await check("bad JSON fails closed",async()=>{const x=await post(api.POST,"{oops");assert.equal(x.status,400)});
  await check("malformed UUID fails closed",async()=>{const x=await post(api.POST,{action:"trace",jobId:"99999999-0000-0000-0000-000000000000"});assert.equal(x.status,400)});
  await check("valid but nonexistent UUID returns no data",async()=>{const x=await post(api.POST,{action:"trace",jobId:uuid(999999)});assert.equal(x.status,404)});
  await check("real PostgreSQL job+request+attempt+transport read",async()=>{
    const x=await post(api.POST,{action:"trace",jobId:good});
    assert.equal(x.status,200);assert.equal(x.headers.get("cache-control"),"no-store");
    assert.equal(x.body.ok,true);assert.equal(x.body.providerDeliveryVerified,false);
    assert.equal(x.body.coverage,"core_queue_worker_transport");
    assert.equal(x.body.evidenceTruncated,false);
    assert(x.body.events.some(e=>e.title==="Action requested"));
    assert(x.body.events.some(e=>e.title==="Core authorization: authorized"&&e.state==="observed"));
    assert(x.body.events.some(e=>e.title.includes("Attempt 1")));
    assert(x.body.events.some(e=>e.title.startsWith("Transport:")));
    assert(x.body.events.every(e=>!JSON.stringify(e).includes("9876543210")));
  });
  await check("UNKNOWN outcome and untrusted correlation redacted",async()=>{
    const x=await post(api.POST,{action:"trace",jobId:empty});
    assert.equal(x.status,200);assert.equal(x.body.coverage,"core_queue");
    assert.equal(x.body.correlationId,null);
    assert.equal(x.body.events.find(e=>e.id.startsWith("job:status:")).state,"unknown");
  });
  await check("evidence rows bounded with explicit truncation",async()=>{
    const x=await post(api.POST,{action:"trace",jobId:huge});
    assert.equal(x.status,200); assert.equal(x.body.evidenceTruncated,true);
    assert.equal(x.body.coverage,"core_queue_worker_transport");
    assert.equal(x.body.events.filter(e=>e.id.startsWith("attempt:start:")).length,40);
    assert.equal(x.body.events.filter(e=>e.id.startsWith("transport:")&&!e.id.startsWith("transport:done")).length,40);
  });
  await check("ordered event evidence",async()=>{
    const x=await post(api.POST,{action:"trace",jobId:huge});
    const times=x.body.events.map(e=>Date.parse(e.at));
    assert(times.every((n,i)=>i===0 || n>=times[i-1]));
  });
  await check("strictly read-only service",async()=>{
    assert.deepEqual(await totalRows(),before);
    const mode=await sql.query("SHOW default_transaction_read_only");
    assert.equal(mode.rows[0].default_transaction_read_only,"on");
  });
  console.log("VL01_ISOLATED_POSTGRES_ROUTE_CERT_PASS: "+passed+"/"+passed+" checks; no real users, sends, payments, or external DB");
} finally {
  try {await sql?.end()}catch{}
  if(dockerStarted){try{run("docker",["rm","-f",container])}catch{}}
  delete globalThis.__vl01Client;delete globalThis.__vl01Session;
  console.log("VL01_DISPOSABLE_INFRA_CLEANUP_COMPLETE");
}
