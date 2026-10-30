import test from "node:test";import assert from "node:assert/strict";
import {dirname,resolve} from "node:path";import {fileURLToPath} from "node:url";
import {
  AUTHORIZED_STAGING_REF,REQUIRED_CONSENT_RELATION,analyzeDependencies,catalogDigest,catalogSql,
  checkManifest,digest,diffPaths,evaluateEvidence,ledgerSql,readStagingOnlyVersions,
  validateBackupManifest,validateProjectIdentity
} from "./ab7k-evidence-lib.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const direct={projectRef:AUTHORIZED_STAGING_REF,host:`db.${AUTHORIZED_STAGING_REF}.supabase.co`,user:"postgres"};

test("identity: only the authorized staging ref bound endpoint passes",()=>{
  assert.equal(validateProjectIdentity(direct).ok,true);
  assert.equal(validateProjectIdentity({...direct,host:"aws-0-ap-south-1.pooler.supabase.com",user:`postgres.${AUTHORIZED_STAGING_REF}`}).ok,true);
  for(const bad of [
    {...direct,projectRef:"yqpgcsduqbxulrlzwzap",host:"db.yqpgcsduqbxulrlzwzap.supabase.co"},
    {...direct,projectRef:"coilipywdvxklewquqvv",host:"db.coilipywdvxklewquqvv.supabase.co"},
    {...direct,host:"db.yqpgcsduqbxulrlzwzap.supabase.co"},
    {...direct,host:"localhost"},
    {...direct,host:"aws-0-ap-south-1.pooler.supabase.com",user:"postgres"},
    {...direct,host:"aws-0-ap-south-1.pooler.supabase.com",user:"postgres.yqpgcsduqbxulrlzwzap"},
    {...direct,projectRef:undefined},{}
  ])assert.equal(validateProjectIdentity(bad).ok,false,JSON.stringify(bad));
});

test("canonical digest is key-order independent and change sensitive",()=>{
  assert.equal(digest({a:1,b:{c:2,d:3}}),digest({b:{d:3,c:2},a:1}));
  assert.notEqual(digest({a:1}),digest({a:2}));
  assert.equal(catalogDigest({identity:{database:"x"},relations:{}}),catalogDigest({identity:{database:"y"},relations:{}}));
  assert.deepEqual(diffPaths({a:{b:1}},{a:{b:2}}),["$.a.b"]);
});

test("manifest check pins 7+23 order and bytes to the reviewed fingerprint",()=>{
  const m=checkManifest(root);
  assert.equal(m.ok,true,m.reasons?.join(","));
  assert.equal(m.quarantined,7);assert.equal(m.candidates,23);
});

test("staging-only ledger versions parse to exactly 31 unique IDs",()=>{
  const v=readStagingOnlyVersions(root);
  assert.equal(v.length,31);assert.equal(new Set(v).size,31);
});

test("static scan reports the never-created consent relation and Core dependencies",()=>{
  const d=analyzeDependencies(root);
  assert.ok(d.missingVoxRelations.some(x=>x.name===REQUIRED_CONSENT_RELATION),"consent relation must be flagged");
  assert.ok(d.externalCoreRelations.includes("communication_conversations"));
  assert.equal(d.method,"REGEX_HEURISTIC_NOT_A_PARSER");
});

test("generated SQL is read-only: framed in a READ ONLY transaction, no DML/DDL outside literals",()=>{
  for(const sql of [catalogSql(root),ledgerSql()]){
    assert.match(sql,/^begin read only;/);assert.match(sql.trim(),/rollback;$/);
    const code=sql.replace(/'(?:[^']|'')*'/g,"''").toLowerCase();
    assert.doesNotMatch(code,/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|do|call|commit|vacuum)\b/);
  }
});

const roleEff={anon:[],authenticated:[],service_role:["SELECT","INSERT","UPDATE","DELETE"]};
const tbl=(over={})=>({kind:"r",owner:"postgres",rls:true,force_rls:true,acl_is_default:false,acl:[],effective:roleEff,
  columns:[],column_acl:[],constraints:[],policies:[],triggers:[],indexes:[],definition:null,...over});
