// VOX RC4 Track C: managed Staging recovery preflight + GO/HOLD evaluator.
// Pure functions only: this module NEVER opens a database connection, reads env/secrets, or writes files.
// It (1) emits deterministic READ-ONLY SQL for a human operator to run against the pinned Staging project,
// (2) emits the preflight packet/runbook, and (3) evaluates operator-captured JSON evidence.
// Local synthetic evidence can never produce managed restoration PASS. GO is structurally unreachable
// unless every managed-evidence check passes AND an injected verifier confirms human approvals.
// The CLI (rc4-recovery-evidence.mjs) injects NO verifier, so the CLI can never emit GO.
import {createHash} from "node:crypto";
import {AUTHORIZED_STAGING_REF,BROWSER_ROLES,PINNED_FINGERPRINT,PROHIBITED_REFS,canonicalJson,checkManifest,validateProjectIdentity} from "./ab7k-evidence-lib.mjs";
import {ADJUDICATION_SCHEMA,SEMANTIC_SCHEMA,adjudicateRecovery,classifyRawPath,compareSemantic,semanticCatalogSql} from "./ab7k-semantic-lib.mjs";

export const RC4_PIN_DIGEST="3ae02af58c07e256507532b866594486d2785e768fd4092a1b1aa8db572f8f60";
export const STAGING_PROJECT_REF=AUTHORIZED_STAGING_REF;
export const PACKET_SCHEMA="qf-vox-rc4-recovery-preflight-packet-v1";
export const EVIDENCE_SCHEMA="qf-vox-rc4-recovery-evidence-v1";
export const DECISION_SCHEMA="qf-vox-rc4-recovery-decision-v1";
export const REQUIRED_APPROVAL_ROLES=Object.freeze(["dba","appsec"]);
export const PROVISIONAL_DISPOSITION="accept-provisional-semantic-parity";
export const REQUIRED_FEATURE_GATES=Object.freeze(["CORE_CONVERSATION","OFFICIAL_EOD_PUBLICATION","SIGNED_JARVIS_OPERATOR_ACTIONS","PROVIDER_SENDS"]);
export const LOCAL_EVIDENCE_KINDS=Object.freeze(["local-synthetic","local-disposable","synthetic-fixture"]);
export const MANAGED_EVIDENCE_KIND="managed-staging-readonly";
const MAX_BACKUP_AGE_MS=48*3600e3;
const MAX_EVIDENCE_AGE_MS=72*3600e3;
const ACCEPTABLE_VERDICTS=Object.freeze(["EXACT_LOCAL_RAW_PARITY","PROVISIONAL_SEMANTIC_PARITY"]);

const sha256=x=>createHash("sha256").update(x).digest("hex");
const HEX64=/^[a-f0-9]{64}$/;
const isObj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const ms=s=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}T/.test(s)?Date.parse(s):NaN;
const ident=x=>{if(!/^[a-z_][a-z0-9_]*$/.test(x))throw new Error("UNSAFE_IDENTIFIER");return x};

/** Digest the approvals must bind to: the whole evidence document except approvals and self-claims. */
export const bindingDigest=ev=>sha256(canonicalJson({...ev,approvals:undefined,claims:undefined}));

// ---------------------------------------------------------------- deterministic read-only SQL
const frame=body=>`begin read only;
set local statement_timeout='30s';
set local lock_timeout='2s';
${body}
rollback;
`;
const GRANTEE=g=>`(case when ${g}=0 then 'PUBLIC' else pg_get_userbyid(${g}) end)`;
const EACL=(acl,typeExpr,owner)=>`(select coalesce(jsonb_agg(a.x order by a.x collate "C"),'[]'::jsonb) from (select ${GRANTEE("e.grantee")}||'|'||pg_get_userbyid(e.grantor)||'|'||e.privilege_type||'|'||e.is_grantable::text as x from aclexplode(coalesce(${acl},acldefault((${typeExpr})::"char",${owner}))) e) a)`;
const USER_NS=`n.nspname<>'information_schema' and left(n.nspname,3)<>'pg_'`;

