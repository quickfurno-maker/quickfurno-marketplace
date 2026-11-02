import test from "node:test";
import assert from "node:assert/strict";
import {prepareInternalRecoveryReview as prepare} from "../../../contracts/vox/ab7WorkerRecoveryFence.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-18T04:00:00Z");
const viewer={role:"superadmin",currentAal:"aal2"};
const rows=[{id:id(1),state:"LEASED",attempts:2,leaseExpiresAtMs:now-1,
 nextAttemptAtMs:now-10000,providerBound:false},
 {id:id(2),state:"DEAD_LETTER",attempts:5,leaseExpiresAtMs:null,
 nextAttemptAtMs:now-10000,providerBound:false},
 {id:id(3),state:"OUTCOME_UNKNOWN",attempts:2,leaseExpiresAtMs:null,
 nextAttemptAtMs:now-10000,providerBound:false}];
const opts=()=>({viewer,rows,now,verifyCurrentOwnerAal2:async()=>true,
 verifyCurrentCoreJob:async()=>true});
test("AB7E anomalies suggest manual review only",async()=>{
 const r=await prepare(opts());assert.equal(r.ok,true,r.reason);
 assert.deepEqual(r.recoveryCandidates.map(x=>x.issue),
  ["STALE_LEASE","DEAD_LETTER","UNKNOWN_OUTCOME"]);
 assert.equal(r.mayDispatch,false);assert.equal(r.mayRetryAutomatically,false);
 assert.equal(r.externalMessagesSent,0);
});
test("AB7E unknown jobs, scope loss and forged claims deny",async()=>{
 for(const patch of [{viewer:{...viewer,currentAal:"aal1"}},
  {rows:[rows[0],rows[0]]},
  {rows:[{...rows[0],providerBound:true}]},
  {rows:[{...rows[0],attempts:6}]},
  {rows:[{...rows[0],state:"DELIVERED"}]},
  {verifyCurrentCoreJob:async()=>false},
  {verifyCurrentOwnerAal2:async()=>false}]){
  assert.equal((await prepare({...opts(),...patch})).ok,false);
 }
});
test("AB7E missing Core source or reviewer outage never triggers dispatch",async()=>{
 for(const k of ["verifyCurrentOwnerAal2","verifyCurrentCoreJob"]){
  const r=await prepare({...opts(),[k]:async()=>{throw Error("offline")}});
  assert.equal(r.ok,false);assert.equal(r.mayDispatch,false);
 }
});
