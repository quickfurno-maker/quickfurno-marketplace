// AB7K RC3 semantic recovery comparator (second, independent of ab7k-evidence-lib.mjs raw diff).
// Pure functions only: NEVER opens a database connection, reads secrets, or writes files except
// through assertSafeOutFile (temp-dir confined). It builds read-only SQL, builds a rolled-back
// behavior probe script for a DISPOSABLE cluster, and adjudicates captured JSON.
// It can never emit GO and never marks managed restoration as anything but BLOCKED.
import {lstatSync,realpathSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename,dirname,isAbsolute,relative,resolve,sep} from "node:path";
import {analyzeDependencies,canonicalJson,CONSENT_CORE_RELATIONS,REQUIRED_CONSENT_RELATION} from "./ab7k-evidence-lib.mjs";

export const SEMANTIC_SCHEMA="qf-vox-ab7k-semantic-snapshot-v1";
export const ADJUDICATION_SCHEMA="qf-vox-ab7k-recovery-adjudication-v1";
export const PROVISIONAL_LABEL="candidate-semantic-parity-provisional";
export const BROWSER_ROLE_LIST=Object.freeze(["anon","authenticated","service_role"]);
const OID_FLOOR=16384;

/** Fields of a PostgreSQL pg_node_tree that only steer deparsing/source position, never evaluation. */
export const PRESENTATION_ONLY_NODE_FIELDS=Object.freeze(
  ["location","funcformat","relabelformat","coerceformat","convertformat","varnosyn","varattnosyn"]);
const STRIP_RE_SRC=`:(${PRESENTATION_ONLY_NODE_FIELDS.join("|")})\\s+-?[0-9]+`;
const OID_FIELD_RE_SRC=":[a-z_]*(?:opno|funcid|type|collid|oid)\\s+([0-9]+)";

/** JS mirror of the SQL normalization, for offline DBA reproduction and tests. */
export function normalizeNodeTree(t){
  return t==null?null:String(t).replace(new RegExp(STRIP_RE_SRC,"g"),"");
}
export function nodeTreeHasUserOids(t){
  if(t==null)return false;
  for(const m of String(t).matchAll(new RegExp(OID_FIELD_RE_SRC,"g")))if(Number(m[1])>=OID_FLOOR)return true;
  return false;
}

// ---------------------------------------------------------------- path safety (local write audit)
export function isPathInside(parent,child){
  const rel=relative(resolve(parent),resolve(child));
  return rel!==""&&!rel.startsWith("..")&&!isAbsolute(rel);
}
/** Returns the resolved file path or throws. The only file writer of this toolchain's Node code. */
export function assertSafeOutFile(file,{allowNonTemp=false,tempRoot=tmpdir()}={}){
  if(typeof file!=="string"||file.length===0)throw new Error("OUT_PATH_REQUIRED");
  if(/(^|[\\/])\.\.([\\/]|$)/.test(file))throw new Error("OUT_PATH_TRAVERSAL");
  if(/^(\\\\|\/\/)/.test(file))throw new Error("OUT_PATH_UNC_REFUSED");
  const abs=resolve(file);
  const dir=dirname(abs);
  let st;
  try{st=lstatSync(dir)}catch{throw new Error("OUT_DIR_MISSING")}
  if(!st.isDirectory()||st.isSymbolicLink())throw new Error("OUT_DIR_NOT_PLAIN_DIRECTORY");
  // On Windows, Node may use an 8.3 TEMP alias while PowerShell emits its long path.
  // Compare real, existing parent directories so both spellings resolve identically.
  // This also refuses a symlinked ancestor escaping TEMP.
  const actualDir=realpathSync.native(dir);
  const actualRoot=realpathSync.native(tempRoot);
  if(!allowNonTemp&&!isPathInside(actualRoot,resolve(actualDir,basename(abs))))
    throw new Error("OUT_PATH_OUTSIDE_TEMP");
  try{lstatSync(abs);throw new Error("OUT_FILE_EXISTS")}catch(e){if(e.message==="OUT_FILE_EXISTS")throw e}
  return abs;
}

// ---------------------------------------------------------------- SQL builders
const ident=x=>{if(!/^[a-z_][a-z0-9_]*$/.test(x))throw new Error("UNSAFE_IDENTIFIER");return x};
const arr=xs=>`array[${xs.map(x=>`'${ident(x)}'`).join(",")}]::text[]`;
const ROLE_LIST=`array['anon','authenticated','service_role']`;
const grantee=g=>`(case when ${g}=0 then 'PUBLIC' else pg_get_userbyid(${g}) end)`;
/** Effective ACL: NULL ACL expands to the object-type hard-wired default for the owner (acldefault). */
const EACL=(acl,typeExpr,owner)=>`(select coalesce(jsonb_agg(a.x order by a.x collate "C"),'[]'::jsonb) from (select ${grantee("e.grantee")}||'|'||pg_get_userbyid(e.grantor)||'|'||e.privilege_type||'|'||e.is_grantable::text as x from aclexplode(coalesce(${acl},acldefault((${typeExpr})::"char",${owner}))) e) a)`;
const XACL=acl=>`(select coalesce(jsonb_agg(a.x order by a.x collate "C"),'[]'::jsonb) from (select ${grantee("e.grantee")}||'|'||pg_get_userbyid(e.grantor)||'|'||e.privilege_type||'|'||e.is_grantable::text as x from aclexplode(${acl}) e) a)`;
const TREE=expr=>`regexp_replace((${expr})::text,'${STRIP_RE_SRC}','','g')`;
const TREEOBJ=expr=>`(case when (${expr}) is null then null else (select jsonb_build_object('md5',md5(x.t),'user_oids',coalesce((select bool_or(g[1]::bigint>=${OID_FLOOR}) from regexp_matches(x.t,'${OID_FIELD_RE_SRC}','g') as g),false)) from (select ${TREE(expr)} as t) x) end)`;
const ATTNAMES=(vec,rel)=>`(select coalesce(jsonb_agg(a.attname order by u.ord),'[]'::jsonb) from unnest(${vec}) with ordinality as u(n,ord) join pg_attribute a on a.attrelid=${rel} and a.attnum=u.n)`;