export function projectPinSql(){
  return frame(`select jsonb_build_object('schema','qf-vox-rc4-project-pin-v1','database',current_database(),'server_version_num',current_setting('server_version_num'),'transaction_read_only',current_setting('transaction_read_only'),'in_recovery',pg_is_in_recovery())::text;`);
}
/** Ledger rows only: version, name and a digest of the stored statements. No statement text is emitted. */
export function schemaMigrationsSql(){
  return frame(`select jsonb_build_object('schema','qf-vox-rc4-ledger-v1',
 'count',(select count(*) from supabase_migrations.schema_migrations),
 'entries',(select coalesce(jsonb_agg(jsonb_build_object('version',m.version,'name',m.name,'statements_md5',md5(coalesce(to_jsonb(m)->>'statements',''))) order by m.version collate "C"),'[]'::jsonb) from supabase_migrations.schema_migrations m))::text;`);
}
export function extensionsSql(){
  return frame(`select jsonb_build_object('schema','qf-vox-rc4-extensions-v1',
 'extensions',(select coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner),'relocatable',e.extrelocatable) order by e.extname collate "C"),'[]'::jsonb) from pg_extension e join pg_namespace n on n.oid=e.extnamespace))::text;`);
}
/** Catalog-only inventory of a managed-platform schema (auth, storage). Never reads rows, so no identities or PII. */
export function schemaInventorySql(nsp){
  ident(nsp);
  return frame(`select jsonb_build_object('schema','qf-vox-rc4-schema-inventory-v1','namespace','${nsp}',
 'present',exists(select 1 from pg_namespace n where n.nspname='${nsp}'),
 'owner',(select pg_get_userbyid(n.nspowner) from pg_namespace n where n.nspname='${nsp}'),
 'acl',(select coalesce(jsonb_agg(a.x order by a.x collate "C"),'[]'::jsonb) from (select ${GRANTEE("e.grantee")}||'|'||pg_get_userbyid(e.grantor)||'|'||e.privilege_type||'|'||e.is_grantable::text as x from pg_namespace n, aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) e where n.nspname='${nsp}') a),
 'relations',(select coalesce(jsonb_object_agg(c.relname,jsonb_build_object('kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
   'acl',${EACL("c.relacl","case when c.relkind='S' then 's' else 'r' end","c.relowner")},
   'columns',(select coalesce(jsonb_agg(at.attname order by at.attnum),'[]'::jsonb) from pg_attribute at where at.attrelid=c.oid and at.attnum>0 and not at.attisdropped))),'{}'::jsonb)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='${nsp}' and c.relkind in ('r','p','v','m','f','S')),
 'functions',(select coalesce(jsonb_object_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'acl',${EACL("p.proacl","'f'","p.proowner")})),'{}'::jsonb)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='${nsp}' and p.prokind in ('f','p')))::text;`);
}
/** WAL archiving / size signals only. SQL cannot prove PITR; the recovery window comes from the platform export. archive_command is deliberately not read. */
export function physicalStorageSql(){
  return frame(`select jsonb_build_object('schema','qf-vox-rc4-physical-v1',
 'database_size_bytes',pg_database_size(current_database()),
 'in_recovery',pg_is_in_recovery(),
 'settings',(select coalesce(jsonb_object_agg(s.name,s.setting),'{}'::jsonb) from pg_settings s where s.name in ('wal_level','archive_mode','max_wal_senders','data_checksums','full_page_writes','block_size','wal_segment_size','server_version_num')),
 'archiver',(select to_jsonb(a)-'stats_reset' from pg_stat_archiver a),
 'replication_slots',(select coalesce(jsonb_agg(jsonb_build_object('slot_type',s.slot_type,'active',s.active,'plugin',s.plugin) order by s.slot_name collate "C"),'[]'::jsonb) from pg_replication_slots s))::text;`);
}
/** Catalog-level restore integrity signals. No row counts, so no live user data is aggregated. */
export function restoreIntegritySql(){
  const rel=`from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${USER_NS}`;
  return frame(`select jsonb_build_object('schema','qf-vox-rc4-integrity-v1',
 'relation_inventory_md5',(select md5(coalesce(string_agg(n.nspname||'.'||c.relname||':'||c.relkind::text||':'||pg_get_userbyid(c.relowner),',' order by n.nspname collate "C",c.relname collate "C"),'')) ${rel} and c.relkind in ('r','p','v','m','f','S','i')),
 'relation_counts',(select coalesce(jsonb_object_agg(x.k,x.v),'{}'::jsonb) from (select n.nspname||':'||c.relkind::text as k,count(*) as v ${rel} and c.relkind in ('r','p','v','m','f','S','i') group by 1) x),
 'invalid_indexes',(select coalesce(jsonb_agg(n.nspname||'.'||ic.relname order by n.nspname collate "C",ic.relname collate "C"),'[]'::jsonb) from pg_index i join pg_class ic on ic.oid=i.indexrelid join pg_namespace n on n.oid=ic.relnamespace where ${USER_NS} and not (i.indisvalid and i.indisready)),
 'unvalidated_constraints',(select coalesce(jsonb_agg(n.nspname||'.'||c.relname||'.'||k.conname order by n.nspname collate "C",c.relname collate "C",k.conname collate "C"),'[]'::jsonb) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where ${USER_NS} and not k.convalidated),
 'disabled_triggers',(select coalesce(jsonb_agg(n.nspname||'.'||c.relname||'.'||t.tgname order by n.nspname collate "C",c.relname collate "C",t.tgname collate "C"),'[]'::jsonb) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where ${USER_NS} and not t.tgisinternal and t.tgenabled='D'),
 'event_triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',et.evtname,'event',et.evtevent,'enabled',et.evtenabled::text,'owner',pg_get_userbyid(et.evtowner)) order by et.evtname collate "C"),'[]'::jsonb) from pg_event_trigger et),
 'public_tables_without_rls',(select coalesce(jsonb_agg(c.relname order by c.relname collate "C"),'[]'::jsonb) ${rel} and n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity),
 'browser_role_owned_relations',(select coalesce(jsonb_agg(n.nspname||'.'||c.relname order by n.nspname collate "C",c.relname collate "C"),'[]'::jsonb) ${rel} and pg_get_userbyid(c.relowner) in ('anon','authenticated','service_role')),
 'default_acl_md5',(select md5(coalesce(string_agg(pg_get_userbyid(d.defaclrole)||'|'||d.defaclnamespace::text||'|'||d.defaclobjtype::text||'|'||coalesce(d.defaclacl::text,''),',' order by pg_get_userbyid(d.defaclrole) collate "C",d.defaclnamespace,d.defaclobjtype),'')) from pg_default_acl d))::text;`);
}

