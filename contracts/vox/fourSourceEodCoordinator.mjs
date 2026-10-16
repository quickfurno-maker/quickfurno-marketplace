// VOX-10A - Core SERVER-ONLY reader coordination; no new report authority.
import {reconcileStaffEodEvidence,EOD_SOURCES} from "./allSourceEodEvidence.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const rec=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const keys=(v,list)=>rec(v)&&Object.keys(v).sort().join("|")===[...list].sort().join("|");
const blocked=error=>Object.freeze({ok:false,error,mode:"READ_ONLY",
 completeness:"INCOMPLETE_OR_UNVERIFIED",rollup:null,canSubmit:false,
 canExport:false,providerMessagesSent:0});
/**
 * readSource functions are Core server-owned adapters. The existing live-backed
 * eod-preview is a PARTIAL WORK-ONLY report and must NOT be represented as
 * a raw stream of CRM, desk, or agent events. Each source requires its OWN
 * authoritative, currently grant-checked reader and completeness watermark.
 * No fallback counts, browser-controlled reader or fake empty-success.
 */
export async function gatherStaffEodSources({
  context,businessDate,readSource,now=Date.now()
}={}){
 if(!rec(context)||!UUID.test(String(context.userId))||
  !UUID.test(String(context.teamId))||!UUID.test(String(context.cityId))||
  context.canReadContent!==true||context.canMutate!==false||
  typeof readSource!=="function"||!Number.isSafeInteger(now))
   return blocked("VERIFIED_CORE_STAFF_SOURCE_READERS_REQUIRED");
 const tasks=EOD_SOURCES.map(source=>Promise.resolve()
  .then(()=>readSource({source,staffId:context.userId,
   teamId:context.teamId,cityId:context.cityId,businessDate})));
 const states=await Promise.allSettled(tasks);
 const covered=[],sourceStatus=[];
 for(let i=0;i<EOD_SOURCES.length;i++){
  const source=EOD_SOURCES[i],result=states[i];
  if(result.status!=="fulfilled"){
   sourceStatus.push(Object.freeze({source,status:"READER_UNAVAILABLE"}));
   continue;
  }
  const v=result.value;
  if(!keys(v,["source","sourceWatermark","events","readerProof"])||
   v.source!==source||!Array.isArray(v.events)||v.events.length>100||
   !rec(v.readerProof)||v.readerProof.staffId!==context.userId||
   v.readerProof.teamId!==context.teamId||
   v.readerProof.cityId!==context.cityId){
   // An invalid/forged reader response is a SECURITY FAILURE, not a
   // missing-source success. Do not return even partial event data.
   return blocked("UNTRUSTED_SOURCE_READER_RESPONSE");
  }
  covered.push(v);
  sourceStatus.push(Object.freeze({source,status:"CORE_READER_ASSERTED"}));
 }
 const report=reconcileStaffEodEvidence({context,businessDate,sources:covered,now});
 if(!report.ok)return blocked(report.error??"EOD_RECONCILIATION_DENIED");
 const complete=states.every(x=>x.status==="fulfilled")&&
  report.completeness==="COVERAGE_ASSERTED_NOT_AUDITED";
 return Object.freeze({ok:true,schema:"qf.vox.eod.aggregator.readiness.v1",
  mode:"READ_ONLY",businessDate,
  sourceStatus:Object.freeze(sourceStatus),
  completeness:complete?"FOUR_SOURCE_ASSERTIONS_NOT_AUDITED":"INCOMPLETE_OR_UNVERIFIED",
  // Four asserted reader watermarks are not independently signed or
  // audited. No official cross-system totals available to Staff yet.
  rollup:null,allSourceTotalCertified:false,
  sourcesClaimed:covered.length,sourceRequired:EOD_SOURCES.length,
  canSubmit:false,canExport:false,canAcknowledge:false,
  providerMessagesSent:0,requiresSignedReaders:true});
}