/** Read-only, catalog-only semantic snapshot. No OIDs, deterministic ordering, identity excluded from compare. */
export function semanticCatalogSql(root){
  const dep=analyzeDependencies(root);
  const rels=[...new Set([...dep.externalCoreRelations,...CONSENT_CORE_RELATIONS,REQUIRED_CONSENT_RELATION])].sort();
  const fns=dep.createdFunctions;
  const priv7=`array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']`;
  return `begin read only;
set local statement_timeout='30s';
set local lock_timeout='2s';
select jsonb_build_object(
 'schema','${SEMANTIC_SCHEMA}',
 'identity',jsonb_build_object('database',current_database(),'server_version_num',current_setting('server_version_num'),'transaction_read_only',current_setting('transaction_read_only')),
 'roles',(select coalesce(jsonb_object_agg(r.rolname,jsonb_build_object('super',r.rolsuper,'bypassrls',r.rolbypassrls,'inherit',r.rolinherit,'login',r.rolcanlogin,'createrole',r.rolcreaterole,'createdb',r.rolcreatedb,'replication',r.rolreplication,'connlimit',r.rolconnlimit,'config_md5',md5(coalesce(r.rolconfig::text,'')))),'{}'::jsonb)
  from pg_roles r where r.rolname in ('anon','authenticated','service_role','authenticator','postgres','supabase_admin')),
 'memberships',(select coalesce(jsonb_agg(m.x order by m.x collate "C"),'[]'::jsonb) from (select pg_get_userbyid(am.member)||'>'||pg_get_userbyid(am.roleid)||'|admin='||coalesce(to_jsonb(am)->>'admin_option','')||'|inherit='||coalesce(to_jsonb(am)->>'inherit_option','')||'|set='||coalesce(to_jsonb(am)->>'set_option','') as x from pg_auth_members am
  where pg_get_userbyid(am.member) in ('anon','authenticated','service_role','authenticator') or pg_get_userbyid(am.roleid) in ('anon','authenticated','service_role','authenticator')) m),
 'schemas',(select coalesce(jsonb_object_agg(n.nspname,jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'acl',${EACL("n.nspacl","'n'","n.nspowner")},
   'usage',(select jsonb_object_agg(sr.n,has_schema_privilege(sr.n::name,n.oid,'USAGE')) from unnest(${ROLE_LIST}) as sr(n)),
   'create',(select jsonb_object_agg(sr.n,has_schema_privilege(sr.n::name,n.oid,'CREATE')) from unnest(${ROLE_LIST}) as sr(n)))),'{}'::jsonb)
  from pg_namespace n where n.nspname='public'),
 'default_acls',(select coalesce(jsonb_agg(d.x order by d.x collate "C"),'[]'::jsonb) from (select pg_get_userbyid(da.defaclrole)||'|'||(case when da.defaclnamespace=0 then '*' else da.defaclnamespace::regnamespace::text end)||'|'||da.defaclobjtype::text||'|'||(select coalesce(string_agg(q.s,',' order by q.s collate "C"),'') from (select ${grantee("e.grantee")}||'/'||pg_get_userbyid(e.grantor)||'/'||e.privilege_type||'/'||e.is_grantable::text as s from aclexplode(da.defaclacl) e) q) as x from pg_default_acl da) d),
 'relations',(select coalesce(jsonb_object_agg(c.relname,jsonb_build_object(
   'kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),'persistence',c.relpersistence::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
   'options',coalesce(c.reloptions::text,''),'is_partition',c.relispartition,
   'acl',${EACL("c.relacl","case when c.relkind='S' then 's' else 'r' end","c.relowner")},
   'priv',(select jsonb_object_agg(ro.n,jsonb_build_object(
      'plain',(select coalesce(jsonb_agg(p.v order by p.v collate "C"),'[]'::jsonb) from unnest(${priv7}) as p(v) where has_table_privilege(ro.n::name,c.oid,p.v)),
      'grantable',(select coalesce(jsonb_agg(p.v order by p.v collate "C"),'[]'::jsonb) from unnest(${priv7}) as p(v) where has_table_privilege(ro.n::name,c.oid,p.v||' WITH GRANT OPTION'))))
      from unnest(${ROLE_LIST}) as ro(n)),
   'columns',(select coalesce(jsonb_object_agg(at.attname,jsonb_build_object('type',format_type(at.atttypid,at.atttypmod),'notnull',at.attnotnull,'identity',at.attidentity::text,'generated',at.attgenerated::text,
      'default',${TREEOBJ("ad.adbin")},'acl',case when at.attacl is null then null else ${XACL("at.attacl")} end)),'{}'::jsonb)
      from pg_attribute at left join pg_attrdef ad on ad.adrelid=at.attrelid and ad.adnum=at.attnum where at.attrelid=c.oid and at.attnum>0 and not at.attisdropped),
   'constraints',(select coalesce(jsonb_object_agg(k.conname,jsonb_build_object(
      'type',k.contype::text,'deferrable',k.condeferrable,'deferred',k.condeferred,'validated',k.convalidated,
      'columns',${ATTNAMES("k.conkey","k.conrelid")},
      'ref_table',case when k.confrelid<>0 then k.confrelid::regclass::text end,
      'ref_columns',case when k.confrelid<>0 then ${ATTNAMES("k.confkey","k.confrelid")} end,
      'fk_update',k.confupdtype::text,'fk_delete',k.confdeltype::text,'fk_match',k.confmatchtype::text,
      'index',case when k.conindid<>0 then k.conindid::regclass::text end,
      'expr',${TREEOBJ("k.conbin")},
      'expr_text_informational',pg_get_constraintdef(k.oid))),'{}'::jsonb)
      from pg_constraint k where k.conrelid=c.oid),
   'indexes',(select coalesce(jsonb_object_agg(ic.relname,jsonb_build_object(
      'am',(select am.amname from pg_am am where am.oid=ic.relam),'unique',i.indisunique,'primary',i.indisprimary,'valid',i.indisvalid,'ready',i.indisready,
      'nulls_not_distinct',coalesce(to_jsonb(i)->>'indnullsnotdistinct','false'),'nkeyatts',i.indnkeyatts,'natts',i.indnatts,'options',coalesce(ic.reloptions::text,''),
      'include',(select coalesce(jsonb_agg(coalesce(pa.attname,'<expr>') order by ik.ord),'[]'::jsonb) from unnest(i.indkey::int2[]) with ordinality as ik(n,ord)
        left join pg_attribute pa on pa.attrelid=i.indrelid and pa.attnum=ik.n and ik.n<>0 where ik.ord>i.indnkeyatts),
      'keys',(select coalesce(jsonb_agg(jsonb_build_object('col',coalesce(pa.attname,'<expr>'),'opclass',oc.opcname,'collation',coalesce(co.collname,''),'option',io.v) order by ik.ord),'[]'::jsonb)
        from unnest(i.indkey::int2[]) with ordinality as ik(n,ord)
        join unnest(i.indclass::oid[]) with ordinality as icl(v,ord) on icl.ord=ik.ord
        join unnest(i.indcollation::oid[]) with ordinality as cl(v,ord) on cl.ord=ik.ord
        join unnest(i.indoption::int2[]) with ordinality as io(v,ord) on io.ord=ik.ord
        join pg_opclass oc on oc.oid=icl.v
        left join pg_collation co on co.oid=cl.v
        left join pg_attribute pa on pa.attrelid=i.indrelid and pa.attnum=ik.n and ik.n<>0),
      'exprs',${TREEOBJ("i.indexprs")},'predicate',${TREEOBJ("i.indpred")},
      'def_text_informational',pg_get_indexdef(i.indexrelid))),'{}'::jsonb)
      from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=c.oid),
   'triggers',(select coalesce(jsonb_object_agg(t.tgname,jsonb_build_object(
      'enabled',t.tgenabled::text,'type',t.tgtype::int,'function',(select pn.nspname||'.'||p.proname from pg_proc p join pg_namespace pn on pn.oid=p.pronamespace where p.oid=t.tgfoid),
      'columns',${ATTNAMES("t.tgattr::int2[]","t.tgrelid")},'deferrable',t.tgdeferrable,'initdeferred',t.tginitdeferred,'nargs',t.tgnargs,'args_md5',md5(t.tgargs),
      'when',${TREEOBJ("t.tgqual")},'old_table',coalesce(t.tgoldtable,''),'new_table',coalesce(t.tgnewtable,''),
      'def_text_informational',pg_get_triggerdef(t.oid))),'{}'::jsonb)
      from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
   'policies',(select coalesce(jsonb_object_agg(po.polname,jsonb_build_object(
      'cmd',po.polcmd::text,'permissive',po.polpermissive,
      'roles',(select coalesce(jsonb_agg(${grantee("pr.o")} order by ${grantee("pr.o")} collate "C"),'[]'::jsonb) from unnest(po.polroles) as pr(o)),
      'using',${TREEOBJ("po.polqual")},'check',${TREEOBJ("po.polwithcheck")})),'{}'::jsonb)
      from pg_policy po where po.polrelid=c.oid),
   'rules',(select coalesce(jsonb_object_agg(rw.rulename,jsonb_build_object('event',rw.ev_type::text,'instead',rw.is_instead,'enabled',rw.ev_enabled::text,
      'qual',${TREEOBJ("rw.ev_qual")},'action_md5',md5(${TREE("rw.ev_action")}))),'{}'::jsonb)
      from pg_rewrite rw where rw.ev_class=c.oid and c.relkind not in ('v','m')),
   'definition_text',case when c.relkind in ('v','m') then pg_get_viewdef(c.oid) end
  )),'{}'::jsonb)
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','f','S')
   and (c.relname like 'vox\\_%' or c.relname=any(${arr(rels)}))),
 'functions',(select coalesce(jsonb_object_agg(f.proname||'('||pg_get_function_identity_arguments(f.oid)||')',jsonb_build_object(
   'kind',f.prokind::text,'owner',pg_get_userbyid(f.proowner),'security_definer',f.prosecdef,'config',coalesce(to_jsonb(f.proconfig),'[]'::jsonb),
   'language',(select l.lanname from pg_language l where l.oid=f.prolang),'volatility',f.provolatile::text,'strict',f.proisstrict,'leakproof',f.proleakproof,'parallel',f.proparallel::text,
   'returns',pg_get_function_result(f.oid),'body_md5',md5(f.prosrc),
   'acl',${EACL("f.proacl","'f'","f.proowner")},
   'execute',(select jsonb_object_agg(fr.n,jsonb_build_object('plain',has_function_privilege(fr.n::name,f.oid,'EXECUTE'),'grantable',has_function_privilege(fr.n::name,f.oid,'EXECUTE WITH GRANT OPTION'))) from unnest(${ROLE_LIST}) as fr(n))
  )),'{}'::jsonb)
  from pg_proc f where f.pronamespace='public'::regnamespace and f.prokind in ('f','p')
   and (f.proname like '%vox%' or f.proname=any(${arr(fns)})))
)::text;
rollback;
`;
}

