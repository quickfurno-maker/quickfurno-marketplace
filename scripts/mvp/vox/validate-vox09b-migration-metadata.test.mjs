import test from "node:test";
import assert from "node:assert/strict";
import {compareVoxMigrationLedgers as compare} from "../../../contracts/vox/migrationParityEvidence.mjs";
const md5="a".repeat(32),other="b".repeat(32);
const row=(i)=>({version:String(20261016000000+i),name:"synthetic_migration_"+i,bodyMd5:md5});
const stage=()=>Array.from({length:86},(_,i)=>row(i+1));
const prod=()=>[...Array.from({length:34},(_,i)=>({
 ...row(i+1),bodyMd5:i<7?other:md5
 })),...Array.from({length:52},(_,i)=>row(i+100))];
test("actual observed ledgers' *counts* reproduced in synthetic comparison",()=>{
 const r=compare({staging:stage(),production:prod()});
 assert.equal(r.ok,true);assert.equal(r.stagingRows,86);assert.equal(r.productionRows,86);
 assert.equal(r.commonVersions,34);assert.equal(r.stagingOnlyVersions,52);
 assert.equal(r.productionOnlyVersions,52);
 assert.equal(r.sharedSqlDigestMismatches,7);
 assert.equal(r.sharedNameMismatches,0);
 assert.equal(r.safeToApplySql,false);assert.equal(r.approvalGranted,false);
});
test("even byte-identical metadata cannot self-approve DBA or AppSec",()=>{
 const a=stage(),r=compare({staging:a,production:a});
 assert.equal(r.ok,true);assert.equal(r.sharedSqlDigestMismatches,0);
 assert.equal(r.canonicalManagedMigrationApproved,false);
 assert.equal(r.globalPrivilegesReconciled,false);
 assert.equal(r.releasePermitted,false);
});
test("duplicate, forged, malformed rows refused",()=>{
 for(const changed of [
  [...stage(),stage()[0]],
  stage().map((x,i)=>i===0?{...x,bodyMd5:"HASHED"}:x),
  stage().map((x,i)=>i===0?{...x,name:"path/../private"}:x),
  stage().map((x,i)=>i===0?{...x,sql:"DROP TABLE"}:x),
  stage().map((x,i)=>i===0?{...x,version:"XX"}:x),
  stage().map((x,i)=>i===0?{...x,bodyMd5:"\\"+md5}:x)
 ]){
  assert.equal(compare({staging:changed,production:prod()}).ok,false);
 }
});
test("renamed version reported separately from changed SQL hash",()=>{
 const a=stage(),b=stage();b[0]={...b[0],name:"some_new_name"};
 const r=compare({staging:a,production:b});
 assert.equal(r.sharedNameMismatches,1);
 assert.equal(r.sharedSqlDigestMismatches,0);
});
test("no raw SQL, usernames, file paths or credentials in report",()=>{
 const text=JSON.stringify(compare({staging:stage(),production:prod()}));
 for(const value of ["password","statement","DROP TABLE","clientUserId",
   "sqlText","filePath","ownerEmail"])assert.equal(text.includes(value),false);
});
test("empty SQL rows counted but cannot claim reconciled",()=>{
 const a=stage(),b=prod();
 a[0].bodyMd5="d41d8cd98f00b204e9800998ecf8427e";
 b[0].bodyMd5="d41d8cd98f00b204e9800998ecf8427e";
 const r=compare({staging:a,production:b});
 assert.equal(r.stagingEmptyBodies,1);assert.equal(r.productionEmptyBodies,1);
 assert.equal(r.safeToApplySql,false);
});
test("bounds input to no more than 500 items or unknown shape",()=>{
 assert.equal(compare({staging:[],production:[]}).ok,false);
 assert.equal(compare({staging:[...stage(),...stage(),...stage(),...stage(),...stage(),...stage()],production:prod()}).ok,false);
 assert.equal(compare().releasePermitted,false);
});
