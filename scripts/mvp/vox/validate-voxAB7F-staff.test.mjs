import test from "node:test";import assert from "node:assert/strict";
import {suspendCoreStaffGrants as run} from "../../../contracts/vox/ab7fStaffCoreSuspend.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const spec=()=>({environment:"staging",enabled:true,ownerId:id(1),
 reviewerId:id(2),targetId:id(3),teamId:id(4),cityId:id(5),nonce:id(6),
 verifyFreshOwnerAal2:async()=>true,verifyFreshTlAal2:async()=>true,
 verifySignedIndependentDecision:async()=>true,
 rpc:async()=>({data:[{department_grants_revoked:2,object_scopes_revoked:3,
 target_id:id(3),receipt_nonce:id(6)}]})});
test("AB7F native Core grant suspension receipt NOT GoTrue logout",async()=>{
 const out=await run(spec());assert.equal(out.ok,true);assert.equal(out.authSessionsInvalidated,false);
 assert.equal(out.departmentGrantsRevoked,2);assert.equal(out.productionCertified,false);
});
test("AB7F never calls RPC without signed independent AAL2 + staging",async()=>{
 for(const p of [{environment:"production"},{enabled:false},
 {reviewerId:id(1)},{verifyFreshTlAal2:async()=>false},
 {verifySignedIndependentDecision:async()=>false}]){
 let called=0;const x=await run({...spec(),...p,rpc:async()=>{called++;return {data:[]}}});
 assert.equal(x.ok,false);assert.equal(called,0);
 }
});
test("AB7F rejects forged, ambiguous or partial Core receipts",async()=>{
 for(const data of [[],[{department_grants_revoked:-1,object_scopes_revoked:2,
 target_id:id(3),receipt_nonce:id(6)}],
 [{department_grants_revoked:2,object_scopes_revoked:3,
 target_id:id(3),receipt_nonce:id(9)}]]){
  assert.equal((await run({...spec(),rpc:async()=>({data})})).ok,false);
 }
 assert.equal((await run({...spec(),rpc:async()=>{throw Error("unknown")}})).ok,false);
});