/**
 * Behavior probe script for a DISPOSABLE cluster only. Runs as the bootstrap superuser, switches to
 * non-superuser roles with SET LOCAL ROLE, records outcomes, and ALWAYS ends with ROLLBACK.
 * Output: one "probe-id|outcome" line per probe (no DDL, no COMMIT, no psql meta-commands).
 */
export function behaviorProbeSql(root){
  const dep=analyzeDependencies(root);
  const fns=dep.createdFunctions;
  const U=n=>`'00000000-0000-4000-8000-${String(n).padStart(12,"0")}'`;
  const CH="public.vox_staff_team_messages_candidate_v1",AB="public.vox_ab7j_staff_suspend_intents_candidate_v1";
  const chatIns=(nonce,body)=>`insert into ${CH}(message_nonce,team_id,city_id,sender_id,body) values (${nonce},gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),${body})`;
  const abIns=(nonce,o,r,t,dg)=>`insert into ${AB}(nonce,owner_id,reviewer_id,target_id,team_id,city_id,request_digest) values (${nonce},${o},${r},${t},gen_random_uuid(),gen_random_uuid(),${dg})`;
  const chatCases=[
    ["chat/valid_hello",chatIns(U(0xa1),`'hello'`)],
    ["chat/dup_nonce",chatIns(U(0xa1),`'hello2'`)],
    ["chat/body_500_ok",chatIns("gen_random_uuid()",`repeat('x',500)`)],
    ["chat/body_501_rejected",chatIns("gen_random_uuid()",`repeat('x',501)`)],
    ["chat/body_empty_rejected",chatIns("gen_random_uuid()",`''`)],
    ["chat/body_null_rejected",chatIns("gen_random_uuid()",`null`)],
    ["chat/body_leading_space_rejected",chatIns("gen_random_uuid()",`' x'`)],
    ["chat/body_trailing_space_rejected",chatIns("gen_random_uuid()",`'x '`)],
    ["chat/body_tab_rejected",chatIns("gen_random_uuid()",`'a'||chr(9)||'b'`)],
    ["chat/body_newline_rejected",chatIns("gen_random_uuid()",`'a'||chr(10)||'b'`)],
    ["chat/body_del_rejected",chatIns("gen_random_uuid()",`'a'||chr(127)||'b'`)],
    ["chat/body_unicode_ok",chatIns("gen_random_uuid()",`'caf'||chr(233)`)]
  ];
  const D="repeat('a',64)";
  const abCases=[
    ["ab7j/valid_distinct",abIns(U(0xb1),U(1),U(2),U(3),D)],
    ["ab7j/dup_nonce",abIns(U(0xb1),U(4),U(5),U(6),D)],
    ["ab7j/owner_eq_reviewer_rejected",abIns(U(0xb2),U(1),U(1),U(3),D)],
    ["ab7j/owner_eq_target_rejected",abIns(U(0xb3),U(1),U(2),U(1),D)],
    ["ab7j/reviewer_eq_target_rejected",abIns(U(0xb4),U(1),U(2),U(2),D)],
    ["ab7j/digest_63_rejected",abIns(U(0xb5),U(1),U(2),U(3),"repeat('a',63)")],
    ["ab7j/digest_65_rejected",abIns(U(0xb6),U(1),U(2),U(3),"repeat('a',65)")],
    ["ab7j/digest_uppercase_rejected",abIns(U(0xb7),U(1),U(2),U(3),"repeat('A',64)")],
    ["ab7j/digest_nonhex_rejected",abIns(U(0xb8),U(1),U(2),U(3),"repeat('g',64)")],
    ["ab7j/digest_null_rejected",abIns(U(0xb9),U(1),U(2),U(3),"null")]
  ];
  const q=s=>`'${s.replace(/'/g,"''")}'`;
  const run=cases=>cases.map(([id,sql])=>`perform pg_temp.qf_rec(${q(id)},null,${q(sql)});`).join("\n ");
  const ops=[["select",t=>`select count(*) from ${t}`],["insert",t=>`insert into ${t} default values`],
    ["update",t=>`update ${t} set ${t.includes("team_messages")?"body=body":"request_digest=request_digest"} where false`],
    ["delete",t=>`delete from ${t} where false`],["truncate",t=>`truncate ${t}`]];
  const privCases=[];
  for(const role of BROWSER_ROLE_LIST)for(const [tn,t] of [["chat",CH],["ab7j",AB]])for(const [on,mk] of ops)
    privCases.push([`priv/${role}/${tn}/${on}`,role,mk(t)]);
  const privRun=privCases.map(([id,role,sql])=>`perform pg_temp.qf_rec(${q(id)},${q(role)},${q(sql)});`).join("\n ");
  return `begin;
set local statement_timeout='120s';
set local lock_timeout='5s';
create function pg_temp.qf_try(p_role text,p_stmt text) returns text language plpgsql as $f$
declare st text;msg text;cn text;
begin
 if p_role is not null then execute format('set local role %I',p_role); end if;
 execute p_stmt;
 reset role;
 return 'OK';
exception when others then
 get stacked diagnostics st=returned_sqlstate,msg=message_text,cn=constraint_name;
 reset role;
 return 'ERR:'||st||':'||coalesce(cn,'')||':'||(case when msg like 'permission denied%' then 'DENIED' when msg like 'new row violates row-level security%' then 'RLS' when msg like 'VOX_CHAT_APPEND_ONLY%' then 'APPEND_ONLY' else '' end);
end
$f$;
create function pg_temp.qf_rec(p_id text,p_role text,p_stmt text) returns void language plpgsql as $f$
begin
 perform set_config('qf.probe',current_setting('qf.probe',true)||p_id||'|'||pg_temp.qf_try(p_role,p_stmt)||E'\\n',true);
end
$f$;
do $probe$
declare f record;r text;
begin
 perform set_config('qf.probe','',true);
 perform set_config('session_replication_role','replica',true);
 ${run(chatCases)}
 ${run(abCases)}
 perform set_config('session_replication_role','origin',true);
 perform pg_temp.qf_rec('chat/trigger_update_blocked',null,${q(`update ${CH} set body='y' where message_nonce=${U(0xa1)}`)});
 perform pg_temp.qf_rec('chat/trigger_delete_blocked',null,${q(`delete from ${CH} where message_nonce=${U(0xa1)}`)});
 ${privRun}
 foreach r in array ${ROLE_LIST} loop
  for f in select p.proname,pg_get_function_identity_arguments(p.oid) as ia,
    (select coalesce(string_agg('null::'||format_type(u.t,null),',' order by u.ord),'') from unnest(p.proargtypes::oid[]) with ordinality as u(t,ord)) as args
   from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and (p.proname like '%vox%' or p.proname=any(${arr(fns)})) order by 1,2 loop
   perform pg_temp.qf_rec('exec/'||r||'/'||f.proname||'('||f.ia||')',r,format('select public.%I(%s)',f.proname,f.args));
  end loop;
 end loop;
end
$probe$;
select current_setting('qf.probe');
rollback;
`;
}

