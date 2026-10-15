// VOX TO-01 source-only, read-only projection. No SQL, no writes or auth bypass.
// Caller MUST first verify an actual Supabase AAL2 user and fresh Core membership
// via getVerifiedScopedStaff / verifyVoxOwnerBearer. This file NEVER grants access.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES=new Set(["operations_manager","acquisition_agent","vendor_success_agent","support_agent","team_leader","auditor"]);
const SOURCES=new Map([
 ["prospect",["prospectIds","PROSPECT"]],
 ["vendor",["vendorIds","VENDOR"]],
 ["support_thread",["supportThreadIds","SUPPORT"]],
 ["conversation",["conversationIds","HUMAN_INBOX"]],
]);
const STATES=new Set(["NEW","ASSIGNED","IN_PROGRESS","WAITING_EXTERNAL","WAITING_APPROVAL","BLOCKED","DONE","ESCALATED","CANCELLED"]);
const PRIORITIES=new Set(["P0","P1","P2","P3"]);
const EVENTS=new Set(["WORK_ASSIGNED","WORK_STARTED","WORK_COMPLETED","WORK_BLOCKED","WORK_ESCALATED"]);
const validId=x=>typeof x==="string"&&UUID.test(x);
const record=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const validTime=x=>typeof x==="string"&&x.length<=35&&Number.isFinite(Date.parse(x));
const isContext=c=>record(c)&&validId(c.userId)&&validId(c.teamId)&&validId(c.cityId)&&ROLES.has(c.role)&&c.canMutate===false;
function sourceGrant(source,id,context){
 const mapping=SOURCES.get(source);if(!mapping)return false;
 const allowed=context[mapping[0]];
 return Array.isArray(allowed)&&allowed.length<=200&&allowed.includes(id);
}
function canReadSource(row,context){
 if(context.role==="team_leader")return false; // TL may see team queue counts/metadata only.
 if(context.role==="auditor")return false; // Never include subject identifiers in auditor projection.
 return sourceGrant(row.source_kind,row.source_id,context);
}
function project(row,context){
 if(!record(row)||!validId(row.id)||!validId(row.city_id)||!validId(row.team_id)||
  !validId(row.source_id)||!SOURCES.has(row.source_kind)||
  row.city_id!==context.cityId||row.team_id!==context.teamId||
  !STATES.has(row.state)||!PRIORITIES.has(row.priority)||
  !Number.isSafeInteger(row.revision)||row.revision<0||
  !validTime(row.created_at)||!validTime(row.updated_at)||
  (row.assignee_id!==null&&!validId(row.assignee_id))||
  (row.due_at!==null&&!validTime(row.due_at)))return null;
 const directlyGranted=canReadSource(row,context);
 const myAssignment=row.assignee_id===context.userId;
 // No full source title, contact details, raw provider messages or recipient IDs.
 if(context.role!=="team_leader"&&context.role!=="auditor"&&!directlyGranted&&!myAssignment)return null;
 // Assignment alone is NOT a subject grant: it can reveal metadata but not source ID.
 return Object.freeze({id:row.id,kind:SOURCES.get(row.source_kind)[1],state:row.state,
  priority:row.priority,revision:row.revision,
  isMyAssignment:myAssignment,hasAssignee:row.assignee_id!==null,
  subjectRef:directlyGranted?row.source_id:null,
  createdAt:row.created_at,updatedAt:row.updated_at,dueAt:row.due_at,
  canClaim:false,canTransfer:false,canClose:false,canReply:false});
}
export function projectScopedWorkQueue({rows,context,limit=32}){
 if(!isContext(context)||!Array.isArray(rows)||rows.length>200||
    !Number.isInteger(limit)||limit<1||limit>32)
  return Object.freeze({ok:false,error:"UNVERIFIED_SCOPE_OR_BOUNDS",items:[]});
 const seen=new Set(),items=[];
 for(const row of rows){
  const value=project(row,context);
  if(!value||seen.has(value.id))continue;
  seen.add(value.id);items.push(value);
  if(items.length>=limit)break;
 }
 return Object.freeze({ok:true,schema:"qf.vox.team.queue.preview.v1",
  mode:"READ_ONLY",actionsEnabled:false,items:Object.freeze(items)});
}
function istDay(x){
 const date=new Date(x);
 if(!Number.isFinite(date.getTime()))return null;
 const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
 const y=p.find(v=>v.type==="year")?.value,m=p.find(v=>v.type==="month")?.value,d=p.find(v=>v.type==="day")?.value;
 return y&&m&&d?`${y}-${m}-${d}`:null;
}
/** Read-only, deduplicated source-event count. No user-authored activity totals. */
export function aggregateScopedDailyEvents({events,context,businessDate}){
 if(!isContext(context)||!Array.isArray(events)||events.length>1000||
  typeof businessDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(businessDate))
  return Object.freeze({ok:false,error:"INVALID_REPORT_SCOPE_OR_INPUT"});
 const counts={assigned:0,started:0,completed:0,blocked:0,escalated:0};
 const observedEvents=new Set(),buckets=new Set();
 for(const event of events){
  if(!record(event)||!validId(event.id)||!validId(event.work_item_id)||
     !validId(event.city_id)||!validId(event.team_id)||
     event.city_id!==context.cityId||event.team_id!==context.teamId||
     !EVENTS.has(event.event_type)||!validTime(event.occurred_at)||
     istDay(event.occurred_at)!==businessDate||
     !validId(event.assignee_id))continue;
  // Ordinary staff can count own assignments only, never the entire team.
  if(!["team_leader","operations_manager","auditor"].includes(context.role)&&event.assignee_id!==context.userId)continue;
  if(observedEvents.has(event.id))continue;
  observedEvents.add(event.id);
  const key=event.work_item_id+":"+event.event_type;
  if(buckets.has(key))continue;
  buckets.add(key);
  if(event.event_type==="WORK_ASSIGNED")counts.assigned++;
  if(event.event_type==="WORK_STARTED")counts.started++;
  if(event.event_type==="WORK_COMPLETED")counts.completed++;
  if(event.event_type==="WORK_BLOCKED")counts.blocked++;
  if(event.event_type==="WORK_ESCALATED")counts.escalated++;
 }
 return Object.freeze({ok:true,schema:"qf.vox.team.daily.preview.v1",
  mode:"READ_ONLY",businessDate,cityId:context.cityId,teamId:context.teamId,
  counts:Object.freeze(counts),actionsEnabled:false,
  // The caller must set a real source event watermark before any report is certified.
  completeness:"UNVERIFIED_SOURCE_WATERMARK"});
}
