import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL(
 "../../../app/api/vox/v1/ab5-source-checkpoints/route.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{
 target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scope={userId:id(1),teamId:id(2),cityId:id(3),
 role:"acquisition_agent",canReadContent:true,canMutate:false,
 verifiedDepartments:["acquisition"],prospectIds:[id(8)],
 vendorIds:[],supportThreadIds:[],conversationIds:[]};
const names=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",
 year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const day=new Date(Date.parse(today+"T00:00:00Z")-86400000).toISOString().slice(0,10);
const rows=names.map((source,i)=>({source,actor_id:scope.userId,
 team_id:scope.teamId,city_id:scope.cityId,business_date:day,
 event_count:i+1,event_checksum:"a".repeat(64),watermark_signature:"b".repeat(64)}));
const config=["VOX_AB5_EOD_CHECKPOINTS_READ_ENABLED",
 "VOX_STAFF_GRANTS_ENABLED","VOX_DEPARTMENT_ENFORCEMENT_ENABLED"];
function create({records=rows,scopeOnSecond=scope,error=null,actor=scope}={}){
 let lookups=0,queries=0,scopeCalls=0;
 const client=()=>({from(table){
  assert.equal(table,"vox_ab3_staff_source_snapshots_candidate_v1");
  queries++;
  const q={select(){return q},eq(){return q},
   limit:async()=>({data:records,error})};return q;
 }});
 const verified=async()=>++scopeCalls===1?actor:scopeOnSecond;
 const module={exports:{}};
 new Function("require","module","exports",js)((name)=>{
  if(name==="server-only")return {};
  if(name==="@/lib/supabase")return {adminClient:client};
  if(name==="@/services/vox/verifiedScopedStaff")
   return {getVerifiedScopedStaff:verified};
  throw Error("UNEXPECTED_IMPORT_"+name);
 },module,module.exports);
 return {...module.exports,get queries(){return queries},get scopeCalls(){return scopeCalls}};
}
const request=new Request("https://core.quickfurno.invalid/api/vox/v1/ab5-source-checkpoints");
const saved=Object.fromEntries(config.map(k=>[k,process.env[k]]));
test.before(()=>{for(const k of config)process.env[k]="staging"});
test.after(()=>{for(const k of config){
 if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];
}});
test("AB5 four SQL checkpoints remain NOT official/cryptographically signed",async()=>{
 const m=create(),res=await m.GET(request);
 assert.equal(res.status,200);assert.equal(m.queries,1);
 const data=await res.json();assert.equal(data.ok,true);
 assert.equal(data.sources.length,4);assert.equal(data.checkpointRows,4);
 assert.equal(data.totalKnown,false);assert.equal(data.official,false);
 assert.ok(data.sources.every(s=>s.watermarkCryptoVerified===false));
 assert.equal(m.scopeCalls,2);assert.equal(data.canSubmit,false);
});
test("AB5 missing source explicitly says INCOMPLETE not zero productivity",async()=>{
 const m=create({records:rows.slice(0,2)}),res=await m.GET(request);
 assert.equal(res.status,200);
 const data=await res.json();assert.equal(data.checkpointRows,2);
 assert.equal(data.completeness,"INCOMPLETE_SOURCE_CHECKPOINTS");
 assert.equal(data.sources[2].eventCountInSnapshot,null);
});
test("AB5 forged record/duplicated source and malformed digest deny whole result",async()=>{
 for(const bad of [
  [rows[0],rows[0],rows[2],rows[3]],
  [{...rows[0],actor_id:id(90)},...rows.slice(1)],
  [{...rows[0],business_date:"2026-01-01"},...rows.slice(1)],
  [{...rows[0],event_checksum:"tampered"},...rows.slice(1)]
 ]){
  const m=create({records:bad}),res=await m.GET(request);
  assert.equal(res.status,503);
  assert.equal((await res.json()).ok,false);
 }
});
test("AB5 remote Auth AAL2 revoked during DB read discards all source results",async()=>{
 const m=create({scopeOnSecond:{...scope,teamId:id(70)}}),
  res=await m.GET(request);
 assert.equal(res.status,403);
 assert.equal((await res.json()).ok,false);
});
test("AB5 disabled route and browser filter never call candidate DB",async()=>{
 const m=create();
 process.env.VOX_AB5_EOD_CHECKPOINTS_READ_ENABLED="disabled";
 try{assert.equal((await m.GET(request)).status,503);
  assert.equal(m.queries,0);
 }finally{process.env.VOX_AB5_EOD_CHECKPOINTS_READ_ENABLED="staging";}
 assert.equal((await m.GET(new Request(request.url+"?teamId="+id(9)))).status,400);
 assert.equal(m.queries,0);
});
test("AB5 no mutate, provider sends or invented official report",async()=>{
 const m=create();
 for(const verb of ["POST","PUT","PATCH","DELETE"]){
  const res=m[verb]();assert.equal(res.status,405);
 }
 assert.doesNotMatch(source,/sendWhatsApp|sendEmail|auth\.admin\.createUser/);
});
