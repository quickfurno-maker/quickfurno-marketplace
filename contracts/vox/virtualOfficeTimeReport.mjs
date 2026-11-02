import {TIME_STATE_SCHEMA} from "./virtualOfficeTimeState.mjs";
const bad=(reason)=>Object.freeze({ok:false,reason,complete:false});
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const ACTIVITY_LIMIT=1000;
/** Summarizes a source-verified Core time state for Owner/TL/Staff projection.
 * Never accepts client-generated totals, presence, webcam or meeting duration.
 * A missing/invalid source is UNKNOWN, never represented as zero productivity.
 */
export function buildVerifiedTimeSummary(state,{asOfMs,sourceVerified=false}={}){
 if(sourceVerified!==true||!state||state.schema!==TIME_STATE_SCHEMA||
    !Array.isArray(state.events)||state.events.length>ACTIVITY_LIMIT||
    !Array.isArray(state.receipts)||state.receipts.length!==state.events.length||
    !safe(state.revision)||state.revision!==state.events.length||
    !safe(asOfMs))return bad("CORE_TIME_SOURCE_UNAVAILABLE");
 if(state.clockedInAt===null){
  if(state.revision!==0||state.events.length!==0||state.clockedOutAt!==null)
   return bad("TIME_SOURCE_INCONSISTENT");
  return Object.freeze({ok:true,complete:true,status:"NOT_STARTED",
   attendanceMs:0,netShiftMs:0,taskMs:0,unattributedMs:0,breakMs:0,
   revision:0,source:"CORE_TIME_LEDGER"});
 }
 if(!safe(state.clockedInAt)||state.clockedInAt>asOfMs||
    (state.clockedOutAt!==null&&(!safe(state.clockedOutAt)||
       state.clockedOutAt<state.clockedInAt||state.clockedOutAt>asOfMs))||
    !safe(state.totalBreakMs)||!safe(state.taskTimeMs))return bad("TIME_SOURCE_INCONSISTENT");
 if(state.clockedOutAt!==null&&(state.breakStartedAt!==null||state.activeTask!==null))
  return bad("TIME_SOURCE_INCONSISTENT");
 const end=state.clockedOutAt??asOfMs;
 const openBreak=state.breakStartedAt!==null?
  (safe(state.breakStartedAt)&&state.breakStartedAt<=asOfMs?
   asOfMs-state.breakStartedAt:NaN):0;
 const openTask=state.activeTask!==null?
  (typeof state.activeTask.workItemId==="string"&&
   safe(state.activeTask.startedAt)&&state.activeTask.startedAt<=asOfMs?
   asOfMs-state.activeTask.startedAt:NaN):0;
 const attendanceMs=end-state.clockedInAt,
  breakMs=state.totalBreakMs+openBreak,
  taskMs=state.taskTimeMs+openTask,
  netShiftMs=attendanceMs-breakMs;
 if(![attendanceMs,breakMs,netShiftMs,taskMs].every(safe)||
   taskMs>netShiftMs)return bad("TIME_SOURCE_INCONSISTENT");
 for(let i=0;i<state.events.length;i++){
  const event=state.events[i],receipt=state.receipts[i];
  if(!event||!receipt||event.revision!==i+1||
     receipt.revision!==i+1||receipt.nonce!==event.nonce||
     !safe(event.atMs)||event.atMs>asOfMs||
     (i>0&&event.atMs<state.events[i-1].atMs))
    return bad("TIME_EVENTS_UNVERIFIED");
 }
 return Object.freeze({ok:true,complete:state.clockedOutAt!==null,
  status:state.clockedOutAt!==null?"CLOCKED_OUT":
   state.breakStartedAt!==null?"ON_BREAK":"CLOCKED_IN",
  attendanceMs,netShiftMs,taskMs,unattributedMs:netShiftMs-taskMs,breakMs,
  revision:state.revision,source:"CORE_TIME_LEDGER"});
}
/** Derives a bounded team rollup from independent verified per-person inputs.
 * Never prints staff IDs or treats unknown employees as absent/offline.
 */
export function aggregateVerifiedTimeSummaries(rows,{expectedStaffCount}={}){
 if(!Array.isArray(rows)||rows.length>200||
    !Number.isSafeInteger(expectedStaffCount)||expectedStaffCount<rows.length||
    expectedStaffCount>200)return bad("STAFF_SCOPE_UNVERIFIED");
 const seen=new Set();let attendanceMs=0,taskMs=0,breakMs=0,verified=0;
 for(const r of rows){
  if(!r||typeof r.staffId!=="string"||seen.has(r.staffId)||
     r.summary?.ok!==true||r.summary?.source!=="CORE_TIME_LEDGER"||
     !["CLOCKED_IN","ON_BREAK","CLOCKED_OUT","NOT_STARTED"].includes(r.summary.status))
   return bad("TEAM_TIME_SOURCE_UNVERIFIED");
  seen.add(r.staffId);
  for(const key of ["attendanceMs","taskMs","breakMs","netShiftMs","unattributedMs"])
   if(!safe(r.summary[key]))return bad("TEAM_TIME_SOURCE_UNVERIFIED");
  attendanceMs+=r.summary.attendanceMs;taskMs+=r.summary.taskMs;
  breakMs+=r.summary.breakMs;verified++;
  if(![attendanceMs,taskMs,breakMs].every(safe))
   return bad("TEAM_TIME_OVERFLOW");
 }
 return Object.freeze({ok:true,complete:verified===expectedStaffCount,
  source:"CORE_TIME_LEDGER",verifiedStaffCount:verified,
  unknownStaffCount:expectedStaffCount-verified,
  attendanceMs,taskMs,breakMs});
}
