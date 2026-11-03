import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS=new Set(["CLOCK_IN","CLOCK_OUT","BREAK_START","BREAK_END",
 "TASK_START","TASK_PAUSE","TASK_RESUME","TASK_STOP","TASK_SWITCH"]);
export type StaffTimeCommand={action:string;nonce:string;expectedRevision:number;workItemId?:string};
export type StaffTimeSnapshot={ok:true;statusCode:200;
 schema:"qf.vox.staff.time.current-shift.v1";status:"NOT_STARTED"|"CLOCKED_IN"|
 "TRACKING_TASK"|"ON_BREAK"|"CLOCKED_OUT";revision:number;
 asOf:string;clockedInAt:string|null;clockedOutAt:string|null;
 activeWorkItemId:string|null;resumeWorkItemId:string|null;
 attendanceMs:number;breakMs:number;
 taskMs:number;netShiftMs:number;unattributedMs:number;
 completeHistory:false;officialEod:false;payrollVerified:false};
const disabled=(error:string)=>({ok:false,statusCode:503,error} as const);
const unknown=()=>({ok:false,statusCode:503,error:"CORE_TIME_OUTCOME_UNKNOWN",
 committed:null,retrySameNonceOnly:true} as const);
const exact=(r:Record<string,unknown>,keys:string[])=>
 Object.keys(r).sort().join("|")===[...keys].sort().join("|");
const time=(s:unknown)=>typeof s==="string"&&s.length<=40&&
 Number.isFinite(Date.parse(s));
