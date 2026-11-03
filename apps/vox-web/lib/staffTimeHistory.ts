import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(["TASK_PAUSE","TASK_STOP","TASK_SWITCH","BREAK_START","CLOCK_OUT"]);
const exact=(v:Record<string,unknown>,fields:string[])=>
 Object.keys(v).sort().join("|")===[...fields].sort().join("|");
const safe=(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=0;
const stamp=(v:unknown)=>typeof v==="string"&&v.length<=40&&
 /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&
 Number.isFinite(Date.parse(v));
export type StaffTaskHistory={
 ok:true;statusCode:200;asOf:string;hasMore:boolean;nextCursor:string|null;completeHistory:false;
 entries:Array<{workItemId:string;startedAt:string;endedAt:string;
 elapsedMs:number;revision:number;closingAction:string}>
};
const deny=(code:number,error:string)=>({ok:false,statusCode:code,error} as const);
export async function fetchMyTaskIntervals(cursor:string|null=null):Promise<StaffTaskHistory|ReturnType<typeof deny>>{
 if(cursor!==null&&(typeof cursor!=="string"||cursor.length<35||
   cursor.length>250||!/^[A-Za-z0-9_-]+$/.test(cursor)))
  return deny(400,"HISTORY_CURSOR_INVALID");
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
    process.env.VOX_VO9_TIME_HISTORY_UI_ENABLED!=="staging"||
    process.env.VOX_VO9_TIME_HISTORY_READ_ENABLED!=="staging")
  return deny(503,"TASK_HISTORY_NOT_CERTIFIED");
 const token=await verifiedMfaSession();
 if(!token)return deny(401,"STAFF_MFA_REQUIRED");
 const base=origin();if(!base)return deny(503,"CORE_ORIGIN_UNAVAILABLE");
 try{
  const response=await fetch(base+"/api/vox/v1/staff-time-history"+
   (cursor?"?cursor="+encodeURIComponent(cursor):""),{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000)
  });
  if(!response.ok)return deny(response.status===401?401:
   response.status===403?403:503,"TASK_HISTORY_SOURCE_UNAVAILABLE");
  const raw:unknown=await response.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return deny(503,"TASK_HISTORY_UNTRUSTED");
  const r=raw as Record<string,unknown>;
  if(!exact(r,["ok","schema","source","sourceVerified","mode","asOf",
   "completeHistory","officialEod","payrollVerified","moneyMinorUnits",
   "providerMessagesSent","windowSize","hasMore","nextCursor","entries"])||
   r.ok!==true||r.schema!=="qf.vox.staff.task-intervals.v1"||
   r.source!=="CORE_VERIFIED_TASK_INTERVALS"||r.sourceVerified!==true||
   r.mode!=="OWN_STAFF_READ_ONLY"||r.completeHistory!==false||
   r.officialEod!==false||r.payrollVerified!==false||
   r.moneyMinorUnits!==0||r.providerMessagesSent!==0||
   r.windowSize!==20||typeof r.hasMore!=="boolean"||
   !stamp(r.asOf)||!Array.isArray(r.entries)||r.entries.length>20||
   (r.hasMore===true&&r.entries.length!==20)||
   (r.hasMore===true&&(typeof r.nextCursor!=="string"||
     r.nextCursor.length<35||r.nextCursor.length>250||
     !/^[A-Za-z0-9_-]+$/.test(r.nextCursor)))||
   (r.hasMore===false&&r.nextCursor!==null))
   return deny(503,"TASK_HISTORY_UNTRUSTED");
  const entries:StaffTaskHistory["entries"]=[];
  const revisions=new Set<number>();
  let preceding=Infinity;
  for(const value of r.entries){
   if(!value||typeof value!=="object"||Array.isArray(value))
    return deny(503,"TASK_HISTORY_ROW_UNTRUSTED");
   const x=value as Record<string,unknown>;
   if(!exact(x,["workItemId","startedAt","endedAt","elapsedMs",
    "revision","closingAction"])||
    typeof x.workItemId!=="string"||!UUID.test(x.workItemId)||
    !stamp(x.startedAt)||!stamp(x.endedAt)||!safe(x.elapsedMs)||
    !safe(x.revision)||(x.revision as number)===0||
    (x.revision as number)>2147483646||revisions.has(x.revision as number)||
    !STATES.has(String(x.closingAction)))return deny(503,"TASK_HISTORY_ROW_UNTRUSTED");
   const start=Date.parse(x.startedAt as string),end=Date.parse(x.endedAt as string);
   if(start>end||end>preceding||end>Date.parse(r.asOf as string)||
    Math.abs(end-start-(x.elapsedMs as number))>1)
    return deny(503,"TASK_HISTORY_ROW_UNTRUSTED");
   preceding=end;revisions.add(x.revision as number);
   entries.push({workItemId:x.workItemId,
    startedAt:x.startedAt as string,endedAt:x.endedAt as string,
    elapsedMs:x.elapsedMs as number,revision:x.revision as number,
    closingAction:x.closingAction as string});
  }
  return {ok:true,statusCode:200,asOf:r.asOf as string,
   hasMore:r.hasMore as boolean,nextCursor:r.nextCursor as string|null,
   completeHistory:false,entries};
 }catch{return deny(503,"TASK_HISTORY_SOURCE_UNAVAILABLE");}
}
