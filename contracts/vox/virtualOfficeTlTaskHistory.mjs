// VO10 bounded Team Leader task interval read. Current neutral Staff roster
// and immutable VO7 source are independently verified by Core. Not performance,
// monitoring, payroll, official EOD, or complete historical tracking.
import {projectVerifiedTaskIntervals} from "./virtualOfficeTimeHistory.mjs";
import {encodeHistoryCursor} from "./virtualOfficeHistoryCursor.mjs";
export const TL_TASK_HISTORY_SCHEMA="qf.vox.team.closed-task-intervals.v1";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE=new Set(["operations_manager","acquisition_agent","vendor_success_agent","support_agent"]);
const valid=x=>typeof x==="string"&&UUID.test(x);
const safe=x=>Number.isSafeInteger(x)&&x>=0;
const exact=(x,fields)=>Object.keys(x).sort().join("|")===[...fields].sort().join("|");
const fail=reason=>Object.freeze({ok:false,reason,sourceVerified:false});
export function projectVerifiedTlTaskHistory(members,rows,opts={}){
 const {leaderId,teamId,cityId,serverNowMs,rosterVerified=false,
  rowSourceVerified=false}=opts;
 if(!valid(leaderId)||!valid(teamId)||!valid(cityId)||!safe(serverNowMs)||
  rosterVerified!==true||rowSourceVerified!==true||
  !Array.isArray(members)||members.length>20||!Array.isArray(rows)||
  rows.length>21)return fail("TL_TASK_HISTORY_SOURCE_UNVERIFIED");
 const actors=new Map(),refs=new Set();
 for(const m of members){
  if(!m||typeof m!=="object"||Array.isArray(m)||
    !exact(m,["staffId","teamId","cityId","role","verifiedNeutralStaff"])||
    !valid(m.staffId)||m.staffId===leaderId||actors.has(m.staffId)||
    m.teamId!==teamId||m.cityId!==cityId||
    !ROLE.has(m.role)||m.verifiedNeutralStaff!==true)
   return fail("TL_TASK_HISTORY_STAFF_UNVERIFIED");
  const ref="STAFF-"+m.staffId.slice(0,8).toUpperCase();
  if(refs.has(ref))return fail("TL_TASK_HISTORY_REF_COLLISION");
  refs.add(ref);actors.set(m.staffId,ref);
 }
 const rowsSeen=new Set(),nonceSeen=new Set(),workRefs=new Map();
 let lastEnd=Infinity;
 const entries=[];
 for(const row of rows){
  if(!row||!actors.has(row.staff_id)||typeof row.closed_by_event_nonce!=="string"||
   !valid(row.closed_by_event_nonce)||nonceSeen.has(row.closed_by_event_nonce))
   return fail("TL_TASK_HISTORY_FOREIGN_ROW");
  const projection=projectVerifiedTaskIntervals([row],{
   staffId:row.staff_id,teamId,cityId,serverNowMs,sourceVerified:true
  });
  if(projection.ok!==true||projection.entries.length!==1)
   return fail("TL_TASK_HISTORY_INTEGRITY_UNVERIFIED");
  const item=projection.entries[0];
  if(item.revision<=0||rowsSeen.has(row.staff_id+":"+item.revision))
   return fail("TL_TASK_HISTORY_REVISION_DUPLICATE");
  const end=Date.parse(item.endedAt);
  if(end>lastEnd)return fail("TL_TASK_HISTORY_ORDER_INVALID");
  lastEnd=end;
  nonceSeen.add(row.closed_by_event_nonce);
  rowsSeen.add(row.staff_id+":"+item.revision);
  const workRef="WORK-"+item.workItemId.slice(0,8).toUpperCase();
  if(workRefs.has(workRef)&&workRefs.get(workRef)!==item.workItemId)
   return fail("TL_TASK_HISTORY_WORK_REF_COLLISION");
  workRefs.set(workRef,item.workItemId);
  if(entries.length<20)entries.push(Object.freeze({
   staffRef:actors.get(row.staff_id),workRef,
   startedAt:item.startedAt,endedAt:item.endedAt,
   elapsedMs:item.elapsedMs,revision:item.revision,
   closingAction:item.closingAction
  }));
 }
 return Object.freeze({ok:true,schema:TL_TASK_HISTORY_SCHEMA,
  mode:"TEAM_LEADER_READ_ONLY",source:"CORE_IMMUTABLE_TASK_INTERVALS",
  sourceVerified:true,rosterVerified:true,boundedWindow:true,
  asOf:new Date(serverNowMs).toISOString(),windowSize:20,
  hasMore:rows.length===21,
  nextCursor:rows.length===21?encodeHistoryCursor(rows[19]):null,
  completeHistory:false,attendanceVerified:false,
  payrollVerified:false,officialEod:false,livePresence:false,
  entries:Object.freeze(entries),providerMessagesSent:0,moneyMinorUnits:0});
}
