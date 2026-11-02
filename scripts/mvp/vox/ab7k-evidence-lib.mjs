// AB7K read-only security/recovery evidence library.
// Pure functions only: this module NEVER opens a database connection, reads env
// secrets, or writes files. It builds read-only SQL for an operator to run and
// evaluates the JSON the operator captured. It cannot produce a GO.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {inspectAb7kFullVoxSources} from "../../../contracts/vox/ab7kFullMigrationManifest.mjs";

const sha=x=>createHash("sha256").update(x).digest("hex");

// Same literals as scripts/mvp/build/stagingBuildGate.mjs (AUTHORIZED_REF/PRODUCTION_REF/JARVIS_REF).
export const AUTHORIZED_STAGING_REF="uckafzuochmbvtiodmcl";
export const PROHIBITED_REFS=Object.freeze(["yqpgcsduqbxulrlzwzap","coilipywdvxklewquqvv"]);
export const PINNED_FINGERPRINT="docs/vox/VOX-AB7K-REVIEWED-SOURCE-FINGERPRINT.json";
export const RECONCILIATION_DOC="docs/vox/VOX-AB7K-MIGRATION-LINEAGE-RECONCILIATION-20261018.md";
export const REQUIRED_CONSENT_RELATION="vox_ab7b_current_consent_candidate_v1";
export const CONSENT_CORE_RELATIONS=Object.freeze([
  "communication_preferences","communication_suppressions","communication_consent_events",
  "communication_consent_ack_intents","communication_conversations","communication_conversation_events"]);
export const BROWSER_ROLES=Object.freeze(["anon","authenticated","service_role"]);
const AUTH_EXEC_ALLOW=new Set(["qf_vox_ab7j_tl_approve_staff_suspend_v1"]);
const AUTH_EXEC_DENY=new Set(["qf_vox_ab7f_staff_suspend_atomic_candidate_v1"]);
const EXPECTED_VOX_TABLES=39;
const EXPECTED_LEDGER_COUNT=86;

export function canonicalize(v){
  if(Array.isArray(v))return v.map(canonicalize);
  if(v&&typeof v==="object"){
    const o={};
    for(const k of Object.keys(v).sort())o[k]=canonicalize(v[k]);
    return o;
  }
  return v;
}
export const canonicalJson=v=>JSON.stringify(canonicalize(v));
export const digest=v=>sha(canonicalJson(v));
/** Digest of everything that must survive a restore (identity/database name excluded). */
export const catalogDigest=snap=>digest({...snap,identity:undefined});

export function diffPaths(a,b,path="$",out=[],limit=50){
  if(out.length>=limit)return out;
  if(canonicalJson(a)===canonicalJson(b))return out;
  const obj=x=>x&&typeof x==="object"&&!Array.isArray(x);
  if(obj(a)&&obj(b)){
    for(const k of [...new Set([...Object.keys(a),...Object.keys(b)])].sort())
      diffPaths(a[k],b[k],`${path}.${k}`,out,limit);
  }else out.push(path);
  return out;
}

/** Endpoint binding only. Necessary, NOT sufficient: the operator must also record the dashboard project ref. */
export function validateProjectIdentity({projectRef,host,user}={}){
  const findings=[];
  const h=String(host??"").toLowerCase(),u=String(user??"");
  if(projectRef!==AUTHORIZED_STAGING_REF)findings.push("PROJECT_REF_NOT_AUTHORIZED_STAGING");
  for(const p of PROHIBITED_REFS)
    if(h.includes(p)||u.includes(p)||projectRef===p)findings.push("PROHIBITED_PROJECT_REF_PRESENT");
  const direct=h===`db.${AUTHORIZED_STAGING_REF}.supabase.co`&&/^[a-z_][a-z0-9_]*$/.test(u);
  const pooler=/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(h)&&
    new RegExp(`^[a-z_][a-z0-9_]*\\.${AUTHORIZED_STAGING_REF}$`).test(u);
  if(!direct&&!pooler)findings.push("CONNECTION_ENDPOINT_NOT_BOUND_TO_AUTHORIZED_REF");
  return Object.freeze({ok:findings.length===0,findings});
}

