import "server-only";
import { verifiedMfaSession } from "./auth";
import { origin } from "./core";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(status:number,error:string)=>({ok:false,status,error} as const);
const exact=(v:Record<string,unknown>,keys:string[])=>
 Object.keys(v).sort().join("|")===[...keys].sort().join("|");
async function call(path:"eod-source-status"|"riya-client-cases"){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
   process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
   !["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE))||
   (path==="eod-source-status"?
      process.env.VOX_EOD_SOURCE_STATUS_UI_ENABLED!=="staging":
      process.env.VOX_RIYA_CASES_UI_ENABLED!=="staging"))
   return fail(503,"SOURCE_UI_DISABLED");
 const token=await verifiedMfaSession();
 if(!token)return fail(401,"STAFF_MFA_REQUIRED");
 const base=origin();if(!base)return fail(503,"CORE_NOT_CONFIGURED");
 try{
  const r=await fetch(base+"/api/vox/v1/"+path,{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return fail(r.status===403?403:503,"CORE_SCOPE_UNAVAILABLE");
  const obj:unknown=await r.json();
  if(!obj||typeof obj!=="object"||Array.isArray(obj))
   return fail(503,"INVALID_CORE_RESPONSE");
  return {ok:true,data:obj as Record<string,unknown>} as const;
 }catch{return fail(503,"CORE_SOURCE_UNAVAILABLE");}
}
export async function fetchStaffSourceReadiness(){
 const r=await call("eod-source-status");if(!r.ok)return r;
 const v=r.data;
 if(!exact(v,["ok","schema","mode","businessDate","source","sources",
   "completeness","allSourceReady","rollup","canSubmit","canExport",
   "providerMessagesSent","actionsEnabled"])||
   v.ok!==true||v.schema!=="qf.vox.staff.eod.source-status.v1"||
   v.mode!=="READ_ONLY"||v.allSourceReady!==false||v.rollup!==null||
   v.canSubmit!==false||v.canExport!==false||v.actionsEnabled!==false||
   v.providerMessagesSent!==0||v.source!=="CORE_CANONICAL_SOURCE_OBSERVATIONS"||
   v.completeness!=="INCOMPLETE_NO_SIGNED_ALL_SOURCE_WATERMARKS"||
   !Array.isArray(v.sources)||v.sources.length!==4)
  return fail(503,"UNVERIFIED_EOD_SOURCES");
 const expected=["CORE_WORK_LEDGER","CRM_AAROHI","SUPPORT_DESK","CORE_CONVERSATION"];
 const mapped=[];
 for(let i=0;i<4;i++){
  const raw=v.sources[i];if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return fail(503,"UNVERIFIED_EOD_ROW");
  const row=raw as Record<string,unknown>;
  if(!exact(row,["source","readiness","scoped","eventProvenance"])||
   row.source!==expected[i]||typeof row.scoped!=="boolean"||
   !["AVAILABLE","NO_GRANTED_OBJECTS","UNAVAILABLE","GRANT_UNVERIFIED"].includes(String(row.readiness))||
   !["CORE_WORK_ONLY","NOT_PROVEN"].includes(String(row.eventProvenance)))
   return fail(503,"UNVERIFIED_EOD_ROW");
  mapped.push({source:row.source as string,readiness:row.readiness as string,
   scoped:row.scoped,eventProvenance:row.eventProvenance as string});
 }
 return {ok:true,mode:"READ_ONLY" as const,complete:false as const,
  canSubmit:false as const,sources:mapped} as const;
}
export async function fetchScopedRiyaClientCases(){
 const r=await call("riya-client-cases");if(!r.ok)return r;
 const v=r.data;
 if(!exact(v,["ok","schema","mode","source","boundedWindow","totalKnown",
  "items","canReadTranscript","canSendReply","canTakeover",
  "requiresJarvisSignedPauseAck","requiresFreshClientConsent",
  "allClientSubjectsVerified","providerMessagesSent"])||
  v.ok!==true||v.schema!=="qf.vox.client.case.source-readiness.v1"||
  v.mode!=="READ_ONLY"||v.source!=="CORE_CANONICAL_CLIENT_CASES"||
  v.boundedWindow!==true||v.totalKnown!==false||
  v.canReadTranscript!==false||v.canSendReply!==false||
  v.canTakeover!==false||v.allClientSubjectsVerified!==false||
  v.requiresFreshClientConsent!==true||v.requiresJarvisSignedPauseAck!==true||
  v.providerMessagesSent!==0||!Array.isArray(v.items)||v.items.length>12)
  return fail(503,"UNVERIFIED_CLIENT_CASES");
 const items=[];
 for(const raw of v.items){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return fail(503,"INVALID_CLIENT_CASE_ROW");
  const x=raw as Record<string,unknown>;
  if(!exact(x,["conversationId","clientProjectId","agent","caseState",
   "revision","lastUpdated","googleLocationVerified",
   "currentCityVerified","readOnly","canReadTranscript","canSendReply",
   "canTakeover"])||!UUID.test(String(x.conversationId))||
   !UUID.test(String(x.clientProjectId))||
   !["RIYA","HUMAN"].includes(String(x.agent))||
   !["OPEN","PAUSED","HUMAN","CLOSED"].includes(String(x.caseState))||
   !Number.isSafeInteger(x.revision)||(x.revision as number)<0||
   typeof x.lastUpdated!=="string"||!Number.isFinite(Date.parse(x.lastUpdated))||
   x.googleLocationVerified!==true||x.currentCityVerified!==true||
   x.readOnly!==true||x.canReadTranscript!==false||
   x.canSendReply!==false||x.canTakeover!==false)
   return fail(503,"INVALID_CLIENT_CASE_ROW");
  items.push({conversationId:x.conversationId as string,
   caseState:x.caseState as string,agent:x.agent as string,
   revision:x.revision as number,lastUpdated:x.lastUpdated as string});
 }
 return {ok:true,mode:"READ_ONLY" as const,totalKnown:false as const,
  canSendReply:false as const,canTakeover:false as const,items} as const;
}
