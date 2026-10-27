
import {evaluateReadOnlyAal2Probe} from "../../../contracts/vox/stagingAal2Probe.mjs";
// Manually invoked only after protected staging identity/DB grants are approved.
// Hard-pinned staging Core from existing VOX Web BFF: NEVER production or user URL.
const CORE="https://staging-core.quickfurno.in";
const ROUTE="/api/vox/v1/work-queue";
const tokens=["VOX_QA_AAL1_TOKEN","VOX_QA_WRONG_CITY_AAL2_TOKEN","VOX_QA_SCOPED_AAL2_TOKEN"];
function jwt(value){
 return typeof value==="string"&&value.length>=100&&value.length<=8192&&
 /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}
export function protectedInputs(env){
 const status={configured:env.VOX_QA_HUMAN_APPROVED_STAGE==="ACKNOWLEDGED_BY_EXTERNAL_HUMAN",
  hostPinned:env.VOX_QA_EXPECTED_CORE_ORIGIN===CORE,
  tokensPresent:tokens.every(name=>jwt(env[name])),
  allDistinct:new Set(tokens.map(name=>env[name])).size===3,
  noProviderSend:true,noDdlOrAuthUserCreation:true};
 return {ready:Object.values(status).every(v=>v===true),status};
}
export async function runProbe(env=process.env,fetchImpl=fetch){
 const config=protectedInputs(env);
 if(!config.ready)return {ok:false,releaseAuthorized:false,reason:"PROTECTED_TEST_IDS_AND_HUMAN_PRECONDITIONS_ABSENT"};
 const cases=[["anonymous",null],["aal1",env.VOX_QA_AAL1_TOKEN],
  ["foreignCity",env.VOX_QA_WRONG_CITY_AAL2_TOKEN],["scoped",env.VOX_QA_SCOPED_AAL2_TOKEN]];
 const results={};
 for(const [name,token] of cases){
  const headers={accept:"application/json"};
  if(token)headers.authorization="Bearer "+token;
  try{
   const response=await fetchImpl(CORE+ROUTE,{
    method:"GET",headers,redirect:"error",cache:"no-store",
    signal:AbortSignal.timeout(4000)});
   // Never log raw body, token, identifiers or PII. The only body consumed
   // is a bounded Core-verified metadata projection from the scoped case.
   let body;
   if(name==="scoped"&&response.status===200){
    const size=Number(response.headers?.get?.("content-length")??0);
    if(size>32768)return {ok:false,releaseAuthorized:false,reason:"OVERSIZED_CORE_RESPONSE"};
    body=await response.json();
    if(JSON.stringify(body).length>32768)return {ok:false,releaseAuthorized:false,reason:"OVERSIZED_CORE_RESPONSE"};
   }
   results[name]={status:response.status,body};
  }catch{return {ok:false,releaseAuthorized:false,reason:"PRIVATE_STAGE_NETWORK_OR_AUTH_UNAVAILABLE"};}
 }
 return evaluateReadOnlyAal2Probe(results);
}
if(import.meta.url===new URL("file://"+process.argv[1]).href){
 if(!process.argv.includes("--protected-read-only")){
  console.log("NOT_EXECUTED: requires explicit --protected-read-only plus independent protected stage identities.");
  process.exit(0);
 }
 const report=await runProbe();
 // The outcome is intentionally sanitized. This command NEVER signs release.
 console.log(JSON.stringify(report));
 process.exit(report.ok?0:42);
}
