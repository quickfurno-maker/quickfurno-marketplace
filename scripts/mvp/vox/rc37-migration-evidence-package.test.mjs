import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,cpSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {
 buildEvidencePackage,verifyEvidencePackage,canonicalStatementsDigest,importManagedLedger,
 buildSourceEvidenceFromDir,validateAliases,runCli
} from "./rc37-migration-evidence-package.mjs";
import {reconcileInventories} from "./rc35-migration-inventory-reconcile.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const fx=join(here,"fixtures/rc37-migration-evidence");
const managedText=()=>readFileSync(join(fx,"managed.json"),"utf8");
const aliases=()=>JSON.parse(readFileSync(join(fx,"aliases.json"),"utf8"));
const args=(o={})=>({managedText:managedText(),sourceDir:join(fx,"source"),aliasInput:aliases(),...o});
const tmp=()=>mkdtempSync(join(tmpdir(),"rc37-"));
const quiet={log(){},err(){}};

test("fixture package is complete, reproducible and never a GO",()=>{
 const a=buildEvidencePackage(args()),b=buildEvidencePackage(args());
 assert.equal(a.packageSha256,b.packageSha256);
 assert.equal(a.releaseGo,false);
 assert.equal(a.goStatus,"NO_GO_EVIDENCE_ONLY");
 assert.equal(a.requiresIndependentDbaDecision,true);
 assert.equal(a.connectsToManaged,false);
 assert.equal(a.evidenceComplete,true);
 assert.deepEqual(a.reconciliation.blockers,[]);
 assert.deepEqual(a.reconciliation.managedEntries.map(e=>[e.class,e.accepted]),[
  ["EXACT_VERSION_AND_NAME",true],["EXACT_VERSION_AND_NAME",true],["VERIFIED_ALIAS",true]]);
 assert.deepEqual(a.reconciliation.sourceOnly.map(s=>s.class),["SOURCE_ONLY_APPEND_CANDIDATE"]);
 assert.match(a.packageSha256,/^[0-9a-f]{64}$/);
 assert.equal(a.source.length,4);
 for(const s of a.source)assert.match(s.canonicalSha256,/^[0-9a-f]{64}$/);
});

test("package hash is independent of ledger row order and CRLF checkouts",()=>{
 const base=buildEvidencePackage(args());
 const m=JSON.parse(managedText());m.migrations.reverse();
 assert.equal(buildEvidencePackage(args({managedText:JSON.stringify(m)})).packageSha256,base.packageSha256);
 const d=tmp();
 try{
  cpSync(join(fx,"source"),d,{recursive:true});
  const f=join(d,"20261101000001_fix_alpha_table.sql");
  writeFileSync(f,readFileSync(f,"utf8").replace(/\n/g,"\r\n"));
  assert.equal(buildEvidencePackage(args({sourceDir:d})).packageSha256,base.packageSha256);
 }finally{rmSync(d,{recursive:true,force:true});}
});

test("fails closed without actual SQL: absent dir files, empty files, missing statements",()=>{
 const d=tmp();
 try{
  assert.throws(()=>buildSourceEvidenceFromDir(d),/RC37_SOURCE_SQL_ABSENT/);
  writeFileSync(join(d,"20261101000001_fix_alpha_table.sql")," \n");
  assert.throws(()=>buildSourceEvidenceFromDir(d),/RC37_SOURCE_SQL_EMPTY/);
 }finally{rmSync(d,{recursive:true,force:true});}
 assert.throws(()=>canonicalStatementsDigest([]),/MANAGED_STATEMENTS_EMPTY/);
 assert.throws(()=>canonicalStatementsDigest([" ; "]),/MANAGED_STATEMENT_EMPTY/);
 assert.throws(()=>canonicalStatementsDigest([1]),/MANAGED_STATEMENT_INVALID/);
 assert.throws(()=>importManagedLedger(JSON.stringify([{version:"20261101000001",name:"x_y_z",statements:[]}])),/MANAGED_STATEMENTS_EMPTY/);
 // names-only ledger: not complete, blocked, never accepted
 const names=JSON.stringify([{version:"20261101000001",name:"fix_alpha_table"}]);
 const p=buildEvidencePackage(args({managedText:names,aliasInput:undefined}));
 assert.equal(p.evidenceComplete,false);
 assert.equal(p.evidenceBlockers[0].code,"MANAGED_SQL_NOT_IMPORTED");
 assert.ok(p.reconciliation.blockers.some(b=>b.code==="DIGEST_UNAVAILABLE"));
 assert.equal(p.releaseGo,false);
});

