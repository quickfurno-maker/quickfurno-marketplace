import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,rmSync,readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {join,basename} from "node:path";
import {tmpdir} from "node:os";
import {DEFAULT_EVIDENCE} from "./rc40-managed-ledger-reconciler.mjs";
import {assessPrivateCapture} from "./rc52-private-managed-sql-assessment.mjs";
const candidateSha="06fc2a35e49ae0f05d65ac65197a31999dc7338f";
const evidenceText=readFileSync(DEFAULT_EVIDENCE,"utf8");
const ev=JSON.parse(evidenceText);
const dir=mkdtempSync(join(tmpdir(),"vox-rc52-synthetic-"));
const objects=new Map(),summary=[];
const md5=x=>createHash("md5").update(x).digest("hex");
for(const m of ev.managedOnly){
 const values=m.version==="20260722000100"?
  Array.from({length:821},(_,i)=>"SELECT "+i+";"):
  ["SELECT '"+m.version+"';"];
 const chunks=m.version==="20260722000100"?
  Array.from({length:9},(_,i)=>({name:m.version+".part"+String(i+1).padStart(3,"0")+".json",
   o:{version:m.version,name:m.name,from:i*100+1,to:Math.min((i+1)*100,values.length),
    statements:values.slice(i*100,(i+1)*100)}})):
  [{name:m.version+".json",o:{version:m.version,name:m.name,statements:values}}];
 for(const c of chunks)objects.set(c.name,JSON.stringify(c.o));
 summary.push({version:m.version,name:m.name,statement_count:values.length,
  raw_join_md5:md5(values.join("\n"))});
}
objects.set("_verification.json",JSON.stringify({
 schema:"qf.vox.rc52.staging-ledger-second-read.v1",readOnly:true,
 projectName:"QuickFurno Staging",versions:summary}));
const fake={candidateSha,evidenceText,privateDir:dir,
 read:p=>objects.get(basename(p)),
 list:()=>[...objects.keys()],
 stat:()=>({isSymbolicLink:()=>false})};
test("all originals require exact slice coverage plus independent second-read content digest",()=>{
 const v=assessPrivateCapture(fake);
 assert.equal(v.withOriginalSql,31);assert.equal(v.sqlStatementCount,851);
 assert.equal(v.secondReadContentDigestsVerified,31);
 assert.equal(v.releaseGo,false);assert.equal(v.managedWrites,false);
 assert.equal(v.independentOriginalsVerified,false);
});
test("captured SQL edited after read is rejected, never inferred from source",()=>{
 const k=ev.managedOnly.find(m=>m.version!=="20260722000100").version+".json";
 const original=objects.get(k),row=JSON.parse(original);
 row.statements[0]="SELECT 'tampered';";objects.set(k,JSON.stringify(row));
 assert.throws(()=>assessPrivateCapture(fake),/SECOND_READ_CONTENT_DRIFT/);
 objects.set(k,original);
});
test("missing baseline slice, incomplete verification and wrong candidate fail closed",()=>{
 const key="20260722000100.part007.json",before=objects.get(key);
 objects.delete(key);assert.throws(()=>assessPrivateCapture(fake),/BASELINE_SLICE_GAP/);
 objects.set(key,before);
 const v=JSON.parse(objects.get("_verification.json"));v.versions.pop();
 objects.set("_verification.json",JSON.stringify(v));
 assert.throws(()=>assessPrivateCapture(fake),/SECOND_READ_MANIFEST_INVALID/);
 objects.set("_verification.json",JSON.stringify({...v,versions:summary}));
 assert.throws(()=>assessPrivateCapture({...fake,candidateSha:"invalid"}),/EXACT_SHA_REQUIRED/);
});
test("unknown extra captured version cannot silently pass the independent file set",()=>{
 const extra="20990101000000.json";
 objects.set(extra,JSON.stringify({version:"20990101000000",name:"unreviewed",statements:["SELECT 1;"]}));
 assert.throws(()=>assessPrivateCapture(fake),/UNEXPECTED_CAPTURE_FILES/);
 objects.delete(extra);
});
test("captured original migration SQL cannot be placed inside a sibling Git worktree",()=>{
 const worktree=join(dir,"another-checkout"),privatePath=join(worktree,"private-sql");
 mkdirSync(privatePath,{recursive:true});
 writeFileSync(join(worktree,".git"),"gitdir: ../not-a-real-git-dir");
 assert.throws(()=>assessPrivateCapture({...fake,privateDir:privatePath}),
  /PRIVATE_DIR_MUST_BE_OUTSIDE_REPOSITORY/);
});
process.on("exit",()=>rmSync(dir,{recursive:true,force:true}));