/** name -> {purpose, build(root)}. Every builder is deterministic and read-only. */
export const SQL_CATALOG=Object.freeze({
  projectPin:{purpose:"database identity + read-only/recovery state (project ref is bound by the connection endpoint, not by SQL)",build:()=>projectPinSql()},
  schemaMigrations:{purpose:"supabase_migrations.schema_migrations semantic reconciliation input",build:()=>schemaMigrationsSql()},
  extensions:{purpose:"installed extension name/version/schema/owner",build:()=>extensionsSql()},
  authSchema:{purpose:"auth schema owner/ACL/relations/functions (catalog only)",build:()=>schemaInventorySql("auth")},
  storageSchema:{purpose:"storage schema owner/ACL/relations/functions (catalog only)",build:()=>schemaInventorySql("storage")},
  ownerAclSemantic:{purpose:"RC3 semantic owner/ACL/RLS/constraint/function snapshot (ab7k-semantic-lib)",build:root=>semanticCatalogSql(root)},
  physicalStorage:{purpose:"database size + WAL archiving signals (NOT PITR proof)",build:()=>physicalStorageSql()},
  restoreIntegrity:{purpose:"catalog-level restore integrity signals",build:()=>restoreIntegritySql()}
});

// ---------------------------------------------------------------- preflight packet + runbook
export const CHECKLIST=Object.freeze([
  {id:"PROJECT_PIN",evidence:"provenance.projectRef/host/user",must:`projectRef == ${AUTHORIZED_STAGING_REF}; host/user bound to that ref; Production and Jarvis refs absent`},
  {id:"SOURCE_PIN",evidence:"sourcePin.manifestDigest",must:`== ${RC4_PIN_DIGEST} (7 quarantined + 23 candidate files)`},
  {id:"BACKUP_PRESENT_FRESH",evidence:"backup.*",must:"present, project-matched, taken <=48h before capture, artifacts with sha256+bytes, no duplicate digests"},
  {id:"BACKUP_ACL_OWNER_ROLES",evidence:"backup.includesOwner/includesAcl/includesRoles",must:"all true (no --no-owner/--no-acl, role dump present)"},
  {id:"AUTH_SCHEMA",evidence:"backup.includesAuthSchema + authSchema.sourceDigest/restoredDigest",must:"included, and source/restored digests of schemaInventorySql('auth') equal"},
  {id:"EXTENSIONS",evidence:"backup.includesExtensions + extensions.source/restored",must:"inventories equal and include plpgsql"},
  {id:"PHYSICAL_STORAGE",evidence:"physicalStorage.*",must:"physical backup size, evidence sha256, restored cluster boot verified"},
  {id:"PITR",evidence:"pitr.*",must:"enabled, recovery target inside platform window, drill restored into an isolated project that is NOT Staging/Production/Jarvis"},
  {id:"MIGRATION_LEDGER",evidence:"ledger.*",must:"unique ascending 14-digit versions, no vox versions, human reconciliation reviewedCount == entries"},
  {id:"RESTORE_ADJUDICATION",evidence:"recovery.*",must:"source read-only; recomputed verdict EXACT or PROVISIONAL; RAW_DIVERGENCE preserved; PROVISIONAL needs independent DBA disposition"},
  {id:"MIGRATION_DRY_RUN_ROLLBACK",evidence:"migrationDryRun.*",must:"disposable restore only, 30 files, zero errors, rollback executed with zero errors and equal catalog digest"},
  {id:"FEATURE_GATES_OFF",evidence:"featureGates.*",must:`${REQUIRED_FEATURE_GATES.join(", ")} all false`},
  {id:"APPROVALS_DBA_APPSEC_HUMAN",evidence:"approvals[]",must:"two distinct human reviewers (dba, appsec), not the operator, bound to bindingDigest, signature verified by an injected verifier"}
]);

export const RUNBOOK=Object.freeze([
  {step:1,actor:"human-operator",mutates:"nothing",action:"Verify git tree digest equals the pin with `node scripts/mvp/vox/rc4-recovery-evidence.mjs packet`; stop on any pin drift."},
  {step:2,actor:"human-operator",mutates:"nothing",action:`Connect with a session-only read-only credential to host db.${AUTHORIZED_STAGING_REF}.supabase.co (or its pooler with user suffix .${AUTHORIZED_STAGING_REF}). Abort if the dashboard ref differs. Production and Jarvis refs are different projects.`},
  {step:3,actor:"human-operator",mutates:"nothing",action:"Run each SQL from `sql <name>` (projectPin, schemaMigrations, extensions, authSchema, storageSchema, ownerAclSemantic, physicalStorage, restoreIntegrity). Each is `begin read only` ... `rollback`. Save JSON outputs with sha256."},
  {step:4,actor:"human-operator",mutates:"nothing",action:"Export platform backup + PITR window evidence from the Supabase dashboard/management console by hand. Record artifact names, sha256 and bytes. Do not claim PITR from SQL."},
  {step:5,actor:"human-operator",mutates:"disposable-only",action:"Restore the managed backup into a NEW isolated Postgres (disposable container or throwaway project that is not Staging/Production/Jarvis). Never restore over Staging."},
  {step:6,actor:"human-operator",mutates:"nothing",action:"Re-run the same SQL set on the restored copy; compare with the RC3 comparator inputs (rawDiffPaths, semanticSource, semanticRestored). Preserve the raw diff verbatim."},
  {step:7,actor:"human-operator",mutates:"disposable-only",action:"Migration dry run: on the disposable restore apply the 30 pinned files in order, stop on first error, record errors. Record catalog digest before and after."},
  {step:8,actor:"human-operator",mutates:"disposable-only",action:"Rollback drill: return the disposable restore to the pre-migration state (re-restore from snapshot; no down-migration is approved). Record errors and the post-rollback catalog digest."},
  {step:9,actor:"independent-human-dba+appsec",mutates:"nothing",action:"Each reviewer independently reviews the assembled evidence, then signs the output of `binding --in evidence.json`. AI review is not signoff."},
  {step:10,actor:"human-operator",mutates:"nothing",action:"Run `evaluate --in evidence.json`. The CLI cannot emit GO. Any GO needs a separately reviewed verifier for the Ed25519 contract and a human release decision."}
]);

