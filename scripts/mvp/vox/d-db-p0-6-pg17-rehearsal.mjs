#!/usr/bin/env node
// D-DB: disposable PostgreSQL 17 ACL / rollback / dump-restore rehearsal for the REVIEW-ONLY
// P0-6 public.is_admin() candidate. Docker only: --network none, no published ports, repo
// mounted read-only, trust auth inside a throwaway container. It never reads managed
// credentials (refuses if present), never touches Staging/Production and never promotes the
// candidate SQL: it only reads it from the read-only mount. Decision stays HOLD regardless.
//
//   node d-db-p0-6-pg17-rehearsal.mjs        (exit 0 proven, 1 assertion failed, 64 refused, 70 error)
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {managedCredentialsPresent} from "./d-db-release-preflight.mjs";

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const CAND="ops/security/sql-candidates/";
export const FORWARD=CAND+"vox_p0_6_is_admin_staging_migration_candidate.sql";
export const ROLLBACK=CAND+"vox_p0_6_is_admin_staging_rollback_migration_candidate.sql";
const BASELINE=CAND+"vox_p0_5_is_admin_rollback_candidate.sql";
export const IMAGE="postgres:17-alpine";
// status: FAIL = an assertion failed (exit 1); HOLD = proven in the disposable DB but the
// decision stays HOLD (exit 0). There is no PASS/GO: this tool never authorizes staging.
export const REPORT_SCHEMA="qf.vox.d-db.p0-6-pg17-rehearsal.v1";
export const COMMAND="node scripts/mvp/vox/d-db-p0-6-pg17-rehearsal.mjs";

const BOOTSTRAP=`
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
 $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
 if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
end $$;
create table public.profiles (id uuid primary key, role text not null, is_active boolean);
insert into public.profiles values
 ('11111111-1111-1111-1111-111111111111','admin',true),
 ('22222222-2222-2222-2222-222222222222','admin',false),
 ('33333333-3333-3333-3333-333333333333','admin',null),
 ('44444444-4444-4444-4444-444444444444','user',true);
grant usage on schema public to authenticated, anon;
grant select on public.profiles to authenticated;
`;
// Baseline = observed Staging function body + its grants; two dependent RLS policies.
const POST_BASELINE=`
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
revoke execute on function public.is_admin() from anon;
create table public.vox_probe (id int primary key, note text);
alter table public.vox_probe enable row level security;
create policy vox_probe_admin_all on public.vox_probe for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy vox_probe_admin_sel on public.vox_probe for select to authenticated using (public.is_admin());
`;
// One JSON document describing everything an ACL/rollback reviewer cares about.
export const SNAPSHOT_SQL=`
select json_build_object(
 'acl',(select proacl::text from pg_proc where oid='public.is_admin()'::regprocedure),
 'grantees',(select coalesce(json_agg(g order by g),'[]'::json) from (
   select case a.grantee when 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||':'||a.privilege_type as g
   from pg_proc p, aclexplode(p.proacl) a where p.oid='public.is_admin()'::regprocedure) x),
 'owner',(select pg_get_userbyid(proowner) from pg_proc where oid='public.is_admin()'::regprocedure),
 'secdef',(select prosecdef from pg_proc where oid='public.is_admin()'::regprocedure),
 'volatility',(select provolatile::text from pg_proc where oid='public.is_admin()'::regprocedure),
 'config',(select proconfig from pg_proc where oid='public.is_admin()'::regprocedure),
 'srcmd5',(select md5(prosrc) from pg_proc where oid='public.is_admin()'::regprocedure),
 'def',pg_get_functiondef('public.is_admin()'::regprocedure),
 'policies',(select coalesce(json_agg(policyname||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') order by policyname),'[]'::json)
   from pg_policies where schemaname='public' and tablename='vox_probe')
)::text;`;
const IDS=[1,2,3,4].map(n=>[8,4,4,4,12].map(k=>String(n).repeat(k)).join("-"));
const BEHAVIOR_SQL=IDS.map(i=>`select set_config('request.jwt.claim.sub','${i}',false);\nselect public.is_admin();`).join("\n");

const REQUIRED_GRANTEES=["authenticated:EXECUTE","postgres:EXECUTE"];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

