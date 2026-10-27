import test from "node:test";import assert from "node:assert/strict";
import {prepareAb7OperationsAdvisory as advisory}
 from "../../../contracts/vox/ab7OperationsAdvisory.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
function args(){return {enabled:true,cityId:id(1),teamId:id(2),
 sourceRevision:1,metrics:{deadLetter:2,duplicateRejected:1,
 inFlight:4,pending:5,processed:10,revokedGrants:1,retrying:2,staleLeases:1},
 verifyCurrentInternalCoreMetrics:async()=>true};}
test("AB7E sanitized counts yield only deterministic owner review",async()=>{
 const r=await advisory(args());assert.equal(r.ok,true);
 assert.equal(r.alerts.length,4);
 assert.equal(r.executionAuthorized,false);
 assert.equal(r.canChangeCredits,false);
 assert.equal(r.canOverrideThreeVendorLimit,false);
 assert.equal(r.providerMessagesSent,0);
});
test("AB7E denies replayed stale metrics and browser claimed overrides",async()=>{
 const a=args();
 for(const p of [
  {enabled:false},
  {metrics:{...a.metrics,deadLetter:-1}},
  {metrics:{...a.metrics,leadReassignment:9}},
  {metrics:{...a.metrics,processed:"500"}},
  {verifyCurrentInternalCoreMetrics:async()=>false},
  {sourceRevision:0}
 ])assert.equal((await advisory({...a,...p})).ok,false);
});
test("AB7E quiet window creates no fake alert",async()=>{
 const a=args();
 const result=await advisory({...a,
  metrics:Object.fromEntries(Object.keys(a.metrics).map(x=>[x,0]))});
 assert.equal(result.ok,true);assert.deepEqual(result.alerts,[]);
});
test("AB7E service health uncertainty stops advisory, notifies nobody",async()=>{
 const a=args();
 const r=await advisory({...a,
  verifyCurrentInternalCoreMetrics:async()=>{throw Error("timeout")}});
 assert.equal(r.ok,false);assert.equal(r.providerMessagesSent,0);
});
