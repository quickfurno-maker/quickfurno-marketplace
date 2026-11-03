// VO9 own-Staff per-task time read projection. This is a bounded reference-only
// view of immutable reviewed candidates; never a payroll or EOD certification.
export const TASK_INTERVAL_HISTORY_SCHEMA="qf.vox.staff.task-intervals.v1";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS=["closed_by_event_nonce","staff_id","team_id","city_id",
 "work_item_id","started_at","ended_at","elapsed_ms","state_revision","closing_action"];
const ACTIONS=new Set(["TASK_PAUSE","TASK_STOP","TASK_SWITCH","BREAK_START","CLOCK_OUT"]);
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const exact=(r,fields)=>Object.keys(r).sort().join("|")===[...fields].sort().join("|");
const fail=reason=>Object.freeze({ok:false,reason,sourceVerified:false});
function instant(value){
 if(typeof value!=="string"||value.length>40||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value))return null;
 const n=Date.parse(value);
 return safe(n)?n:null;
}
export function projectVerifiedTaskIntervals(rows,scope={}){
 const {staffId,teamId,cityId,serverNowMs,sourceVerified=false}=scope;
 if(sourceVerified!==true||![staffId,teamId,cityId].every(s=>typeof s==="string"&&UUID.test(s))||
  !safe(serverNowMs)||!Array.isArray(rows)||rows.length>21)
  return fail("TASK_HISTORY_SOURCE_UNAVAILABLE");
 const seenNonces=new Set(),seenRevisions=new Set(),entries=[];
 let previous=Infinity;
 for(const row of rows){
  if(!row||typeof row!=="object"||Array.isArray(row)||!exact(row,FIELDS)||
   row.staff_id!==staffId||row.team_id!==teamId||row.city_id!==cityId||
   ![row.closed_by_event_nonce,row.work_item_id].every(s=>typeof s==="string"&&UUID.test(s))||
   !ACTIONS.has(row.closing_action)||!safe(row.elapsed_ms)||
   !safe(row.state_revision)||row.state_revision===0||row.state_revision>2147483646||
   seenNonces.has(row.closed_by_event_nonce)||seenRevisions.has(row.state_revision))
   return fail("TASK_HISTORY_ROW_UNTRUSTED");
  const start=instant(row.started_at),end=instant(row.ended_at);
  if(start===null||end===null||start>end||end>serverNowMs||end>previous||
   Math.abs((end-start)-row.elapsed_ms)>1)
   return fail("TASK_HISTORY_CHRONOLOGY_INVALID");
  seenNonces.add(row.closed_by_event_nonce);
  seenRevisions.add(row.state_revision);
  previous=end;
  if(entries.length<20)entries.push(Object.freeze({
   workItemId:row.work_item_id,startedAt:row.started_at,
   endedAt:row.ended_at,elapsedMs:row.elapsed_ms,
   revision:row.state_revision,closingAction:row.closing_action
  }));
 }
 return Object.freeze({ok:true,schema:TASK_INTERVAL_HISTORY_SCHEMA,
  source:"CORE_VERIFIED_TASK_INTERVALS",sourceVerified:true,
  mode:"OWN_STAFF_READ_ONLY",asOf:new Date(serverNowMs).toISOString(),
  completeHistory:false,officialEod:false,payrollVerified:false,
  moneyMinorUnits:0,providerMessagesSent:0,
  windowSize:20,hasMore:rows.length>20,entries:Object.freeze(entries)});
}
