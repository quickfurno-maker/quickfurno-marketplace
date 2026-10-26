import test from "node:test";import assert from "node:assert/strict";
import {persistIndependentlyReviewedEod as run} from "../../../contracts/vox/ab7fEodCoreWriter.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const spec=()=>({environment:"staging",enabled:true,staffId:id(1),
 teamLeaderId:id(2),teamId:id(3),cityId:id(4),nonce:id(5),
 businessDate:"2026-10-17",sourceDigest:"a".repeat(64),
 verifyPinnedFourSignatures:async()=>true,
 verifyCurrentIndependentTlAal2:async()=>true,
 verifyCurrentCoreSources:async()=>true,
 rpc:async()=>({data:[{report_id:id(6),receipt_nonce:id(5),source_count:4,
 report_state:"TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE",published:false}]})});
test("AB7F durable 4-source EOD is NEVER official without Owner release",async()=>{
 const x=await run(spec());assert.equal(x.ok,true);
 assert.equal(x.persisted,true);assert.equal(x.official,false);assert.equal(x.published,false);
});
test("AB7F 4 current signers / independent TL / Core sources checked before RPC",async()=>{
 for(const p of [{enabled:false},{environment:"production"},
  {staffId:id(2)},{verifyPinnedFourSignatures:async()=>false},
  {verifyCurrentIndependentTlAal2:async()=>false},
  {verifyCurrentCoreSources:async()=>false}]){
  let n=0;const x=await run({...spec(),...p,rpc:async()=>{n++;return {data:[]}}});
  assert.equal(x.ok,false);assert.equal(n,0);
 }
});
test("AB7F wrong source count or forged published receipt never trusted",async()=>{
 for(const data of [[],[{report_id:id(6),receipt_nonce:id(5),source_count:3,
 report_state:"TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE",published:false}],
 [{report_id:id(6),receipt_nonce:id(5),source_count:4,
 report_state:"TL_ACKNOWLEDGED_AWAITING_OWNER_RELEASE",published:true}]]){
  assert.equal((await run({...spec(),rpc:async()=>({data})})).ok,false);
 }
});
