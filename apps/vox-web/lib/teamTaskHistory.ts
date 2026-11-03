import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";
const safe=(x:unknown)=>Number.isSafeInteger(x)&&(x as number)>=0;
const exact=(x:Record<string,unknown>,keys:string[])=>
 Object.keys(x).sort().join("|")===[...keys].sort().join("|");
const timestamp=(v:unknown)=>typeof v==="string"&&v.length<=40&&
 /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&
 Number.isFinite(Date.parse(v));
const deny=(status:number,error:string)=>({ok:false,status,error} as const);
const ACTIONS=new Set(["TASK_PAUSE","TASK_STOP","TASK_SWITCH","BREAK_START","CLOCK_OUT"]);
export type TlTaskHistory={ok:true;status:200;asOf:string;hasMore:boolean;
 entries:Array<{staffRef:string;workRef:string;startedAt:string;
 endedAt:string;elapsedMs:number;revision:number;closingAction:string}>};
export async function fetchTeamTaskHistory():Promise<TlTaskHistory|ReturnType<typeof deny>>{
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
    process.env.VOX_VO10_TL_TASK_HISTORY_UI_ENABLED!=="staging"||
    process.env.VOX_VO10_TL_TASK_HISTORY_ENABLED!=="staging")
  return deny(503,"TEAM_TASK_HISTORY_NOT_CERTIFIED");
 const token=await verifiedMfaSession();
 if(!token)return deny(401,"TEAM_LEADER_MFA_REQUIRED");
 const base=origin();if(!base)return deny(503,"CORE_UNAVAILABLE");
 try{
  const response=await fetch(base+"/api/vox/v1/team-task-history",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(7000)
  });
  if(!response.ok)return deny(response.status===403?403:response.status===401?401:503,
   "TEAM_TASK_HISTORY_SOURCE_UNAVAILABLE");
  const data:unknown=await response.json();
  if(!data||typeof data!=="object"||Array.isArray(data))
   return deny(503,"TEAM_TASK_HISTORY_UNTRUSTED");
  const x=data as Record<string,unknown>;
  if(!exact(x,["ok","schema","mode","source","sourceVerified",
    "rosterVerified","boundedWindow","asOf","windowSize","hasMore",
    "completeHistory","attendanceVerified","payrollVerified","officialEod",
    "livePresence","entries","providerMessagesSent","moneyMinorUnits"])||
    x.ok!==true||x.schema!=="qf.vox.team.closed-task-intervals.v1"||
    x.mode!=="TEAM_LEADER_READ_ONLY"||x.source!=="CORE_IMMUTABLE_TASK_INTERVALS"||
    x.sourceVerified!==true||x.rosterVerified!==true||x.boundedWindow!==true||
    x.windowSize!==20||typeof x.hasMore!=="boolean"||
    x.completeHistory!==false||x.attendanceVerified!==false||
    x.payrollVerified!==false||x.officialEod!==false||
    x.livePresence!==false||x.providerMessagesSent!==0||x.moneyMinorUnits!==0||
    !timestamp(x.asOf)||!Array.isArray(x.entries)||x.entries.length>20||
    (x.hasMore===true&&x.entries.length!==20))
   return deny(503,"TEAM_TASK_HISTORY_UNTRUSTED");
  const entries:TlTaskHistory["entries"]=[], seen=new Set<string>();
  let newest=Infinity;
  for(const item of x.entries){
   if(!item||typeof item!=="object"||Array.isArray(item))
    return deny(503,"TEAM_TASK_ROW_UNTRUSTED");
   const v=item as Record<string,unknown>;
   if(!exact(v,["staffRef","workRef","startedAt","endedAt","elapsedMs",
    "revision","closingAction"])||
    typeof v.staffRef!=="string"||!/^STAFF-[0-9A-F]{8}$/.test(v.staffRef)||
    typeof v.workRef!=="string"||!/^WORK-[0-9A-F]{8}$/.test(v.workRef)||
    !timestamp(v.startedAt)||!timestamp(v.endedAt)||
    !safe(v.elapsedMs)||!safe(v.revision)||(v.revision as number)===0||
    (v.revision as number)>2147483646||!ACTIONS.has(String(v.closingAction))||
    seen.has(v.staffRef+":"+v.revision))
    return deny(503,"TEAM_TASK_ROW_UNTRUSTED");
   const start=Date.parse(v.startedAt as string),end=Date.parse(v.endedAt as string);
   if(end>newest||end>Date.parse(x.asOf as string)||start>end||
      Math.abs(end-start-(v.elapsedMs as number))>1)
    return deny(503,"TEAM_TASK_CHRONOLOGY_UNTRUSTED");
   newest=end;seen.add(v.staffRef+":"+v.revision);
   entries.push({
    staffRef:v.staffRef,workRef:v.workRef,
    startedAt:v.startedAt as string,endedAt:v.endedAt as string,
    elapsedMs:v.elapsedMs as number,revision:v.revision as number,
    closingAction:v.closingAction as string
   });
  }
  return {ok:true,status:200,asOf:x.asOf as string,
   hasMore:x.hasMore as boolean,entries};
 }catch{return deny(503,"TEAM_TASK_HISTORY_SOURCE_UNAVAILABLE");}
}