test("declared digests are recorded as declared-only and keep the package incomplete",()=>{
 const dg=canonicalStatementsDigest(["create table fix_alpha(id int)"]);
 const p=buildEvidencePackage(args({managedText:JSON.stringify([{version:"20261101000001",name:"fix_alpha_table",statementsSha256:dg}]),aliasInput:undefined}));
 assert.equal(p.managed[0].digestBasis,"DECLARED_DIGEST");
 assert.equal(p.reconciliation.managedEntries[0].accepted,true);
 assert.equal(p.evidenceComplete,false);
 assert.throws(()=>importManagedLedger(JSON.stringify([{version:"20261101000001",name:"a_b_c",statementsSha256:"xyz"}])),/DIGEST_MALFORMED/);
});

test("statement differences change the digest and cause DIGEST_MISMATCH",()=>{
 const m=JSON.parse(managedText());
 m.migrations[0].statements=["create table fix_alpha(id bigint)"];
 const p=buildEvidencePackage(args({managedText:JSON.stringify(m)}));
 assert.equal(p.evidenceComplete,false);
 assert.ok(p.reconciliation.blockers.some(b=>b.code==="DIGEST_MISMATCH"));
 assert.equal(canonicalStatementsDigest(["select 1;"]),canonicalStatementsDigest(["select 1"]));
});

test("aliases need attestation and both digests equal to recomputed values",()=>{
 const managed=importManagedLedger(managedText());
 const src=buildSourceEvidenceFromDir(join(fx,"source")).files;
 const a=aliases().aliases[0];
 assert.equal(validateAliases({aliases:[a]},managed,src)[0].sourceFile,a.sourceFile);
 const H="a".repeat(64);
 assert.throws(()=>validateAliases([{...a,managedSha256:H}],managed,src),/ALIAS_DIGEST_UNVERIFIED/);
 assert.throws(()=>validateAliases([{...a,sourceSha256:H}],managed,src),/ALIAS_DIGEST_UNVERIFIED/);
 assert.throws(()=>validateAliases([{...a,verifiedBy:""}],managed,src),/ALIAS_ATTESTATION_MISSING/);
 assert.throws(()=>validateAliases([{...a,basis:" "}],managed,src),/ALIAS_ATTESTATION_MISSING/);
 assert.throws(()=>validateAliases([{...a,managedVersion:"20990101000000"}],managed,src),/ALIAS_MANAGED_UNKNOWN/);
 assert.throws(()=>validateAliases([{...a,sourceFile:"20990101000000_no_such_file.sql"}],managed,src),/ALIAS_SOURCE_UNKNOWN/);
 assert.throws(()=>validateAliases([a,a],managed,src),/ALIAS_DUPLICATE/);
 assert.throws(()=>validateAliases("nope",managed,src),/ALIAS_SHAPE/);
 // Alias to a file whose SQL differs cannot be forged even with a self-consistent claim.
 const other=src.find(s=>s.file.includes("beta"));
 assert.throws(()=>validateAliases([{...a,sourceFile:other.file,sourceSha256:other.canonicalSha256}],managed,src),/ALIAS_DIGEST_UNVERIFIED/);
});

test("without the alias the renamed ledger row stays blocked",()=>{
 const p=buildEvidencePackage(args({aliasInput:undefined}));
 assert.equal(p.evidenceComplete,false);
 const codes=p.reconciliation.blockers.map(b=>b.code);
 assert.ok(codes.includes("MANAGED_ONLY_NO_SOURCE_SQL")||codes.includes("DIGEST_UNAVAILABLE"));
});

