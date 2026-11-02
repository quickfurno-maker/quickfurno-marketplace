import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";import {fileURLToPath} from "node:url";
import {checkManifest} from "./ab7k-evidence-lib.mjs";
import {SEMANTIC_SCHEMA} from "./ab7k-semantic-lib.mjs";
import {
  CHECKLIST,EVIDENCE_SCHEMA,PROVISIONAL_DISPOSITION,RC4_PIN_DIGEST,REQUIRED_FEATURE_GATES,RUNBOOK,SQL_CATALOG,STAGING_PROJECT_REF,
  bindingDigest,buildPreflightPacket,evaluateRecoveryEvidence,physicalStorageSql,projectPinSql,restoreIntegritySql,
  schemaInventorySql,schemaMigrationsSql,extensionsSql
} from "./rc4-recovery-lib.mjs";
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,"../../..");
const read=p=>readFileSync(resolve(here,p),"utf8");
const DOC="docs/vox/VOX-RC4-TRACK-C-RECOVERY-ADJUDICATION-20261030.md";

// ------------------------------------------------------------------ TEST-ONLY synthetic fixtures (not evidence)
const NOW=Date.parse("2026-10-30T12:00:00Z");
const H=c=>c.repeat(64);
const PRIVS=["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER"];
const OWNER_ACL=PRIVS.map(p=>`postgres|postgres|${p}|true`);
const none={plain:[],grantable:[]};
const T="communication_preferences";
const ACL_PATHS=[`$.relations.${T}.acl`,`$.relations.${T}.acl_is_default`];
const sem=()=>({schema:SEMANTIC_SCHEMA,identity:{database:"postgres",transaction_read_only:"on"},roles:{},memberships:[],
  schemas:{public:{owner:"postgres",acl:["postgres|postgres|USAGE|true"],usage:{anon:true,authenticated:true,service_role:true},create:{anon:false,authenticated:false,service_role:false}}},
  default_acls:[],
  relations:{[T]:{kind:"r",owner:"postgres",persistence:"p",options:"",is_partition:false,rls:true,force_rls:true,acl:OWNER_ACL,
    priv:{anon:none,authenticated:none,service_role:none},columns:{},constraints:{},indexes:{},triggers:{},policies:{},rules:{},definition_text:null}},
  functions:{}});
const ext=()=>[{name:"plpgsql",version:"1.0",schema:"pg_catalog"},{name:"pgcrypto",version:"1.3",schema:"extensions"}];
function base(){
  return {
    schema:EVIDENCE_SCHEMA,
    provenance:{kind:"managed-staging-readonly",projectRef:STAGING_PROJECT_REF,host:`db.${STAGING_PROJECT_REF}.supabase.co`,user:"postgres",readOnly:true,capturedAt:"2026-10-30T10:00:00Z",capturedBy:"operator-a"},
    sourcePin:{manifestDigest:RC4_PIN_DIGEST},
    backup:{present:true,projectRef:STAGING_PROJECT_REF,takenAt:"2026-10-30T06:00:00Z",includesOwner:true,includesAcl:true,includesRoles:true,includesAuthSchema:true,includesExtensions:true,
      artifacts:[{name:"db.dump",sha256:H("a"),bytes:1000},{name:"roles.sql",sha256:H("b"),bytes:200}]},
    authSchema:{sourceDigest:H("c"),restoredDigest:H("c")},
    extensions:{source:ext(),restored:ext()},
    physicalStorage:{kind:"physical",sizeBytes:5000000,evidenceSha256:H("d"),restoredBootVerified:true},
    pitr:{enabled:true,earliestRecoveryPoint:"2026-10-23T00:00:00Z",latestRecoveryPoint:"2026-10-30T09:59:00Z",recoveryTargetTime:"2026-10-30T08:00:00Z",
      drillProjectRef:"isolateddrillproject",drillCompletedAt:"2026-10-30T11:00:00Z",evidenceSha256:H("e")},
    ledger:{count:2,entries:[{version:"20261013144800",name:"core_base",statementsMd5:H("1")},{version:"20261013144901",name:"core_more",statementsMd5:H("2")}],
      reconciliation:{reviewerKind:"human",reviewerId:"ledger-reviewer",reviewedAt:"2026-10-30T09:00:00Z",unresolvedAliases:0,reviewedCount:2}},
    recovery:{rawDiffPaths:[],semanticSource:sem(),semanticRestored:sem()},
    migrationDryRun:{target:"disposable-restore",manifestDigest:RC4_PIN_DIGEST,filesApplied:30,errors:[],adjudicationVerdict:"EXACT_LOCAL_RAW_PARITY",
      rollback:{planReviewed:true,executed:true,errors:[],preCatalogDigest:H("f"),postCatalogDigest:H("f")}},
    featureGates:Object.fromEntries(REQUIRED_FEATURE_GATES.map(k=>[k,false]))
  };
}
const approval=(role,id,binding,over={})=>({role,kind:"human",reviewerId:id,reviewedAt:"2026-10-30T11:30:00Z",bindsTo:binding,disposition:"accept-recovery-evidence",signature:`sig-${role}`,...over});
/** Adds approvals bound to the CURRENT evidence. Mutating the evidence afterwards invalidates them. */
function signed(e,{dba={},appsec={}}={}){
  const b=bindingDigest(e);
  return {...e,approvals:[approval("dba","dba-1",b,dba),approval("appsec","appsec-1",b,appsec)]};
}
const yes=()=>true;
const ev=(e,o={})=>evaluateRecoveryEvidence(e,{now:NOW,...o});
const st=(r,id)=>r.checks.find(c=>c.id===id)?.status;
const clone=x=>JSON.parse(JSON.stringify(x));

