// VOX-04 Core-owned support and governed WhatsApp metadata projection.
// The caller MUST have already received verified scope from Core VOX-03,
// with city-bound, exact per-thread & vendor/prospect grants. There is no send.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid=x=>typeof x==="string"&&UUID.test(x);
const AGE_HOUR=3600_000;
const allowedStates=new Set(["open","pending","resolved","closed"]);
function ageBand(when,now){
 const t=Date.parse(String(when??""));
 if(!Number.isFinite(t)||t>now+30000)return "UNKNOWN";
 const h=Math.max(0,(now-t)/AGE_HOUR);
 return h<24?"UNDER_24H":h<72?"24_TO_72H":"OVER_72H";
}
export function projectStaffServiceDesk({threads=[],conversations=[],context,verifiedVendorIds=[],
 verifiedProspectIds=[],now=Date.now()}={}){
 if(!context||context.canReadContent!==true||context.canMutate!==false)throw new Error("SCOPE_REQUIRED");
 const v=new Set(verifiedVendorIds.filter(isUuid)),p=new Set(verifiedProspectIds.filter(isUuid));
 const t=new Set(context.supportThreadIds??[]),c=new Set(context.conversationIds??[]);
 const permittedThreads=(Array.isArray(threads)?threads:[]).filter(x=>
  x&&isUuid(x.id)&&t.has(x.id)&&v.has(x.vendor_id));
 const support=permittedThreads.slice(0,12).map(x=>Object.freeze({
  threadId:x.id,vendorId:x.vendor_id,
  state:allowedStates.has(String(x.status??"").toLowerCase())?String(x.status).toLowerCase():"UNKNOWN",
  priority:["low","normal","medium","high","urgent"].includes(String(x.priority??"").toLowerCase())
    ?String(x.priority).toLowerCase():"UNKNOWN",
  lastUpdatedAt:Number.isFinite(Date.parse(String(x.updated_at??"")))?new Date(x.updated_at).toISOString():null,
  ageBand:ageBand(x.created_at??x.updated_at,now),
  slaStatus:"NOT_CONFIGURED", // Core source has no authoritative SLA due timestamp.
  canClose:false,canReassign:false,
 }));
 const inbox=(Array.isArray(conversations)?conversations:[]).filter(x=>{
  if(!x||!isUuid(x.id)||!c.has(x.id)||x.state!=="HUMAN"||x.human_takeover!==true)return false;
  if(x.subject_type==="vendor")return v.has(x.subject_id);
  if(x.subject_type==="prospect")return p.has(x.subject_id);
  return false; // client/Riya and unknown subject NEVER visible to vendor VOX
 }).slice(0,12).map(x=>Object.freeze({
  conversationId:x.id,subjectType:x.subject_type,
  lane:x.subject_type==="prospect"?"AAROHI":"ANISHA",
  revision:Number.isSafeInteger(Number(x.revision))?Number(x.revision):null,
  serviceWindow:typeof x.service_window_expires_at==="string" &&
    Date.parse(x.service_window_expires_at)>now?"OPEN":"CLOSED_OR_UNKNOWN",
  state:"HUMAN",
  canReply:false,canSendTemplate:false,canTakeover:false,
 }));
 return Object.freeze({
  schema:"qf.vox.service.desk.v1",mode:"READ_ONLY",
  support:Object.freeze(support),humanInbox:Object.freeze(inbox),
  unsupportedUntilApproved:Object.freeze(["staff-case-mutation","whatsapp-outbound","case-sla-executor","agent-takeover"]),
 });
}
export function proposeCaseAssignment(caseId,staffId,expectedRevision){
 // Proposal only. Core must validate city, assigned vendor, manager approval,
 // expected revision, actor and audit before changing any native case.
 if(!isUuid(caseId)||!isUuid(staffId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
  return Object.freeze({accepted:false,reason:"INVALID_REQUEST"});
 return Object.freeze({accepted:false,reason:"CORE_ATOMIC_APPROVAL_NOT_CONNECTED"});
}