/** Pure assertions over snapshots. Returns failures (empty = proven). */
export function assessRehearsal({baseline,forward,rolledBack,restoredForward,restoredBaseline,restoredRolledBack}){
 const f=[];const need=(ok,msg)=>{if(!ok)f.push(msg)};
 need(baseline.grantees.includes("authenticated:EXECUTE"),"baseline: authenticated lacks EXECUTE");
 need(!baseline.grantees.some(g=>g.startsWith("PUBLIC:")||g.startsWith("anon:")),"baseline: PUBLIC/anon must not hold EXECUTE");
 for(const g of REQUIRED_GRANTEES)need(baseline.grantees.includes(g),`baseline: missing ${g}`);
 need(forward.srcmd5!==baseline.srcmd5,"forward: function body did not change");
 need(same(forward.acl,baseline.acl)&&same(forward.grantees,baseline.grantees),"forward: ACL drifted from baseline");
 need(forward.owner===baseline.owner,"forward: owner changed");
 need(forward.secdef===true&&forward.volatility==="s"&&same(forward.config,["search_path=public"]),"forward: SECURITY DEFINER/STABLE/search_path not preserved");
 need(same(forward.policies,baseline.policies)&&baseline.policies.length===2,"forward: dependent policies changed or missing");
 const fb=Object.fromEntries(forward.behavior.map(r=>[r.id,r.is_admin]));
 need(fb["11111111-1111-1111-1111-111111111111"]===true,"forward: active admin denied");
 need(!fb["22222222-2222-2222-2222-222222222222"]&&!fb["33333333-3333-3333-3333-333333333333"]&&!fb["44444444-4444-4444-4444-444444444444"],"forward: inactive/NULL-active/non-admin allowed");
 const bb=Object.fromEntries(baseline.behavior.map(r=>[r.id,r.is_admin]));
 need(bb["22222222-2222-2222-2222-222222222222"]===true,"baseline: expected inactive admin allowed (pre-P0-6 behavior)");
 need(same(rolledBack,baseline),"rollback: state is not byte-identical to baseline (def/ACL/policies/behavior)");
 need(same(restoredForward,forward),"restore: pg_dump/pg_restore of forward state differs");
 need(same(restoredBaseline,baseline),"restore: pg_dump/pg_restore of baseline state differs");
 need(same(restoredRolledBack,baseline),"restore: forward-restored then rolled back is not baseline");
 // Every state (incl. restored ones) must keep EXECUTE away from PUBLIC/anon and keep a non-NULL ACL:
 // a NULL proacl means the implicit default (PUBLIC EXECUTE), which a drop/create or restore can reintroduce.
 const states={baseline,forward,rolledBack,restoredForward,restoredBaseline,restoredRolledBack};
 for(const [n,s] of Object.entries(states)){
  need(typeof s.acl==="string"&&s.acl.length>0,`${n}: proacl is NULL (default PUBLIC EXECUTE)`);
  need(!(s.grantees||[]).some(g=>g.startsWith("PUBLIC:")||g.startsWith("anon:")),`${n}: PUBLIC/anon holds EXECUTE`);
  need((s.grantees||[]).includes("authenticated:EXECUTE"),`${n}: authenticated lost EXECUTE`);
 }
 return f;
}