const safe=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>=0;
const readEnabled=()=>process.env.VOX_STAFF_PORTAL_ENABLED==="staging"&&
 process.env.VOX_TEAM_WORKSPACE_ENABLED==="staging"&&
 process.env.VOX_VO4_WORKDAY_UI_ENABLED==="staging"&&
 process.env.VOX_VO4_TIME_READ_ENABLED==="staging"&&
 ["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE));
const writeEnabled=()=>readEnabled()&&
 process.env.VOX_VO3_TIME_WRITES_ENABLED==="staging";
export async function fetchCurrentStaffTime(){
 if(!readEnabled())return disabled("STAFF_WORKDAY_NOT_CERTIFIED");
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,statusCode:401,error:"STAFF_MFA_REQUIRED"} as const;
 const base=origin();
 if(!base)return disabled("CORE_ORIGIN_UNAVAILABLE");
 try{
  const response=await fetch(base+"/api/vox/v1/staff-time-state",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000)
  });
  if(!response.ok)return {ok:false,statusCode:response.status===401?401:
   response.status===403?403:503,error:"CURRENT_SHIFT_UNAVAILABLE"} as const;
  const raw:unknown=await response.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return disabled("UNVERIFIED_TIME_SOURCE");
  const r=raw as Record<string,unknown>;
  if(!exact(r,["ok","schema","mode","source","sourceVerified","completeHistory",
   "officialEod","payrollVerified","providerMessagesSent","moneyMinorUnits",
   "asOf","status","revision","clockedInAt","clockedOutAt","activeWorkItemId",
   "resumeWorkItemId","attendanceMs","breakMs","taskMs","netShiftMs","unattributedMs"])||
   r.ok!==true||r.schema!=="qf.vox.staff.time.current-shift.v1"||
   r.mode!=="READ_ONLY"||r.source!=="CORE_CURRENT_SHIFT"||
   r.sourceVerified!==true||r.completeHistory!==false||r.officialEod!==false||
   r.payrollVerified!==false||r.providerMessagesSent!==0||
   r.moneyMinorUnits!==0||
   !["NOT_STARTED","CLOCKED_IN","TRACKING_TASK","ON_BREAK",
     "CLOCKED_OUT"].includes(String(r.status))||
   !safe(r.revision)||(r.revision as number)>2147483646||
   !time(r.asOf)||
   (r.clockedInAt!==null&&!time(r.clockedInAt))||
   (r.clockedOutAt!==null&&!time(r.clockedOutAt))||
   (r.activeWorkItemId!==null&&
    (typeof r.activeWorkItemId!=="string"||!UUID.test(r.activeWorkItemId)))||
   (r.resumeWorkItemId!==null&&
    (typeof r.resumeWorkItemId!=="string"||!UUID.test(r.resumeWorkItemId)))||
   (r.status!=="CLOCKED_IN"&&r.resumeWorkItemId!==null)||
   !["attendanceMs","breakMs","taskMs","netShiftMs","unattributedMs"].every(k=>safe(r[k]))||
   (r.attendanceMs as number)!==(r.breakMs as number)+(r.netShiftMs as number)||
   (r.netShiftMs as number)!==(r.taskMs as number)+(r.unattributedMs as number)||
   ((r.status==="TRACKING_TASK")!==(r.activeWorkItemId!==null))||
   (r.status==="NOT_STARTED"&&r.revision!==0))
   return disabled("UNVERIFIED_TIME_SOURCE");
  return {ok:true,statusCode:200,schema:r.schema,status:r.status,
   revision:r.revision,asOf:r.asOf,clockedInAt:r.clockedInAt,
   clockedOutAt:r.clockedOutAt,activeWorkItemId:r.activeWorkItemId,
   resumeWorkItemId:r.resumeWorkItemId,
   attendanceMs:r.attendanceMs,breakMs:r.breakMs,taskMs:r.taskMs,
   netShiftMs:r.netShiftMs,unattributedMs:r.unattributedMs,
   completeHistory:false,officialEod:false,payrollVerified:false} as StaffTimeSnapshot;
 }catch{return disabled("CURRENT_SHIFT_UNAVAILABLE");}
}
export async function submitStaffTimeCommand(command:StaffTimeCommand){
 if(!writeEnabled())return disabled("STAFF_TIME_WRITES_NOT_CERTIFIED");
 if(!command||typeof command.action!=="string"||!ACTIONS.has(command.action)||
  !UUID.test(command.nonce)||!safe(command.expectedRevision)||
  command.expectedRevision>2147483646||
  !exact(command as unknown as Record<string,unknown>,
   command.action.startsWith("TASK_")?
    ["action","nonce","expectedRevision","workItemId"]:
    ["action","nonce","expectedRevision"])||
  (command.action.startsWith("TASK_")&&!UUID.test(command.workItemId??"")))
  return {ok:false,statusCode:400,error:"INVALID_TIME_COMMAND"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,statusCode:401,error:"STAFF_MFA_REQUIRED"} as const;
 const base=origin();if(!base)return unknown();
 try{
  const response=await fetch(base+"/api/vox/v1/staff-time",{
   method:"POST",headers:{authorization:"Bearer "+token,
    accept:"application/json","content-type":"application/json"},
   body:JSON.stringify(command),cache:"no-store",redirect:"error",
   signal:AbortSignal.timeout(11000)
  });
  if(!response.ok)return unknown();
  const raw:unknown=await response.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return unknown();
  const x=raw as Record<string,unknown>;
  if(!exact(x,["ok","schema","nonce","eventId","revision","occurredAt",
   "providerMessagesSent","moneyMinorUnits","productionCertified"])||
   x.ok!==true||x.schema!=="qf.vox.staff.time.receipt.v1"||
   x.nonce!==command.nonce||!safe(x.revision)||
   x.revision!==command.expectedRevision+1||
   typeof x.eventId!=="string"||!UUID.test(x.eventId)||
   !time(x.occurredAt)||x.providerMessagesSent!==0||
   x.moneyMinorUnits!==0||x.productionCertified!==false)return unknown();
  return {ok:true,statusCode:200,okReceipt:{
   ok:true,schema:"qf.vox.staff.time.receipt.v1" as const,
   nonce:command.nonce,eventId:x.eventId as string,
   revision:x.revision as number,occurredAt:x.occurredAt as string,
   providerMessagesSent:0 as const,moneyMinorUnits:0 as const,
   productionCertified:false as const}} as const;
 }catch{return unknown();}
}
