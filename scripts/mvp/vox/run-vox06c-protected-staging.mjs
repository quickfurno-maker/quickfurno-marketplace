import {assessProtectedStaffStage} from "../../../contracts/vox/protectedStageReadOnly.mjs";
const ORIGIN="https://staging-core.quickfurno.in";
const EXPECTED=["AAL1","FOREIGN_CITY","CROSS_TEAM","REVOKED","MISSING_DEPARTMENT","SCOPED"]
 .map(x=>"VOX_STAGE_QA_"+x+"_TOKEN");
const jwt=x=>typeof x==="string"&&x.length>=100&&x.length<=8192&&
 /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(x);
export function preflight(env={}){
 return env.VOX_STAGE_QA_APPROVAL_ACK==="EXTERNAL_REVIEWER_SIGNED_SEPARATELY"&&
   env.VOX_STAGE_QA_EXPECTED_ORIGIN===ORIGIN&&
   EXPECTED.every(x=>jwt(env[x]))&&new Set(EXPECTED.map(x=>env[x])).size===EXPECTED.length;
}
export async function runStage(env=process.env,fetcher=fetch){
 if(!preflight(env))return {ok:false,releaseAuthorized:false,reason:"REAL_APPROVED_STAGE_IDENTITIES_ABSENT"};
 const tests=[
  ["anonymous",null,"/api/vox/v1/work-queue"],
  ["aal1",env.VOX_STAGE_QA_AAL1_TOKEN,"/api/vox/v1/work-queue"],
  ["foreignCity",env.VOX_STAGE_QA_FOREIGN_CITY_TOKEN,"/api/vox/v1/work-queue"],
  ["crossTeam",env.VOX_STAGE_QA_CROSS_TEAM_TOKEN,"/api/vox/v1/work-queue"],
  ["revoked",env.VOX_STAGE_QA_REVOKED_TOKEN,"/api/vox/v1/work-queue"],
  ["missingDepartment",env.VOX_STAGE_QA_MISSING_DEPARTMENT_TOKEN,"/api/vox/v1/work-queue"],
  ["queue",env.VOX_STAGE_QA_SCOPED_TOKEN,"/api/vox/v1/work-queue"],
  ["desk",env.VOX_STAGE_QA_SCOPED_TOKEN,"/api/vox/v1/desk"],
  ["myWork",env.VOX_STAGE_QA_SCOPED_TOKEN,"/api/vox/v1/my-work"]
 ];
 const results={};
 for(const [key,token,path] of tests){
  try{
   const opts={method:"GET",redirect:"error",cache:"no-store",
     headers:{accept:"application/json"},signal:AbortSignal.timeout(4500)};
   if(token)opts.headers.authorization="Bearer "+token;
   const response=await fetcher(ORIGIN+path,opts);
   let body;
   if(["queue","desk","myWork"].includes(key)&&response.status===200){
    const len=Number(response.headers?.get?.("content-length")??0);
    if(!Number.isFinite(len)||len>32768||len<0)
     return {ok:false,releaseAuthorized:false,reason:"CORE_RESPONSE_OVERSIZE"};
    body=await response.json();
    if(JSON.stringify(body).length>32768)
     return {ok:false,releaseAuthorized:false,reason:"CORE_RESPONSE_OVERSIZE"};
   }
   results[key]={status:response.status,body};
  }catch{return {ok:false,releaseAuthorized:false,reason:"PROTECTED_STAGE_NETWORK_FAILED"};}
 }
 // No bearer, raw business object, response data or identities are logged.
 return assessProtectedStaffStage(results);
}
if(import.meta.url===new URL("file://"+process.argv[1]).href){
 if(!process.argv.includes("--protected-read-only")){
  console.log("NOT_EXECUTED: protected stage requires real tokens and independently verified approval.");
 }else{
  const report=await runStage();
  console.log(JSON.stringify(report));
  process.exitCode=report.ok?0:42;
 }
}