export function parseProbeOutput(text){
  const m=new Map();
  for(const line of String(text).split(/\r?\n/)){
    if(!line.trim())continue;
    const i=line.indexOf("|");
    if(i<1)throw new Error("PROBE_LINE_MALFORMED");
    const id=line.slice(0,i);
    if(m.has(id))throw new Error("PROBE_ID_DUPLICATE");
    m.set(id,line.slice(i+1));
  }
  return Object.fromEntries([...m].sort(([a],[b])=>a<b?-1:a>b?1:0));
}

const isOk=o=>o==="OK";
const DENIED_RE=/^ERR:42501:[^:]*:DENIED$/;
/** Independent expectations from the candidate SQL grants; evaluated per database, not just cross-compared. */
export function evaluateProbeExpectations(p,{expectConstraints=true}={}){
  const fail=[];
  const need=(id,pred,why)=>{const o=p[id];if(o===undefined)fail.push(`${id}: MISSING_PROBE`);else if(!pred(o))fail.push(`${id}: ${o} (${why})`)};
  for(const role of BROWSER_ROLE_LIST)for(const tn of ["chat","ab7j"])for(const op of ["select","insert","update","delete","truncate"]){
    const id=`priv/${role}/${tn}/${op}`;
    if(role==="service_role"&&tn==="chat"){
      // Candidate SQL only REVOKEs from public/anon/authenticated and GRANTs SELECT; any other
      // service_role privilege is inherited from default privileges and is cross-compared, not asserted.
      if(op==="select")need(id,isOk,"service_role SELECT on chat must work");
    }else need(id,o=>DENIED_RE.test(o),"must be permission denied");
  }
  if(expectConstraints){
    const rej=(id,code,cn)=>need(id,o=>o.startsWith(`ERR:${code}:`)&&(cn===undefined||o.startsWith(`ERR:${code}:${cn}:`)),`must be ${code}${cn?" "+cn:""}`);
    for(const id of ["chat/valid_hello","chat/body_500_ok","chat/body_unicode_ok","ab7j/valid_distinct"])need(id,isOk,"must be accepted");
    for(const id of ["chat/body_501_rejected","chat/body_empty_rejected","chat/body_leading_space_rejected","chat/body_trailing_space_rejected","chat/body_tab_rejected","chat/body_newline_rejected","chat/body_del_rejected"])rej(id,"23514");
    rej("chat/body_null_rejected","23502");rej("chat/dup_nonce","23505");rej("ab7j/dup_nonce","23505");
    for(const id of ["ab7j/owner_eq_reviewer_rejected","ab7j/owner_eq_target_rejected","ab7j/reviewer_eq_target_rejected"])rej(id,"23514","ab7j_distinct_staff_approvers");
    for(const id of ["ab7j/digest_63_rejected","ab7j/digest_65_rejected","ab7j/digest_uppercase_rejected","ab7j/digest_nonhex_rejected"])rej(id,"23514");
    rej("ab7j/digest_null_rejected","23502");
    rej("chat/trigger_update_blocked","P0001");rej("chat/trigger_delete_blocked","P0001");
  }
  return fail;
}