/** Re-derives the 7+23 order/hashes from live bytes and compares to the pinned reviewed fingerprint. */
export function checkManifest(root){
  const cur=inspectAb7kFullVoxSources(root);
  if(!cur.ok)return {ok:false,reasons:[cur.reason]};
  const pinned=JSON.parse(readFileSync(resolve(root,PINNED_FINGERPRINT),"utf8"));
  const reasons=[];
  const listing=fs=>fs.map(x=>x.order+"|"+x.path+"|"+x.sha256).join("\n");
  if(cur.files.length!==30)reasons.push("FILE_COUNT_NOT_30");
  cur.files.forEach((f,i)=>{
    if(f.order!==i+1)reasons.push(`ORDER_GAP_${i+1}`);
    const want=i<7?"QUARANTINED_FOUNDATION":"UNINSTALLED_CANDIDATE";
    if(f.stage!==want)reasons.push(`STAGE_ORDER_${i+1}`);
  });
  if(sha(Buffer.from(listing(cur.files)))!==cur.manifestDigest)reasons.push("LIVE_DIGEST_RECOMPUTE_MISMATCH");
  if(cur.manifestDigest!==pinned.manifestDigest)reasons.push("DIGEST_DRIFT_FROM_PINNED");
  if(sha(Buffer.from(listing(pinned.files)))!==pinned.manifestDigest)reasons.push("PINNED_FILE_INTERNALLY_INCONSISTENT");
  cur.files.forEach((f,i)=>{
    const p=pinned.files[i];
    if(!p||p.path!==f.path||p.sha256!==f.sha256||p.bytes!==f.bytes)reasons.push(`BYTES_DRIFT_${i+1}_${f.path.split("/").pop()}`);
  });
  return {ok:reasons.length===0,reasons,manifestDigest:cur.manifestDigest,
    quarantined:cur.quarantinedFoundationCount,candidates:cur.uninstalledCandidateCount,files:cur.files};
}

export function readStagingOnlyVersions(root){
  const t=readFileSync(resolve(root,RECONCILIATION_DOC),"utf8");
  const sec=t.split("## Staging applied versions without exact Core filename match")[1]?.split("## Core versions")[0]??"";
  return [...sec.matchAll(/^- `(\d{14})`/gm)].map(m=>m[1]);
}