// ------------------------------------------------------------------ pin + packet
test("RC4 pin constant equals the committed 7+23 fingerprint and the exact required digest",()=>{
  assert.equal(RC4_PIN_DIGEST,"3ae02af58c07e256507532b866594486d2785e768fd4092a1b1aa8db572f8f60");
  const pinned=JSON.parse(readFileSync(resolve(root,"docs/vox/VOX-AB7K-REVIEWED-SOURCE-FINGERPRINT.json"),"utf8"));
  assert.equal(pinned.manifestDigest,RC4_PIN_DIGEST);
  assert.equal(pinned.quarantinedFoundationCount,7);assert.equal(pinned.uninstalledCandidateCount,23);
  assert.equal(STAGING_PROJECT_REF,"uckafzuochmbvtiodmcl");
});
test("preflight packet is deterministic, HOLD, unexecuted, and preserves RAW_DIVERGENCE / PROVISIONAL_SEMANTIC_PARITY / DBA review",()=>{
  const a=buildPreflightPacket(root),b=buildPreflightPacket(root);
  assert.deepEqual(a,b);
  assert.equal(a.status,"HOLD");assert.equal(a.executed,false);assert.equal(a.goEligible,false);assert.equal(a.managedRestoration,"BLOCKED");
  assert.equal(a.pin.expectedDigest,RC4_PIN_DIGEST);
  assert.equal(a.preserved.rawStatus,"RAW_DIVERGENCE");assert.equal(a.preserved.localVerdict,"PROVISIONAL_SEMANTIC_PARITY");assert.equal(a.preserved.requiresIndependentDbaReview,true);
  assert.deepEqual(Object.keys(a.sql).sort(),Object.keys(SQL_CATALOG).sort());
  for(const v of Object.values(a.sql))assert.match(v.sha256,/^[a-f0-9]{64}$/);
  assert.ok(a.project.prohibitedRefs.length>=2);assert.ok(!a.project.prohibitedRefs.includes(STAGING_PROJECT_REF));
  assert.deepEqual(Object.values(a.attestations),Array(5).fill("NOT_PROVIDED"));
  assert.ok(CHECKLIST.length>=13);assert.ok(RUNBOOK.length>=10);
  assert.equal(a.pin.ok,checkManifest(root).ok); // mirrors the live tree; never fabricated
});
test("runbook never restores over Staging or mutates anything but a disposable copy",()=>{
  for(const s of RUNBOOK)assert.ok(["nothing","disposable-only"].includes(s.mutates),`step ${s.step}`);
  const t=JSON.stringify(RUNBOOK);
  assert.match(t,/Never restore over Staging/);assert.match(t,/no down-migration is approved/);
  assert.doesNotMatch(t,/apply[^"]*to Staging/i);
});

// ------------------------------------------------------------------ SQL safety
const FORBIDDEN=/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|do|call|commit|vacuum|set role|reset|execute)\b/;
test("every inventory SQL is read-only framed, catalog-only, deterministic and free of data/identity reads",()=>{
  for(const [name,spec] of Object.entries(SQL_CATALOG)){
    const sql=spec.build(root);
    assert.equal(sql,spec.build(root),`${name} deterministic`);
    assert.match(sql,/^begin read only;/,name);assert.match(sql.trim(),/rollback;$/,name);
    assert.equal((sql.match(/\bbegin\b/g)||[]).length,1,name);
    const code=sql.replace(/'(?:[^']|'')*'/g,"''").toLowerCase();
    assert.doesNotMatch(code.replace(/set local /g,""),FORBIDDEN,name);
    assert.doesNotMatch(sql,/auth\.users|auth\.identities|auth\.sessions|encrypted_password|raw_user_meta_data|archive_command|pg_read_file|dblink|lo_import/i,name);
  }
  assert.match(schemaMigrationsSql(),/supabase_migrations\.schema_migrations/);
  assert.match(schemaInventorySql("auth"),/acldefault\(/);
  assert.match(extensionsSql(),/pg_extension/);
  assert.match(physicalStorageSql(),/pg_stat_archiver/);
  assert.match(restoreIntegritySql(),/indisvalid/);assert.match(restoreIntegritySql(),/convalidated/);
  assert.doesNotMatch(projectPinSql(),/count\(\*\)/);
  assert.doesNotMatch(restoreIntegritySql().replace(/count\(\*\) as v/,""),/count\(\*\)/); // only catalog-object counts, never row counts
});
test("schemaInventorySql refuses unsafe identifiers",()=>{
  for(const bad of ["auth; drop table x","Auth","a'b",""])assert.throws(()=>schemaInventorySql(bad),/UNSAFE_IDENTIFIER/);
});

// ------------------------------------------------------------------ evaluator: HOLD by default
test("empty, wrong-schema and non-object evidence is HOLD with a FAIL, never GO",()=>{
  for(const x of [undefined,null,{},{schema:"nope"},[],"GO"]){
    const r=ev(x);assert.equal(r.decision,"HOLD");assert.equal(r.managedRestoration,"BLOCKED");assert.equal(r.rejected,true);assert.equal(r.exitCode,3);
  }
});
test("minimal valid-schema evidence with nothing else is HOLD (all absent) and lists every blocker",()=>{
  const r=ev({schema:EVIDENCE_SCHEMA});
  assert.equal(r.decision,"HOLD");assert.equal(r.exitCode,4);assert.equal(r.rejected,false);
  for(const id of ["PROVENANCE_MANAGED_STAGING","BACKUP_PRESENT_FRESH","PITR_EVIDENCE","PHYSICAL_STORAGE_EVIDENCE","MIGRATION_LEDGER_RECONCILED","RESTORE_ADJUDICATION","MIGRATION_DRY_RUN","ROLLBACK_DRILL","FEATURE_GATES_HARD_OFF","APPROVALS_DBA_APPSEC_HUMAN"])
    assert.ok(r.blockers.includes(id),id);
  assert.equal(r.independentDbaReview,"REQUIRED");
});
test("TEST-ONLY fully consistent managed evidence still HOLDs without an injected verifier; GO needs verified human approvals",()=>{
  const e=signed(base());
  const noVerifier=ev(e);
  assert.equal(noVerifier.decision,"HOLD");assert.equal(noVerifier.managedRestoration,"BLOCKED");
  assert.equal(st(noVerifier,"APPROVALS_DBA_APPSEC_HUMAN"),"HOLD");
  assert.match(noVerifier.checks.find(c=>c.id==="APPROVALS_DBA_APPSEC_HUMAN").detail,/UNVERIFIABLE/);
  const withVerifier=ev(e,{verifyApproval:yes});
  assert.deepEqual(withVerifier.blockers,[],JSON.stringify(withVerifier.checks.filter(c=>c.status!=="PASS")));
  assert.equal(withVerifier.decision,"GO");assert.equal(withVerifier.exitCode,0);
  assert.equal(withVerifier.localSyntheticEvidenceCanPass,false);
  const rejecting=ev(e,{verifyApproval:()=>false});
  assert.equal(rejecting.decision,"HOLD");assert.equal(rejecting.rejected,true);
  const throwing=ev(e,{verifyApproval:()=>{throw new Error("boom")}});
  assert.equal(throwing.decision,"HOLD");assert.equal(st(throwing,"APPROVALS_DBA_APPSEC_HUMAN"),"FAIL");
  const truthy=ev(e,{verifyApproval:()=>"yes"});
  assert.equal(truthy.decision,"HOLD"); // only strict true counts
});

// ------------------------------------------------------------------ local synthetic evidence can never PASS managed restoration
test("local synthetic / disposable provenance never reaches GO, even with every other field perfect and a permissive verifier",()=>{
  for(const kind of ["local-synthetic","local-disposable","synthetic-fixture"]){
    const b=base();b.provenance.kind=kind;
    const r=ev(signed(b),{verifyApproval:yes});
    assert.equal(r.decision,"HOLD",kind);assert.equal(r.managedRestoration,"BLOCKED",kind);
    assert.equal(st(r,"PROVENANCE_MANAGED_STAGING"),"HOLD");
    assert.match(r.checks.find(c=>c.id==="PROVENANCE_MANAGED_STAGING").detail,/LOCAL_SYNTHETIC_EVIDENCE_CANNOT_CERTIFY/);
  }
  const b=base();b.provenance.kind="invented";
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"PROVENANCE_MANAGED_STAGING"),"FAIL");
  const c=base();delete c.provenance;
  assert.equal(ev(signed(c),{verifyApproval:yes}).decision,"HOLD");
});
test("self-claimed managed restoration PASS / GO on non-GO evidence is rejected as falsified",()=>{
  for(const claim of [{managedRestoration:"PASS"},{restoreVerified:true},{claims:{managedRestoration:"PASS"}},{claims:{decision:"GO"}},{claims:{restoreVerified:true}}]){
    const b={...base(),...claim};b.provenance.kind="local-synthetic";
    const r=ev(signed(b),{verifyApproval:yes});
    assert.equal(r.decision,"HOLD");assert.equal(st(r,"SELF_CLAIM_MATCHES_EVALUATION"),"FAIL");assert.equal(r.rejected,true);
  }
});
test("a claimed adjudication cannot override the recomputed one (exactManagedRecovery / goEligible / PASS lies)",()=>{
  const b=base();b.recovery.rawDiffPaths=ACL_PATHS;
  b.adjudication={verdict:"EXACT_LOCAL_RAW_PARITY",rawStatus:"RAW_PARITY"};
  let r=ev(signed(b),{verifyApproval:yes});
  assert.equal(st(r,"ADJUDICATION_CLAIM_MATCHES_RECOMPUTE"),"FAIL");assert.equal(r.decision,"HOLD");
  for(const lie of [{exactManagedRecovery:true},{goEligible:true},{managedRestoration:"PASS"}]){
    const c=base();c.adjudication={verdict:"EXACT_LOCAL_RAW_PARITY",rawStatus:"RAW_PARITY",...lie};
    r=ev(signed(c),{verifyApproval:yes});
    assert.equal(st(r,"ADJUDICATION_CLAIM_MATCHES_RECOMPUTE"),"FAIL");assert.equal(r.decision,"HOLD");
  }
});

