import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,cpSync,mkdtempSync,rmSync,writeFileSync,readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {VENDOR_ADDITIONAL_FILES,validatePinnedVendorPendingFiles}
 from "./rc-launch-vendor-pending-source-addendum.mjs";
import {MIGRATIONS} from "../vendor/vendor-seven-migration-fingerprint.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const dir=resolve(root,"supabase/migrations");
const sha=x=>createHash("sha256").update(x).digest("hex");
const names=()=>readdirSync(dir).filter(n=>/^\d{14}_.+\.sql$/.test(n));
const ledger=()=>JSON.parse(readFileSync(resolve(root,
 "supabase/staging-history/qf-post-g1-migration-ledger-20260929.json"),"utf8"));

test("all seven exact November SQL bytes present and no managed release GO",()=>{
 const actual=validatePinnedVendorPendingFiles({names:names(),sourceDir:dir});
 assert.equal(actual.count,7);
 assert.equal(actual.verified,true);
 assert.equal(actual.applied,false);
 assert.equal(actual.releaseGo,false);
 assert.equal(actual.managedStagingVerified,false);
 assert.equal(actual.managedProductionVerified,false);
 assert.equal(actual.authorizesDeployment,false);
 assert.deepEqual(actual.files,VENDOR_ADDITIONAL_FILES);
});
test("preserve exact original 51 historic post-G1 source pins plus seven new PENDING rows",()=>{
 const r=ledger().records;
 assert.equal(r.length,58);
 assert.equal(sha(JSON.stringify(r.slice(0,51))),
  "8a5364be05415b4e8b7a52a3114e6099783a3ecf63f2ca0fcdb9cbf94c21c01d");
 assert.deepEqual(r.slice(51).map(x=>x.filename),VENDOR_ADDITIONAL_FILES);
 for(const row of r.slice(51)){
  assert.equal(row.exactVersionPresence.staging,false);
  assert.equal(row.exactVersionPresence.production,false);
  assert.match(row.evidence,/^SOURCE_PIN_CREATED_2026-11-04_.*NO_REMOTE_APPLY$/);
  assert.equal(row.canonicalSha256,sha(readFileSync(resolve(dir,row.filename))));
 }
});
test("a missing, changed or incomplete new source fails closed",()=>{
 assert.throws(()=>validatePinnedVendorPendingFiles({
  names:names().filter(x=>x!==VENDOR_ADDITIONAL_FILES[0]),sourceDir:dir,
 }),/VENDOR_ADDENDUM_INCOMPLETE/);
 const tmp=mkdtempSync(join(tmpdir(),"qf-vendor-pending-"));
 try{
  for(const filename of VENDOR_ADDITIONAL_FILES)
   cpSync(resolve(dir,filename),join(tmp,filename));
  writeFileSync(join(tmp,VENDOR_ADDITIONAL_FILES[0]),Buffer.from("select 1;\n"));
  assert.throws(()=>validatePinnedVendorPendingFiles({
   names:VENDOR_ADDITIONAL_FILES,sourceDir:tmp
  }),/VENDOR_ADDENDUM_RAW_SHA_DRIFT/);
 }finally{rmSync(tmp,{force:true,recursive:true});}
});
test("only missing entire addendum may be accepted as historic snapshot; never as certified",()=>{
 const old=names().filter(x=>!VENDOR_ADDITIONAL_FILES.includes(x));
 const r=validatePinnedVendorPendingFiles({names:old,sourceDir:dir,allowAbsent:true});
 assert.equal(r.verified,false);
 assert.equal(r.count,0);
 assert.throws(()=>validatePinnedVendorPendingFiles({names:old,sourceDir:dir}),
  /VENDOR_ADDENDUM_INCOMPLETE/);
 assert.equal(new Set(MIGRATIONS.map(([file])=>file)).size,7);
});
