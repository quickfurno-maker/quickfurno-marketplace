import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const code=readFileSync(new URL("../../../app/api/vox/v1/official-eod-publish/route.ts",import.meta.url),"utf8");
const js=ts.transpileModule(code,{compilerOptions:{
 target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const flags=["VOX_AB7G_EOD_PUBLISH_ENABLED",
 "VOX_AB7G_SIGNED_OWNER_PROOF_ENABLED",
 "VOX_DEPARTMENT_ENFORCEMENT_ENABLED"];
const old=Object.fromEntries(flags.map(k=>[k,process.env[k]]));
test.before(()=>flags.forEach(k=>process.env[k]="staging"));
test.after(()=>flags.forEach(k=>old[k]===undefined?
 delete process.env[k]:process.env[k]=old[k]));
const input={reportId:id(1),teamLeaderId:id(2),nonce:id(3),
 sourceDigest:"a".repeat(64)};
function h({owner=id(4),forged=false,dbError=false}={}){
 let reads=0,writes=0;
 const module={exports:{}};
 new Function("require","module","exports",js)(name=>{
  if(name==="server-only")return {};
  if(name==="@/services/vox/verifiedStaffBearer")
   return {verifyVoxOwnerBearer:async()=>{reads++;return owner}};
  if(name==="@/lib/supabase")return {adminClient:()=>({rpc:async(method,params)=>{
   writes++;assert.equal(method,"qf_vox_ab7g_official_eod_publish_candidate_v1");
   assert.equal(params.p_owner,owner);
   if(dbError)return {error:{code:"review_denied"}};
   return {data:[{publication_report_id:forged?id(99):input.reportId,
    receipt_nonce:input.nonce,source_sha256:input.sourceDigest,
    publication_state:"OFFICIALLY_RELEASED_BY_OWNER"}]};
  }})};
  throw Error("UNKNOWN_TEST_IMPORT");
 },module,module.exports);
 return {...module.exports,get reads(){return reads},get writes(){return writes}};
}
const req=(body=input)=>new Request("https://core.quickfurno.invalid/api/vox/v1/official-eod-publish",{
 method:"POST",headers:{"content-type":"application/json",authorization:"Bearer synthetic"},
 body:JSON.stringify(body)});
test("AB7G exact independently attested Core Owner publication route",async()=>{
 const x=h(),r=await x.POST(req());assert.equal(r.status,201);
 assert.equal(x.writes,1);assert.equal((await r.json()).externalMessagesSent,0);
});
test("AB7G no API DB mutation unless independently authenticated owner",async()=>{
 const x=h({owner:null}),r=await x.POST(req());
 assert.equal(r.status,403);assert.equal(x.writes,0);
});
test("AB7G stage switches and extra body fields fail closed",async()=>{
 const x=h();process.env.VOX_AB7G_SIGNED_OWNER_PROOF_ENABLED="off";
 assert.equal((await x.POST(req())).status,503);
 process.env.VOX_AB7G_SIGNED_OWNER_PROOF_ENABLED="staging";
 assert.equal((await x.POST(req({...input,ownerId:id(4)}))).status,400);
 assert.equal(x.writes,0);
});
test("AB7G DB replay/review rejection and forged receipt cannot publish",async()=>{
 assert.equal((await h({dbError:true}).POST(req())).status,409);
 assert.equal((await h({forged:true}).POST(req())).status,503);
});