test("verifiedAliases map in RC35 still requires digest equality",()=>{
 const src={files:[{file:"20260101000000_aaa_bbb_ccc.sql",canonicalSha256:"a".repeat(64)}]};
 const m=[{version:"20260909000000",name:"zzz_yyy_xxx",statementsSha256:"b".repeat(64)}];
 const r=reconcileInventories(m,src,new Map([["20260909000000","20260101000000_aaa_bbb_ccc.sql"]]));
 assert.equal(r.managedEntries[0].class,"VERIFIED_ALIAS");
 assert.equal(r.managedEntries[0].accepted,false);
 assert.ok(r.blockers.some(b=>b.code==="DIGEST_MISMATCH"));
 assert.throws(()=>reconcileInventories(m,src,new Map([["20260909000000","20990101000000_gone_gone_gone.sql"]])),/VERIFIED_ALIAS_SOURCE_MISSING/);
});

test("secrets in an export are refused",()=>{
 const withUrl=JSON.stringify([{version:"20261101000001",name:"a_b_c",note:"postgresql://postgres:hunter2@db.example.co:5432/postgres"}]);
 assert.throws(()=>importManagedLedger(withUrl),/RC37_SECRET_IN_INPUT/);
 assert.throws(()=>importManagedLedger("{"),/MANAGED_JSON_INVALID/);
 assert.throws(()=>importManagedLedger("{}"),/MANAGED_LEDGER_SHAPE/);
});

test("verify detects tampering and stale inputs",()=>{
 const pkg=JSON.parse(JSON.stringify(buildEvidencePackage(args())));
 assert.equal(verifyEvidencePackage(pkg,args()).packageSha256,pkg.packageSha256);
 const forged=JSON.parse(JSON.stringify(pkg));forged.releaseGo=true;
 assert.throws(()=>verifyEvidencePackage(forged,args()),/PACKAGE_GO_FORBIDDEN/);
 const tampered=JSON.parse(JSON.stringify(pkg));tampered.evidenceComplete=false;
 assert.throws(()=>verifyEvidencePackage(tampered,args()),/PACKAGE_TAMPERED/);
 const m=JSON.parse(managedText());m.migrations[0].statements=["create table fix_alpha(id text)"];
 assert.throws(()=>verifyEvidencePackage(pkg,args({managedText:JSON.stringify(m)})),/PACKAGE_STALE_VS_INPUTS/);
});

test("CLI: build, verify, exit codes",()=>{
 const d=tmp();
 try{
  const out=join(d,"p.json");
  const base=["--managed",join(fx,"managed.json"),"--source-dir",join(fx,"source")];
  assert.equal(runCli([...base,"--aliases",join(fx,"aliases.json"),"--out",out],quiet),0);
  assert.equal(JSON.parse(readFileSync(out,"utf8")).releaseGo,false);
  assert.equal(runCli([...base,"--aliases",join(fx,"aliases.json"),"--verify",out],quiet),0);
  assert.equal(runCli(base,quiet),2); // no alias: incomplete
  assert.equal(runCli([...base,"--aliases",join(fx,"aliases.json"),"--verify",join(d,"missing.json")],quiet),1);
  assert.equal(runCli(["--managed",join(fx,"managed.json")],quiet),1);
  mkdirSync(join(d,"empty"));
  assert.equal(runCli(["--managed",join(fx,"managed.json"),"--source-dir",join(d,"empty")],quiet),1);
 }finally{rmSync(d,{recursive:true,force:true});}
});

test("source: the module contains no network, process-spawn or SQL-execution imports",()=>{
 const src=readFileSync(join(here,"rc37-migration-evidence-package.mjs"),"utf8");
 for(const bannedRe of [/node:(https?|net|tls|dgram|child_process)/,/from\s+"pg"/,/supabase-js/,/fetch\(/,/process\.env/])
  assert.doesNotMatch(src,bannedRe);
});