// ------------------------------------------------------------------ project pin
test("wrong, Production-like or Jarvis project refs and endpoints are rejected",()=>{
  for(const patch of [{projectRef:"yqpgcsduqbxulrlzwzap"},{projectRef:"coilipywdvxklewquqvv"},{projectRef:"someotherproject"},
    {host:"db.yqpgcsduqbxulrlzwzap.supabase.co"},{host:"evil.example.com"},{user:"postgres.yqpgcsduqbxulrlzwzap"}]){
    const b=base();Object.assign(b.provenance,patch);
    const r=ev(signed(b),{verifyApproval:yes});
    assert.equal(st(r,"PROJECT_PIN"),"FAIL",JSON.stringify(patch));assert.equal(r.decision,"HOLD");
  }
  const b=base();b.provenance.readOnly=false;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"CAPTURE_READ_ONLY"),"FAIL");
  const c=base();delete c.provenance.readOnly;
  assert.equal(st(ev(signed(c),{verifyApproval:yes}),"CAPTURE_READ_ONLY"),"HOLD");
});
test("source pin drift or absence blocks; live tree check mirrors checkManifest",()=>{
  const b=base();b.sourcePin.manifestDigest=H("0");
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"SOURCE_PIN_7_PLUS_23"),"FAIL");
  const c=base();delete c.sourcePin;
  assert.equal(st(ev(signed(c),{verifyApproval:yes}),"SOURCE_PIN_7_PLUS_23"),"HOLD");
  const r=ev(signed(base()),{verifyApproval:yes,root});
  const m=checkManifest(root);
  assert.equal(st(r,"LIVE_TREE_MATCHES_PIN"),m.ok&&m.manifestDigest===RC4_PIN_DIGEST?"PASS":"FAIL");
  if(st(r,"LIVE_TREE_MATCHES_PIN")==="FAIL")assert.equal(r.decision,"HOLD");
});

