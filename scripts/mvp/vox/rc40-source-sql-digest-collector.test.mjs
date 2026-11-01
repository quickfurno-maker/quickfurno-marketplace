import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,cpSync,rmSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
import {dirname,join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {collectSourceSqlDigests,parseDrift,runCli,DEFAULT_DRIFT,DEFAULT_SOURCE_DIR,RC40_SCHEMA,EXPECTED_SCHEMA} from "./rc40-source-sql-digest-collector.mjs";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";

const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(here,"../../..");
const driftText=readFileSync(DEFAULT_DRIFT,"utf8");
const drift=JSON.parse(driftText);
const quiet=()=>({log(){},err(){}});
const tmp=()=>mkdtempSync(join(tmpdir(),"rc40-"));
const sha=t=>createHash("sha256").update(t).digest("hex");
const real=(o={})=>collectSourceSqlDigests({driftText,sourceDir:DEFAULT_SOURCE_DIR,...o});
const expectedFor=(ev,n)=>JSON.stringify({schema:EXPECTED_SCHEMA,entries:ev.entries.slice(0,n).map(e=>({file:e.file,sha256:e.canonicalSha256}))});
// re-seal an evidence object the way the collector does (for forged-previous tests)
const seal=o=>{const {evidenceSha256,...b}=o;return JSON.stringify({...b,evidenceSha256:sha(JSON.stringify(b))});};

// Synthetic fixture: 2 source-only + 1 common file with a self-consistent drift record.
function fixture(){
 const d=tmp(),src=join(d,"src");mkdirSync(src);
 const f={"20270101000001_a.sql":"select 1;\n","20270101000002_b.sql":"select 2;\r\n","20270101000003_c.sql":"select 3;\n"};
 for(const [n,t] of Object.entries(f))writeFileSync(join(src,n),t);
 const dr={schema:"qf.vox.staging-migration-drift/read-only-v1",production_touched:false,managed_writes:false,
  staging_count:1,source_sql_count:3,common_version_count:1,staging_only_count:1,source_only_count:2,
  staging_only:[{version:"20260101000000",name:"managed_thing"}],
  source_only:["20270101000001_a.sql","20270101000002_b.sql"],
  common_versions:[{version:"20270101000003",staging_name:"c",source_filename:"20270101000003_c.sql"}]};
 return {d,src,run:(o={})=>collectSourceSqlDigests({driftText:JSON.stringify(dr),sourceDir:src,repoRootDir:d,protectedRoots:[],...o})};
}

test("actual drift: all 107 real source-only SQL files hashed deterministically",()=>{
 assert.equal(drift.source_only_count,107);
 const a=real(),b=real();
 assert.equal(a.evidenceSha256,b.evidenceSha256);
 assert.equal(a.entries.length,107);
 assert.equal(a.counts.collected,107);
 assert.equal(a.releaseGo,false);assert.equal(a.executesSql,false);assert.equal(a.connectsToManaged,false);
 assert.equal(a.managedWrites,false);assert.equal(a.guessesManagedSql,false);
 assert.deepEqual(a.entries.map(e=>e.file),[...drift.source_only].sort());
 for(const e of a.entries){
  assert.equal(e.canonicalSha256,canonicalSqlDigest(readFileSync(join(DEFAULT_SOURCE_DIR,e.file))));
  assert.match(e.sha256,/^[0-9a-f]{64}$/);
 }
 assert.equal(new Set(a.entries.map(e=>e.canonicalSha256)).size,107);
 assert.equal(a.managedOnly.length,31);
 assert.ok(a.managedOnly.every(m=>m.sqlDigest===null));
 assert.equal(a.counts.unattested,107);assert.equal(a.complete,false);
});

test("actual drift: expected digest evidence attests entries; tampered or foreign evidence rejects",()=>{
 const base=real();
 const full=real({expectedText:expectedFor(base,107)});
 assert.equal(full.complete,true);assert.equal(full.counts.attested,107);
 assert.equal(full.sourceOnlyDigestSetSha256,base.sourceOnlyDigestSetSha256);
 const part=real({expectedText:expectedFor(base,10)});
 assert.equal(part.counts.attested,10);assert.equal(part.unattestedFiles.length,97);
 assert.throws(()=>real({expectedText:expectedFor(base,10),requireComplete:true}),/RC40_EVIDENCE_INCOMPLETE:97_UNATTESTED/);
 const ex=JSON.parse(expectedFor(base,3));ex.entries[1].sha256="0".repeat(64);
 assert.throws(()=>real({expectedText:JSON.stringify(ex)}),/RC40_EXPECTED_DIGEST_MISMATCH:/);
 const foreign=JSON.parse(expectedFor(base,1));
 foreign.entries.push({file:drift.common_versions[0].source_filename,sha256:"1".repeat(64)});
 assert.throws(()=>real({expectedText:JSON.stringify(foreign)}),/EXPECTED_FILE_NOT_SOURCE_ONLY/);
 const dup=JSON.parse(expectedFor(base,2));dup.entries.push(dup.entries[0]);
 assert.throws(()=>real({expectedText:JSON.stringify(dup)}),/EXPECTED_DUPLICATE/);
 const mal=JSON.parse(expectedFor(base,1));mal.entries[0].sha256="xyz";
 assert.throws(()=>real({expectedText:JSON.stringify(mal)}),/EXPECTED_DIGEST_MALFORMED/);
});

test("predeploy migration-digests and RC38 plan evidence formats are accepted by version/file",()=>{
 const base=real(),e0=base.entries[0],e1=base.entries[1];
 const pre=JSON.stringify({schema:"qf.vox.rc38.migration-digests.v1",migrations:[{version:e0.version,forwardSha256:e0.canonicalSha256,rollbackSha256:"a".repeat(64)}]});
 assert.equal(real({expectedText:pre}).counts.attested,1);
 const plan=JSON.stringify({schema:"qf.vox.rc38.staged-migration-dryrun.v1",stages:[{file:e1.file,version:e1.version,forwardSha256:e1.canonicalSha256}]});
 assert.equal(real({expectedText:plan}).counts.attested,1);
 const wrongVer=JSON.stringify({schema:"qf.vox.rc38.migration-digests.v1",migrations:[{version:"29990101000000",forwardSha256:e0.canonicalSha256}]});
 assert.throws(()=>real({expectedText:wrongVer}),/EXPECTED_FILE_NOT_SOURCE_ONLY/);
 assert.throws(()=>real({expectedText:JSON.stringify({schema:"nope"})}),/EXPECTED_SCHEMA/);
});

test("actual drift: missing and extra source files are rejected",()=>{
 const d=tmp(),src=join(d,"m");cpSync(DEFAULT_SOURCE_DIR,src,{recursive:true});
 const run=()=>collectSourceSqlDigests({driftText,sourceDir:src});
 assert.equal(run().entries.length,107);
 writeFileSync(join(src,"notes.txt"),"non-sql noise is ignored");
 assert.equal(run().entries.length,107);
 writeFileSync(join(src,"29990101000000_extra.sql"),"select 1;\n");
 assert.throws(run,/RC40_EXTRA_SOURCE_FILE:29990101000000_extra.sql/);
 rmSync(join(src,"29990101000000_extra.sql"));
 const gone=drift.source_only[5];
 rmSync(join(src,gone));
 assert.throws(run,new RegExp("RC40_MISSING_SOURCE_FILE:"+gone));
});

test("drift record validation: counts, duplicates, read-only flags, filenames",()=>{
 const mut=f=>{const c=structuredClone(drift);f(c);return JSON.stringify(c);};
 assert.equal(parseDrift(driftText).files.length,107);
 assert.throws(()=>parseDrift(mut(c=>{c.source_only_count=106})),/DRIFT_SOURCE_ONLY_COUNT/);
 assert.throws(()=>parseDrift(mut(c=>{c.source_only[1]=c.source_only[0]})),/DUPLICATE_SOURCE_ONLY_FILE/);
 assert.throws(()=>parseDrift(mut(c=>{c.managed_writes=true})),/DRIFT_NOT_READ_ONLY/);
 assert.throws(()=>parseDrift(mut(c=>{c.source_only[0]="../x.sql"})),/DRIFT_FILENAME_INVALID/);
 assert.throws(()=>parseDrift(mut(c=>{c.source_only[1]=c.source_only[0].replace(/_.*/,"_other.sql")})),/DUPLICATE_SOURCE_ONLY_VERSION/);
 assert.throws(()=>parseDrift(mut(c=>{c.source_only[0]=c.common_versions[0].source_filename})),/DRIFT_SOURCE_ONLY_OVERLAPS_COMMON/);
 assert.throws(()=>parseDrift("{"),/DRIFT_UNPARSEABLE/);
 assert.throws(()=>parseDrift(mut(c=>{c.schema="x"})),/DRIFT_SCHEMA/);
});

test("fixture: raw vs canonical digests, CRLF stable, duplicates and empty files rejected",()=>{
 const fx=fixture();
 const ev=fx.run();
 assert.equal(ev.entries.length,2);
 const b=ev.entries[1];
 assert.notEqual(b.sha256,b.canonicalSha256);
 assert.equal(b.canonicalSha256,canonicalSqlDigest("select 2;\n"));
 assert.equal(ev.managedOnly[0].sqlDigest,null);
 writeFileSync(join(fx.src,"20270101000002_b.sql"),"select 1;\n"); // same canonical digest as _a
 assert.throws(()=>fx.run(),/RC40_DUPLICATE_DIGEST:/);
 writeFileSync(join(fx.src,"20270101000002_b.sql"),"");
 assert.throws(()=>fx.run(),/RC40_EMPTY_SOURCE_FILE/);
});

test("fixture: quarantined/protected digests are rejected even when renamed",()=>{
 const fx=fixture();
 const pdir=join(fx.d,"prot");mkdirSync(pdir);
 writeFileSync(join(pdir,"legacy.sql"),"select 2;\n");
 assert.throws(()=>fx.run({protectedRoots:["prot"]}),/RC40_PROTECTED_OR_QUARANTINED_DIGEST:20270101000002_b.sql/);
 assert.equal(fx.run().entries.length,2);
});

test("actual repo quarantined SQL: a copy posing as a source-only file is rejected",()=>{
 const q="ops/vox/quarantined-migrations/legacy-20261014/20261014010000_vox_v1_scoped_staff_authority.sql";
 const fx=fixture();
 writeFileSync(join(fx.src,"20270101000001_a.sql"),readFileSync(join(repo,q)));
 assert.throws(()=>fx.run({repoRootDir:repo,protectedRoots:undefined}),/RC40_PROTECTED_OR_QUARANTINED_DIGEST:20270101000001_a.sql/);
});

test("secrets in evidence input are refused",()=>{
 const ex=JSON.parse(expectedFor(real(),1));ex.note="postgresql://u:p@host/db";
 assert.throws(()=>real({expectedText:JSON.stringify(ex)}),/RC40_SECRET_IN_INPUT/);
});

test("append-only chain: previous evidence may be extended but never altered",()=>{
 const fx=fixture();
 const first=fx.run();
 const second=fx.run({prevText:JSON.stringify(first)});
 assert.equal(second.prevEvidenceSha256,first.evidenceSha256);
 const clone=()=>JSON.parse(JSON.stringify(first));
 const tampered=clone();tampered.entries[0].canonicalSha256="f".repeat(64);
 assert.throws(()=>fx.run({prevText:JSON.stringify(tampered)}),/PREV_TAMPERED/);
 const forged=clone();forged.entries[0].canonicalSha256="f".repeat(64);
 assert.throws(()=>fx.run({prevText:seal(forged)}),/PREV_DIGEST_CHANGED/);
 const shrunk=clone();shrunk.entries.push({file:"20270101000009_gone.sql",canonicalSha256:"e".repeat(64)});
 assert.throws(()=>fx.run({prevText:seal(shrunk)}),/PREV_ENTRY_REMOVED/);
 assert.throws(()=>fx.run({prevText:JSON.stringify({schema:"x"})}),/PREV_INVALID/);
});

test("CLI: writes once, refuses overwrite, rejects bad flags, real run exits 0",()=>{
 const d=tmp(),out=join(d,"ev.json");
 const logs=[];
 assert.equal(runCli(["--out",out],{log:m=>logs.push(m),err(){}}),0);
 const ev=JSON.parse(readFileSync(out,"utf8"));
 assert.equal(ev.schema,RC40_SCHEMA);assert.equal(ev.entries.length,107);
 assert.ok(logs[0].includes(ev.evidenceSha256));
 const before=readFileSync(out,"utf8");
 assert.equal(runCli(["--out",out],quiet()),1);
 assert.equal(readFileSync(out,"utf8"),before);
 assert.equal(runCli([],quiet()),1);
 assert.equal(runCli(["--bogus","x","--out",join(d,"b.json")],quiet()),1);
 assert.equal(runCli(["--out"],quiet()),1);
 assert.equal(runCli(["--out",join(d,"c.json"),"--out",join(d,"d.json")],quiet()),1);
 const out2=join(d,"ev2.json");
 assert.equal(runCli(["--out",out2,"--prev",out],quiet()),0);
 assert.equal(JSON.parse(readFileSync(out2,"utf8")).prevEvidenceSha256,ev.evidenceSha256);
 const out3=join(d,"ev3.json");
 assert.equal(runCli(["--out",out3,"--source-dir",join(d,"nope")],quiet()),1);
 assert.equal(existsSync(out3),false);
 const out4=join(d,"ev4.json");
 assert.equal(runCli(["--out",out4,"--require-complete"],quiet()),1);
 assert.equal(existsSync(out4),false);
 // feeding the collector's own output back as expected evidence is not an accepted schema
 assert.equal(runCli(["--out",join(d,"e.json"),"--expected",out],quiet()),1);
});

test("collector source never touches DB, network or env",()=>{
 const src=readFileSync(join(here,"rc40-source-sql-digest-collector.mjs"),"utf8");
 assert.doesNotMatch(src,/process\.env|child_process|from "node:(?:net|http|https|dns|tls)"|fetch\(/);
});