const fn=(over={})=>({kind:"f",owner:"postgres",security_definer:true,config:["search_path=\"\""],returns:"jsonb",body_md5:"x",
  acl_is_default:false,acl:[],public_execute:false,execute:{anon:false,authenticated:false,service_role:true},...over});
function snap(over={}){
  const relations={};for(let i=0;i<39;i++)relations[`vox_t${i}`]=tbl();
  return {identity:{database:"d",server_version_num:"170000",transaction_read_only:"on"},
    roles:{anon:{super:false,bypassrls:false},authenticated:{super:false,bypassrls:false}},
    schema_privs:{anon:{usage:true,create:false},authenticated:{usage:true,create:false},service_role:{usage:true,create:false}},
    default_acls:[],presence:{},relations,functions:{},...over};
}

test("evaluator never emits GO, flags the missing consent relation, and keeps restoration BLOCKED",()=>{
  const r=evaluateEvidence({root,snapshot:snap(),target:"local-disposable",expect:"post-install"});
  assert.equal(r.goEligible,false);assert.notEqual(r.overall,"GO");
  assert.equal(r.overall,"HOLD");
  assert.ok(r.checks.some(c=>c.id.startsWith("STATIC_VOX_RELATION_NEVER_CREATED")&&c.status==="BLOCKED"));
  assert.ok(r.checks.some(c=>c.id==="CONSENT_RELATION_PRESENT_IN_TARGET"&&c.status==="BLOCKED"));
  assert.match(r.managedRestoration,/^BLOCKED/);
  assert.deepEqual(Object.values(r.attestations),Array(5).fill("NOT_PROVIDED"));
});

test("evaluator FAILs on anon privilege, missing FORCE RLS, and PUBLIC execute",()=>{
  const s=snap();
  s.relations.vox_t0=tbl({effective:{...roleEff,anon:["SELECT"]}});
  s.relations.vox_t1=tbl({force_rls:false});
  s.functions["qf_vox_x(uuid)"]=fn({public_execute:true});
  const r=evaluateEvidence({root,snapshot:s,target:"local-disposable",expect:"post-install"});
  assert.equal(r.overall,"FAIL");
  const st=id=>r.checks.find(c=>c.id===id).status;
  assert.equal(st("ANON_NO_PRIVILEGE_ON_VOX_RELATIONS"),"FAIL");
  assert.equal(st("VOX_FORCE_RLS_ALL_TABLES"),"FAIL");
  assert.equal(st("NO_PUBLIC_EXECUTE_ON_NON_TRIGGER_VOX_FUNCTIONS"),"FAIL");
});

test("managed target rejects wrong identity and missing staging-only ledger versions",()=>{
  const r=evaluateEvidence({root,snapshot:snap({relations:{}}),target:"managed-staging",expect:"pre-install",
    identity:{...direct,projectRef:"yqpgcsduqbxulrlzwzap"},ledger:[{version:"20200101000000",name:"x"}]});
  assert.equal(r.overall,"FAIL");
  assert.equal(r.checks.find(c=>c.id==="PROJECT_IDENTITY_ENDPOINT").status,"FAIL");
  assert.equal(r.checks.find(c=>c.id==="STAGING_ONLY_VERSIONS_PRESENT").status,"FAIL");
});

test("backup manifest: absent or --no-owner/--no-acl/5-schema-style backups stay BLOCKED; complete is only REVIEW",()=>{
  assert.equal(validateBackupManifest(undefined).status,"BLOCKED");
  const ok={project_ref:AUTHORIZED_STAGING_REF,taken_at:"2026-10-30T00:00:00Z",schemas:["public","auth"],
    includes_owner:true,includes_acl:true,includes_roles:true,artifacts:[{name:"a.dump",sha256:"a".repeat(64),bytes:10}]};
  assert.equal(validateBackupManifest({...ok,includes_acl:false,includes_owner:false}).status,"BLOCKED");
  assert.equal(validateBackupManifest({...ok,includes_roles:false}).status,"BLOCKED");
  assert.equal(validateBackupManifest(ok).status,"REVIEW");
});
