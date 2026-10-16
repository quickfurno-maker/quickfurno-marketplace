// VOX-08O: evidence-led EOD reconciliation across EXISTING Core/CRM/Desk/Agent
// event sources. No report submission, extra Staff grants, delivery or AI claims.
// All provenance is supplied by a future trusted Core reader, not the browser.
export const EOD_SOURCES=Object.freeze([
 "CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"
]);
const kinds=new Set(["ASSIGNED","STARTED","COMPLETED","BLOCKED","ESCALATED","HANDOVER"]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=s=>typeof s==="string"&&UUID.test(s);
const obj=s=>s!==null&&typeof s==="object"&&!Array.isArray(s);
const sameKeys=(value,keys)=>obj(value)&&Object.keys(value).sort().join("|")===[...keys].sort().join("|");
const reject=error=>Object.freeze({ok:false,error,mode:"READ_ONLY",
 canSubmit:false,canAcknowledge:false,canExport:false,providerMessagesSent:0});
function istBounds(s){
 if(typeof s!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
 const start=Date.parse(s+"T00:00:00+05:30");
 if(!Number.isFinite(start))return null;
 const iso=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",
  year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(start));
 return iso===s?{start,end:start+86400000}:null;
}
const moment=(s)=>typeof s==="string"&&s.length<=40&&Number.isFinite(Date.parse(s));
const counts=()=>({assigned:0,started:0,completed:0,blocked:0,escalated:0,handovers:0});
const map=Object.freeze({ASSIGNED:"assigned",STARTED:"started",COMPLETED:"completed",
 BLOCKED:"blocked",ESCALATED:"escalated",HANDOVER:"handovers"});
/**
 * Source inputs must be obtained independently by Core with strong identity,
 * current object-scoped grants and signed agent context WHERE applicable.
 * This pure function DOES NOT certify any upstream signature or database origin.
 * Unknown/late source data cannot be represented as all-source complete.
 */
export function reconcileStaffEodEvidence({
 context,businessDate,sources,now=Date.now()
}={}){
 if(!obj(context)||!id(context.userId)||!id(context.teamId)||!id(context.cityId)||
  context.canReadContent!==true||context.canMutate!==false||
  !["operations_manager","acquisition_agent","vendor_success_agent","support_agent"].includes(context.role)||
  !Array.isArray(context.prospectIds)||!Array.isArray(context.vendorIds)||
  !Array.isArray(context.supportThreadIds)||!Array.isArray(context.conversationIds)||
  ["prospectIds","vendorIds","supportThreadIds","conversationIds"].some(k=>
   context[k].length>200||context[k].some(v=>!id(v))||
   new Set(context[k]).size!==context[k].length))
  return reject("CURRENT_SCOPED_STAFF_REQUIRED");
 const window=istBounds(businessDate);
 if(!window||!Number.isSafeInteger(now)||now<window.start||
  now>window.end+86400000)return reject("CURRENT_OR_PREVIOUS_IST_DAY_ONLY");
 if(!Array.isArray(sources)||sources.length>4)
  return reject("UNBOUNDED_EOD_SOURCES");
 const existing=new Map(),verified=new Map(),allIds=new Set(),revisions=new Set();
 const rollup=counts();
 let included=0;
 for(const source of sources){
  if(!obj(source)||!EOD_SOURCES.includes(source.source)||existing.has(source.source)||
    !sameKeys(source,["source","sourceWatermark","events","readerProof"])||
    !Array.isArray(source.events)||source.events.length>100||
    !obj(source.readerProof)||!sameKeys(source.readerProof,
     ["trust","teamId","cityId","staffId","scopeRevision","committedAt"])||
    source.readerProof.trust!=="CORE_SERVER_READ_ONLY"||
    source.readerProof.teamId!==context.teamId||source.readerProof.cityId!==context.cityId||
    source.readerProof.staffId!==context.userId||
    !Number.isSafeInteger(source.readerProof.scopeRevision)||
    source.readerProof.scopeRevision<1||
    !moment(source.readerProof.committedAt)||
    Date.parse(source.readerProof.committedAt)>now+30000)
   return reject("SOURCE_IDENTITY_OR_AUTHORITY_NOT_PROVEN");
  existing.set(source.source,source);
  const watermark=source.sourceWatermark;
  const goodWatermark=obj(watermark)&&sameKeys(watermark,
   ["watermarkId","completeThrough","readerVersion","origin"])&&
   id(watermark.watermarkId)&&moment(watermark.completeThrough)&&
   /^[a-z0-9][a-z0-9._-]{0,31}$/i.test(String(watermark.readerVersion))&&
   watermark.origin==="CORE_VERIFIED_READER"&&
   Date.parse(watermark.completeThrough)>=window.end&&
   Date.parse(watermark.completeThrough)<=now+30000;
  const subtotal=counts();
  for(const e of source.events){
   if(!sameKeys(e,["id","source","actorId","teamId","cityId",
    "subjectKind","subjectId","workItemId","eventType","revision","occurredAt"])||
    !id(e.id)||allIds.has(e.id)||e.source!==source.source||
    e.actorId!==context.userId||e.teamId!==context.teamId||
    e.cityId!==context.cityId||!id(e.subjectId)||!id(e.workItemId)||
    !kinds.has(e.eventType)||!Number.isSafeInteger(e.revision)||
    e.revision<0||e.revision>2147483647||!moment(e.occurredAt)||
    Date.parse(e.occurredAt)<window.start||Date.parse(e.occurredAt)>=window.end)
    return reject("UNVERIFIED_EOD_EVENT");
   const grants={prospect:"prospectIds",vendor:"vendorIds",
    support_thread:"supportThreadIds",conversation:"conversationIds"};
   if(!Object.hasOwn(grants,e.subjectKind)||
    !context[grants[e.subjectKind]].includes(e.subjectId)||
    (source.source==="CORE_CONVERSATION"&&e.subjectKind!=="conversation")||
    (source.source==="CRM_AAROHI"&&e.subjectKind!=="prospect")||
    (source.source==="SUPPORT_DESK"&&e.subjectKind!=="support_thread"))
    return reject("REVOKED_OR_FOREIGN_EOD_SUBJECT");
   const version=source.source+":"+e.workItemId+":"+e.revision;
   if(revisions.has(version))return reject("REPLAYED_EOD_WORK_REVISION");
   revisions.add(version);
   allIds.add(e.id);
   subtotal[map[e.eventType]]++;
   included++;
  }
  verified.set(source.source,Object.freeze({
   source:source.source,coverage:goodWatermark?"COVERED_BY_SOURCE_ASSERTION":"INCOMPLETE_OR_UNKNOWN",
   count:source.events.length,counts:Object.freeze(subtotal)
  }));
  // A covered source does not mean it has an independently audited signed
  // authority; never claim that externally in this source-only projection.
  if(goodWatermark)for(const key of Object.keys(rollup))rollup[key]+=subtotal[key];
 }
 const allPresent=EOD_SOURCES.every(s=>existing.has(s));
 const allCovered=allPresent&&EOD_SOURCES.every(s=>
  verified.get(s).coverage==="COVERED_BY_SOURCE_ASSERTION");
 const evidenceBySource=EOD_SOURCES.map(name=>verified.get(name)??Object.freeze({
  source:name,coverage:"MISSING",count:0,counts:Object.freeze(counts())
 }));
 return Object.freeze({ok:true,schema:"qf.vox.eod.multi-source.provenance.v2",
  mode:"READ_ONLY",businessDate,subjectScope:"CURRENT_STAFF_ONLY",
  completeness:allCovered?"COVERAGE_ASSERTED_NOT_AUDITED":"INCOMPLETE_OR_UNVERIFIED",
  sourceCount:existing.size,requiredSourceCount:4,
  eventsVerified:included,
  // Totals explicitly unavailable until all four source watermarks cover the day.
  rollup:allCovered?Object.freeze(rollup):null,
  evidenceBySource:Object.freeze(evidenceBySource),
  canSubmit:false,canAcknowledge:false,canExport:false,
  canApproveFinalBusinessReport:false,providerMessagesSent:0,
  requiresSignedSourceReaders:true,requiresIndependentHumanApproval:true});
}
