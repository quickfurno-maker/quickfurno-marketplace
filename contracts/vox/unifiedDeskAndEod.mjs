// VOX TO-03A synthetic/testable read-only inbox & evidence-ledger report contracts.
// Core must remotely authenticate AAL2 and supply CURRENT city/team/subject grants.
// No new Riya/Anisha/Aarohi agents; none of these projections grants send authority.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCES=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
const COUNTS=["ASSIGNED","STARTED","COMPLETED","BLOCKED","ESCALATED","HANDOVER"];
const id=x=>typeof x==="string"&&UUID.test(x);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const time=x=>typeof x==="string"&&x.length<=40&&Number.isFinite(Date.parse(x));
const contextOk=c=>obj(c)&&id(c.userId)&&id(c.teamId)&&id(c.cityId)&&
 c.canMutate===false&&["operations_manager","acquisition_agent","vendor_success_agent","support_agent","team_leader","auditor"].includes(c.role)&&
 ["prospectIds","vendorIds","supportThreadIds","conversationIds"].every(k=>
   Array.isArray(c[k])&&c[k].length<=200&&c[k].every(id));
const reject=reason=>Object.freeze({ok:false,error:reason,items:[],actionsEnabled:false});
/** Only metadata on HUMAN owned/eligible conversations. No transcript or PII.
 * Client/Riya items DENIED until canonical Core client subject grants exist.
 */
export function projectUnifiedHumanInbox({context,rows,limit=24}={}){
 if(!contextOk(context)||!Array.isArray(rows)||rows.length>200||
  !Number.isInteger(limit)||limit<1||limit>24)return reject("INVALID_CORE_CONTEXT");
 const seen=new Set(),items=[];
 for(const r of rows){
  if(!obj(r)||!id(r.id)||seen.has(r.id)||!id(r.team_id)||!id(r.city_id)||
    r.team_id!==context.teamId||r.city_id!==context.cityId||
    !id(r.subject_id)||!Number.isSafeInteger(r.revision)||r.revision<0||
    !time(r.updated_at)||r.state!=="HUMAN"||r.human_takeover!==true||
    r.consent_state!=="ALLOWED"||r.do_not_contact!==false||
    !["RIYA","ANISHA","AAROHI"].includes(r.lane)||
    !context.conversationIds.includes(r.id)||!context.canReadContent)continue;
  const vendor=r.lane==="ANISHA"&&r.subject_kind==="vendor"&&context.vendorIds.includes(r.subject_id);
  const acquisition=r.lane==="AAROHI"&&r.subject_kind==="prospect"&&context.prospectIds.includes(r.subject_id);
  // Riya/client subject permissions are NOT modelled in legacy Staff scoped grants.
  if(!vendor&&!acquisition)continue;
  seen.add(r.id);
  items.push(Object.freeze({conversationId:r.id,lane:r.lane,state:"HUMAN",
    revision:r.revision,updatedAt:r.updated_at,subjectKind:r.subject_kind,
    canReadTranscript:false,canReply:false,canHandover:false,
    providerMessagesSent:0}));
  if(items.length>=limit)break;
 }
 return Object.freeze({ok:true,schema:"qf.vox.unified.inbox.preview.v1",mode:"METADATA_ONLY",
  actionsEnabled:false,items:Object.freeze(items)});
}
const istDay=x=>new Intl.DateTimeFormat("en-CA",{
  timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"
 }).format(new Date(x));
/** Source watermarks are mandatory provenance from the Core event reader;
 * it is NEVER appropriate to invent totals when a source is unavailable.
 */
export function projectEvidenceLedEod({context,events,businessDate,sourceWatermarks}={}){
 if(!contextOk(context)||!Array.isArray(events)||events.length>1000||
   typeof businessDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)||
   !Number.isFinite(Date.parse(businessDate+"T00:00:00+05:30"))||
   !Array.isArray(sourceWatermarks)||sourceWatermarks.length>4)
   return Object.freeze({ok:false,error:"INVALID_REPORT_INPUT",actionsEnabled:false});
 const bySource=new Map();
 for(const w of sourceWatermarks){
  if(!obj(w)||!SOURCES.includes(w.source)||bySource.has(w.source)||
   !time(w.completeThrough)||!id(w.watermarkId))return Object.freeze({ok:false,error:"BAD_SOURCE_WATERMARK",actionsEnabled:false});
  bySource.set(w.source,w);
 }
 const end=Date.parse(businessDate+"T23:59:59.999+05:30");
 const evidenceComplete=SOURCES.every(s=>bySource.has(s)&&Date.parse(bySource.get(s).completeThrough)>=end);
 const counts={assigned:0,started:0,completed:0,blocked:0,escalated:0,handovers:0};
 const seen=new Set(),byWorkType=new Set();
 for(const r of events){
  if(!obj(r)||!id(r.id)||!id(r.work_item_id)||!id(r.team_id)||!id(r.city_id)||
    !id(r.actor_id)||r.team_id!==context.teamId||r.city_id!==context.cityId||
    !SOURCES.includes(r.source)||!COUNTS.includes(r.event_type)||!time(r.occurred_at)||
    istDay(r.occurred_at)!==businessDate||seen.has(r.id))continue;
  if(!["team_leader","operations_manager","auditor"].includes(context.role)&&r.actor_id!==context.userId)continue;
  seen.add(r.id);
  const key=r.source+":"+r.work_item_id+":"+r.event_type;
  if(byWorkType.has(key))continue;
  byWorkType.add(key);
  if(r.event_type==="ASSIGNED")counts.assigned++;
  if(r.event_type==="STARTED")counts.started++;
  if(r.event_type==="COMPLETED")counts.completed++;
  if(r.event_type==="BLOCKED")counts.blocked++;
  if(r.event_type==="ESCALATED")counts.escalated++;
  if(r.event_type==="HANDOVER")counts.handovers++;
 }
 return Object.freeze({ok:true,schema:"qf.vox.eod.evidence.preview.v1",
  teamId:context.teamId,cityId:context.cityId,businessDate,
  mode:"READ_ONLY",actionsEnabled:false,
  completeness:evidenceComplete?"SOURCE_WATERMARKS_COVER_DAY":"INCOMPLETE_OR_UNVERIFIED",
  counts:Object.freeze(counts),sourceCount:bySource.size,
  canSubmit:false,canAcknowledge:false});
}