// ------------------------------------------------------------------ absent / falsified backups
test("absent backup is HOLD, not PASS",()=>{
  for(const mut of [b=>{delete b.backup},b=>{b.backup={present:false}},b=>{b.backup={}}]){
    const b=base();mut(b);
    const r=ev(signed(b),{verifyApproval:yes});
    assert.equal(st(r,"BACKUP_PRESENT_FRESH"),"HOLD");assert.equal(r.decision,"HOLD");assert.equal(r.managedRestoration,"BLOCKED");
    assert.match(r.checks.find(c=>c.id==="BACKUP_PRESENT_FRESH").detail,/MANAGED_BACKUP_ABSENT/);
  }
});
test("falsified or lossy backups are rejected: wrong project, stale, future, bad artifacts, duplicate digests",()=>{
  const cases={
    wrongProject:b=>{b.backup.projectRef="yqpgcsduqbxulrlzwzap"},
    stale:b=>{b.backup.takenAt="2026-10-20T00:00:00Z"},
    afterCapture:b=>{b.backup.takenAt="2026-10-30T11:00:00Z"},
    badTime:b=>{b.backup.takenAt="yesterday"},
    noArtifacts:b=>{b.backup.artifacts=[]},
    badSha:b=>{b.backup.artifacts[0].sha256="abc"},
    zeroBytes:b=>{b.backup.artifacts[0].bytes=0},
    dupDigest:b=>{b.backup.artifacts[1].sha256=b.backup.artifacts[0].sha256}
  };
  for(const [name,mut] of Object.entries(cases)){
    const b=base();mut(b);
    const r=ev(signed(b),{verifyApproval:yes});
    assert.equal(st(r,"BACKUP_PRESENT_FRESH"),"FAIL",name);assert.equal(r.decision,"HOLD",name);
  }
});
test("ACL, ownership and role dump absence/loss (--no-owner/--no-acl) are rejected individually",()=>{
  for(const [id,key] of [["BACKUP_OWNER_PRESERVED","includesOwner"],["BACKUP_ACL_PRESERVED","includesAcl"],["BACKUP_ROLES_DUMPED","includesRoles"]]){
    const lossy=base();lossy.backup[key]=false;
    let r=ev(signed(lossy),{verifyApproval:yes});
    assert.equal(st(r,id),"FAIL",key);assert.equal(r.decision,"HOLD");assert.equal(r.rejected,true);
    const absent=base();delete absent.backup[key];
    r=ev(signed(absent),{verifyApproval:yes});
    assert.equal(st(r,id),"HOLD",key);assert.equal(r.decision,"HOLD");
    const str=base();str.backup[key]="true";
    assert.notEqual(st(ev(signed(str),{verifyApproval:yes}),id),"PASS","string true is not true");
  }
});
test("restored ownership by a browser role fails even when the backup flags are all true",()=>{
  const b=base();b.recovery.semanticRestored.relations[T].owner="service_role";
  const r=ev(signed(b),{verifyApproval:yes});
  assert.equal(st(r,"OWNERSHIP_NOT_BROWSER_ROLES"),"FAIL");assert.equal(r.decision,"HOLD");
  const f=base();f.recovery.semanticSource.functions={"f()":{owner:"anon"}};f.recovery.semanticRestored.functions={"f()":{owner:"anon"}};
  assert.equal(st(ev(signed(f),{verifyApproval:yes}),"OWNERSHIP_NOT_BROWSER_ROLES"),"FAIL");
});

