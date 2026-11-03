import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";
const safe=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>=0;
const exact=(x:Record<string,unknown>,fields:string[])=>
 Object.keys(x).sort().join("|")===[...fields].sort().join("|");
const deny=(status:number,error:string)=>({ok:false,status,error} as const);
const STATES=["NOT_STARTED","CLOCKED_IN","ON_BREAK","TRACKING_TASK","CLOCKED_OUT"];
export type OwnerTeamTimeView={ok:true;status:200;asOf:string;staffCount:number;
 hasMore:boolean;staff:Array<{staffRef:string;teamRef:string;status:string;
 attendanceMs:number;breakMs:number;taskMs:number;unattributedMs:number}>;
 states:Record<string,number>;attendanceMs:number;breakMs:number;
 taskMs:number;unattributedMs:number;completeHistory:false;
 payrollVerified:false;officialEod:false;livePresence:false};
export async function fetchOwnerTeamTime():Promise<OwnerTeamTimeView|ReturnType<typeof deny>>{
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
   process.env.VOX_VO10_OWNER_TIME_UI_ENABLED!=="staging"||
   process.env.VOX_VO10_OWNER_TIME_ENABLED!=="staging")
  return deny(503,"OWNER_TIME_NOT_CERTIFIED");
 const token=await verifiedMfaSession();
 if(!token)return deny(401,"OWNER_MFA_REQUIRED");
 const base=origin();if(!base)return deny(503,"CORE_UNAVAILABLE");
 try{
  const response=await fetch(base+"/api/vox/v1/owner-team-time",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(7000)
  });
  if(!response.ok)return deny(response.status===403?403:response.status===401?401:503,
   "OWNER_TEAM_TIME_SOURCE_UNAVAILABLE");
  const value:unknown=await response.json();
  if(!value||typeof value!=="object"||Array.isArray(value))
   return deny(503,"OWNER_TIME_UNTRUSTED");
  const r=value as Record<string,unknown>;
  if(!exact(r,["ok","schema","mode","source","sourceVerified","rosterVerified",
   "boundedWindow","windowSize","hasMore","completeHistory","officialEod",
   "payrollVerified","livePresence","staffCount","asOf","states","attendanceMs",
   "breakMs","taskMs","unattributedMs","staff","providerMessagesSent",
   "moneyMinorUnits"])||r.ok!==true||
   r.schema!=="qf.vox.owner.team-time-window.v1"||
   r.mode!=="OWNER_READ_ONLY"||r.source!=="CORE_VERIFIED_CURRENT_SHIFTS"||
   r.sourceVerified!==true||r.rosterVerified!==true||r.boundedWindow!==true||
   r.windowSize!==20||typeof r.hasMore!=="boolean"||
   r.completeHistory!==false||r.officialEod!==false||
   r.payrollVerified!==false||r.livePresence!==false||
   r.providerMessagesSent!==0||r.moneyMinorUnits!==0||
   typeof r.asOf!=="string"||!Number.isFinite(Date.parse(r.asOf))||
   !safe(r.staffCount)||(r.staffCount as number)>20||
   (r.hasMore===true&&r.staffCount!==20)||
   !Array.isArray(r.staff)||r.staff.length!==r.staffCount||
   !r.states||typeof r.states!=="object"||Array.isArray(r.states)||
   !["attendanceMs","breakMs","taskMs","unattributedMs"].every(k=>safe(r[k])))
   return deny(503,"OWNER_TIME_UNTRUSTED");
  const states=r.states as Record<string,unknown>;
  if(!exact(states,STATES)||!STATES.every(k=>safe(states[k]))||
   STATES.reduce((a,k)=>a+(states[k] as number),0)!==r.staffCount)
   return deny(503,"OWNER_TIME_STATES_UNTRUSTED");
  let attendanceMs=0,breakMs=0,taskMs=0,unattributedMs=0;
  const refSet=new Set<string>();
  const staff:OwnerTeamTimeView["staff"]=[];
  for(const item of r.staff){
   if(!item||typeof item!=="object"||Array.isArray(item))
    return deny(503,"OWNER_TIME_STAFF_UNTRUSTED");
   const s=item as Record<string,unknown>;
   if(!exact(s,["staffRef","teamRef","status","attendanceMs","breakMs",
     "taskMs","unattributedMs"])||
    typeof s.staffRef!=="string"||!/^STAFF-[0-9A-F]{8}$/.test(s.staffRef)||
    typeof s.teamRef!=="string"||!/^TEAM-[0-9A-F]{8}$/.test(s.teamRef)||
    refSet.has(s.staffRef)||!STATES.includes(String(s.status))||
    !["attendanceMs","breakMs","taskMs","unattributedMs"].every(k=>safe(s[k]))||
    (s.attendanceMs as number)!==(s.breakMs as number)+(s.taskMs as number)+(s.unattributedMs as number))
    return deny(503,"OWNER_TIME_STAFF_UNTRUSTED");
   refSet.add(s.staffRef);
   attendanceMs+=s.attendanceMs as number;breakMs+=s.breakMs as number;
   taskMs+=s.taskMs as number;unattributedMs+=s.unattributedMs as number;
   staff.push({staffRef:s.staffRef,teamRef:s.teamRef,status:s.status as string,
    attendanceMs:s.attendanceMs as number,breakMs:s.breakMs as number,
    taskMs:s.taskMs as number,unattributedMs:s.unattributedMs as number});
  }
  if(attendanceMs!==r.attendanceMs||breakMs!==r.breakMs||
     taskMs!==r.taskMs||unattributedMs!==r.unattributedMs||
     STATES.some(k=>staff.filter(x=>x.status===k).length!==states[k])||
     ![attendanceMs,breakMs,taskMs,unattributedMs].every(safe))
   return deny(503,"OWNER_TIME_TOTALS_UNTRUSTED");
  return {ok:true,status:200,asOf:r.asOf as string,
   staffCount:r.staffCount as number,hasMore:r.hasMore as boolean,staff,
   states:Object.fromEntries(STATES.map(k=>[k,states[k] as number])),
   attendanceMs,breakMs,taskMs,unattributedMs,
   completeHistory:false,payrollVerified:false,
   officialEod:false,livePresence:false};
 }catch{return deny(503,"OWNER_TIME_SOURCE_UNAVAILABLE");}
}
