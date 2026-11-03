/* VO4 read-only projection. Only Core may verify Staff and database source.
Never use as payroll, complete EOD, or realtime connection evidence. */
export const TIME_READ_SCHEMA="qf.vox.staff.time.current-shift.v1";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=v=>typeof v==="string"&&uuid.test(v);
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const FIELDS=["staff_id","team_id","city_id","revision","clocked_in_at",
 "clocked_out_at","break_started_at","total_break_ms","active_work_item_id",
 "task_started_at","last_work_item_id","task_time_ms","last_event_at"];
const bad=reason=>Object.freeze({ok:false,reason,sourceVerified:false});
const instant=v=>{
 if(typeof v!=="string"||v.length>40||
  !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v))return null;
 const n=Date.parse(v);return safe(n)?n:null;
};
export function projectVerifiedStaffTimeRow(row,scope={}){
 const {staffId,teamId,cityId,serverNowMs,sourceVerified=false}=scope;
 if(sourceVerified!==true||!id(staffId)||!id(teamId)||!id(cityId)||
  !safe(serverNowMs))return bad("CORE_TIME_SOURCE_UNAVAILABLE");
 const base={ok:true,schema:TIME_READ_SCHEMA,mode:"READ_ONLY",
  source:"CORE_CURRENT_SHIFT",sourceVerified:true,
  completeHistory:false,officialEod:false,payrollVerified:false,
  providerMessagesSent:0,moneyMinorUnits:0,asOf:new Date(serverNowMs).toISOString()};
 if(row===null)return Object.freeze({...base,status:"NOT_STARTED",revision:0,
  clockedInAt:null,clockedOutAt:null,activeWorkItemId:null,
  attendanceMs:0,breakMs:0,taskMs:0,netShiftMs:0,unattributedMs:0});
 if(!row||typeof row!=="object"||Array.isArray(row)||
  Object.keys(row).sort().join("|")!==[...FIELDS].sort().join("|")||
  row.staff_id!==staffId||row.team_id!==teamId||row.city_id!==cityId||
  !safe(row.revision)||row.revision>2147483646||
  !safe(row.total_break_ms)||!safe(row.task_time_ms)||
  (row.active_work_item_id!==null&&!id(row.active_work_item_id))||
  (row.last_work_item_id!==null&&!id(row.last_work_item_id)))
  return bad("CORE_TIME_ROW_UNTRUSTED");
 const fields=["clocked_in_at","clocked_out_at","break_started_at",
  "task_started_at","last_event_at"];
 const parsed=fields.map(k=>row[k]===null?null:instant(row[k]));
 if(fields.some((k,i)=>row[k]!==null&&parsed[i]===null))
  return bad("CORE_TIME_TIMESTAMP_UNTRUSTED");
 const [start,end,breakStart,taskStart,lastEvent]=parsed;
 if((row.active_work_item_id===null)!==(taskStart===null)||
  (breakStart!==null&&taskStart!==null)||
  (end!==null&&(start===null||end<start||breakStart!==null||taskStart!==null))||
  (row.revision===0)!==(lastEvent===null)||
  (start===null&&row.revision!==0)||(start!==null&&row.revision===0)||
  [start,end,breakStart,taskStart,lastEvent].some(x=>x!==null&&x>serverNowMs)||
  (start!==null&&lastEvent!==null&&lastEvent<start)||
  (breakStart!==null&&(start===null||breakStart<start))||
  (taskStart!==null&&(start===null||taskStart<start))||
  (start===null&&(row.total_break_ms!==0||row.task_time_ms!==0)))
  return bad("CORE_TIME_ROW_INCONSISTENT");
 const attendanceMs=start===null?0:(end??serverNowMs)-start;
 const breakMs=row.total_break_ms+(breakStart!==null?serverNowMs-breakStart:0);
 const taskMs=row.task_time_ms+(taskStart!==null?serverNowMs-taskStart:0);
 const netShiftMs=attendanceMs-breakMs;
 if(![attendanceMs,breakMs,taskMs,netShiftMs].every(safe)||
  taskMs>netShiftMs)return bad("CORE_TIME_DURATION_INCONSISTENT");
 const status=start===null?"NOT_STARTED":end!==null?"CLOCKED_OUT":
  breakStart!==null?"ON_BREAK":taskStart!==null?"TRACKING_TASK":"CLOCKED_IN";
 return Object.freeze({...base,status,revision:row.revision,
  clockedInAt:row.clocked_in_at,clockedOutAt:row.clocked_out_at,
  activeWorkItemId:row.active_work_item_id,attendanceMs,breakMs,taskMs,
  netShiftMs,unattributedMs:netShiftMs-taskMs});
}
