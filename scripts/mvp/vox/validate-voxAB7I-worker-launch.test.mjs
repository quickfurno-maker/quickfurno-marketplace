import test from "node:test";import assert from "node:assert/strict";
import {authorizeAb7iInternalWorker as run}
 from "../../../contracts/vox/ab7iWorkerLaunchPreflight.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.now(),releaseSha256="a".repeat(64),dbSchemaSha256="b".repeat(64);
const spec=()=>({environment:"staging",enabled:true,workerId:id(1),
 releaseSha256,dbSchemaSha256,now,
 operatorAal2Proof:{verified:true,subjectId:id(2)},
 independentReleaseProof:{verified:true,subjectId:id(3),
 releaseSha256,schemaSha256:dbSchemaSha256,issuedAtMs:now-1000,expiresAtMs:now+60000},
 verifyCurrentSignedOwnerGate:async()=>true,
 verifySchemaFingerprint:async()=>true,verifyNoProviders:async()=>true});
test("AB7I verified readiness never automatically starts a worker or provider",async()=>{
 const x=await run(spec());assert.equal(x.ok,true);assert.equal(x.canStart,false);
 assert.equal(x.actualWorkerStarted,false);assert.equal(x.outboundMessagingEnabled,false);
});
test("AB7I revoked Owner, unknown DB fingerprint, provider non-isolation fail",async()=>{
 for(const patch of [{verifyCurrentSignedOwnerGate:async()=>false},
 {verifySchemaFingerprint:async()=>false},{verifyNoProviders:async()=>false},
 {independentReleaseProof:{...spec().independentReleaseProof,subjectId:id(2)}},
 {environment:"production"},{enabled:false}]){
  const x=await run({...spec(),...patch});assert.equal(x.ok,false);
  assert.equal(x.actualWorkerStarted,false);
 }
});