// ---------------------------------------------------------------- semantic comparison
const WIDEN=new Set(["ACL_WIDENED","PRIV_WIDENED","COLUMN_ACL_WIDENED","FUNCTION_EXECUTE_WIDENED","POLICY_ADDED","POLICY_CHANGED","RLS_WEAKENED",
  "OWNER_CHANGED","SCHEMA_ACCESS_WIDENED","DEFAULT_ACL_CHANGED","ROLE_ATTRIBUTE_CHANGED","MEMBERSHIP_CHANGED","PROBE_WIDENED"]);
const WEAKEN=new Set(["CONSTRAINT_REMOVED","CONSTRAINT_EXPR_CHANGED","CONSTRAINT_CHANGED","INDEX_REMOVED","INDEX_CHANGED","TRIGGER_REMOVED",
  "TRIGGER_CHANGED","RULE_CHANGED","COLUMN_CHANGED","PROBE_WEAKENED","FUNCTION_CHANGED"]);

const eq=(a,b)=>canonicalJson(a)===canonicalJson(b);
const keys=(a,b)=>[...new Set([...Object.keys(a??{}),...Object.keys(b??{})])].sort();
const split=e=>{const [g,gr,p,gt]=e.split("|");return {g,gr,p,gt}};

function aclFindings(a,b,object,category,codeBase,out,suffix=""){
  const A=new Set(a??[]),B=new Set(b??[]);
  const add=[...B].filter(x=>!A.has(x)),rem=[...A].filter(x=>!B.has(x));
  if(!add.length&&!rem.length)return;
  const noGrantor=s=>new Set([...s].map(x=>{const y=split(x);return `${y.g}|${y.p}|${y.gt}`}));
  const nA=noGrantor(A),nB=noGrantor(B);
  const widened=[...nB].filter(x=>!nA.has(x)),narrowed=[...nA].filter(x=>!nB.has(x));
  const base={object,category,path:`${object}${suffix}`};
  if(widened.length)out.push({...base,code:`${codeBase}_WIDENED`,detail:`added(grantee|priv|grantable): ${widened.join(", ")}`});
  if(narrowed.length)out.push({...base,code:`${codeBase}_NARROWED`,detail:`removed: ${narrowed.join(", ")}`});
  if(!widened.length&&!narrowed.length)out.push({...base,code:`${codeBase}_GRANTOR_CHANGED`,detail:`grantor differs: +${add.join(",")} -${rem.join(",")}`});
}
function mapFindings(a,b,object,category,codes,out,cmp){
  for(const k of keys(a,b)){
    const path=`${object}.${category}.${k}`;
    if(a?.[k]===undefined)out.push({object,category,path,code:codes.added,detail:"present only in restored"});
    else if(b?.[k]===undefined)out.push({object,category,path,code:codes.removed,detail:"present only in source"});
    else if(cmp)cmp(a[k],b[k],path);
    else if(!eq(a[k],b[k]))out.push({object,category,path,code:codes.changed,detail:`source=${canonicalJson(a[k])} restored=${canonicalJson(b[k])}`});
  }
}
function exprFinding(x,y,object,category,path,out,changedCode){
  const nonPortable=(x&&x.user_oids)||(y&&y.user_oids);
  if(eq(x,y)&&!nonPortable)return;
  if(nonPortable)out.push({object,category,path,code:"EXPR_NONPORTABLE_NEEDS_BEHAVIOR_PROOF",detail:"parse tree references non-builtin OIDs; tree digest not comparable across databases"});
  else out.push({object,category,path,code:changedCode,detail:`normalized parse-tree digest differs: ${x?.md5??"null"} vs ${y?.md5??"null"}`});
}

