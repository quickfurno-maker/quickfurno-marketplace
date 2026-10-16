// Source-only, attributable 4-reader Staff EOD. Strictly read-only.
// External verifyReading adapter MUST check trusted Core source signature,
// actor/object grants, watermark provenance and current auth before this runs.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SOURCES=Object.freeze(["CORE_WORK_LEDGER","CRM_AAROHI",
 "SUPPORT_DESK","CORE_CONVERSATION"]);
const id=v=>typeof v==="string"&&UUID.test(v);
const fail=(reason,details={})=>Object.freeze({ok:false,reason,
 mode:"READ_ONLY",completeness:"NOT_CERTIFIED",rollup:null,canSubmit:false,
 providerMessagesSent:0,...details});
export async function previewAttributableFourSourceEod({
 scope,businessDate,window,readings,verifyReading,verifyCurrentScope
}={}){
 if(!scope||!id(scope.userId)||!id(scope.teamId)||!id(scope.cityId)||
  scope.currentAal!=="aal2"||scope.canReadContent!==true||
  scope.canMutate!==false||typeof businessDate!=="string"||
  !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)||
  !window||!Number.isSafeInteger(window.startMs)||
  !Number.isSafeInteger(window.endMs)||
  window.endMs-window.startMs!==86400000||
  window.startMs!==Date.parse(businessDate+"T00:00:00+05:30")||
  new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(window.startMs))!==businessDate||
  !Array.isArray(readings)||readings.length!==4||
  typeof verifyReading!=="function"||
  typeof verifyCurrentScope!=="function")
  return fail("CURRENT_AAL2_SCOPE_AND_FOUR_TRUSTED_READERS_REQUIRED");
 try{if((await verifyCurrentScope(scope))!==true)
  return fail("STAFF_ROLE_OR_SCOPE_REVOKED");}
 catch{return fail("CURRENT_SCOPE_UNAVAILABLE");}
 const seenSources=new Set(),seenEvents=new Set(),summaries=[];
 for(const r of readings){
  if(!r||!SOURCES.includes(r.source)||seenSources.has(r.source)||
   !Number.isSafeInteger(r.cursorStartMs)||
   !Number.isSafeInteger(r.cursorEndMs)||
   r.cursorStartMs>window.startMs||r.cursorEndMs<window.endMs||
   !Array.isArray(r.events)||r.events.length>250)
   return fail("SOURCE_READINESS_OR_WATERMARK_INCOMPLETE");
  try{if((await verifyReading(r,{...scope,businessDate,window}))!==true)
   return fail("UNTRUSTED_SOURCE_SIGNATURE_OR_GRANT");}
  catch{return fail("SOURCE_READER_UNAVAILABLE");}
  seenSources.add(r.source);
  const kinds=new Map();
  for(const e of r.events){
   if(!e||!id(e.id)||!id(e.actorId)||!id(e.teamId)||!id(e.cityId)||
    !id(e.objectId)||!Number.isSafeInteger(e.revision)||e.revision<0||
    !Number.isSafeInteger(e.occurredAtMs)||
    e.occurredAtMs<window.startMs||e.occurredAtMs>=window.endMs||
    e.actorId!==scope.userId||e.teamId!==scope.teamId||
    e.cityId!==scope.cityId||seenEvents.has(e.id)||
    typeof e.kind!=="string"||!/^[A-Z_]{3,32}$/.test(e.kind))
    return fail("UNATTRIBUTABLE_OR_DUPLICATE_EOD_EVENT");
   seenEvents.add(e.id);kinds.set(e.kind,(kinds.get(e.kind)||0)+1);
  }
  summaries.push(Object.freeze({source:r.source,verifiedEventCount:r.events.length,
   byKind:Object.freeze(Object.fromEntries([...kinds.entries()].sort()))}));
 }
 if(seenSources.size!==4)return fail("FOUR_AUTHORITATIVE_SOURCES_MISSING");
 return Object.freeze({ok:true,mode:"READ_ONLY",
  schema:"qf.vox.l9.four-source-attribution-preview.v1",
  businessDate,verifiedScope:"CURRENT_AAL2_STAFF",sources:Object.freeze(
   SOURCES.map(s=>summaries.find(r=>r.source===s))),
  completeness:"ALL_FOUR_INJECTED_SOURCE_READERS_VERIFIED",
  // Still not official EOD; protected staging and human review separate.
  rollup:Object.freeze({totalEvents:seenEvents.size,readOnlyPreview:true}),
  canSubmit:false,canExport:false,providerMessagesSent:0,
  requiresActualSignedCoreReaders:true,requiresAuthorizedStagingE2E:true});
}
export const requiredAttributableSources=SOURCES;
