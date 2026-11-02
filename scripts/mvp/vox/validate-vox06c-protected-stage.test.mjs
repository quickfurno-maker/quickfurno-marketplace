import test from "node:test";
import assert from "node:assert/strict";
import {assessProtectedStaffStage} from "../../../contracts/vox/protectedStageReadOnly.mjs";
import {preflight,runStage} from "./run-vox06c-protected-staging.mjs";
const queue={ok:true,schema:"qf.vox.work.queue.preview.v1",
 actionsEnabled:false,mode:"READ_ONLY",items:[]};
const desk={ok:true,view:{schema:"qf.vox.service.desk.v1",
 mode:"READ_ONLY",support:[],humanInbox:[]}};
const myWork={ok:true,view:{schema:"qf.vox.overview.v1",source:"quickfurno-core",
 actionsEnabled:false},staff:{actionsEnabled:false}};
const expected=()=>({
 anonymous:{status:403},aal1:{status:403},
 foreignCity:{status:403},crossTeam:{status:403},
 revoked:{status:403},missingDepartment:{status:403},
 queue:{status:200,body:queue},desk:{status:200,body:desk},
 myWork:{status:200,body:myWork}
});
test("only six true denies and three scoped reads pass; even success NEVER authorizes release",()=>{
 const r=assessProtectedStaffStage(expected());
 assert.equal(r.ok,true);assert.equal(r.releaseAuthorized,false);
 assert.equal(r.requiresHumanDbaAal2ProviderConsentAndRollback,true);
});
test("cross-team, revoked, and missing independent department each fail closed",()=>{
 for(const k of ["anonymous","aal1","foreignCity","crossTeam","revoked","missingDepartment"]){
  const e=expected();e[k]={status:200};assert.equal(assessProtectedStaffStage(e).ok,false,k);
 }
 for(const k of ["queue","desk","myWork"]){
  const e=expected();e[k]={status:503};assert.equal(assessProtectedStaffStage(e).ok,false,k);
 }
});
test("unbounded, executable, or unmasked source is rejected",()=>{
 const all=[{...queue,actionsEnabled:true},{...queue,items:Array.from({length:26},()=>({}))}];
 for(const bad of all){const e=expected();e.queue={status:200,body:bad};
  assert.equal(assessProtectedStaffStage(e).ok,false);}
 const e=expected();e.desk={status:200,body:{...desk,view:{...desk.view,humanInbox:{raw:"secret"}}}};
 assert.equal(assessProtectedStaffStage(e).ok,false);
});
const token=n=>["a".repeat(35+n),"b".repeat(35+n),"c".repeat(35+n)].join(".");
const env={VOX_STAGE_QA_APPROVAL_ACK:"EXTERNAL_REVIEWER_SIGNED_SEPARATELY",
 VOX_STAGE_QA_EXPECTED_ORIGIN:"https://staging-core.quickfurno.in"};
for(const [i,k] of ["AAL1","FOREIGN_CITY","CROSS_TEAM","REVOKED","MISSING_DEPARTMENT","SCOPED"].entries())
 env["VOX_STAGE_QA_"+k+"_TOKEN"]=token(i+1);
test("no live call without protected approval and six distinct real-role token inputs",async()=>{
 assert.equal(preflight({}),false);
 assert.equal(preflight({...env,VOX_STAGE_QA_EXPECTED_ORIGIN:"https://quickfurno.in"}),false);
 assert.equal(preflight({...env,VOX_STAGE_QA_SCOPED_TOKEN:env.VOX_STAGE_QA_REVOKED_TOKEN}),false);
 let requests=0;
 const r=await runStage({},()=>{requests++;throw Error("not called");});
 assert.equal(requests,0);assert.equal(r.ok,false);
});
test("prepared test calls exactly nine pinned read-only GETs without redirect or write",async()=>{
 const seen=[];let counter=0;
 const fetcher=async(url,opts)=>{
  seen.push({url,method:opts.method,redirect:opts.redirect,cache:opts.cache});
  const status=counter++<6?403:200;
  return {status,headers:{get:()=>null},
   json:async()=>url.endsWith("/work-queue")?queue:
    url.endsWith("/desk")?desk:myWork};
 };
 const r=await runStage(env,fetcher);
 assert.equal(r.ok,true);assert.equal(r.releaseAuthorized,false);
 assert.equal(seen.length,9);
 assert.deepEqual(new Set(seen.map(x=>x.url)),new Set([
  "https://staging-core.quickfurno.in/api/vox/v1/work-queue",
  "https://staging-core.quickfurno.in/api/vox/v1/desk",
  "https://staging-core.quickfurno.in/api/vox/v1/my-work"]));
 for(const request of seen){
  assert.equal(request.method,"GET");assert.equal(request.redirect,"error");
  assert.equal(request.cache,"no-store");
 }
});