export function compareSemantic(a,b){
  const out=[];
  if(a?.schema!==SEMANTIC_SCHEMA||b?.schema!==SEMANTIC_SCHEMA)
    return [{object:"snapshot",category:"schema",path:"$.schema",code:"SEMANTIC_SNAPSHOT_SCHEMA_INVALID",detail:"both snapshots must be "+SEMANTIC_SCHEMA}];
  for(const r of keys(a.roles,b.roles)){
    if(!eq(a.roles?.[r],b.roles?.[r]))out.push({object:`roles.${r}`,category:"roles",path:`$.roles.${r}`,code:"ROLE_ATTRIBUTE_CHANGED",detail:`source=${canonicalJson(a.roles?.[r])} restored=${canonicalJson(b.roles?.[r])}`});
  }
  if(!eq(a.memberships,b.memberships))out.push({object:"memberships",category:"memberships",path:"$.memberships",code:"MEMBERSHIP_CHANGED",detail:"role membership set differs"});
  if(!eq(a.default_acls,b.default_acls))out.push({object:"default_acls",category:"default_acls",path:"$.default_acls",code:"DEFAULT_ACL_CHANGED",detail:`source=${canonicalJson(a.default_acls)} restored=${canonicalJson(b.default_acls)}`});
  for(const s of keys(a.schemas,b.schemas)){
    const x=a.schemas?.[s],y=b.schemas?.[s],o=`schemas.${s}`;
    if(!x||!y){out.push({object:o,category:"schemas",path:`$.${o}`,code:"SCHEMA_ACCESS_WIDENED",detail:"schema present on one side only"});continue}
    if(x.owner!==y.owner)out.push({object:o,category:"schemas",path:`$.${o}.owner`,code:"OWNER_CHANGED",detail:`${x.owner} -> ${y.owner}`});
    aclFindings(x.acl,y.acl,o,"acl","ACL",out,".acl");
    for(const k of ["usage","create"])for(const r of keys(x[k],y[k]))
      if(!x[k]?.[r]&&y[k]?.[r])out.push({object:o,category:"schemas",path:`$.${o}.${k}.${r}`,code:"SCHEMA_ACCESS_WIDENED",detail:`${r} gained ${k}`});
      else if(x[k]?.[r]!==y[k]?.[r])out.push({object:o,category:"schemas",path:`$.${o}.${k}.${r}`,code:"SCHEMA_ACCESS_CHANGED",detail:`${r} lost ${k}`});
  }
  mapFindings(a.relations,b.relations,"relations","relation",{added:"RELATION_ADDED",removed:"RELATION_REMOVED",changed:"RELATION_CHANGED"},out,(x,y,path)=>{
    const obj=`relations.${path.slice("relations.relation.".length)}`;
    for(const f of ["kind","persistence","options","is_partition","definition_text"])
      if(!eq(x[f],y[f]))out.push({object:obj,category:"attributes",path:`${obj}.${f}`,code:"RELATION_ATTRIBUTE_CHANGED",detail:`${f}: ${canonicalJson(x[f])} -> ${canonicalJson(y[f])}`});
    if(x.owner!==y.owner)out.push({object:obj,category:"owner",path:`${obj}.owner`,code:"OWNER_CHANGED",detail:`${x.owner} -> ${y.owner}`});
    for(const f of ["rls","force_rls"])
      if(x[f]!==y[f])out.push({object:obj,category:"rls",path:`${obj}.${f}`,code:x[f]&&!y[f]?"RLS_WEAKENED":"RLS_CHANGED",detail:`${f}: ${x[f]} -> ${y[f]}`});
    aclFindings(x.acl,y.acl,obj,"acl","ACL",out,".acl");
    for(const r of keys(x.priv,y.priv))for(const g of ["plain","grantable"]){
      const pa=new Set(x.priv?.[r]?.[g]??[]),pb=new Set(y.priv?.[r]?.[g]??[]);
      const add=[...pb].filter(v=>!pa.has(v)),rem=[...pa].filter(v=>!pb.has(v));
      if(add.length)out.push({object:obj,category:"acl",path:`${obj}.priv.${r}.${g}`,code:"PRIV_WIDENED",detail:`${r} gained ${g} ${add.join(",")}`});
      if(rem.length)out.push({object:obj,category:"acl",path:`${obj}.priv.${r}.${g}`,code:"PRIV_NARROWED",detail:`${r} lost ${g} ${rem.join(",")}`});
    }
    mapFindings(x.columns,y.columns,obj,"columns",{added:"COLUMN_CHANGED",removed:"COLUMN_CHANGED",changed:"COLUMN_CHANGED"},out,(c,d,p)=>{
      for(const f of ["type","notnull","identity","generated"])
        if(!eq(c[f],d[f]))out.push({object:obj,category:"columns",path:`${p}.${f}`,code:"COLUMN_CHANGED",detail:`${f}: ${c[f]} -> ${d[f]}`});
      exprFinding(c.default,d.default,obj,"columns",`${p}.default`,out,"COLUMN_CHANGED");
      aclFindings(c.acl,d.acl,obj,"acl","COLUMN_ACL",out,`.columns.${p.split(".").pop()}.acl`);
    });
    mapFindings(x.constraints,y.constraints,obj,"constraints",{added:"CONSTRAINT_ADDED",removed:"CONSTRAINT_REMOVED",changed:"CONSTRAINT_CHANGED"},out,(c,d,p)=>{
      for(const f of ["type","deferrable","deferred","validated","columns","ref_table","ref_columns","fk_update","fk_delete","fk_match","index"])
        if(!eq(c[f],d[f]))out.push({object:obj,category:"constraints",path:`${p}.${f}`,code:"CONSTRAINT_CHANGED",detail:`${f}: ${canonicalJson(c[f])} -> ${canonicalJson(d[f])}`});
      exprFinding(c.expr,d.expr,obj,"constraints",`${p}.expr`,out,"CONSTRAINT_EXPR_CHANGED");
    });
    mapFindings(x.indexes,y.indexes,obj,"indexes",{added:"INDEX_CHANGED",removed:"INDEX_REMOVED",changed:"INDEX_CHANGED"},out,(i,j,p)=>{
      for(const f of ["am","unique","primary","valid","ready","nulls_not_distinct","nkeyatts","natts","include","options","keys"])
        if(!eq(i[f],j[f]))out.push({object:obj,category:"indexes",path:`${p}.${f}`,code:"INDEX_CHANGED",detail:`${f}: ${canonicalJson(i[f])} -> ${canonicalJson(j[f])}`});
      exprFinding(i.exprs,j.exprs,obj,"indexes",`${p}.exprs`,out,"INDEX_CHANGED");
      exprFinding(i.predicate,j.predicate,obj,"indexes",`${p}.predicate`,out,"INDEX_CHANGED");
    });
    mapFindings(x.triggers,y.triggers,obj,"triggers",{added:"TRIGGER_CHANGED",removed:"TRIGGER_REMOVED",changed:"TRIGGER_CHANGED"},out,(t,u,p)=>{
      for(const f of ["enabled","type","function","columns","deferrable","initdeferred","nargs","args_md5","old_table","new_table"])
        if(!eq(t[f],u[f]))out.push({object:obj,category:"triggers",path:`${p}.${f}`,code:"TRIGGER_CHANGED",detail:`${f}: ${canonicalJson(t[f])} -> ${canonicalJson(u[f])}`});
      exprFinding(t.when,u.when,obj,"triggers",`${p}.when`,out,"TRIGGER_CHANGED");
    });
    mapFindings(x.policies,y.policies,obj,"policies",{added:"POLICY_ADDED",removed:"POLICY_CHANGED",changed:"POLICY_CHANGED"},out,(q,w,p)=>{
      for(const f of ["cmd","permissive","roles"])
        if(!eq(q[f],w[f]))out.push({object:obj,category:"policies",path:`${p}.${f}`,code:"POLICY_CHANGED",detail:`${f}: ${canonicalJson(q[f])} -> ${canonicalJson(w[f])}`});
      exprFinding(q.using,w.using,obj,"policies",`${p}.using`,out,"POLICY_CHANGED");
      exprFinding(q.check,w.check,obj,"policies",`${p}.check`,out,"POLICY_CHANGED");
    });
    mapFindings(x.rules,y.rules,obj,"rules",{added:"RULE_CHANGED",removed:"RULE_CHANGED",changed:"RULE_CHANGED"},out);
  });
  mapFindings(a.functions,b.functions,"functions","function",{added:"FUNCTION_CHANGED",removed:"FUNCTION_CHANGED",changed:"FUNCTION_CHANGED"},out,(x,y,path)=>{
    const name=path.slice("functions.function.".length),obj=`functions.${name}`;
    if(x.owner!==y.owner)out.push({object:obj,category:"owner",path:`${obj}.owner`,code:"OWNER_CHANGED",detail:`${x.owner} -> ${y.owner}`});
    for(const f of ["kind","security_definer","config","language","volatility","strict","leakproof","parallel","returns","body_md5"])
      if(!eq(x[f],y[f]))out.push({object:obj,category:"attributes",path:`${obj}.${f}`,code:"FUNCTION_CHANGED",detail:`${f}: ${canonicalJson(x[f])} -> ${canonicalJson(y[f])}`});
    aclFindings(x.acl,y.acl,obj,"acl","ACL",out,".acl");
    for(const r of keys(x.execute,y.execute))for(const g of ["plain","grantable"]){
      const p=x.execute?.[r]?.[g],q=y.execute?.[r]?.[g];
      if(!p&&q)out.push({object:obj,category:"acl",path:`${obj}.execute.${r}.${g}`,code:"FUNCTION_EXECUTE_WIDENED",detail:`${r} gained EXECUTE (${g})`});
      else if(p&&!q)out.push({object:obj,category:"acl",path:`${obj}.execute.${r}.${g}`,code:"FUNCTION_EXECUTE_NARROWED",detail:`${r} lost EXECUTE (${g})`});
    }
  });
  return out;
}

