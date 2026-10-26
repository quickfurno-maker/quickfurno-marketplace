import test from "node:test";
import assert from "node:assert/strict";
import {reconcileStaffAuthAfterCoreFence as run} from "../../../contracts/vox/ab7gAuthSessionReconciliation.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const spec=()=>({environment:"staging",enabled:true,
 targetId:id(1),ownerId:id(2),reviewerId:id(3),suspensionNonce:id(4),
 verifyIndependentSuspensionReceipt:async()=>true,
 verifyCurrentOwnerAal2:async()=>true,
 verifyCurrentTargetIsDisabled:async()=>true,
 requestGlobalSessionRevoke:async()=>({accepted:true,targetId:id(1),nonce:id(4)}),
 verifyGlobalSessionRevoke:async()=>true});
test("AB7G confirmed Auth provider result is distinct from Core revocation",async()=>{
 const x=await run(spec());assert.equal(x.ok,true);
 assert.equal(x.authSessionsInvalidated,false);assert.equal(x.refreshSessionsRevokedVerified,true);
 assert.equal(x.activeJwtMayRemainValid,true);assert.equal(x.productionCertified,false);
});
test("AB7G stage and identity checks deny before Auth request",async()=>{
 for(const patch of [{enabled:false},{environment:"production"},
  {targetId:id(2)},{verifyIndependentSuspensionReceipt:async()=>false},
  {verifyCurrentOwnerAal2:async()=>false},{verifyCurrentTargetIsDisabled:async()=>false}]){
  let calls=0;
  const x=await run({...spec(),...patch,requestGlobalSessionRevoke:async()=>{
   calls++;return {accepted:true,targetId:id(1),nonce:id(4)};
  }});
  assert.equal(x.ok,false);assert.equal(calls,0);
 }
});
test("AB7G mere provider acceptance does not certify global invalidation",async()=>{
 assert.equal((await run({...spec(),verifyGlobalSessionRevoke:async()=>false})).authSessionsInvalidated,false);
 assert.equal((await run({...spec(),requestGlobalSessionRevoke:async()=>({accepted:true,targetId:id(1),nonce:id(9)})})).ok,false);
});
