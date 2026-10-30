// VOX-L1 - authenticated Core source-liveness classifier, NO employee performance
// totals or complete EOD claims. All rows are separately sourced by Core Server.
// Unlike earlier injected-only adapters, this is used by the actual Core route.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sources=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const fail=reason=>Object.freeze({ok:false,error:reason,
 allSourceReady:false,rollup:null,canSubmit:false,providerMessagesSent:0});
export function projectActualStaffSourceStatus({scope,observations,businessDate}={}){
 if(!scope||typeof scope!=="object"||!UUID.test(scope.userId)||
  !UUID.test(scope.teamId)||!UUID.test(scope.cityId)||
  scope.canReadContent!==true||scope.canMutate!==false||
  !Array.isArray(observations)||observations.length!==4||
  typeof businessDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(businessDate))
  return fail("CURRENT_AAL2_STAFF_AND_CANONICAL_SOURCE_REQUIRED");
 const seen=new Set(),result=[];
 for(const o of observations){
  if(!o||typeof o!=="object"||Array.isArray(o)||
   Object.keys(o).sort().join("|")!==["source","readerState","currentScopeVerified","eventProvenance"].sort().join("|")||
   !sources.includes(o.source)||seen.has(o.source)||
   !["AVAILABLE","NO_GRANTED_OBJECTS","UNAVAILABLE","GRANT_UNVERIFIED"].includes(o.readerState)||
   o.currentScopeVerified!==true&&o.currentScopeVerified!==false||
   o.eventProvenance!=="CORE_WORK_ONLY"&&o.eventProvenance!=="NOT_PROVEN")
   return fail("UNTRUSTED_SOURCE_READINESS");
  if(o.readerState==="AVAILABLE"&&o.currentScopeVerified!==true)
   return fail("SOURCE_CLAIMS_UNVERIFIED_GRANTS");
  if(o.source!=="CORE_WORK_LEDGER"&&o.eventProvenance!=="NOT_PROVEN")
   return fail("AGENT_EVENT_PROVENANCE_NOT_CERTIFIED");
  seen.add(o.source);
  result.push(Object.freeze({source:o.source,readiness:o.readerState,
   scoped:o.currentScopeVerified,eventProvenance:o.eventProvenance}));
 }
 return Object.freeze({ok:true,schema:"qf.vox.staff.eod.source-status.v1",
  mode:"READ_ONLY",businessDate,source:"CORE_CANONICAL_SOURCE_OBSERVATIONS",
  sources:Object.freeze(sources.map(name=>result.find(x=>x.source===name))),
  completeness:"INCOMPLETE_NO_SIGNED_ALL_SOURCE_WATERMARKS",
  allSourceReady:false,rollup:null,canSubmit:false,canExport:false,
  providerMessagesSent:0,actionsEnabled:false});
}
