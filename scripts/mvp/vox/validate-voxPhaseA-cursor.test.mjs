import test from "node:test";
import assert from "node:assert/strict";
import {issueScopedQueueCursor,verifyScopedQueueCursor}
 from "../../../contracts/vox/phaseAScopedQueueCursor.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-17T16:00:00Z");
const scope={userId:id(1),teamId:id(2),cityId:id(3),
 currentAal:"aal2",canReadContent:true,canMutate:false,
 effectiveGrantsSha256:"a".repeat(64)};
const row={referenceId:id(4),source:"CORE_WORK_LEDGER",
 updatedAt:new Date(now-12000).toISOString()};
const secret="very-long-synthetic-test-secret-not-for-deployment";
const start=()=>issueScopedQueueCursor({scope,lastRow:row,secret,now});
test("Phase A authenticated cursor seals role/team/city/grants and row key",()=>{
 const x=start();assert.equal(x.ok,true);
 assert.equal(x.mayReadNextPage,false);
 const r=verifyScopedQueueCursor({token:x.token,scope,secret,now});
 assert.equal(r.ok,true);assert.equal(r.lastReferenceId,row.referenceId);
 assert.equal(r.requiresCurrentCoreSourceRevision,true);
});
test("Phase A expired, cross-user, cross-city, changed grant and AAL1 denied",()=>{
 const token=start().token;
 for(const patch of [
  {scope:{...scope,userId:id(19)}},
  {scope:{...scope,teamId:id(20)}},
  {scope:{...scope,cityId:id(21)}},
  {scope:{...scope,effectiveGrantsSha256:"b".repeat(64)}},
  {scope:{...scope,currentAal:"aal1"}},
  {scope:{...scope,canReadContent:false}},
  {secret:"a-different-valid-synthetic-test-secret-more-than-32bytes"},
  {now:now+300001}
 ])assert.equal(verifyScopedQueueCursor({token,scope,secret,now,...patch}).ok,false);
});
test("Phase A unsigned tamper and malformed cursor never authorizes page",()=>{
 const token=start().token;
 for(const candidate of [
  token.slice(0,-1)+"x",token+"a",token.replace(".",".."),
  "eyJyb2xlIjoiYWRtaW4ifQ.sig",undefined
 ])assert.equal(verifyScopedQueueCursor({token:candidate,scope,secret,now}).ok,false);
});
test("Phase A keyset proof does not itself enable new source reads",()=>{
 assert.equal(start().mayReadNextPage,false);
 assert.equal(verifyScopedQueueCursor({token:start().token,
  scope,secret,now}).mayReadNextPage,false);
});