// ------------------------------------------------------------------ Auth / extensions
test("Auth schema: not included is FAIL, digests absent is HOLD, digest mismatch is FAIL",()=>{
  let b=base();b.backup.includesAuthSchema=false;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"AUTH_SCHEMA_RESTORED"),"FAIL");
  b=base();delete b.authSchema;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"AUTH_SCHEMA_RESTORED"),"HOLD");
  b=base();b.authSchema.restoredDigest=H("9");
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"AUTH_SCHEMA_RESTORED"),"FAIL");
  b=base();b.authSchema={sourceDigest:"x",restoredDigest:"x"};
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"AUTH_SCHEMA_RESTORED"),"FAIL");
  b=base();delete b.backup.includesAuthSchema;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"AUTH_SCHEMA_RESTORED"),"HOLD");
});
test("Supabase extensions: missing, empty, plpgsql-less and differing inventories are rejected",()=>{
  let b=base();b.backup.includesExtensions=false;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"EXTENSIONS_RESTORED"),"FAIL");
  b=base();delete b.extensions;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"EXTENSIONS_RESTORED"),"HOLD");
  b=base();b.extensions.restored=[];
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"EXTENSIONS_RESTORED"),"FAIL");
  b=base();b.extensions={source:[{name:"pgcrypto",version:"1.3",schema:"extensions"}],restored:[{name:"pgcrypto",version:"1.3",schema:"extensions"}]};
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"EXTENSIONS_RESTORED"),"FAIL");
  b=base();b.extensions.restored=[ext()[0]];
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"EXTENSIONS_RESTORED"),"FAIL");
  b=base();b.extensions.restored=[...ext()].reverse();
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"EXTENSIONS_RESTORED"),"PASS"); // order-insensitive
});

// ------------------------------------------------------------------ physical storage + PITR
test("physical storage evidence: absent is HOLD; logical-only, no boot proof, bad digest are FAIL",()=>{
  let b=base();delete b.physicalStorage;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"PHYSICAL_STORAGE_EVIDENCE"),"HOLD");
  for(const patch of [{kind:"logical"},{restoredBootVerified:false},{restoredBootVerified:undefined},{evidenceSha256:"zz"},{sizeBytes:0}]){
    b=base();Object.assign(b.physicalStorage,patch);
    assert.equal(st(ev(signed(b),{verifyApproval:yes}),"PHYSICAL_STORAGE_EVIDENCE"),"FAIL",JSON.stringify(patch));
  }
});
test("PITR evidence: absent HOLD; disabled, target outside window, drill on Staging/Production/Jarvis, drill before target all FAIL",()=>{
  let b=base();delete b.pitr;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"PITR_EVIDENCE"),"HOLD");
  const patches=[{enabled:false},{recoveryTargetTime:"2026-10-01T00:00:00Z"},{recoveryTargetTime:"2026-10-30T11:59:00Z"},
    {drillProjectRef:STAGING_PROJECT_REF},{drillProjectRef:"yqpgcsduqbxulrlzwzap"},{drillProjectRef:"coilipywdvxklewquqvv"},{drillProjectRef:""},
    {drillCompletedAt:"2026-10-30T07:00:00Z"},{earliestRecoveryPoint:"never"},{evidenceSha256:"1"}];
  for(const patch of patches){
    b=base();Object.assign(b.pitr,patch);
    const r=ev(signed(b),{verifyApproval:yes});
    assert.equal(st(r,"PITR_EVIDENCE"),"FAIL",JSON.stringify(patch));assert.equal(r.decision,"HOLD");
  }
});

