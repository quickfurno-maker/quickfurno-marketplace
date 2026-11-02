
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {evaluateReadOnlyAal2Probe} from "../../../contracts/vox/stagingAal2Probe.mjs";
import {protectedInputs,runProbe} from "./run-to04j-protected-aal2.mjs";
const base={ok:true,schema:"qf.vox.work.queue.preview.v1",
 mode:"READ_ONLY",actionsEnabled:false,boundedWindow:true,
 completeness:"BOUNDED_NOT_TOTAL",items:[]};
const statuses={anonymous:{status:403},aal1:{status:403},
 foreignCity:{status:403},scoped:{status:200,body:base}};
test("staging read-only positive and three negative HTTP results never authorize release",()=>{
 const r=evaluateReadOnlyAal2Probe(statuses);
 assert.equal(r.ok,true);assert.equal(r.releaseAuthorized,false);
 assert.equal(r.observed.scopedAal2ReadOnly,true);
 assert.equal(r.requiresSignedIndependentHumanReview,true);
});
test("disabled schema/feature or privileged response is never accepted",()=>{
 assert.equal(evaluateReadOnlyAal2Probe({...statuses,scoped:{status:503}}).ok,false);
 assert.equal(evaluateReadOnlyAal2Probe({...statuses,aal1:{status:200,body:base}}).ok,false);
 assert.equal(evaluateReadOnlyAal2Probe({...statuses,foreignCity:{status:200,body:base}}).ok,false);
 assert.equal(evaluateReadOnlyAal2Probe({...statuses,anonymous:{status:200,body:base}}).ok,false);
 assert.equal(evaluateReadOnlyAal2Probe({...statuses,scoped:{status:200,body:{...base,actionsEnabled:true}}}).ok,false);
});
test("unexpected PII fields or unverified action affordances denied",()=>{
 const item={workItemId:"00000000-0000-4000-8000-000000000001",kind:"prospect",
  state:"ASSIGNED",revision:1,updatedAt:"2026-10-15T10:00:00Z",
  assignedToMe:true,canClaim:false,canTransition:false};
 assert.equal(evaluateReadOnlyAal2Probe({...statuses,scoped:{status:200,body:{...base,items:[item]}}}).ok,true);
 assert.equal(evaluateReadOnlyAal2Probe({...statuses,scoped:{status:200,body:{...base,items:[{...item,phone:"secret"}]}}}).ok,false);
 assert.equal(evaluateReadOnlyAal2Probe({...statuses,scoped:{status:200,body:{...base,items:[{...item,canClaim:true}]}}}).ok,false);
});
const token=n=>["a".repeat(36+n),"b".repeat(36+n),"c".repeat(36+n)].join(".");
const env={VOX_QA_HUMAN_APPROVED_STAGE:"ACKNOWLEDGED_BY_EXTERNAL_HUMAN",
 VOX_QA_EXPECTED_CORE_ORIGIN:"https://staging-core.quickfurno.in",
 VOX_QA_AAL1_TOKEN:token(1),VOX_QA_WRONG_CITY_AAL2_TOKEN:token(2),
 VOX_QA_SCOPED_AAL2_TOKEN:token(3)};
test("no stage network access without a pinned host and three distinct protected tokens",async()=>{
 assert.equal(protectedInputs({}).ready,false);
 assert.equal(protectedInputs({...env,VOX_QA_EXPECTED_CORE_ORIGIN:"https://quickfurno.in"}).ready,false);
 assert.equal(protectedInputs({...env,VOX_QA_SCOPED_AAL2_TOKEN:token(2)}).ready,false);
 let requests=0;
 const r=await runProbe({},()=>{requests++;throw Error("request should not happen");});
 assert.equal(requests,0);assert.equal(r.ok,false);
});
test("probe sends exactly four GETs to pinned staging Core with no redirects and no writes",async()=>{
 const seen=[],statuses=[403,403,403,200];let i=0;
 const fetchImpl=async(url,options)=>{
  seen.push({url,method:options.method,redirect:options.redirect,cache:options.cache});
  const status=statuses[i++];
  return {status,headers:{get:()=>null},json:async()=>base};
 };
 const r=await runProbe(env,fetchImpl);
 assert.equal(r.ok,true);assert.equal(r.releaseAuthorized,false);
 assert.equal(seen.length,4);
 for(const s of seen){
  assert.equal(s.url,"https://staging-core.quickfurno.in/api/vox/v1/work-queue");
  assert.equal(s.method,"GET");assert.equal(s.redirect,"error");assert.equal(s.cache,"no-store");
 }
 const src=readFileSync(new URL("./run-to04j-protected-aal2.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(src,/method:"POST"|method:"PATCH"|method:"DELETE"|inviteUserByEmail/);
});
