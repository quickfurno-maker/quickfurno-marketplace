// VOX-06C: strictly read-only protected-stage acceptance. Source/offline
// mock tests cannot authorize rollout or simulate an independent reviewer.
const denied=new Set([401,403]);
export function assessProtectedStaffStage(results){
 const names=["anonymous","aal1","foreignCity","crossTeam","revoked","missingDepartment"];
 if(!results||names.some(k=>!results[k]||!Number.isInteger(results[k].status)))
  return {ok:false,releaseAuthorized:false,reason:"MISSING_GENUINE_TOKEN_PROOFS"};
 for(const k of names)if(!denied.has(results[k].status))
  return {ok:false,releaseAuthorized:false,reason:"UNAUTHORIZED_SCOPE_NOT_DENIED_"+k};
 for(const [route,schema] of [["queue","qf.vox.work.queue.preview.v1"],
   ["desk","qf.vox.service.desk.v1"],["myWork","qf.vox.overview.v1"]]){
  const r=results[route];
  if(!r||r.status!==200||r.body?.ok!==true||r.body?.view?.actionsEnabled===true||
     (route==="queue"?r.body?.schema:r.body?.view?.schema)!==schema)
   return {ok:false,releaseAuthorized:false,reason:"SCOPED_READ_NOT_VERIFIED_"+route};
  if(route==="queue"&&(r.body.actionsEnabled!==false||
     r.body.mode!=="READ_ONLY"||r.body.items?.length>25))
   return {ok:false,releaseAuthorized:false,reason:"QUEUE_PRIVILEGED_OR_UNBOUNDED"};
  if(route==="desk"&&(r.body.view?.mode!=="READ_ONLY"||
    !Array.isArray(r.body.view.support)||!Array.isArray(r.body.view.humanInbox)||
    r.body.view.support.length>12||r.body.view.humanInbox.length>12))
   return {ok:false,releaseAuthorized:false,reason:"DESK_NOT_MASKED"};
  if(route==="myWork"&&(r.body.staff?.actionsEnabled!==false||
     r.body.view?.source!=="quickfurno-core"))
   return {ok:false,releaseAuthorized:false,reason:"OVERVIEW_NOT_CORE_VERIFIED"};
 }
 return {ok:true,releaseAuthorized:false,reason:"READ_ONLY_AUTH_MATRIX_ONLY_NOT_RELEASE",
  requiresHumanDbaAal2ProviderConsentAndRollback:true};
}
