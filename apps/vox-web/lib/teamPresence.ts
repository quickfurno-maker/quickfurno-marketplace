import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";
export type TeamPresenceView={ok:true;status:200;asOf:string;
 totalRosterKnown:true;unknownStaffCount:number;liveRealtimeConnected:false;
 entries:{staffRef:string;state:string;source:"EPHEMERAL_ONLY"}[]};
const deny=(status:number,error:string)=>({ok:false,status,error} as const);
const states=new Set(["ONLINE","AWAY","BUSY","IN_MEETING","ON_BREAK","UNKNOWN"]);
const safe=(x:unknown)=>Number.isSafeInteger(x)&&(x as number)>=0;
const exact=(x:Record<string,unknown>,fields:string[])=>
 Object.keys(x).sort().join("|")===[...fields].sort().join("|");
export async function fetchVerifiedTeamPresence():Promise<TeamPresenceView|ReturnType<typeof deny>>{
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
    process.env.VOX_VO6_PRESENCE_UI_ENABLED!=="staging"||
    process.env.VOX_VO6_PRESENCE_READ_ENABLED!=="staging")
  return deny(503,"PRESENCE_NOT_CERTIFIED");
 const token=await verifiedMfaSession();
 if(!token)return deny(401,"STAFF_MFA_REQUIRED");
 const core=origin();if(!core)return deny(503,"CORE_ORIGIN_UNAVAILABLE");
 try{
  const response=await fetch(core+"/api/vox/v1/team-presence",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000)
  });
  if(!response.ok)return deny(response.status===401?401:response.status===403?403:503,
   "PRESENCE_SOURCE_UNAVAILABLE");
  const raw:unknown=await response.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return deny(503,"PRESENCE_RECEIPT_UNTRUSTED");
  const x=raw as Record<string,unknown>;
  if(!exact(x,["ok","schema","mode","sourceVerified","rosterVerified",
   "liveRealtimeConnected","asOf","boundedWindow","attendanceVerified",
   "timeTrackingVerified","taskCompletionVerified","latestObservationsVerified",
   "totalRosterKnown","unknownStaffCount","entries"])||
   x.ok!==true||x.schema!=="qf.vox.virtual-office.team-presence.v1"||
   x.mode!=="EPHEMERAL_READ_ONLY"||
   x.sourceVerified!==true||x.rosterVerified!==true||
   x.liveRealtimeConnected!==false||x.boundedWindow!==true||
   x.attendanceVerified!==false||x.timeTrackingVerified!==false||
   x.taskCompletionVerified!==false||x.totalRosterKnown!==true||
   typeof x.asOf!=="string"||!Number.isFinite(Date.parse(x.asOf))||
   !safe(x.unknownStaffCount)||!safe(x.latestObservationsVerified)||
   !Array.isArray(x.entries)||x.entries.length>20||
   (x.unknownStaffCount as number)>x.entries.length||
   (x.latestObservationsVerified as number)>x.entries.length)
   return deny(503,"PRESENCE_RECEIPT_UNTRUSTED");
  const entries:TeamPresenceView["entries"]=[];
  const seen=new Set<string>();
  for(const value of x.entries){
   if(!value||typeof value!=="object"||Array.isArray(value))
    return deny(503,"PRESENCE_ENTRY_UNTRUSTED");
   const row=value as Record<string,unknown>;
   if(!exact(row,["staffRef","state","source"])||
    typeof row.staffRef!=="string"||
    !/^STAFF-[0-9A-F]{8}$/.test(row.staffRef)||
    seen.has(row.staffRef)||!states.has(String(row.state))||
    row.source!=="EPHEMERAL_ONLY")
    return deny(503,"PRESENCE_ENTRY_UNTRUSTED");
   seen.add(row.staffRef);
   entries.push({staffRef:row.staffRef,state:row.state as string,
    source:"EPHEMERAL_ONLY"});
  }
  if(entries.filter(x=>x.state==="UNKNOWN").length!==x.unknownStaffCount)
   return deny(503,"PRESENCE_COUNT_INCONSISTENT");
  return {ok:true,status:200,asOf:x.asOf,
   totalRosterKnown:true,unknownStaffCount:x.unknownStaffCount as number,
   liveRealtimeConnected:false,entries};
 }catch{return deny(503,"PRESENCE_SOURCE_UNAVAILABLE");}
}

/** Voluntary, idempotent manual Staff signal only; no background heartbeat. */
export async function setMyPresenceStatus(state:string){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
    process.env.VOX_VO6_PRESENCE_UI_ENABLED!=="staging"||
    process.env.VOX_VO6_PRESENCE_WRITE_ENABLED!=="staging")
  return deny(503,"PRESENCE_SIGNAL_NOT_CERTIFIED");
 if(!["ONLINE","AWAY","BUSY","IN_MEETING","ON_BREAK"].includes(state))
  return deny(400,"INVALID_PRESENCE_STATE");
 const token=await verifiedMfaSession();
 if(!token)return deny(401,"STAFF_MFA_REQUIRED");
 const core=origin();if(!core)return deny(503,"CORE_ORIGIN_UNAVAILABLE");
 try{
  const response=await fetch(core+"/api/vox/v1/team-presence",{
   method:"POST",headers:{authorization:"Bearer "+token,
    accept:"application/json","content-type":"application/json"},
   body:JSON.stringify({state}),cache:"no-store",redirect:"error",
   signal:AbortSignal.timeout(7000)
  });
  if(!response.ok)return deny(response.status===403?403:
   response.status===401?401:503,"PRESENCE_SIGNAL_OUTCOME_UNKNOWN");
  const raw:unknown=await response.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return deny(503,"PRESENCE_SIGNAL_OUTCOME_UNKNOWN");
  const r=raw as Record<string,unknown>;
  if(!exact(r,["ok","schema","staffRef","state","observedAt","source",
   "attendanceVerified","providerMessagesSent","moneyMinorUnits"])||
   r.ok!==true||r.schema!=="qf.vox.presence.signal.receipt.v1"||
   typeof r.staffRef!=="string"||!/^STAFF-[0-9A-F]{8}$/.test(r.staffRef)||
   r.state!==state||typeof r.observedAt!=="string"||
   !Number.isFinite(Date.parse(r.observedAt))||
   r.source!=="EPHEMERAL_ONLY"||r.attendanceVerified!==false||
   r.providerMessagesSent!==0||r.moneyMinorUnits!==0)
   return deny(503,"PRESENCE_SIGNAL_OUTCOME_UNKNOWN");
  return {ok:true,status:200,receipt:{ok:true,
   schema:"qf.vox.presence.signal.receipt.v1",staffRef:r.staffRef,
   state,observedAt:r.observedAt,source:"EPHEMERAL_ONLY",
   attendanceVerified:false,providerMessagesSent:0,moneyMinorUnits:0}} as const;
 }catch{return deny(503,"PRESENCE_SIGNAL_OUTCOME_UNKNOWN");}
}