export function compareProbes(a,b){
  const out=[];
  for(const id of keys(a,b)){
    const x=a?.[id],y=b?.[id];
    if(x===y)continue;
    const widened=x!==undefined&&y!==undefined&&!isOk(x)&&isOk(y);
    const code=widened?(id.startsWith("priv/")||id.startsWith("exec/")?"PROBE_WIDENED":"PROBE_WEAKENED"):"PROBE_OUTCOME_DIFFERS";
    out.push({object:"probes",category:"probes",path:`probe.${id}`,code,detail:`source=${x} restored=${y}`});
  }
  return out;
}

// ---------------------------------------------------------------- adjudication
const RAW_CATEGORY=[
  [/^\$\.relations\.(.+)\.(acl|acl_is_default)$/,m=>({object:`relations.${m[1]}`,category:"acl"})],
  [/^\$\.relations\.(.+)\.constraints$/,m=>({object:`relations.${m[1]}`,category:"constraints"})],
  [/^\$\.relations\.(.+)\.indexes$/,m=>({object:`relations.${m[1]}`,category:"indexes"})],
  [/^\$\.relations\.(.+)\.triggers$/,m=>({object:`relations.${m[1]}`,category:"triggers"})],
  [/^\$\.relations\.(.+)\.policies$/,m=>({object:`relations.${m[1]}`,category:"policies"})],
  [/^\$\.functions\.(.+)\.(acl|acl_is_default)$/,m=>({object:`functions.${m[1]}`,category:"acl"})]
];
/** A raw divergent path is "proven" only if an independent semantic comparison covered that exact object+category and found nothing. */
export function classifyRawPath(path,semA,semB,findings){
  for(const [re,mk] of RAW_CATEGORY){
    const m=re.exec(path);
    if(!m)continue;
    const {object,category}=mk(m);
    const [kind,...nameParts]=object.split(".");
    const name=nameParts.join(".");
    const covered=semA?.[kind]?.[name]!==undefined&&semB?.[kind]?.[name]!==undefined;
    if(!covered)return {path,proven:false,reason:"object absent from a semantic snapshot"};
    const blockers=findings.filter(f=>f.object===object&&f.category===category);
    return blockers.length?{path,proven:false,reason:`semantic findings: ${blockers.map(f=>f.code).join(",")}`}
      :{path,proven:true,reason:`independent ${category} comparison found no difference`};
  }
  return {path,proven:false,reason:"raw field has no independent semantic proof; it is itself a direct property"};
}

