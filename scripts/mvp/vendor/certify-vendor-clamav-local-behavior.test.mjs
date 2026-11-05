import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {probeLocalClamavBehavior} from "./certify-vendor-clamav-local-behavior.mjs";

test("local clean and EICAR signature outcomes are independently required",async()=>{
 const lengths=[];
 const result=await probeLocalClamavBehavior(async bytes=>{
  lengths.push(bytes.length);
  return lengths.length===1?"clean":"infected";
 });
 assert.equal(lengths.length,2);
 assert.ok(lengths[0]>8);
 assert.equal(lengths[1],68);
 assert.equal(result.behaviorObserved,true);
 assert.equal(result.result,"LOCAL_SIGNATURE_BEHAVIOR_OBSERVED");
 assert.equal(result.engineBinaryAttested,false);
 assert.equal(result.signatureDatabaseAttested,false);
 assert.equal(result.canEnablePrivateScan,false);
 assert.equal(result.releaseDecision,"HOLD");
});
test("simulated all-clean engine cannot pass the malware signature control",async()=>{
 const r=await probeLocalClamavBehavior(async()=>"clean");
 assert.equal(r.behaviorObserved,false);
 assert.equal(r.eicarControl,"clean");
 assert.equal(r.canEnableEvidenceReview,false);
});
test("missing daemon, signature uncertainty or swapped verdicts remain blocked",async()=>{
 for(const verdicts of [
   ["unavailable","unavailable"],["clean","unavailable"],
   ["infected","clean"],["unavailable","infected"],
 ]){
  let i=0;
  const r=await probeLocalClamavBehavior(async()=>verdicts[i++]);
  assert.equal(r.behaviorObserved,false);
  assert.equal(r.releaseDecision,"HOLD");
 }
});
test("probe is loopback-only and never certifies real managed Staging or scans documents",()=>{
 const cli=readFileSync(resolve(import.meta.dirname,"certify-vendor-clamav-local-behavior.mjs"),"utf8");
 const scanner=readFileSync(resolve(import.meta.dirname,"../../../lib/vendors/privateClamavScanner.mjs"),"utf8");
 assert.match(cli,/scanPrivateDocumentWithLocalClamav/);
 assert.match(scanner,/const LOOPBACK="127.0.0.1"/);
 assert.doesNotMatch(cli,/createClient|supabase|fetch\(|\.storage\.|\.rpc\(|upload\(|writeFileSync/);
 assert.match(cli,/canEnablePrivateScan:false,canEnableEvidenceReview:false/);
});
