/**
 * AB-3 operational boundary between an authenticated Core queue handler
 * and the verified AB-2 domain window. No independent identity or grant.
 * The source reader MUST be the existing server-side protected Core GET,
 * not a caller-supplied JSON payload from the browser.
 */
import {projectVerifiedDomainWindow} from "./ab2ScopedDomainWindow.mjs";
const roles={
 acquisition_agent:"acquisition",
 vendor_success_agent:"vendor_success",
 support_agent:"service_support"
};
const deny=(reason,status=503)=>Object.freeze({ok:false,reason,status,
 items:[],actionsEnabled:false,nextPageAuthorized:false});
async function readJsonResponse(response){
 if(!(response instanceof Response)||response.status!==200||
  !(response.headers.get("content-type")??"").toLowerCase().startsWith("application/json")||
  !(response.headers.get("cache-control")??"").includes("no-store"))return null;
 try{
  const text=await response.text();
  if(!text||text.length>24000)return null;
  const value=JSON.parse(text);
  if(!value||value.ok!==true||
   value.schema!=="qf.vox.work.queue.preview.v1"||
   value.mode!=="READ_ONLY"||
   value.actionsEnabled!==false||value.boundedWindow!==true||
   value.completeness!=="BOUNDED_NOT_TOTAL"||
   !Array.isArray(value.items)||value.items.length>25)return null;
  return value;
 }catch{return null;}
}
export async function getAuthenticatedDomainWork({
 request,scope,enabled=false,readProtectedWork,verifyCurrentScope,
 verifyCurrentWorkObject
}={}){
 if(!(request instanceof Request)||request.method!=="GET"||
  new URL(request.url).search||new URL(request.url).hash)
  return deny("NO_CLIENT_FILTERS",400);
 if(enabled!==true)return deny("AB3_DOMAIN_VIEW_DISABLED");
 if(!scope||!Object.hasOwn(roles,scope.role)||
  !Array.isArray(scope.verifiedDepartments)||
  !scope.verifiedDepartments.includes(roles[scope.role])||
  scope.currentAal!=="aal2"||scope.canReadContent!==true||
  scope.canMutate!==false||
  typeof readProtectedWork!=="function"||
  typeof verifyCurrentScope!=="function"||
  typeof verifyCurrentWorkObject!=="function")
  return deny("EXACT_AAL2_DEPARTMENT_SCOPE_REQUIRED",403);
 try{
  // The existing Core reader independently verifies the same bearer.
  // Filtering happens AFTER it has returned authenticated canonical work.
  if(await verifyCurrentScope(scope)!==true)
   return deny("CURRENT_STAFF_SCOPE_CHANGED",403);
  const source=await readJsonResponse(await readProtectedWork(request));
  if(!source)return deny("CANONICAL_CORE_WORK_UNAVAILABLE");
  const dep=roles[scope.role];
  const allowed={
   acquisition:new Set(["prospect"]),
   vendor_success:new Set(["vendor","support_thread"]),
   service_support:new Set(["support_thread"])
  }[dep];
  const rows=source.items.filter(x=>allowed.has(x.kind)).map(x=>({
   id:x.workItemId,kind:x.kind,state:x.state,
   revision:x.revision,updatedAt:x.updatedAt,
   canChange:false,canSend:false
  }));
  const result=await projectVerifiedDomainWindow({
   scope,department:dep,source:{ok:true,mode:"READ_ONLY",
    actionsEnabled:false,items:rows},
   verifyCurrentScope,verifySource:async()=>true,
   verifyExactObjectGrant:async x=>verifyCurrentWorkObject(x)
  });
  if(result.ok!==true)return deny("CURRENT_OBJECT_OR_GRANT_REVOKED",403);
  return Object.freeze({...result,
   status:200,source:"EXISTING_AUTHENTICATED_CORE_WORK_QUEUE",
   stageCertified:false,officialTotal:null,actionsEnabled:false});
 }catch{return deny("AB3_DOMAIN_CORE_SOURCE_UNAVAILABLE");}
}
