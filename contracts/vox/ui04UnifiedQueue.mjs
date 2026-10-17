/**
 * UI-04 T2: bounded unified Core Work + Riya read-only queue.
 * Each source projection must come from independently authenticated Core
 * server code; verifyProjection is an injected trusted server callback.
 */
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid=v=>typeof v==="string"&&ID.test(v);
const deny=reason=>Object.freeze({ok:false,reason,items:[],
 sourceCount:0,canTransition:false,canHandover:false,canReply:false});
const goodTime=t=>typeof t==="string"&&t.length<=40&&Number.isFinite(Date.parse(t));
const MAX=25;
export async function composeCoreVerifiedUnifiedQueue({
 scope,workProjection,clientProjection,verifyCurrentScope,
 verifyProjection,verifyCurrentObjectGrant,limit=25
}={}){
 if(!scope||!uuid(scope.userId)||!uuid(scope.teamId)||!uuid(scope.cityId)||
  scope.currentAal!=="aal2"||scope.canReadContent!==true||
  scope.canMutate!==false||!Number.isInteger(limit)||limit<1||limit>MAX||
  typeof verifyCurrentScope!=="function"||typeof verifyProjection!=="function"||
  typeof verifyCurrentObjectGrant!=="function"||
  !workProjection||workProjection.ok!==true||
  workProjection.schema!=="qf.vox.work.queue.preview.v1"||
  workProjection.mode!=="READ_ONLY"||workProjection.actionsEnabled!==false||
  !Array.isArray(workProjection.items)||workProjection.items.length>25||
  !clientProjection||clientProjection.ok!==true||
  clientProjection.schema!=="qf.vox.client.case.source-readiness.v1"||
  clientProjection.mode!=="READ_ONLY"||
  clientProjection.canTakeover!==false||
  clientProjection.canReadTranscript!==false||
  clientProjection.canSendReply!==false||
  !Array.isArray(clientProjection.items)||clientProjection.items.length>12)
  return deny("CURRENT_SIGNED_SOURCE_PROJECTIONS_REQUIRED");
 if(clientProjection.items.length>0&&
  (!Array.isArray(scope.verifiedDepartments)||
    !scope.verifiedDepartments.includes("client_success")))
  return deny("CURRENT_CLIENT_DEPARTMENT_REQUIRED");
 try{
  if(await verifyCurrentScope(scope)!==true)
   return deny("STAFF_ACCESS_REVOKED");
  for(const [source,p] of [["CORE_WORK_LEDGER",workProjection],
   ["CORE_CLIENT_RIYA",clientProjection]]){
   if(await verifyProjection({source,projection:p,scope})!==true)
    return deny("UNVERIFIED_CORE_SOURCE_PROJECTION");
  }
  const seen=new Set(),items=[];
  for(const w of workProjection.items){
   if(!w||!uuid(w.workItemId)||seen.has(w.workItemId)||
    !["prospect","vendor","support_thread"].includes(w.kind)||
    !["NEW","ASSIGNED","IN_PROGRESS","WAITING_EXTERNAL",
      "WAITING_APPROVAL","BLOCKED","DONE"].includes(w.state)||
    !Number.isSafeInteger(w.revision)||w.revision<0||
    !goodTime(w.updatedAt)||typeof w.assignedToMe!=="boolean"||
    w.canClaim!==false||w.canTransition!==false)
    return deny("WORK_ITEM_PROVENANCE_FAILED");
   if(await verifyCurrentObjectGrant({scope,source:"CORE_WORK_LEDGER",
    itemId:w.workItemId,kind:w.kind})!==true)
    return deny("WORK_OBJECT_ACCESS_REVOKED");
   seen.add(w.workItemId);
   items.push({source:"CORE_WORK_LEDGER",referenceId:w.workItemId,
    subjectKind:w.kind,state:w.state,updatedAt:w.updatedAt,
    assignedToMe:w.assignedToMe});
  }
  for(const c of clientProjection.items){
   if(!c||!uuid(c.conversationId)||!uuid(c.clientProjectId)||
    seen.has(c.conversationId)||
    !["OPEN","PAUSED","HUMAN","CLOSED"].includes(c.caseState)||
    !["RIYA","HUMAN"].includes(c.agent)||
    c.googleLocationVerified!==true||
    c.currentCityVerified!==true||c.readOnly!==true||
    c.canReadTranscript!==false||c.canSendReply!==false||
    c.canTakeover!==false||!Number.isSafeInteger(c.revision)||
    c.revision<0||!goodTime(c.lastUpdated))
    return deny("CLIENT_SOURCE_PROVENANCE_FAILED");
   if(await verifyCurrentObjectGrant({scope,source:"CORE_CLIENT_RIYA",
    itemId:c.conversationId,kind:"client"})!==true)
    return deny("CLIENT_OBJECT_ACCESS_REVOKED");
   seen.add(c.conversationId);
   items.push({source:"CORE_CLIENT_RIYA",referenceId:c.conversationId,
    subjectKind:"client",state:c.caseState,updatedAt:c.lastUpdated,
    assignedToMe:false});
  }
  items.sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||
   a.referenceId.localeCompare(b.referenceId));
  return Object.freeze({ok:true,schema:"qf.vox.ui04.unified.work.preview.v1",
   mode:"READ_ONLY",completeness:"BOUNDED_NOT_TOTAL",
   sourceCount:2,items:Object.freeze(items.slice(0,limit).map(r=>
    Object.freeze({...r,canTransition:false,canHandover:false,
     canReply:false}))),canTransition:false,canHandover:false,
   canReply:false,providerMessagesSent:0});
 }catch{return deny("SCOPE_OR_SOURCE_GATE_UNAVAILABLE");}
}
