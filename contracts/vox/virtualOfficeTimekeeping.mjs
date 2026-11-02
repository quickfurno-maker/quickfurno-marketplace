/**
 * Virtual Office V0 — pure, source-only command boundary.
 * Does not perform Auth, SQL, attendance writes, clock measurement or payroll.
 * Server-owned Staff identity and timestamps MUST be resolved by Core.
 * Each command is executed atomically under a DB lock and original nonce ledger.
 */
export const VO_TIME_SCHEMA="qf.vox.virtual-office.time-command.v1";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const attendance=new Set(["CLOCK_IN","BREAK_START","BREAK_END","CLOCK_OUT"]);
const task=new Set(["TASK_START","TASK_PAUSE","TASK_RESUME","TASK_STOP","TASK_SWITCH"]);
const deny=reason=>Object.freeze({ok:false,reason,persisted:false});
const same=(keys,expected)=>keys.length===expected.length &&
  keys.every((x,i)=>x===[...expected].sort()[i]);

export function validateTimeCommand(raw){
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return deny("INVALID_COMMAND");
 const {action,nonce,expectedRevision,workItemId}=raw;
 if(!attendance.has(action)&&!task.has(action))return deny("INVALID_ACTION");
 const required=task.has(action)?["action","expectedRevision","nonce","workItemId"]:
  ["action","expectedRevision","nonce"];
 if(!same(Object.keys(raw).sort(),required))return deny("UNKNOWN_OR_MISSING_FIELDS");
 if(typeof nonce!=="string"||!uuid.test(nonce)||
    !Number.isSafeInteger(expectedRevision)||expectedRevision<0||
    expectedRevision>2147483646)return deny("INVALID_NONCE_OR_REVISION");
 if(task.has(action)&&(typeof workItemId!=="string"||!uuid.test(workItemId)))
  return deny("INVALID_WORK_ITEM");
 return Object.freeze({ok:true,schema:VO_TIME_SCHEMA,persisted:false,
  command:Object.freeze({action,nonce,expectedRevision,
   ...(task.has(action)?{workItemId}:{})})});
}

/**
 * The authoritative DB must supply these event intervals; do not derive
 * payroll or worker productivity from browser events or connection presence.
 * This pure verifier refuses overlaps, malformed records, and fabricated totals.
 */
export function validateRecordedIntervals(intervals){
 if(!Array.isArray(intervals)||intervals.length>1000)
  return deny("INVALID_INTERVALS");
 let total=0,previousEnd=-Infinity;
 for(const interval of intervals){
  if(!interval||typeof interval!=="object"||Array.isArray(interval)||
     !same(Object.keys(interval).sort(),["startMs","endMs"]))
    return deny("INVALID_INTERVAL");
  const {startMs,endMs}=interval;
  if(!Number.isSafeInteger(startMs)||!Number.isSafeInteger(endMs)||
     startMs<0||endMs<=startMs||startMs<previousEnd)
    return deny("OVERLAPPING_OR_UNVERIFIED_INTERVAL");
  const delta=endMs-startMs;
  if(!Number.isSafeInteger(delta)||!Number.isSafeInteger(total+delta))
    return deny("INTERVAL_OVERFLOW");
  total+=delta;previousEnd=endMs;
 }
 return Object.freeze({ok:true,persisted:false,totalMs:total});
}