export function buildPreflightPacket(root){
  let pin;
  try{
    const m=checkManifest(root);
    pin={ok:m.ok,reasons:m.reasons,liveManifestDigest:m.manifestDigest??null,matchesRc4Pin:m.manifestDigest===RC4_PIN_DIGEST,quarantined:m.quarantined??null,candidates:m.candidates??null};
  }catch(e){pin={ok:false,reasons:[`MANIFEST_UNREADABLE:${e.message}`],liveManifestDigest:null,matchesRc4Pin:false}}
  const sql={};
  for(const name of Object.keys(SQL_CATALOG).sort()){
    const text=SQL_CATALOG[name].build(root);
    sql[name]={purpose:SQL_CATALOG[name].purpose,sha256:sha256(text),bytes:Buffer.byteLength(text)};
  }
  return {
    schema:PACKET_SCHEMA,
    status:"HOLD",executed:false,goEligible:false,managedRestoration:"BLOCKED",
    pin:{expectedDigest:RC4_PIN_DIGEST,fingerprintFile:PINNED_FINGERPRINT,...pin},
    project:{stagingRef:STAGING_PROJECT_REF,prohibitedRefs:[...PROHIBITED_REFS],note:"Staging is not Production; Production and Jarvis refs must never appear in evidence."},
    sql,checklist:CHECKLIST,runbook:RUNBOOK,
    preserved:{rawStatus:"RAW_DIVERGENCE",localVerdict:"PROVISIONAL_SEMANTIC_PARITY",requiresIndependentDbaReview:true,
      note:"Local PROVISIONAL_SEMANTIC_PARITY keeps RAW_DIVERGENCE (two ACL paths on vox_ab7j_staff_suspend_intents_candidate_v1). It is not exact recovery and not managed Staging restore certification."},
    attestations:{aal2:"NOT_PROVIDED",pitr:"NOT_PROVIDED",ed25519:"NOT_PROVIDED",dba_signoff:"NOT_PROVIDED",appsec_signoff:"NOT_PROVIDED"}
  };
}

// ---------------------------------------------------------------- GO/HOLD evaluator
/** true -> PASS, false -> FAIL (contradicts requirement), undefined/other -> HOLD (absent). */
const tri=v=>v===true?"PASS":v===false?"FAIL":"HOLD";

function checkProvenance(ev,now,add){
  const p=isObj(ev.provenance)?ev.provenance:null;
  if(!p){add("PROVENANCE_MANAGED_STAGING","HOLD","PROVENANCE_ABSENT");return}
  if(p.kind===MANAGED_EVIDENCE_KIND)add("PROVENANCE_MANAGED_STAGING","PASS","declared managed Staging read-only capture");
  else if(LOCAL_EVIDENCE_KINDS.includes(p.kind))add("PROVENANCE_MANAGED_STAGING","HOLD","LOCAL_SYNTHETIC_EVIDENCE_CANNOT_CERTIFY_MANAGED_RESTORATION");
  else add("PROVENANCE_MANAGED_STAGING","FAIL",`unknown provenance kind ${JSON.stringify(p.kind)}`);
  add("CAPTURE_READ_ONLY",tri(p.readOnly),`provenance.readOnly=${p.readOnly}`);
  if(!p.projectRef)add("PROJECT_PIN","HOLD","PROJECT_REF_ABSENT");
  else{
    const v=validateProjectIdentity({projectRef:p.projectRef,host:p.host,user:p.user});
    add("PROJECT_PIN",v.ok?"PASS":"FAIL",v.ok?`bound to ${STAGING_PROJECT_REF}`:v.findings.join(","));
  }
  const at=ms(p.capturedAt);
  if(!Number.isFinite(at))add("EVIDENCE_FRESH","HOLD","capturedAt absent or not ISO-8601");
  else add("EVIDENCE_FRESH",at<=now&&now-at<=MAX_EVIDENCE_AGE_MS?"PASS":"FAIL",at>now?"capturedAt is in the future":now-at>MAX_EVIDENCE_AGE_MS?"evidence older than 72h":"within 72h");
}