// ------------------------------------------------------------------ schema_migrations reconciliation
test("schema_migrations: absent HOLD; vox versions, duplicates, disorder, bad format, count lies FAIL; reconciliation must be human and complete",()=>{
  let b=base();delete b.ledger;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"MIGRATION_LEDGER_RECONCILED"),"HOLD");
  const muts={
    vox:l=>{l.entries[1].name="vox_v1_scoped_staff_authority"},
    dup:l=>{l.entries[1].version=l.entries[0].version},
    disorder:l=>{l.entries.reverse()},
    format:l=>{l.entries[0].version="2026-10-13"},
    count:l=>{l.count=86},
    ai:l=>{l.reconciliation.reviewerKind="ai"},
    unresolved:l=>{l.reconciliation.unresolvedAliases=3},
    reviewedCount:l=>{l.reconciliation.reviewedCount=1}
  };
  for(const [name,m] of Object.entries(muts)){
    b=base();m(b.ledger);
    assert.equal(st(ev(signed(b),{verifyApproval:yes}),"MIGRATION_LEDGER_RECONCILED"),"FAIL",name);
  }
  b=base();delete b.ledger.reconciliation;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"MIGRATION_LEDGER_RECONCILED"),"HOLD");
});

// ------------------------------------------------------------------ RAW_DIVERGENCE / PROVISIONAL_SEMANTIC_PARITY / DBA
test("provisional semantic parity keeps RAW_DIVERGENCE and HOLDs until an independent DBA disposition is verified",()=>{
  const b=base();b.recovery.rawDiffPaths=ACL_PATHS;
  const plain=ev(signed(b),{verifyApproval:yes});
  assert.equal(plain.adjudicationVerdict,"PROVISIONAL_SEMANTIC_PARITY");assert.equal(plain.rawStatus,"RAW_DIVERGENCE");
  assert.deepEqual(plain.rawDivergentPaths.map(p=>p.path),ACL_PATHS);
  assert.ok(plain.rawDivergentPaths.every(p=>p.proven));
  assert.equal(st(plain,"RESTORE_ADJUDICATION"),"HOLD");assert.match(plain.checks.find(c=>c.id==="RESTORE_ADJUDICATION").detail,/needs independent DBA review/);
  assert.equal(plain.decision,"HOLD");assert.equal(plain.independentDbaReview,"REQUIRED");
  const noVerifier=ev(signed(b,{dba:{disposition:PROVISIONAL_DISPOSITION}}));
  assert.equal(noVerifier.decision,"HOLD");
  const accepted=ev(signed(b,{dba:{disposition:PROVISIONAL_DISPOSITION}}),{verifyApproval:yes});
  assert.equal(st(accepted,"RESTORE_ADJUDICATION"),"PASS");
  assert.equal(accepted.rawStatus,"RAW_DIVERGENCE");                      // preserved even when accepted
  assert.equal(accepted.adjudicationVerdict,"PROVISIONAL_SEMANTIC_PARITY"); // never relabelled exact
  assert.equal(accepted.independentDbaReview,"VERIFIED");
});
test("privilege widening hidden behind the same ACL raw paths FAILS (no DBA disposition can rescue it)",()=>{
  const b=base();b.recovery.rawDiffPaths=ACL_PATHS;
  const r2=b.recovery.semanticRestored.relations[T];
  r2.acl=[...OWNER_ACL,"anon|postgres|SELECT|false"];r2.priv.anon={plain:["SELECT"],grantable:[]};
  const r=ev(signed(b,{dba:{disposition:PROVISIONAL_DISPOSITION}}),{verifyApproval:yes});
  assert.equal(r.adjudicationVerdict,"SEMANTIC_DIVERGENCE");assert.equal(st(r,"RESTORE_ADJUDICATION"),"FAIL");
  assert.equal(r.decision,"HOLD");assert.equal(r.rejected,true);
});
test("unexplained raw paths, missing inputs, bad schema and non-read-only source are rejected or held",()=>{
  let b=base();b.recovery.rawDiffPaths=[`$.relations.${T}.owner`];
  assert.equal(ev(signed(b),{verifyApproval:yes}).adjudicationVerdict,"RAW_DIVERGENCE_UNEXPLAINED");
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"RESTORE_ADJUDICATION"),"FAIL");
  b=base();delete b.recovery;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"RESTORE_ADJUDICATION"),"HOLD");
  b=base();delete b.recovery.semanticRestored;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"RESTORE_ADJUDICATION"),"HOLD");
  b=base();b.recovery.semanticSource.schema="x";
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"RESTORE_ADJUDICATION"),"FAIL");
  b=base();b.recovery.semanticSource.identity.transaction_read_only="off";
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"RESTORE_ADJUDICATION"),"FAIL");
  b=base();b.recovery.rawDiffPaths="oops";
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"RESTORE_ADJUDICATION"),"FAIL");
  b=base();b.recovery.semanticSource.relations={};
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"RESTORE_ADJUDICATION"),"HOLD");
});

