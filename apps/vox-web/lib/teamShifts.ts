import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";
const safe=(x:unknown)=>Number.isSafeInteger(x)&&(x as number)>=0;
const deny=(status:number,error:string)=>({ok:false,status,error} as const);
const exact=(x:Record<string,unknown>,fields:string[])=>
 Object.keys(x).sort().join("|")===[...fields].sort().join("|");
type Person={staffRef:string;status:string;attendanceMs:number;breakMs:number;
 taskMs:number;unattributedMs:number};
export type TeamShiftView={ok:true;status:200;asOf:string;staffCount:number;
 totals:{attendanceMs:number;breakMs:number;taskMs:number;netShiftMs:number;
 unattributedMs:number};states:Record<string,number>;staff:Person[];
 completeHistory:false;officialEod:false;payrollVerified:false;livePresence:false};
export async function fetchVerifiedTeamShifts():Promise<TeamShiftView|
 ReturnType<typeof deny>>{
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
    process.env.VOX_VO5_TEAM_SHIFT_UI_ENABLED!=="staging"||
    process.env.VOX_VO5_TEAM_SHIFTS_ENABLED!=="staging")
  return deny(503,"TEAM_SHIFTS_NOT_CERTIFIED");
 const token=await verifiedMfaSession();
 if(!token)return deny(401,"MFA_REQUIRED");
 const host=origin();if(!host)return deny(503,"CORE_NOT_CONFIGURED");
 try{
  const response=await fetch(host+"/api/vox/v1/team-shifts",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(6500)});
  if(!response.ok)return deny(response.status===403?403:response.status===401?401:503,
   "TEAM_SHIFT_SOURCE_UNAVAILABLE");
  const raw:unknown=await response.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return deny(503,"TEAM_SHIFT_SOURCE_UNTRUSTED");
  const v=raw as Record<string,unknown>;
  if(!exact(v,["ok","schema","mode","source","sourceVerified","rosterVerified",
   "boundedWindow","completeHistory","officialEod","payrollVerified",
   "livePresence","asOf","staffCount","states","attendanceMs","breakMs",
   "taskMs","netShiftMs","unattributedMs","staff",
   "providerMessagesSent","moneyMinorUnits"])||
   v.ok!==true||v.schema!=="qf.vox.team.current-shifts.v1"||
   v.mode!=="READ_ONLY"||v.source!=="CORE_CURRENT_SHIFT_ROWS"||
   v.sourceVerified!==true||v.rosterVerified!==true||
   v.boundedWindow!==true||v.completeHistory!==false||
   v.officialEod!==false||v.payrollVerified!==false||
   v.livePresence!==false||v.providerMessagesSent!==0||
   v.moneyMinorUnits!==0||typeof v.asOf!=="string"||
   !Number.isFinite(Date.parse(v.asOf))||
   !safe(v.staffCount)||(v.staffCount as number)>20||
   !Array.isArray(v.staff)||v.staff.length!==v.staffCount||
   !v.states||typeof v.states!=="object"||Array.isArray(v.states))
   return deny(503,"TEAM_SHIFT_SOURCE_UNTRUSTED");
  const names=["NOT_STARTED","CLOCKED_IN","ON_BREAK","TRACKING_TASK","CLOCKED_OUT"];
  const states=v.states as Record<string,unknown>;
  if(!exact(states,names)||!names.every(n=>safe(states[n]))||
    names.reduce((a,n)=>a+(states[n] as number),0)!==v.staffCount||
    !["attendanceMs","breakMs","taskMs","netShiftMs","unattributedMs"].every(k=>safe(v[k]))||
    (v.attendanceMs as number)!==(v.breakMs as number)+(v.netShiftMs as number)||
    (v.netShiftMs as number)!==(v.taskMs as number)+(v.unattributedMs as number))
   return deny(503,"TEAM_SHIFT_TOTALS_UNTRUSTED");
  const staff:Person[]=[],seen=new Set<string>();
  let attendanceMs=0,breakMs=0,taskMs=0,unattributedMs=0;
  for(const rawPerson of v.staff){
   if(!rawPerson||typeof rawPerson!=="object"||Array.isArray(rawPerson))
    return deny(503,"TEAM_SHIFT_STAFF_UNTRUSTED");
   const p=rawPerson as Record<string,unknown>;
   if(!exact(p,["staffRef","status","attendanceMs","breakMs","taskMs","unattributedMs"])||
      typeof p.staffRef!=="string"||
      !/^STAFF-[0-9A-F]{8}$/.test(p.staffRef)||
      seen.has(p.staffRef)||!names.includes(String(p.status))||
      !["attendanceMs","breakMs","taskMs","unattributedMs"].every(k=>safe(p[k])))
    return deny(503,"TEAM_SHIFT_STAFF_UNTRUSTED");
   seen.add(p.staffRef);
   attendanceMs+=p.attendanceMs as number;breakMs+=p.breakMs as number;
   taskMs+=p.taskMs as number;unattributedMs+=p.unattributedMs as number;
   staff.push({staffRef:p.staffRef,status:p.status as string,
    attendanceMs:p.attendanceMs as number,breakMs:p.breakMs as number,
    taskMs:p.taskMs as number,unattributedMs:p.unattributedMs as number});
  }
  if(attendanceMs!==v.attendanceMs||breakMs!==v.breakMs||
     taskMs!==v.taskMs||unattributedMs!==v.unattributedMs)
   return deny(503,"TEAM_SHIFT_TOTALS_UNTRUSTED");
  return {ok:true,status:200,asOf:v.asOf,staffCount:v.staffCount as number,
   totals:{attendanceMs:v.attendanceMs as number,breakMs:v.breakMs as number,
    taskMs:v.taskMs as number,netShiftMs:v.netShiftMs as number,
    unattributedMs:v.unattributedMs as number},
   states:Object.fromEntries(names.map(n=>[n,states[n] as number])),
   staff,completeHistory:false,officialEod:false,
   payrollVerified:false,livePresence:false};
 }catch{return deny(503,"TEAM_SHIFT_SOURCE_UNAVAILABLE");}
}