function checkPin(ev,root,add){
  const d=ev.sourcePin?.manifestDigest;
  if(d===undefined)add("SOURCE_PIN_7_PLUS_23","HOLD","sourcePin.manifestDigest absent");
  else add("SOURCE_PIN_7_PLUS_23",d===RC4_PIN_DIGEST?"PASS":"FAIL",d===RC4_PIN_DIGEST?"matches RC4 pin":"digest differs from RC4 pin");
  if(root){
    let m;try{m=checkManifest(root)}catch(e){m={ok:false,reasons:[e.message]}}
    add("LIVE_TREE_MATCHES_PIN",m.ok&&m.manifestDigest===RC4_PIN_DIGEST?"PASS":"FAIL",m.ok?m.manifestDigest:m.reasons.join(","));
  }
}

function checkBackup(ev,add){
  const b=ev.backup;
  if(!isObj(b)||b.present!==true){add("BACKUP_PRESENT_FRESH","HOLD","MANAGED_BACKUP_ABSENT");}
  else{
    const bad=[];
    if(b.projectRef!==STAGING_PROJECT_REF)bad.push("project_ref");
    const taken=ms(b.takenAt),cap=ms(ev.provenance?.capturedAt);
    if(!Number.isFinite(taken))bad.push("taken_at");
    else if(Number.isFinite(cap)){if(taken>cap)bad.push("taken_after_capture");else if(cap-taken>MAX_BACKUP_AGE_MS)bad.push("stale_backup")}
    const arts=Array.isArray(b.artifacts)?b.artifacts:[];
    if(arts.length===0||!arts.every(a=>isObj(a)&&typeof a.name==="string"&&a.name&&HEX64.test(a.sha256)&&Number.isInteger(a.bytes)&&a.bytes>0))bad.push("artifact_name_sha256_bytes");
    else if(new Set(arts.map(a=>a.sha256)).size!==arts.length)bad.push("duplicate_artifact_digest");
    add("BACKUP_PRESENT_FRESH",bad.length?"FAIL":"PASS",bad.length?bad.join(","):`${arts.length} artifact(s)`);
  }
  const bb=isObj(b)?b:{};
  for(const [id,key] of [["BACKUP_OWNER_PRESERVED","includesOwner"],["BACKUP_ACL_PRESERVED","includesAcl"],["BACKUP_ROLES_DUMPED","includesRoles"]])
    add(id,tri(bb[key]),`backup.${key}=${bb[key]}`);
}

function checkAuthAndExtensions(ev,add){
  const b=isObj(ev.backup)?ev.backup:{};
  const a=ev.authSchema;
  let s=tri(b.includesAuthSchema),d=`backup.includesAuthSchema=${b.includesAuthSchema}`;
  if(s==="PASS"){
    if(!isObj(a)||!a.sourceDigest||!a.restoredDigest){s="HOLD";d="auth schema digests absent"}
    else if(!HEX64.test(a.sourceDigest)||!HEX64.test(a.restoredDigest)||a.sourceDigest!==a.restoredDigest){s="FAIL";d="auth schema source/restored digest invalid or different"}
    else d="auth schema inventory digests equal";
  }
  add("AUTH_SCHEMA_RESTORED",s,d);
  const x=ev.extensions;
  s=tri(b.includesExtensions);d=`backup.includesExtensions=${b.includesExtensions}`;
  if(s==="PASS"){
    const ok=l=>Array.isArray(l)&&l.length>0&&l.every(e=>isObj(e)&&e.name&&e.version&&e.schema);
    if(!isObj(x)||!x.source||!x.restored){s="HOLD";d="extension inventories absent"}
    else if(!ok(x.source)||!ok(x.restored)){s="FAIL";d="extension inventory malformed or empty"}
    else if(!x.source.some(e=>e.name==="plpgsql")){s="FAIL";d="plpgsql missing from inventory"}
    else if(canonicalJson([...x.source].sort((p,q)=>p.name<q.name?-1:1))!==canonicalJson([...x.restored].sort((p,q)=>p.name<q.name?-1:1))){s="FAIL";d="extension inventories differ"}
    else d=`${x.source.length} extensions equal`;
  }
  add("EXTENSIONS_RESTORED",s,d);
}

function checkPhysicalAndPitr(ev,add){
  const ph=ev.physicalStorage;
  if(!isObj(ph))add("PHYSICAL_STORAGE_EVIDENCE","HOLD","PHYSICAL_STORAGE_EVIDENCE_ABSENT");
  else{
    const bad=[];
    if(ph.kind!=="physical")bad.push("kind_not_physical");
    if(!Number.isInteger(ph.sizeBytes)||ph.sizeBytes<=0)bad.push("size_bytes");
    if(!HEX64.test(ph.evidenceSha256))bad.push("evidence_sha256");
    if(ph.restoredBootVerified!==true)bad.push("restored_boot_not_verified");
    add("PHYSICAL_STORAGE_EVIDENCE",bad.length?"FAIL":"PASS",bad.length?bad.join(","):"physical evidence structurally complete");
  }
  const p=ev.pitr;
  if(!isObj(p))add("PITR_EVIDENCE","HOLD","PITR_EVIDENCE_ABSENT");
  else{
    const bad=[];
    if(p.enabled!==true)bad.push("pitr_not_enabled");
    const lo=ms(p.earliestRecoveryPoint),hi=ms(p.latestRecoveryPoint),t=ms(p.recoveryTargetTime),done=ms(p.drillCompletedAt);
    if(![lo,hi,t,done].every(Number.isFinite))bad.push("timestamps");
    else{
      if(!(lo<=t&&t<=hi))bad.push("target_outside_window");
      if(done<t)bad.push("drill_before_target");
    }
    if(typeof p.drillProjectRef!=="string"||!p.drillProjectRef)bad.push("drill_project_absent");
    else if(p.drillProjectRef===STAGING_PROJECT_REF||PROHIBITED_REFS.includes(p.drillProjectRef))bad.push("drill_not_isolated");
    if(!HEX64.test(p.evidenceSha256))bad.push("evidence_sha256");
    add("PITR_EVIDENCE",bad.length?"FAIL":"PASS",bad.length?bad.join(","):"window, target and isolated drill structurally consistent");
  }
}