/**
 * Combine raw strict diff + semantic snapshots + behavior probes. Never GO, never managed recovery.
 * rawDiffPaths: output of diffPaths(raw source, raw restored) (empty = byte-identical raw catalog).
 */
export function adjudicateRecovery({rawDiffPaths,semanticSource,semanticRestored,probesSource,probesRestored,expectConstraints=true}){
  const findings=[];
  const haveSem=!!(semanticSource&&semanticRestored);
  if(haveSem)findings.push(...compareSemantic(semanticSource,semanticRestored));
  const haveProbes=!!(probesSource&&probesRestored);
  const probeExpectFailures=haveProbes?[
    ...evaluateProbeExpectations(probesSource,{expectConstraints}).map(x=>`source ${x}`),
    ...evaluateProbeExpectations(probesRestored,{expectConstraints}).map(x=>`restored ${x}`)]:[];
  if(haveProbes)findings.push(...compareProbes(probesSource,probesRestored));
  const rawIdentical=rawDiffPaths.length===0;
  const rawClass=rawDiffPaths.map(p=>classifyRawPath(p,semanticSource,semanticRestored,findings));
  const codes=new Set(findings.map(f=>f.code));
  const securityRegression=[...codes].some(c=>WIDEN.has(c)||WEAKEN.has(c));
  const unproven=rawClass.filter(r=>!r.proven);
  const nonPortable=codes.has("EXPR_NONPORTABLE_NEEDS_BEHAVIOR_PROOF");
  let verdict,label,requiresDba=true;
  if(!haveSem||!haveProbes){verdict="INCOMPLETE_EVIDENCE";label="INCOMPLETE_EVIDENCE"}
  else if(findings.length||probeExpectFailures.length){verdict="SEMANTIC_DIVERGENCE";label="SEMANTIC_DIVERGENCE"}
  else if(rawIdentical){verdict="EXACT_LOCAL_RAW_PARITY";label="EXACT_LOCAL_RAW_PARITY (disposable only; not managed recovery)";requiresDba=false}
  else if(unproven.length){verdict="RAW_DIVERGENCE_UNEXPLAINED";label="RAW_DIVERGENCE_UNEXPLAINED"}
  else{verdict="PROVISIONAL_SEMANTIC_PARITY";label=PROVISIONAL_LABEL}
  const exitCode={EXACT_LOCAL_RAW_PARITY:0,PROVISIONAL_SEMANTIC_PARITY:4,SEMANTIC_DIVERGENCE:3,RAW_DIVERGENCE_UNEXPLAINED:3,INCOMPLETE_EVIDENCE:3}[verdict];
  return {
    schema:ADJUDICATION_SCHEMA,verdict,label,exitCode,
    rawStatus:rawIdentical?"RAW_PARITY":"RAW_DIVERGENCE",
    rawDivergentPaths:rawClass,
    requiresDbaInterpretation:requiresDba,
    securityRegression,nonPortableExpressionTrees:nonPortable,
    semanticFindings:findings,probeExpectationFailures:probeExpectFailures,
    exactManagedRecovery:false,goEligible:false,
    managedRestoration:"BLOCKED: local disposable evidence only; no managed backup, PITR, AAL2, Ed25519 or human DBA/AppSec signoff is recorded by this tool",
    attestations:{aal2:"NOT_PROVIDED",pitr:"NOT_PROVIDED",ed25519:"NOT_PROVIDED",dba_signoff:"NOT_PROVIDED",appsec_signoff:"NOT_PROVIDED"},
    note:"candidate-semantic-parity-provisional is NOT exact recovery. The strict raw diff stays RAW_DIVERGENCE until a qualified DBA interprets it."
  };
}
