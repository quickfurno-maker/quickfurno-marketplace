import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";

export type UnifiedWorkItem=Readonly<{
 source:"CORE_WORK_LEDGER"|"CORE_CLIENT_RIYA";
 referenceId:string;subjectKind:"prospect"|"vendor"|"support_thread"|"client";
 state:string;updatedAt:string;assignedToMe:boolean;
 canTransition:false;canHandover:false;canReply:false;
}>;
export type UnifiedRead=Readonly<
 |{ok:true;status:200;items:readonly UnifiedWorkItem[];
  completeness:"BOUNDED_NOT_TOTAL";mode:"READ_ONLY"}
 |{ok:false;status:401|403|503;error:string}
>;
const denied=(status:401|403|503,error:string):UnifiedRead=>
 ({ok:false,status,error});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keys=(v:Record<string,unknown>,k:string[])=>Object.keys(v).sort().join("|")===k.sort().join("|");
const workKinds=new Set(["prospect","vendor","support_thread"]);
const workStates=new Set(["NEW","ASSIGNED","IN_PROGRESS",
 "WAITING_EXTERNAL","WAITING_APPROVAL","BLOCKED","DONE"]);
const clientStates=new Set(["OPEN","PAUSED","HUMAN","CLOSED"]);
export function parseUnifiedCoreWorkspace(payload:unknown):UnifiedRead{
 if(!payload||typeof payload!=="object"||Array.isArray(payload))
  return denied(503,"UNVERIFIED_UNIFIED_CORE_RESPONSE");
 const p=payload as Record<string,unknown>;
 if(!keys(p,["ok","schema","mode","completeness","sourceCount","items",
  "canTransition","canHandover","canReply","providerMessagesSent",
  "owner","source","actionsEnabled","stageCertified"])||
  p.ok!==true||p.schema!=="qf.vox.ui04.unified.work.preview.v1"||
  p.mode!=="READ_ONLY"||p.completeness!=="BOUNDED_NOT_TOTAL"||
  p.sourceCount!==2||p.canTransition!==false||
  p.canHandover!==false||p.canReply!==false||
  p.actionsEnabled!==false||p.stageCertified!==false||
  p.providerMessagesSent!==0||p.owner!=="quickfurno-core"||
  p.source!=="EXISTING_PROTECTED_CORE_ROUTES"||
  !Array.isArray(p.items)||p.items.length>25)
  return denied(503,"UNVERIFIED_UNIFIED_CORE_RESPONSE");
 const seen=new Set<string>(),safe:UnifiedWorkItem[]=[];
 for(const raw of p.items){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return denied(503,"INVALID_UNIFIED_ITEM");
  const i=raw as Record<string,unknown>;
  if(!keys(i,["source","referenceId","subjectKind","state",
   "updatedAt","assignedToMe","canTransition","canHandover","canReply"])||
   typeof i.referenceId!=="string"||!uuid.test(i.referenceId)||
   seen.has(i.referenceId)||typeof i.updatedAt!=="string"||
   !Number.isFinite(Date.parse(i.updatedAt))||
   i.canTransition!==false||i.canHandover!==false||i.canReply!==false||
   typeof i.assignedToMe!=="boolean")
   return denied(503,"INVALID_UNIFIED_ITEM");
  if(i.source==="CORE_CLIENT_RIYA"){
   if(i.subjectKind!=="client"||!clientStates.has(String(i.state))||
    i.assignedToMe!==false)return denied(503,"CROSS_LANE_UNVERIFIED");
  }else if(i.source==="CORE_WORK_LEDGER"){
   if(!workKinds.has(String(i.subjectKind))||
    !workStates.has(String(i.state)))
    return denied(503,"CROSS_LANE_UNVERIFIED");
  }else return denied(503,"CROSS_LANE_UNVERIFIED");
  seen.add(i.referenceId);
  safe.push({source:i.source as UnifiedWorkItem["source"],
   referenceId:i.referenceId,subjectKind:i.subjectKind as UnifiedWorkItem["subjectKind"],
   state:String(i.state),updatedAt:i.updatedAt,assignedToMe:i.assignedToMe as boolean,
   canTransition:false,canHandover:false,canReply:false});
 }
 return {ok:true,status:200,mode:"READ_ONLY",completeness:"BOUNDED_NOT_TOTAL",items:safe};
}
/** Existing MFA cookie and pinned HTTPS Core origin only; never browser token. */
export async function fetchVerifiedUnifiedWorkspace():Promise<UnifiedRead>{
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
  process.env.VOX_UI04_WORKSPACE_UI_ENABLED!=="staging"||
  !["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE)))
  return denied(503,"UNIFIED_WORKSPACE_DISABLED");
 const token=await verifiedMfaSession();
 if(!token)return denied(401,"STAFF_MFA_REQUIRED");
 const base=origin();if(!base)return denied(503,"PINNED_CORE_ORIGIN_UNAVAILABLE");
 try{
  const response=await fetch(base+"/api/vox/v1/ui04-workspace",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000)});
  if(!response.ok)return denied(response.status===403?403:503,"CURRENT_CORE_SCOPE_REQUIRED");
  if(!(response.headers.get("content-type")??"").startsWith("application/json"))
   return denied(503,"INVALID_CORE_MEDIA_TYPE");
  const raw=await response.text();
  if(!raw||raw.length>24000)return denied(503,"INVALID_CORE_PAYLOAD_SIZE");
  return parseUnifiedCoreWorkspace(JSON.parse(raw));
 }catch{return denied(503,"CORE_UNIFIED_WORKSPACE_UNAVAILABLE");}
}