function checkLedger(ev,add){
  const l=ev.ledger;
  if(!isObj(l)||!Array.isArray(l.entries)||l.entries.length===0){add("MIGRATION_LEDGER_RECONCILED","HOLD","LEDGER_ABSENT");return}
  const bad=[];
  const versions=l.entries.map(e=>e?.version);
  if(!versions.every(v=>typeof v==="string"&&/^\d{14}$/.test(v)))bad.push("version_format");
  else{
    if(new Set(versions).size!==versions.length)bad.push("duplicate_versions");
    if(versions.some((v,i)=>i>0&&versions[i-1]>=v))bad.push("not_ascending");
  }
  if(l.entries.some(e=>/vox/i.test(String(e?.name??""))))bad.push("vox_migration_already_in_ledger");
  if(l.count!==undefined&&l.count!==l.entries.length)bad.push("count_mismatch");
  const r=l.reconciliation;
  if(bad.length){add("MIGRATION_LEDGER_RECONCILED","FAIL",bad.join(","));return}
  if(!isObj(r)){add("MIGRATION_LEDGER_RECONCILED","HOLD","SEMANTIC_RECONCILIATION_ABSENT");return}
  if(r.reviewerKind!=="human"||!r.reviewerId||r.unresolvedAliases!==0||r.reviewedCount!==l.entries.length)
    add("MIGRATION_LEDGER_RECONCILED","FAIL","reconciliation must be human, reviewedCount==entries, unresolvedAliases==0");
  else add("MIGRATION_LEDGER_RECONCILED","PASS",`${l.entries.length} entries reconciled by ${r.reviewerId}`);
}

/** Recomputes the verdict from raw inputs instead of trusting any claimed adjudication. */
function recomputeAdjudication(rec){
  const a=rec.semanticSource,b=rec.semanticRestored;
  if(rec.probesSource&&rec.probesRestored)
    return adjudicateRecovery({rawDiffPaths:rec.rawDiffPaths,semanticSource:a,semanticRestored:b,probesSource:rec.probesSource,probesRestored:rec.probesRestored,expectConstraints:rec.expectConstraints!==false});
  const findings=compareSemantic(a,b);
  const rawClass=rec.rawDiffPaths.map(p=>classifyRawPath(p,a,b,findings));
  const rawIdentical=rec.rawDiffPaths.length===0;
  let verdict;
  if(findings.length)verdict="SEMANTIC_DIVERGENCE";
  else if(rawIdentical)verdict="EXACT_LOCAL_RAW_PARITY";
  else if(rawClass.some(r=>!r.proven))verdict="RAW_DIVERGENCE_UNEXPLAINED";
  else verdict="PROVISIONAL_SEMANTIC_PARITY";
  return {schema:ADJUDICATION_SCHEMA,verdict,rawStatus:rawIdentical?"RAW_PARITY":"RAW_DIVERGENCE",rawDivergentPaths:rawClass,
    requiresDbaInterpretation:verdict!=="EXACT_LOCAL_RAW_PARITY",semanticFindings:findings,probeExpectationFailures:[],probesCompared:false};
}

