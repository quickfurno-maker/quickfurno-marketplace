import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {
 reconcileInventories,buildSourceInventoryFromDir,canonicalSqlDigest,runCli,
 normaliseManagedInventory
} from "./rc35-migration-inventory-reconcile.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const snapshot=JSON.parse(readFileSync(resolve(root,"docs/vox/VOX-MANAGED-STAGING-MIGRATION-DRIFT-READONLY-20261031.json"),"utf8"));
const to04g=JSON.parse(readFileSync(resolve(root,"ops/vox/certification/TO04G-READONLY-MIGRATION-METADATA.json"),"utf8"));
const source=()=>buildSourceInventoryFromDir(resolve(root,"supabase/migrations"));
const H=c=>c.repeat(64);

test("actual captured metadata: 55 version matches, 31 managed-only, 107 source-only",()=>{
 const src=source();
 assert.equal(src.files.length,snapshot.source_sql_count);
 const r=reconcileInventories(snapshot,src);
 assert.equal(r.counts.managed,86);
 assert.equal(r.counts.managedVersionMatchedInSource,snapshot.common_version_count);
 assert.equal(r.counts.managedOnly,snapshot.staging_only_count);
 // Aliased sources are claimed by managed rows, so source-only shrinks below 107.
 const aliased=new Set(r.managedEntries.flatMap(e=>e.class.startsWith("ALIAS")||e.class==="AMBIGUOUS_ALIAS"?e.sourceCandidates:[]));
 assert.equal(r.counts.sourceOnly+aliased.size,snapshot.source_only_count);
 assert.equal(r.managedClassCounts.MANAGED_BASELINE_SQUASH,1);
 assert.equal(r.managedClassCounts.MANAGED_ONLY_NO_SOURCE,2);
 assert.equal(r.reconciled,false);
 assert.equal(r.releaseGo,false);
});

test("no digests supplied: every version match is blocked as DIGEST_UNAVAILABLE, none accepted",()=>{
 const r=reconcileInventories(snapshot,source());
 assert.equal(r.counts.aliasAccepted,0);
 assert.equal(r.blockers.filter(b=>b.code==="DIGEST_UNAVAILABLE").length,
  r.managedEntries.filter(e=>e.digestStatus==="DIGEST_UNAVAILABLE").length);
 assert.ok(r.blockers.some(b=>b.code==="DUPLICATE_MANAGED_NAME"));
});

test("TO04G staging metadata normalises and reports the same 86 rows",()=>{
 const m=normaliseManagedInventory(to04g);
 assert.equal(m.length,86);
 const r=reconcileInventories(to04g,source());
 assert.equal(r.counts.managed,86);
});

test("deterministic: input order does not change the report hash",()=>{
 const a=reconcileInventories(snapshot,source());
 const src=source();
 const b=reconcileInventories(snapshot,{files:src.files.slice().reverse()});
 assert.equal(a.reportSha256,b.reportSha256);
 assert.deepEqual(a.blockers,b.blockers);
});

test("digest semantics: match accepts, mismatch blocks, alias needs digest too",()=>{
 const src={files:[
  {file:"20260101000000_a_b_c.sql",canonicalSha256:H("a")},
  {file:"20260102000000_x_y_z.sql",canonicalSha256:H("b")},
  {file:"20260103000000_new_one.sql",canonicalSha256:H("c")}]};
 const managed=[
  {version:"20260101000000",name:"a_b_c",statementsSha256:H("a")},
  {version:"20260102999999",name:"x_y_z_staging_20260102",statementsSha256:H("b")}];
 const r=reconcileInventories(managed,src);
 assert.deepEqual(r.managedEntries.map(e=>[e.class,e.digestStatus,e.accepted]),[
  ["EXACT_VERSION_AND_NAME","DIGEST_MATCH",true],
  ["ALIAS_NORMALISED_NAME","DIGEST_MATCH",true]]);
 assert.equal(r.reconciled,true);
 assert.equal(r.sourceOnly[0].class,"SOURCE_ONLY_APPEND_CANDIDATE");
 const bad=reconcileInventories([{...managed[0],statementsSha256:H("f")}],src);
 assert.ok(bad.blockers.some(b=>b.code==="DIGEST_MISMATCH"));
 assert.equal(bad.managedEntries[0].accepted,false);
});

test("name mismatch at same version, ambiguous alias and double claims block",()=>{
 const src={files:[
  {file:"20260101000000_one_two_three.sql"},
  {file:"20260105000000_dup_name_here.sql"},{file:"20260106000000_dup_name_here.sql"},
  {file:"20260107000000_claimed_once.sql"}]};
 const r=reconcileInventories([
  {version:"20260101000000",name:"other_name_entirely"},
  {version:"20260201000000",name:"dup_name_here"},
  {version:"20260301000000",name:"claimed_once"},
  {version:"20260302000000",name:"claimed_once"}],src);
 const codes=r.blockers.map(b=>b.code);
 for(const c of ["NAME_MISMATCH_AT_SAME_VERSION","AMBIGUOUS_ALIAS","SOURCE_CLAIMED_BY_MULTIPLE_MANAGED_ROWS","DUPLICATE_MANAGED_NAME"])
  assert.ok(codes.includes(c),c);
 assert.equal(r.counts.aliasAccepted,0);
});

test("malformed inputs fail closed",()=>{
 assert.throws(()=>reconcileInventories([{version:"1",name:"x"}],[]),/RC35_MANAGED_ENTRY_INVALID/);
 assert.throws(()=>reconcileInventories([{version:"20260101000000",name:"x",sha256:"zz"}],[]),/RC35_DIGEST_MALFORMED/);
 assert.throws(()=>reconcileInventories({},[]),/RC35_MANAGED_INVENTORY_SHAPE/);
 assert.throws(()=>reconcileInventories([],[{file:"bad.sql"}]),/RC35_SOURCE_ENTRY_INVALID/);
 assert.throws(()=>reconcileInventories([{version:"20260101000000",name:"x"},{version:"20260101000000",name:"y"}],[]),/MANAGED_DUPLICATE_VERSION/);
});

test("canonical digest ignores CRLF and trailing whitespace only",()=>{
 assert.equal(canonicalSqlDigest("select 1;\r\n"),canonicalSqlDigest("select 1;\n\n"));
 assert.notEqual(canonicalSqlDigest("select 1;"),canonicalSqlDigest("select 2;"));
});

test("CLI: injected files, exit 2 on blockers, 0 when reconciled, 1 on bad input",()=>{
 const dir=mkdtempSync(join(tmpdir(),"rc35-"));
 try{
  const mp=join(dir,"m.json"),sp=join(dir,"s.json"),out=join(dir,"o.json");
  writeFileSync(sp,JSON.stringify({files:[{file:"20260101000000_a_b_c.sql",sha256:H("a")}]}));
  writeFileSync(mp,JSON.stringify([{version:"20260101000000",name:"a_b_c"}]));
  const io={log(){},err(){}};
  assert.equal(runCli(["--managed",mp,"--source",sp,"--out",out],io),2);
  assert.equal(JSON.parse(readFileSync(out,"utf8")).blockers[0].code,"DIGEST_UNAVAILABLE");
  writeFileSync(mp,JSON.stringify([{version:"20260101000000",name:"a_b_c",statementsSha256:H("a")}]));
  assert.equal(runCli(["--managed",mp,"--source",sp,"--out",out],io),0);
  assert.equal(runCli(["--managed",mp],io),1);
  writeFileSync(mp,"{");
  assert.equal(runCli(["--managed",mp,"--source",sp],io),1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