/** `sh` = {sql(db,text)->stdout, file(db,relPath), dump(db), restore(db,dump), createDb(name)}. */
export function rehearse(sh){
 const snap=db=>{
  const o=JSON.parse(sh.sql(db,SNAPSHOT_SQL).trim());
  const out=sh.sql(db,BEHAVIOR_SQL).trim().split("\n");
  o.behavior=IDS.map((id,n)=>({id,is_admin:out[2*n+1].trim()==="t"}));
  return o;
 };
 sh.createDb("src");
 const serverVersionNum=sh.sql("src","select current_setting('server_version_num');").trim();
 if(!/^17\d{4}$/.test(serverVersionNum))
  return {schema:REPORT_SCHEMA,status:"FAIL",proven:false,failures:[`server is not PostgreSQL 17 (server_version_num=${serverVersionNum})`],
   decision:"HOLD",candidatePromoted:false,managedCalls:false,serverVersionNum,command:COMMAND};
 sh.sql("src",BOOTSTRAP);
 sh.file("src",BASELINE);
 sh.sql("src",POST_BASELINE);
 const baseline=snap("src");
 const baseDump=sh.dump("src");
 sh.file("src",FORWARD);
 const forward=snap("src");
 const fwdDump=sh.dump("src");
 sh.file("src",ROLLBACK);
 const rolledBack=snap("src");
 sh.createDb("rb");sh.restore("rb",baseDump);const restoredBaseline=snap("rb");
 sh.createDb("rf");sh.restore("rf",fwdDump);const restoredForward=snap("rf");
 sh.file("rf",ROLLBACK);const restoredRolledBack=snap("rf");
 const failures=assessRehearsal({baseline,forward,rolledBack,restoredForward,restoredBaseline,restoredRolledBack});
 return {schema:REPORT_SCHEMA,status:failures.length?"FAIL":"HOLD",proven:failures.length===0,failures,
  decision:"HOLD",candidatePromoted:false,managedCalls:false,serverVersionNum,command:COMMAND,
  baselineGrantees:baseline.grantees,forwardSrcMd5:forward.srcmd5,baselineSrcMd5:baseline.srcmd5};
}

function dockerShell(name){
 const d=(args,input)=>{
  const r=spawnSync("docker",args,{encoding:"utf8",input,maxBuffer:64*1024*1024});
  if(r.error)throw r.error;
  if(r.status!==0)throw Error(`docker ${args[0]} failed: ${(r.stderr||"").trim().slice(0,500)}`);
  return r.stdout;
 };
 const psql=(db,more,input)=>d(["exec","-i",name,"psql","-U","postgres","-d",db,"-X","-v","ON_ERROR_STOP=1","-Atq",...more],input);
 return {
  d,
  sql:(db,text)=>psql(db,["-f","-"],text),
  file:(db,rel)=>psql(db,["-f","/qa/"+rel]),
  createDb:n=>{d(["exec",name,"createdb","-U","postgres",n])},
  dump:db=>{const p=`/tmp/${db}-${randomBytes(4).toString("hex")}.dump`;d(["exec",name,"pg_dump","-U","postgres","-Fc","-d",db,"-f",p]);return p},
  restore:(db,p)=>{d(["exec",name,"pg_restore","-U","postgres","-d",db,"--exit-on-error",p])}
 };
}

export function runRehearsal({env=process.env}={}){
 const present=managedCredentialsPresent(env);
 if(present.length)return {code:64,stderr:`DDB_REHEARSAL_REFUSED managed credentials present: ${present.join(",")}\n`};
 const name="ddb-p0-6-"+randomBytes(6).toString("hex");
 const sh=dockerShell(name);let started=false;
 try{
  sh.d(["run","-d","--name",name,"--network","none","-e","POSTGRES_HOST_AUTH_METHOD=trust","-v",`${repoRoot}:/qa:ro`,IMAGE]);
  started=true;
  let ready=false;
  for(let i=0;i<90&&!ready;i++){
   const logs=spawnSync("docker",["logs",name],{encoding:"utf8"});
   if(((logs.stdout||"")+(logs.stderr||"")).includes("PostgreSQL init process complete; ready for start up.")){
    const p=spawnSync("docker",["exec",name,"psql","-U","postgres","-Atqc","select 1"],{encoding:"utf8"});
    ready=p.status===0&&p.stdout.trim()==="1";
   }
   if(!ready)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);
  }
  if(!ready)throw Error("postgres readiness timeout");
  const report=rehearse(sh);
  return {code:report.proven?0:1,stdout:JSON.stringify(report,null,2)+"\n"};
 }finally{
  if(started){spawnSync("docker",["rm","-f",name],{stdio:"ignore"})}
 }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const r=runRehearsal();
  if(r.stdout)process.stdout.write(r.stdout);
  if(r.stderr)process.stderr.write(r.stderr);
  process.exitCode=r.code;
 }catch(e){process.stderr.write(`DDB_REHEARSAL_ERROR ${e instanceof Error?e.message:String(e)}\n`);process.exitCode=70}
}
