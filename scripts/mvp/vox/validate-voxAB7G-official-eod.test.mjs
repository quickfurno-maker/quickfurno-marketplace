import test from "node:test";import assert from "node:assert/strict";
import {publishReviewedEod as publish} from "../../../contracts/vox/ab7gOfficialEodRelease.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const spec=()=>({environment:"staging",enabled:true,reportId:id(1),
 ownerId:id(2),teamLeaderId:id(3),nonce:id(4),sourceDigest:"a".repeat(64),
 verifyCurrentOwnerAal2:async()=>true,
 verifyCurrentIndependentTlAal2:async()=>true,
 verifyPinnedApprovalAndSigner:async()=>true,
 verifyUnmodifiedNativeSources:async()=>true,
 rpc:async()=>({data:[{publication_report_id:id(1),receipt_nonce:id(4),
 source_sha256:"a".repeat(64),publication_state:"OFFICIALLY_RELEASED_BY_OWNER"}]})});
test("AB7G real official ledger receipt is distinct from pending report",async()=>{
 const x=await publish(spec());assert.equal(x.ok,true);
 assert.equal(x.official,true);assert.equal(x.productionCertified,false);
});
test("AB7G denied before RPC absent reviewer, Owner, exact source, staging",async()=>{
 for(const p of [{environment:"production"},{enabled:false},
  {verifyCurrentOwnerAal2:async()=>false},
  {verifyCurrentIndependentTlAal2:async()=>false},
  {verifyPinnedApprovalAndSigner:async()=>false},
  {verifyUnmodifiedNativeSources:async()=>false}]){
  let called=0;const r=await publish({...spec(),...p,
   rpc:async()=>{called++;return {data:[]}}});
  assert.equal(r.ok,false);assert.equal(called,0);
 }
});
test("AB7G wrong immutable receipt, replay, ambiguous transport denies",async()=>{
 assert.equal((await publish({...spec(),rpc:async()=>({data:[]})})).ok,false);
 assert.equal((await publish({...spec(),rpc:async()=>({data:[{
  publication_report_id:id(1),receipt_nonce:id(9),
  source_sha256:"a".repeat(64),publication_state:"OFFICIALLY_RELEASED_BY_OWNER"
 }]})})).ok,false);
 assert.equal((await publish({...spec(),rpc:async()=>{throw Error("unknown")}})).ok,false);
});