// ------------------------------------------------------------------ falsified approvals
test("approvals bound to different evidence (edited after signing) are rejected",()=>{
  const e=signed(base());
  const tampered=clone(e);tampered.backup.artifacts[0].bytes=999;
  const r=ev(tampered,{verifyApproval:yes});
  assert.equal(st(r,"APPROVALS_DBA_APPSEC_HUMAN"),"FAIL");assert.match(r.checks.find(c=>c.id==="APPROVALS_DBA_APPSEC_HUMAN").detail,/binding_mismatch/);
  assert.equal(r.decision,"HOLD");
  const reordered=clone(e);reordered.approvals.reverse();
  assert.equal(ev(reordered,{verifyApproval:yes}).decision,"GO"); // approvals/claims are excluded from the binding
  assert.notEqual(bindingDigest(e),bindingDigest(tampered));
  assert.equal(bindingDigest(e),bindingDigest({...e,claims:{managedRestoration:"PASS"},approvals:[]}));
});
test("falsified approvers are rejected: AI, operator self-approval, one person in two roles, duplicate role, unsigned, forged time",()=>{
  const e=base();
  const b=bindingDigest(e);
  const withApprovals=(dba,appsec)=>({...e,approvals:[dba,appsec]});
  const D=(o={})=>approval("dba","dba-1",b,o),A=(o={})=>approval("appsec","appsec-1",b,o);
  const bad={
    aiDba:withApprovals(D({kind:"ai"}),A()),
    aiAppsec:withApprovals(D(),A({kind:"model"})),
    selfApproval:withApprovals(D({reviewerId:"operator-a"}),A()),
    sameReviewer:withApprovals(D(),A({reviewerId:"dba-1"})),
    duplicateRole:{...e,approvals:[D(),D({reviewerId:"dba-2"}),A()]},
    unsigned:withApprovals(D({signature:""}),A()),
    noDisposition:withApprovals(D({disposition:undefined}),A()),
    wrongBinding:withApprovals(D({bindsTo:H("0")}),A()),
    beforeCapture:withApprovals(D({reviewedAt:"2026-10-30T09:00:00Z"}),A()),
    inFuture:withApprovals(D({reviewedAt:"2026-10-31T00:00:00Z"}),A()),
    unknownRole:withApprovals(D(),{...A(),role:"owner"}),
    notObject:{...e,approvals:[D(),"appsec-ok"]}
  };
  for(const [name,x] of Object.entries(bad)){
    const r=ev(x,{verifyApproval:yes});
    assert.equal(r.decision,"HOLD",name);assert.equal(st(r,"APPROVALS_DBA_APPSEC_HUMAN"),"FAIL",name);assert.equal(r.rejected,true,name);
  }
  assert.equal(ev(withApprovals(D(),A()),{verifyApproval:yes}).decision,"GO"); // control: the same builder with valid inputs
  const onlyDba=ev({...e,approvals:[D()]},{verifyApproval:yes});
  assert.equal(st(onlyDba,"APPROVALS_DBA_APPSEC_HUMAN"),"HOLD");assert.match(onlyDba.checks.find(c=>c.id==="APPROVALS_DBA_APPSEC_HUMAN").detail,/appsec/);
  assert.equal(st(ev({...e,approvals:[]},{verifyApproval:yes}),"APPROVALS_DBA_APPSEC_HUMAN"),"HOLD");
  assert.equal(st(ev({...e,approvals:"yes"},{verifyApproval:yes}),"APPROVALS_DBA_APPSEC_HUMAN"),"HOLD");
});
test("the verifier receives the evaluator-computed binding, not a caller-supplied one",()=>{
  const e=signed(base());const seen=[];
  ev(e,{verifyApproval:(a,binding)=>{seen.push([a.role,binding]);return true}});
  assert.deepEqual(seen.map(x=>x[0]).sort(),["appsec","dba"]);
  for(const [,bnd] of seen)assert.equal(bnd,bindingDigest(e));
});

// ------------------------------------------------------------------ migration dry run + rollback errors
test("migration dry run: absent HOLD; non-disposable target, wrong digest/count, apply errors FAIL",()=>{
  let b=base();delete b.migrationDryRun;
  let r=ev(signed(b),{verifyApproval:yes});
  assert.equal(st(r,"MIGRATION_DRY_RUN"),"HOLD");assert.equal(st(r,"ROLLBACK_DRILL"),"HOLD");
  const patches=[{target:"managed-staging"},{target:"staging"},{manifestDigest:H("0")},{filesApplied:29},{filesApplied:31},{errors:["relation missing"]},{errors:"none"},
    {adjudicationVerdict:"SEMANTIC_DIVERGENCE"},{adjudicationVerdict:undefined}];
  for(const patch of patches){
    b=base();Object.assign(b.migrationDryRun,patch);
    r=ev(signed(b),{verifyApproval:yes});
    assert.equal(st(r,"MIGRATION_DRY_RUN"),"FAIL",JSON.stringify(patch));assert.equal(r.decision,"HOLD");
  }
});
test("rollback errors are rejected: errors, non-restored catalog, missing digests; unexecuted drill HOLDs",()=>{
  const patches=[{errors:["DROP failed"]},{errors:"ok"},{postCatalogDigest:H("0")},{preCatalogDigest:"x"},{postCatalogDigest:undefined}];
  for(const patch of patches){
    const b=base();Object.assign(b.migrationDryRun.rollback,patch);
    const r=ev(signed(b),{verifyApproval:yes});
    assert.equal(st(r,"ROLLBACK_DRILL"),"FAIL",JSON.stringify(patch));assert.equal(r.decision,"HOLD");assert.equal(r.rejected,true);
  }
  for(const patch of [{executed:false},{planReviewed:false},{executed:undefined}]){
    const b=base();Object.assign(b.migrationDryRun.rollback,patch);
    const r=ev(signed(b),{verifyApproval:yes});
    assert.equal(st(r,"ROLLBACK_DRILL"),"HOLD",JSON.stringify(patch));assert.equal(r.decision,"HOLD");
  }
  const b=base();delete b.migrationDryRun.rollback;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"ROLLBACK_DRILL"),"HOLD");
});
test("post-install PROVISIONAL verdict in the dry run also needs the DBA disposition",()=>{
  const b=base();b.migrationDryRun.adjudicationVerdict="PROVISIONAL_SEMANTIC_PARITY";
  const r=ev(signed(b),{verifyApproval:yes});
  assert.equal(st(r,"MIGRATION_DRY_RUN"),"HOLD");assert.equal(r.decision,"HOLD");
  assert.equal(ev(signed(b,{dba:{disposition:PROVISIONAL_DISPOSITION}}),{verifyApproval:yes}).decision,"GO");
});