function checkAdjudication(ev,dbaDisposition,add){
  const rec=ev.recovery;
  if(!isObj(rec)||!rec.semanticSource||!rec.semanticRestored){add("RESTORE_ADJUDICATION","HOLD","RESTORE_COMPARISON_INPUTS_ABSENT");return null}
  if(!Array.isArray(rec.rawDiffPaths)||!rec.rawDiffPaths.every(p=>typeof p==="string")){add("RESTORE_ADJUDICATION","FAIL","rawDiffPaths must be an array of strings");return null}
  if(rec.semanticSource.schema!==SEMANTIC_SCHEMA||rec.semanticRestored.schema!==SEMANTIC_SCHEMA){add("RESTORE_ADJUDICATION","FAIL","semantic snapshot schema invalid");return null}
  if(rec.semanticSource.identity?.transaction_read_only!=="on"){add("RESTORE_ADJUDICATION","FAIL","source snapshot was not captured in a read-only transaction");return null}
  const rels=Object.keys(rec.semanticSource.relations??{});
  if(rels.length===0){add("RESTORE_ADJUDICATION","HOLD","source snapshot has no relations");return null}
  const owned=[];
  for(const [label,snap] of [["source",rec.semanticSource],["restored",rec.semanticRestored]]){
    for(const [n,r] of Object.entries(snap.relations??{}))if(BROWSER_ROLES.includes(r?.owner))owned.push(`${label}:${n}`);
    for(const [n,f] of Object.entries(snap.functions??{}))if(BROWSER_ROLES.includes(f?.owner))owned.push(`${label}:${n}`);
  }
  if(owned.length){add("OWNERSHIP_NOT_BROWSER_ROLES","FAIL",owned.slice(0,10).join(","));}
  else add("OWNERSHIP_NOT_BROWSER_ROLES","PASS","no relation/function owned by anon, authenticated or service_role");
  let adj;
  try{adj=recomputeAdjudication(rec)}catch(e){add("RESTORE_ADJUDICATION","FAIL",`comparison threw ${e.message}`);return null}
  if(isObj(ev.adjudication)){
    const c=ev.adjudication;
    const lie=c.verdict!==adj.verdict||c.rawStatus!==adj.rawStatus||c.exactManagedRecovery===true||c.goEligible===true||c.managedRestoration==="PASS";
    add("ADJUDICATION_CLAIM_MATCHES_RECOMPUTE",lie?"FAIL":"PASS",lie?`claimed ${c.verdict}/${c.rawStatus}, recomputed ${adj.verdict}/${adj.rawStatus}`:"claim equals recomputation");
  }
  const v=adj.verdict;
  if(v==="EXACT_LOCAL_RAW_PARITY")add("RESTORE_ADJUDICATION","PASS","raw and semantic parity on the restored copy (still needs human approvals)");
  else if(v==="PROVISIONAL_SEMANTIC_PARITY")
    add("RESTORE_ADJUDICATION",dbaDisposition===PROVISIONAL_DISPOSITION?"PASS":"HOLD",
      dbaDisposition===PROVISIONAL_DISPOSITION?"RAW_DIVERGENCE preserved; independent DBA disposition verified":"RAW_DIVERGENCE preserved; PROVISIONAL_SEMANTIC_PARITY needs independent DBA review");
  else if(v==="INCOMPLETE_EVIDENCE")add("RESTORE_ADJUDICATION","HOLD","INCOMPLETE_EVIDENCE");
  else add("RESTORE_ADJUDICATION","FAIL",v);
  return adj;
}

function checkDryRun(ev,dbaDisposition,add){
  const d=ev.migrationDryRun;
  if(!isObj(d)){add("MIGRATION_DRY_RUN","HOLD","DRY_RUN_ABSENT");add("ROLLBACK_DRILL","HOLD","ROLLBACK_ABSENT");return}
  const bad=[];
  if(d.target!=="disposable-restore")bad.push("target_must_be_disposable_restore");
  if(d.manifestDigest!==RC4_PIN_DIGEST)bad.push("manifest_digest");
  if(d.filesApplied!==30)bad.push("files_applied_not_30");
  if(!Array.isArray(d.errors))bad.push("errors_not_array");
  else if(d.errors.length)bad.push(`${d.errors.length}_apply_error(s)`);
  if(!ACCEPTABLE_VERDICTS.includes(d.adjudicationVerdict))bad.push("post_install_verdict");
  else if(d.adjudicationVerdict==="PROVISIONAL_SEMANTIC_PARITY"&&dbaDisposition!==PROVISIONAL_DISPOSITION)bad.push("provisional_needs_dba");
  add("MIGRATION_DRY_RUN",bad.length?(bad.every(x=>x==="provisional_needs_dba")?"HOLD":"FAIL"):"PASS",bad.length?bad.join(","):"30 files applied to a disposable restore without errors");
  const r=d.rollback;
  if(!isObj(r)||r.planReviewed!==true||r.executed!==true){add("ROLLBACK_DRILL","HOLD","rollback plan not reviewed or drill not executed");return}
  const rb=[];
  if(!Array.isArray(r.errors))rb.push("errors_not_array");
  else if(r.errors.length)rb.push(`${r.errors.length}_rollback_error(s)`);
  if(!HEX64.test(r.preCatalogDigest)||!HEX64.test(r.postCatalogDigest))rb.push("catalog_digests");
  else if(r.preCatalogDigest!==r.postCatalogDigest)rb.push("post_rollback_catalog_differs");
  add("ROLLBACK_DRILL",rb.length?"FAIL":"PASS",rb.length?rb.join(","):"rollback drill clean and catalog restored");
}

function checkGates(ev,add){
  const g=ev.featureGates;
  if(!isObj(g)){add("FEATURE_GATES_HARD_OFF","HOLD","featureGates absent");return}
  const missing=REQUIRED_FEATURE_GATES.filter(k=>!(k in g));
  const on=Object.entries(g).filter(([,v])=>!(v===false||v==="off")).map(([k])=>k);
  if(on.length)add("FEATURE_GATES_HARD_OFF","FAIL",`not off: ${on.join(",")}`);
  else if(missing.length)add("FEATURE_GATES_HARD_OFF","HOLD",`missing: ${missing.join(",")}`);
  else add("FEATURE_GATES_HARD_OFF","PASS","all required gates off");
}