const strip=s=>s.replace(/\/\*[\s\S]*?\*\//g,"").replace(/--[^\n]*/g,"");
const ID="([a-z_][a-z0-9_]*)";
const addTo=(m,k,f)=>{if(!m.has(k))m.set(k,new Set());m.get(k).add(f)};
const files=s=>[...s].sort();

/** Static (regex) relation/function dependency scan of the 30 files. Heuristic; DBA must confirm. */
export function analyzeDependencies(root){
  const inv=inspectAb7kFullVoxSources(root);
  if(!inv.ok)throw new Error(inv.reason);
  const created=new Map(),createdFns=new Map(),refs=new Map(),calls=new Map(),auth=new Map();
  const mk=(re)=>new RegExp(re,"g");
  for(const f of inv.files){
    const text=strip(readFileSync(resolve(root,f.path),"utf8")).toLowerCase();
    for(const m of text.matchAll(mk(`create\\s+(?:or\\s+replace\\s+)?(?:unlogged\\s+)?(?:materialized\\s+)?(?:table|view)\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${ID}`)))addTo(created,m[1],f.path);
    for(const m of text.matchAll(mk(`create\\s+(?:or\\s+replace\\s+)?(?:function|procedure)\\s+public\\.${ID}`)))addTo(createdFns,m[1],f.path);
    for(const m of text.matchAll(mk(`\\b(?:from|join|references|update|into|on|table|only)\\s+public\\.${ID}`)))addTo(refs,m[1],f.path);
    for(const m of text.matchAll(mk(`'public\\.${ID}'`)))addTo(refs,m[1],f.path);
    for(const m of text.matchAll(mk(`\\bpublic\\.${ID}\\s*\\(`)))addTo(calls,m[1],f.path);
    for(const m of text.matchAll(mk(`\\bauth\\.${ID}`)))addTo(auth,m[1],f.path);
  }
  const external=[...refs.keys()].filter(k=>!created.has(k)).sort();
  const row=k=>({name:k,referencedBy:files(refs.get(k))});
  return Object.freeze({
    createdRelations:[...created.keys()].sort(),
    createdFunctions:[...createdFns.keys()].sort(),
    missingVoxRelations:external.filter(k=>k.startsWith("vox_")).map(row),
    externalCoreRelations:external.filter(k=>!k.startsWith("vox_")),
    externalFunctions:[...calls.keys()].filter(k=>!createdFns.has(k)&&!refs.has(k)&&!created.has(k)).sort(),
    authFunctions:[...auth.keys()].sort(),
    method:"REGEX_HEURISTIC_NOT_A_PARSER"
  });
}

const ident=x=>{if(!/^[a-z_][a-z0-9_]*$/.test(x))throw new Error("UNSAFE_IDENTIFIER");return x};
const arr=xs=>`array[${xs.map(x=>`'${ident(x)}'`).join(",")}]::text[]`;
const ROLE_LIST=`array['anon','authenticated','service_role']`;
const ACL=col=>`(select coalesce(jsonb_agg(a.x order by a.x collate "C"),'[]'::jsonb) from (select (case when e.grantee=0 then 'PUBLIC' else pg_get_userbyid(e.grantee) end)||'|'||pg_get_userbyid(e.grantor)||'|'||e.privilege_type||'|'||e.is_grantable::text as x from aclexplode(${col}) e) a)`;

/** Single read-only statement set. Catalog reads only; no DML/DDL; rolls back. */
export function catalogSql(root){
  const dep=analyzeDependencies(root);
  const rels=[...new Set([...dep.externalCoreRelations,...CONSENT_CORE_RELATIONS,REQUIRED_CONSENT_RELATION])].sort();
  const fns=dep.createdFunctions;
  return `begin read only;
set local statement_timeout='30s';
set local lock_timeout='2s';
select jsonb_build_object(
 'identity',jsonb_build_object('database',current_database(),'current_user',current_user,'session_user',session_user,
  'server_version_num',current_setting('server_version_num'),'transaction_read_only',current_setting('transaction_read_only'),
  'search_path',current_setting('search_path')),
 'roles',(select coalesce(jsonb_object_agg(r.rolname,jsonb_build_object('super',r.rolsuper,'bypassrls',r.rolbypassrls,'inherit',r.rolinherit,'login',r.rolcanlogin,'createrole',r.rolcreaterole,'createdb',r.rolcreatedb)),'{}'::jsonb)
  from pg_roles r where r.rolname in ('anon','authenticated','service_role','authenticator','postgres','supabase_admin')),
 'memberships',(select coalesce(jsonb_agg(m.x order by m.x collate "C"),'[]'::jsonb) from (select pg_get_userbyid(am.member)||'>'||pg_get_userbyid(am.roleid) as x from pg_auth_members am
  where pg_get_userbyid(am.member) in ('anon','authenticated','service_role','authenticator') or pg_get_userbyid(am.roleid) in ('anon','authenticated','service_role','authenticator')) m),
 'schema_privs',(select jsonb_object_agg(sr.n,jsonb_build_object('usage',has_schema_privilege(sr.n::name,'public','USAGE'),'create',has_schema_privilege(sr.n::name,'public','CREATE'))) from unnest(${ROLE_LIST}) as sr(n)),
 'default_acls',(select coalesce(jsonb_agg(d.x order by d.x collate "C"),'[]'::jsonb) from (select pg_get_userbyid(da.defaclrole)||'|'||da.defaclnamespace::regnamespace::text||'|'||da.defaclobjtype::text||'|'||da.defaclacl::text as x from pg_default_acl da) d),
 'presence',(select coalesce(jsonb_object_agg(d.n,to_regclass('public.'||d.n)::text),'{}'::jsonb) from unnest(${arr(rels)}) as d(n)),
 'relations',(select coalesce(jsonb_object_agg(c.relname,jsonb_build_object(
   'kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
   'acl_is_default',c.relacl is null,
   'acl',${ACL("c.relacl")},
   'effective',(select jsonb_object_agg(ro.n,(select coalesce(jsonb_agg(p.v order by p.v collate "C"),'[]'::jsonb)
      from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(v) where has_table_privilege(ro.n::name,c.oid,p.v)))
      from unnest(${ROLE_LIST}) as ro(n)),
   'columns',(select coalesce(jsonb_agg(at.attname||':'||format_type(at.atttypid,at.atttypmod)||':'||at.attnotnull::text order by at.attname collate "C"),'[]'::jsonb)
      from pg_attribute at where at.attrelid=c.oid and at.attnum>0 and not at.attisdropped),
   'column_acl',(select coalesce(jsonb_agg(at.attname order by at.attname collate "C"),'[]'::jsonb)
      from pg_attribute at where at.attrelid=c.oid and at.attnum>0 and not at.attisdropped and at.attacl is not null),
   'constraints',(select coalesce(jsonb_agg(k.conname||'|'||k.contype::text||'|'||pg_get_constraintdef(k.oid) order by k.conname collate "C"),'[]'::jsonb)
      from pg_constraint k where k.conrelid=c.oid),
   'policies',(select coalesce(jsonb_agg(po.polname||'|'||po.polcmd::text||'|'||po.polpermissive::text||'|'||
      (select coalesce(string_agg(case when pr.o=0 then 'PUBLIC' else pg_get_userbyid(pr.o) end,',' order by (case when pr.o=0 then 'PUBLIC' else pg_get_userbyid(pr.o) end) collate "C"),'') from unnest(po.polroles) as pr(o))||'|'||
      coalesce(pg_get_expr(po.polqual,po.polrelid),'')||'|'||coalesce(pg_get_expr(po.polwithcheck,po.polrelid),'') order by po.polname collate "C"),'[]'::jsonb)
      from pg_policy po where po.polrelid=c.oid),
   'triggers',(select coalesce(jsonb_agg(t.tgname||'|'||t.tgenabled::text||'|'||pg_get_triggerdef(t.oid) order by t.tgname collate "C"),'[]'::jsonb)
      from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
   'indexes',(select coalesce(jsonb_agg(i.indexname||'|'||i.indexdef order by i.indexname collate "C"),'[]'::jsonb)
      from pg_indexes i where i.schemaname='public' and i.tablename=c.relname),
   'definition',case when c.relkind in ('v','m') then pg_get_viewdef(c.oid) end
  )),'{}'::jsonb)
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','f')
   and (c.relname like 'vox\\_%' or c.relname=any(${arr(rels)}))),
 'functions',(select coalesce(jsonb_object_agg(f.proname||'('||pg_get_function_identity_arguments(f.oid)||')',jsonb_build_object(
   'kind',f.prokind::text,'owner',pg_get_userbyid(f.proowner),'security_definer',f.prosecdef,
   'config',coalesce(to_jsonb(f.proconfig),'[]'::jsonb),'returns',pg_get_function_result(f.oid),'body_md5',md5(f.prosrc),
   'acl_is_default',f.proacl is null,
   'acl',${ACL("f.proacl")},
   'public_execute',(f.proacl is null or exists(select 1 from aclexplode(f.proacl) e where e.grantee=0 and e.privilege_type='EXECUTE')),
   'execute',(select jsonb_object_agg(fr.n,has_function_privilege(fr.n::name,f.oid,'EXECUTE')) from unnest(${ROLE_LIST}) as fr(n))
  )),'{}'::jsonb)
  from pg_proc f where f.pronamespace='public'::regnamespace and f.prokind in ('f','p')
   and (f.proname like '%vox%' or f.proname=any(${arr(fns)})))
)::text;
rollback;
`;
}

export function ledgerSql(){
  return `begin read only;
set local statement_timeout='30s';
set local lock_timeout='2s';
select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) order by version collate "C"),'[]'::jsonb)::text
 from supabase_migrations.schema_migrations;
rollback;
`;
}

const list=xs=>xs.slice(0,20).join(",")+(xs.length>20?`,+${xs.length-20}more`:"");

export function validateBackupManifest(m,{stamp}={}){
  if(!m)return {status:"BLOCKED",detail:"MANAGED_BACKUP_BYTES_ACL_ROLE_DUMP_NOT_PROVIDED"};
  const bad=[];
  if(m.project_ref!==AUTHORIZED_STAGING_REF)bad.push("project_ref");
  if(!Number.isFinite(Date.parse(m.taken_at)))bad.push("taken_at");
  if(!Array.isArray(m.schemas)||!m.schemas.includes("public"))bad.push("schemas_must_include_public");
  if(m.includes_owner!==true)bad.push("owner_not_preserved(--no-owner?)");
  if(m.includes_acl!==true)bad.push("acl_not_preserved(--no-acl?)");
  if(m.includes_roles!==true)bad.push("role_dump_missing");
  if(!Array.isArray(m.artifacts)||m.artifacts.length===0||
     !m.artifacts.every(a=>/^[a-f0-9]{64}$/.test(a.sha256)&&Number.isInteger(a.bytes)&&a.bytes>0))bad.push("artifact_sha256_bytes");
  if(bad.length)return {status:"BLOCKED",detail:"BACKUP_MANIFEST_INSUFFICIENT: "+bad.join(",")};
  return {status:"REVIEW",detail:"manifest structurally complete; NO restore was executed or verified by this tool"};
}

function securityChecks(snap,add,expectedVoxTables){
  const rels=Object.entries(snap.relations??{});
  const vox=rels.filter(([n])=>n.startsWith("vox_"));
  const tables=vox.filter(([,r])=>r.kind==="r"||r.kind==="p");
  add("VOX_TABLE_COUNT",tables.length===expectedVoxTables?"PASS":"FAIL",`found ${tables.length}, expected ${expectedVoxTables}`);
  const noForce=tables.filter(([,r])=>!(r.rls&&r.force_rls)).map(([n])=>n);
  add("VOX_FORCE_RLS_ALL_TABLES",noForce.length===0?"PASS":"FAIL",noForce.length?list(noForce):"all enable+FORCE RLS");
  const anon=vox.filter(([,r])=>(r.effective?.anon??[]).length>0).map(([n])=>n);
  add("ANON_NO_PRIVILEGE_ON_VOX_RELATIONS",anon.length===0?"PASS":"FAIL",anon.length?list(anon):"none");
  const write=new Set(["INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER"]);
  const authW=vox.filter(([,r])=>(r.effective?.authenticated??[]).some(p=>write.has(p))).map(([n])=>n);
  add("AUTHENTICATED_NO_WRITE_PRIVILEGE_ON_VOX_RELATIONS",authW.length===0?"PASS":"FAIL",authW.length?list(authW):"none");
  const authR=vox.filter(([,r])=>(r.effective?.authenticated??[]).includes("SELECT")).map(([n])=>n);
  add("AUTHENTICATED_DIRECT_SELECT_ON_VOX_RELATIONS",authR.length===0?"PASS":"REVIEW",authR.length?`AppSec must justify: ${list(authR)}`:"none");
  const pub=vox.filter(([,r])=>r.acl.some(x=>x.startsWith("PUBLIC|"))).map(([n])=>n);
  add("NO_PUBLIC_ACL_ON_VOX_RELATIONS",pub.length===0?"PASS":"FAIL",pub.length?list(pub):"none");
  const colAcl=vox.filter(([,r])=>r.column_acl.length>0).map(([n])=>n);
  add("NO_COLUMN_LEVEL_ACL_ON_VOX_RELATIONS",colAcl.length===0?"PASS":"REVIEW",colAcl.length?list(colAcl):"none");
  const badPol=[];
  for(const [n,r] of vox)for(const p of r.policies){const roles=p.split("|")[3].split(",");if(roles.includes("PUBLIC")||roles.includes("anon"))badPol.push(n);}
  add("NO_POLICY_FOR_ANON_OR_PUBLIC_ON_VOX_TABLES",badPol.length===0?"PASS":"FAIL",badPol.length?list([...new Set(badPol)]):"none");
  const owners=[...new Set([...vox.map(([,r])=>r.owner),...Object.values(snap.functions??{}).map(f=>f.owner)])].sort();
  const ownerBad=owners.filter(o=>BROWSER_ROLES.includes(o));
  add("OWNERS_NOT_BROWSER_ROLES",ownerBad.length===0?"PASS":"FAIL",`owners=${owners.join(",")}`);
  const fns=Object.entries(snap.functions??{}).filter(([s])=>s.includes("vox"));
  const name=s=>s.split("(")[0];
  const pubEx=fns.filter(([,f])=>f.public_execute&&!/trigger$/.test(f.returns??"")).map(([s])=>s);
  add("NO_PUBLIC_EXECUTE_ON_NON_TRIGGER_VOX_FUNCTIONS",pubEx.length===0?"PASS":"FAIL",pubEx.length?list(pubEx):"none");
  const anonEx=fns.filter(([,f])=>f.execute?.anon).map(([s])=>s);
  add("ANON_NO_EXECUTE_ON_VOX_FUNCTIONS",anonEx.length===0?"PASS":"FAIL",anonEx.length?list(anonEx):"none");
  const noPath=fns.filter(([,f])=>f.security_definer&&!(f.config??[]).some(c=>/^search_path=/.test(c))).map(([s])=>s);
  add("SECURITY_DEFINER_PINNED_SEARCH_PATH",noPath.length===0?"PASS":"FAIL",noPath.length?list(noPath):"all pinned");
  const denyHit=fns.filter(([s,f])=>AUTH_EXEC_DENY.has(name(s))&&f.execute?.authenticated).map(([s])=>s);
  add("AUTHENTICATED_DENIED_SUSPENSION_RPC",denyHit.length===0?"PASS":"FAIL",denyHit.length?list(denyHit):"not executable by authenticated");
  const unk=fns.filter(([s,f])=>f.execute?.authenticated&&!AUTH_EXEC_ALLOW.has(name(s))&&!AUTH_EXEC_DENY.has(name(s))).map(([s])=>s);
  add("AUTHENTICATED_EXECUTE_ALLOWLIST",unk.length===0?"PASS":"REVIEW",unk.length?`unreviewed: ${list(unk)}`:"only known TL review RPC");
  const svc=fns.filter(([,f])=>f.execute?.service_role).length;
  add("SERVICE_ROLE_EXECUTE_SNAPSHOT","INFO",`${svc}/${fns.length} vox functions executable by service_role (full map in snapshot)`);
  const rb=["anon","authenticated"].filter(r=>snap.roles?.[r]?.super||snap.roles?.[r]?.bypassrls);
  add("BROWSER_ROLES_NOT_SUPER_OR_BYPASSRLS",rb.length===0?"PASS":"FAIL",rb.length?rb.join(","):"ok");
  const sc=["anon","authenticated"].filter(r=>snap.schema_privs?.[r]?.create);
  add("BROWSER_ROLES_NO_CREATE_ON_PUBLIC",sc.length===0?"PASS":"FAIL",sc.length?sc.join(","):"ok");
  add("DEFAULT_ACL_SNAPSHOT","INFO",`${(snap.default_acls??[]).length} pg_default_acl rows captured`);
}

/** Evaluate captured snapshot(s). Emits FAIL or HOLD only; goEligible is structurally false. */
export function evaluateEvidence(o){
  const {root,snapshot:snap,ledger,target,expect="post-install",identity,backupManifest}=o;
  if(!["local-disposable","managed-staging"].includes(target))throw new Error("INVALID_TARGET");
  if(!["pre-install","post-install"].includes(expect))throw new Error("INVALID_EXPECT");
  const checks=[];
  const add=(id,status,detail)=>checks.push({id,status,detail});
  const ver=String(snap.identity?.server_version_num??"");
  if(target==="managed-staging"){
    const v=validateProjectIdentity(identity);
    add("PROJECT_IDENTITY_ENDPOINT",v.ok?"PASS":"FAIL",v.ok?`endpoint bound to ${AUTHORIZED_STAGING_REF}`:v.findings.join(","));
    add("SESSION_READ_ONLY",snap.identity?.transaction_read_only==="on"?"PASS":"FAIL",`transaction_read_only=${snap.identity?.transaction_read_only}`);
    add("SERVER_VERSION","INFO",`server_version_num=${ver}`);
    if(!Array.isArray(ledger))add("MIGRATION_LEDGER_FINGERPRINT","BLOCKED","ledger snapshot not provided");
    else{
      const versions=new Set(ledger.map(x=>x.version));
      const sOnly=readStagingOnlyVersions(root);
      const miss=sOnly.filter(x=>!versions.has(x));
      add("STAGING_ONLY_VERSIONS_PRESENT",sOnly.length===31&&miss.length===0?"PASS":"FAIL",
        sOnly.length!==31?`reconciliation doc parse yielded ${sOnly.length}, expected 31`:miss.length?`missing ${list(miss)} (wrong project?)`:"all 31 present");
      add("LEDGER_COUNT",ledger.length===EXPECTED_LEDGER_COUNT?"PASS":"REVIEW",`${ledger.length} (18 Oct baseline ${EXPECTED_LEDGER_COUNT}); drift needs DBA re-reconciliation`);
      const voxMig=ledger.filter(x=>/vox/i.test(x.name??"")).map(x=>x.version);
      add("NO_VOX_MIGRATION_IN_LEDGER",voxMig.length===0?"PASS":"FAIL",voxMig.length?list(voxMig):"none");
    }
  }else{
    add("PROJECT_IDENTITY_ENDPOINT","INFO","local disposable cluster; NOT a QuickFurno Staging identity");
    add("SERVER_VERSION_PG17",ver.startsWith("17")?"PASS":"FAIL",`server_version_num=${ver}`);
  }
  const mf=checkManifest(root);
  add("MANIFEST_7_PLUS_23_ORDER_AND_HASHES",mf.ok?"PASS":"FAIL",mf.ok?`digest ${mf.manifestDigest}`:mf.reasons.join(","));
  const dep=analyzeDependencies(root);
  const presence=snap.presence??{};
  for(const m of dep.missingVoxRelations)
    add(`STATIC_VOX_RELATION_NEVER_CREATED:${m.name}`,"BLOCKED",
      `referenced by ${m.referencedBy.map(x=>x.split("/").pop()).join(",")}; no file in the 30 creates it`);
  const consent=presence[REQUIRED_CONSENT_RELATION]??null;
  if(consent===null)add("CONSENT_RELATION_PRESENT_IN_TARGET","BLOCKED",`${REQUIRED_CONSENT_RELATION} absent; CORE_CONVERSATION source insert guard has no consent truth`);
  else add("CONSENT_RELATION_PRESENT_IN_TARGET","REVIEW",
    `exists as ${snap.relations?.[REQUIRED_CONSENT_RELATION]?.kind??"?"}; AppSec must prove it derives from genuine Core consent/suppression, not a synthetic table`);
  const coreMissing=dep.externalCoreRelations.filter(n=>presence[n]==null);
  add("CORE_RELATION_PRESENCE",coreMissing.length===0?(target==="managed-staging"?"REVIEW":"INFO"):"BLOCKED",
    coreMissing.length?`absent: ${list(coreMissing)}`:`all ${dep.externalCoreRelations.length} present; presence only, column/semantic parity NOT verified`);
  const consentCore=CONSENT_CORE_RELATIONS.filter(n=>presence[n]==null);
  add("CORE_CONSENT_RELATIONS",consentCore.length===0?"REVIEW":"BLOCKED",
    consentCore.length?`absent: ${list(consentCore)}`:"present; columns captured in snapshot for DBA comparison");
  const voxCount=Object.keys(snap.relations??{}).filter(n=>n.startsWith("vox_")).length;
  if(expect==="pre-install")add("NO_VOX_RELATIONS_INSTALLED",voxCount===0?"PASS":"FAIL",`vox relations=${voxCount}`);
  else securityChecks(snap,add,o.expectedVoxTables??EXPECTED_VOX_TABLES);
  const bm=validateBackupManifest(backupManifest);
  add("MANAGED_BACKUP_CHAIN_OF_CUSTODY",bm.status,bm.detail);
  const overall=checks.some(c=>c.status==="FAIL")?"FAIL":"HOLD";
  const counts={};for(const c of checks)counts[c.status]=(counts[c.status]??0)+1;
  return {
    schema:"qf-vox-ab7k-evidence-report-v1",target,expect,overall,goEligible:false,counts,
    catalogDigest:catalogDigest(snap),checks,
    managedRestoration:"BLOCKED: no current managed backup bytes + ACL + role dump restore-tested by a qualified DBA is recorded by this tool",
    attestations:{aal2:"NOT_PROVIDED",pitr:"NOT_PROVIDED",ed25519:"NOT_PROVIDED",dba_signoff:"NOT_PROVIDED",appsec_signoff:"NOT_PROVIDED"},
    note:"This tool cannot emit GO. GO requires out-of-band independent DBA and AppSec signatures."
  };
}