// ------------------------------------------------------------------ feature gates
test("feature gates must be hard off: any on/unknown value FAILs, missing gates HOLD",()=>{
  for(const v of [true,"on","true",1,null,"false"]){
    const b=base();b.featureGates.CORE_CONVERSATION=v;
    assert.equal(st(ev(signed(b),{verifyApproval:yes}),"FEATURE_GATES_HARD_OFF"),"FAIL",String(v));
  }
  let b=base();delete b.featureGates.PROVIDER_SENDS;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"FEATURE_GATES_HARD_OFF"),"HOLD");
  b=base();delete b.featureGates;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"FEATURE_GATES_HARD_OFF"),"HOLD");
  b=base();b.featureGates.EXTRA_FLAG=true;
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"FEATURE_GATES_HARD_OFF"),"FAIL");
  b=base();b.featureGates.CORE_CONVERSATION="off";
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"FEATURE_GATES_HARD_OFF"),"PASS");
});

// ------------------------------------------------------------------ stale evidence
test("future or stale capture times are rejected",()=>{
  let b=base();b.provenance.capturedAt="2026-10-31T00:00:00Z";
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"EVIDENCE_FRESH"),"FAIL");
  b=base();b.provenance.capturedAt="2026-10-20T00:00:00Z";b.backup.takenAt="2026-10-19T00:00:00Z";
  assert.equal(st(ev(signed(b),{verifyApproval:yes}),"EVIDENCE_FRESH"),"FAIL");
});

// ------------------------------------------------------------------ local audit: no network / process / env / unconfined writes
test("RC4 Node modules open no network/process/db channels and never read env",()=>{
  for(const f of ["rc4-recovery-lib.mjs","rc4-recovery-evidence.mjs"]){
    assert.doesNotMatch(read(f),/node:(net|http|https|http2|dgram|dns|tls|child_process|worker_threads|cluster)|\bfetch\(|XMLHttpRequest|WebSocket|process\.env|\bpg\b from|\bspawn|\bexec(Sync|File)?\(/,f);
  }
  assert.doesNotMatch(read("rc4-recovery-lib.mjs"),/writeFileSync|appendFileSync|createWriteStream|mkdirSync|rmSync|readFileSync/);
});
test("CLI writes only via assertSafeOutFile (one create-only writer) and injects no approval verifier",()=>{
  const cli=read("rc4-recovery-evidence.mjs");
  assert.equal((cli.match(/writeFileSync\(/g)||[]).length,1);
  assert.match(cli,/writeFileSync\(assertSafeOutFile\(/);assert.match(cli,/flag:"wx"/);
  assert.doesNotMatch(cli,/verifyApproval/);
});

// ------------------------------------------------------------------ packet honesty
test("Track C doc preserves HOLD, RAW_DIVERGENCE, PROVISIONAL_SEMANTIC_PARITY, DBA review, pin and claims no execution or signoff",()=>{
  const t=readFileSync(resolve(root,DOC),"utf8");
  assert.ok(t.includes(RC4_PIN_DIGEST));assert.ok(t.includes(STAGING_PROJECT_REF));
  assert.match(t,/RAW_DIVERGENCE/);assert.match(t,/PROVISIONAL_SEMANTIC_PARITY/);
  assert.match(t,/independent (qualified )?(human )?DBA/i);assert.match(t,/NOT EXECUTED/);assert.match(t,/HOLD/);
  assert.doesNotMatch(t,/managed restoration[^\n]*\b(PASS|verified|certified|complete)\b/i);
  assert.doesNotMatch(t,/PITR[^\n]*\b(verified|proven|restored)\b/i);
  assert.doesNotMatch(t,/tests? (passed|pass(es)?)\b/i);
});
