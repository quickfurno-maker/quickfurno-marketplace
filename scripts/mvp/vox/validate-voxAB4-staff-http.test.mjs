import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const code=readFileSync(new URL("../../../app/api/vox/v1/ab4-staff-review/route.ts",import.meta.url),"utf8");
const contract=await import("../../../contracts/vox/ab4StaffRequestGateway.mjs");
const js=ts.transpileModule(code,{compilerOptions:{
 target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const ownerId=uuid(1),leaderId=uuid(2),requestId=uuid(3),nonce=uuid(4);
const body={
 action:"REQUEST",requestId,nonce,reviewerId:leaderId,teamId:uuid(5),
 cityId:uuid(6),emailSha256:"a".repeat(64),
 departments:["acquisition","service_support"],expectedRosterRevision:0,
 expiresAt:new Date(Date.now()+1800000).toISOString()
};
const review={action:"REVIEW",requestId,decision:"APPROVED",
 decisionReference:uuid(7),signatureSha256:"b".repeat(64)};
const flags=["VOX_AB4_STAFF_REVIEW_ENABLED","VOX_STAFF_GRANTS_ENABLED",
 "VOX_DEPARTMENT_ENFORCEMENT_ENABLED"];
const old=Object.fromEntries(flags.map(k=>[k,process.env[k]]));
test.before(()=>flags.forEach(k=>process.env[k]="staging"));
test.after(()=>flags.forEach(k=>{
 if(old[k]===undefined)delete process.env[k];
 else process.env[k]=old[k];
}));
function harness({
 owner=ownerId,staff={userId:leaderId,role:"team_leader",
  teamId:uuid(5),cityId:uuid(6),canMutate:false},
 dbFailure=false,wrongReceipt=false
}={}){
 let reads=0,writes=0,tableNames=[];
 const db=()=>({from(name){
  tableNames.push(name);
  return {insert(insert){
   ++writes;
   return {select(){return {single:async()=>({
    error:dbFailure?{message:"synthetic DB denied"}:null,
    data:dbFailure?null:name.includes("requests")?{
     id:wrongReceipt?uuid(90):insert.id,owner_id:insert.owner_id,
     reviewer_id:insert.reviewer_id,nonce:insert.nonce,
     state:"PENDING_INDEPENDENT_REVIEW"
    }:{
     request_id:wrongReceipt?uuid(90):insert.request_id,
     reviewer_id:insert.reviewer_id,decision:insert.decision
    }
   })}}};
  }};
 }});
 const module={exports:{}};
 new Function("require","module","exports",js)((name)=>{
  if(name==="server-only")return {};
  if(name==="@/lib/supabase")return {adminClient:db};
  if(name==="@/services/vox/verifiedStaffBearer")
   return {verifyVoxOwnerBearer:async()=>{reads++;return owner}};
  if(name==="@/services/vox/verifiedScopedStaff")
   return {getVerifiedScopedStaff:async()=>{reads++;return staff}};
  if(name==="@/contracts/vox/ab4StaffRequestGateway.mjs")
   return contract;
  throw Error("MOCKED_IMPORT_UNKNOWN_"+name);
 },module,module.exports);
 return {...module.exports,get reads(){return reads},
  get writes(){return writes},get tables(){return tableNames}};
}
const req=(body,extra={})=>new Request("https://core.quickfurno.invalid/api/vox/v1/ab4-staff-review",{
 method:"POST",
 headers:{"content-type":"application/json",
  authorization:"Bearer synthetic.stub.stub",...extra},
 body:JSON.stringify(body)});
test("AB4 contract and route create pending review, never an Auth invitation",async()=>{
 const h=harness(),res=await h.POST(req(body));
 assert.equal(res.status,201);
 const json=await res.json();
 assert.equal(json.state,"PENDING_INDEPENDENT_REVIEW");
 assert.equal(json.accountCreated,false);
 assert.equal(json.inviteSent,false);
 assert.equal(json.grantsActivated,false);
 assert.equal(h.reads,1);
 assert.equal(h.writes,1);
 assert.deepEqual(h.tables,["vox_ab3_staff_invitation_requests_candidate_v1"]);
});
test("AB4 independent AAL2 Team Leader can write a separate decision only",async()=>{
 const h=harness(),res=await h.POST(req(review));
 assert.equal(res.status,200);
 const json=await res.json();
 assert.equal(json.state,"REVIEWED_ONLY");
 assert.equal(json.grantsActivated,false);
 assert.deepEqual(h.tables,["vox_ab3_staff_invitation_decisions_candidate_v1"]);
});
test("AB4 default OFF and disabled HTTP verbs cannot touch database",async()=>{
 const h=harness();
 process.env.VOX_AB4_STAFF_REVIEW_ENABLED="off";
 try{assert.equal((await h.POST(req(body))).status,503);
  assert.equal(h.reads,0);
  assert.equal(h.writes,0);
 }finally{process.env.VOX_AB4_STAFF_REVIEW_ENABLED="staging";}
 for(const method of ["GET","PUT","PATCH","DELETE"])
  assert.equal(h[method]().status,405,method);
});
test("AB4 owner and independent TL auth failures deny before candidate DB",async()=>{
 for(const entry of [
  {owner:null,payload:body},{staff:null,payload:review},
  {staff:{userId:leaderId,role:"support_agent",canMutate:false},payload:review},
  {staff:{userId:leaderId,role:"team_leader",canMutate:true},payload:review}
 ]){
  const h=harness(entry);
  const res=await h.POST(req(entry.payload));
  assert.equal(res.status,403);
  assert.equal(h.writes,0);
 }
});
test("AB4 malformed content and forged actor fields cannot enter Core writer",async()=>{
 const h=harness();
 for(const value of [
  {...body,ownerId:uuid(90)},
  {...body,staffRole:"owner"},
  {...body,reviewerId:ownerId},
  {...body,departments:["owner_admin"]},
  {...body,nonce:"replay me"}
 ])assert.equal((await h.POST(req(value))).status,400);
 assert.equal(h.writes,0);
 assert.equal((await h.POST(req(body,{"content-type":"text/plain"}))).status,415);
 assert.equal(h.writes,0);
});
test("AB4 DB failure/duplicate request or mismatched receipt is rejected",async()=>{
 for(const mode of [{dbFailure:true},{wrongReceipt:true}]){
  const h=harness(mode);
  assert.equal((await h.POST(req(body))).status,409);
  assert.equal((await h.POST(req(review))).status,409);
 }
});
test("AB4 untrusted filter and oversized payload are rejected",async()=>{
 const h=harness();
 const q=new Request("https://core.quickfurno.invalid/api/vox/v1/ab4-staff-review?owner="+uuid(9),
 {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
 assert.equal((await h.POST(q)).status,400);
 const big=new Request("https://core.quickfurno.invalid/api/vox/v1/ab4-staff-review",
 {method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify({...body,reason:"x".repeat(2000)})});
 assert.equal((await h.POST(big)).status,413);
 assert.equal(h.writes,0);
});
