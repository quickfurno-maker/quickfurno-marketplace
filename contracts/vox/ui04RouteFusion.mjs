/**
 * UI-04 authenticated Core HTTP route composition.
 * Source readers must be the already protected existing Core GET handlers.
 * No outbound fetch, browser-provided staff scope or service role mutation.
 */
import {composeCoreVerifiedUnifiedQueue} from "./ui04UnifiedQueue.mjs";
const denied=(reason,status=503)=>Object.freeze({ok:false,reason,status,
 source:"CORE_READ_ONLY",actionsEnabled:false,items:[],providerMessagesSent:0});
const EXACT=["work","client","portal","grants","departments"];
const strict=(x,keys)=>x&&typeof x==="object"&&!Array.isArray(x)&&
 Object.keys(x).sort().join("|")===keys.slice().sort().join("|");
const JSON_TYPE=/^application\/json(?:;|$)/i;
async function verifiedBody(response){
 if(!(response instanceof Response)||response.status!==200||
  !JSON_TYPE.test(response.headers.get("content-type")??"")||
  !(response.headers.get("cache-control")??"").includes("no-store"))return null;
 const content=await response.text();
 if(!content||content.length>24000)return null;
 try{
  const result=JSON.parse(content);
  return result&&typeof result==="object"&&!Array.isArray(result)?result:null;
 }catch{return null;}
}
export async function composeAuthorizedCoreWorkspace({
 request,featureGates,scope,
 verifyCurrentScope,readWorkHandler,readClientHandler,
 verifyCurrentObjectGrant
}={}){
 if(!(request instanceof Request)||request.method!=="GET"||
  new URL(request.url).search||new URL(request.url).hash)
  return denied("GET_NO_FILTERS_REQUIRED",400);
 if(!strict(featureGates,EXACT)||EXACT.some(k=>featureGates[k]!=="staging"))
  return denied("UI04_WORKSPACE_RELEASE_DISABLED");
 if(!scope||scope.currentAal!=="aal2"||scope.canReadContent!==true||
  scope.canMutate!==false||
  !["operations_manager","support_agent"].includes(scope.role)||
  !Array.isArray(scope.verifiedDepartments)||
  !scope.verifiedDepartments.includes("client_success")||
  typeof verifyCurrentScope!=="function"||
  typeof readWorkHandler!=="function"||
  typeof readClientHandler!=="function"||
  typeof verifyCurrentObjectGrant!=="function")
  return denied("CURRENT_CLIENT_STAFF_AAL2_REQUIRED",403);
 try{
  // Never substitute a locally created projection when either REAL source
  // route refuses: both perform separate Core Auth/role/objects DB reads.
  if(await verifyCurrentScope(scope)!==true)
   return denied("STAFF_SCOPE_REVOKED",403);
  const [workResponse,clientResponse]=await Promise.all([
   readWorkHandler(request),readClientHandler(request)
  ]);
  if(workResponse?.status===403||clientResponse?.status===403)
   return denied("CORE_SOURCE_STAFF_DENIED",403);
  const [workProjection,clientProjection]=await Promise.all([
   verifiedBody(workResponse),verifiedBody(clientResponse)
  ]);
  if(!workProjection||!clientProjection)
   return denied("PROTECTED_SOURCE_READER_UNAVAILABLE");
  const result=await composeCoreVerifiedUnifiedQueue({
   scope,workProjection,clientProjection,verifyCurrentScope,
   verifyProjection:async({source,projection})=>
    source==="CORE_WORK_LEDGER"?projection===workProjection:
    source==="CORE_CLIENT_RIYA"&&projection===clientProjection,
   verifyCurrentObjectGrant
  });
  if(result.ok!==true)return denied("OBJECT_AND_SOURCE_SCOPE_DENIED",403);
  // Two current remote Auth/Core entitlement checks bracket the bounded
  // object-specific DB reads. Per-item current() would repeat full Supabase
  // Auth, reviewer memberships and grants 37 times; never cache across calls.
  if(await verifyCurrentScope(scope)!==true)
   return denied("STAFF_SCOPE_REVOKED_DURING_READ",403);
  // No transcript, phone, address, email, staff grants or provider payload.
  return Object.freeze({...result,
   owner:"quickfurno-core",source:"EXISTING_PROTECTED_CORE_ROUTES",
   actionsEnabled:false,stageCertified:false});
 }catch{return denied("WORKSPACE_AGGREGATION_UNAVAILABLE");}
}