function checkApprovals(ev,binding,now,verify,add){
  const out={dba:null};
  const list=ev.approvals;
  if(!Array.isArray(list)||list.length===0){add("APPROVALS_DBA_APPSEC_HUMAN","HOLD","NO_APPROVALS_PROVIDED");return out}
  const cap=ms(ev.provenance?.capturedAt);
  const operators=new Set([ev.provenance?.capturedBy,ev.backup?.takenBy].filter(Boolean));
  const bad=[],seen=new Map();
  list.forEach((a,i)=>{
    const t=`#${i}`;
    if(!isObj(a)){bad.push(`${t}:not_object`);return}
    if(!REQUIRED_APPROVAL_ROLES.includes(a.role)){bad.push(`${t}:unknown_role`);return}
    const k=`${t}:${a.role}`;
    if(a.kind!=="human")bad.push(`${k}:approver_not_human`);
    if(typeof a.reviewerId!=="string"||!a.reviewerId)bad.push(`${k}:reviewer_id`);
    if(a.bindsTo!==binding)bad.push(`${k}:binding_mismatch`);
    if(typeof a.signature!=="string"||!a.signature)bad.push(`${k}:signature_absent`);
    if(typeof a.disposition!=="string"||!a.disposition)bad.push(`${k}:disposition_absent`);
    const at=ms(a.reviewedAt);
    if(!(at<=now)||(Number.isFinite(cap)&&!(at>=cap)))bad.push(`${k}:reviewed_at`);
    if(operators.has(a.reviewerId))bad.push(`${k}:self_approval`);
    if(seen.has(a.role))bad.push(`${k}:duplicate_role`);
    seen.set(a.role,a);
  });
  const ids=[...seen.values()].map(a=>a.reviewerId);
  if(new Set(ids).size!==ids.length)bad.push("same_reviewer_for_multiple_roles");
  if(bad.length){add("APPROVALS_DBA_APPSEC_HUMAN","FAIL",bad.join(","));return out}
  const missing=REQUIRED_APPROVAL_ROLES.filter(r=>!seen.has(r));
  if(missing.length){add("APPROVALS_DBA_APPSEC_HUMAN","HOLD",`missing roles: ${missing.join(",")}`);return out}
  if(typeof verify!=="function"){add("APPROVALS_DBA_APPSEC_HUMAN","HOLD","APPROVAL_SIGNATURE_UNVERIFIABLE: no verifier injected; structure only");return out}
  for(const a of seen.values()){
    let ok=false;
    try{ok=verify(a,binding)===true}catch{ok=false}
    if(!ok)bad.push(`${a.role}:signature_rejected`);
  }
  if(bad.length){add("APPROVALS_DBA_APPSEC_HUMAN","FAIL",bad.join(","));return out}
  out.dba=seen.get("dba").disposition;
  add("APPROVALS_DBA_APPSEC_HUMAN","PASS","two distinct human approvals verified and bound to the evidence");
  return out;
}

function claimsManagedPass(ev){
  const c=isObj(ev.claims)?ev.claims:{};
  return [ev.managedRestoration,c.managedRestoration].includes("PASS")||ev.restoreVerified===true||c.restoreVerified===true||c.decision==="GO";
}

/**
 * Evaluate operator-captured evidence. opts: {now (ms), root (verifies live tree vs pin), verifyApproval(approval,binding)->boolean}.
 * Without opts.verifyApproval a GO is impossible. Local/synthetic provenance can never reach GO.
 */
export function evaluateRecoveryEvidence(ev,opts={}){
  const now=Number.isFinite(opts.now)?opts.now:Date.now();
  const checks=[];
  const add=(id,status,detail)=>checks.push({id,status,detail});
  if(!isObj(ev)||ev.schema!==EVIDENCE_SCHEMA){
    add("EVIDENCE_SCHEMA","FAIL",`evidence must be an object with schema ${EVIDENCE_SCHEMA}`);
    return finish(checks,{binding:null,adjudication:null,dba:null});
  }
  const binding=bindingDigest(ev);
  checkProvenance(ev,now,add);
  checkPin(ev,opts.root,add);
  checkBackup(ev,add);
  checkAuthAndExtensions(ev,add);
  checkPhysicalAndPitr(ev,add);
  checkLedger(ev,add);
  const ap=checkApprovals(ev,binding,now,opts.verifyApproval,add);
  const adjudication=checkAdjudication(ev,ap.dba,add);
  checkDryRun(ev,ap.dba,add);
  checkGates(ev,add);
  if(claimsManagedPass(ev)){
    const wouldGo=checks.every(c=>c.status==="PASS"||c.status==="INFO");
    add("SELF_CLAIM_MATCHES_EVALUATION",wouldGo?"PASS":"FAIL",wouldGo?"claim consistent":"evidence claims managed restoration PASS/GO but the evaluator does not agree; treat as falsified");
  }
  return finish(checks,{binding,adjudication,dba:ap.dba});
}

function finish(checks,{binding,adjudication,dba}){
  const blockers=checks.filter(c=>c.status!=="PASS"&&c.status!=="INFO").map(c=>c.id);
  const decision=blockers.length===0?"GO":"HOLD";
  const rejected=checks.some(c=>c.status==="FAIL");
  return {
    schema:DECISION_SCHEMA,decision,rejected,
    managedRestoration:decision==="GO"?"PASS":"BLOCKED",
    localSyntheticEvidenceCanPass:false,
    pin:RC4_PIN_DIGEST,projectRef:STAGING_PROJECT_REF,bindingDigest:binding,
    rawStatus:adjudication?.rawStatus??"UNKNOWN",
    adjudicationVerdict:adjudication?.verdict??"UNKNOWN",
    rawDivergentPaths:adjudication?.rawDivergentPaths??[],
    independentDbaReview:dba===PROVISIONAL_DISPOSITION||(adjudication?.verdict==="EXACT_LOCAL_RAW_PARITY"&&dba)?"VERIFIED":"REQUIRED",
    checks,blockers,
    exitCode:decision==="GO"?0:rejected?3:4
  };
}
