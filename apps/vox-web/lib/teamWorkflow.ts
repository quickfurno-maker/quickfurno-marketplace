import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId=(x:unknown):x is string=>typeof x==="string"&&UUID.test(x);
const deny=(status:number,error:string)=>({ok:false,status,error} as const);
const baseEnabled=()=>process.env.VOX_STAFF_PORTAL_ENABLED==="staging"&&
 process.env.VOX_TEAM_WORKSPACE_ENABLED==="staging"&&
 ["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE));
const enabled=(flag:string)=>baseEnabled()&&process.env[flag]==="staging";
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",
 year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
async function requestCore(path:"staff-chat"|"eod-submissions"|"eod-reviews",
 payload?:Record<string,unknown>){
 const token=await verifiedMfaSession();
 if(!token)return deny(401,"MFA_REQUIRED");
 const url=origin();
 if(!url)return deny(503,"CORE_NOT_CONFIGURED");
 try{
  const response=await fetch(url+"/api/vox/v1/"+path,{
   method:payload?"POST":"GET",
   headers:{authorization:"Bearer "+token,accept:"application/json",
    ...(payload?{"content-type":"application/json"}:{})},
   ...(payload?{body:JSON.stringify(payload)}:{}),
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)
  });
  if(!response.ok)return deny(response.status===401?401:
   response.status===403?403:response.status===409?409:503,"CORE_SCOPE_DENIED_OR_STALE");
  const body:unknown=await response.json();
  if(!body||typeof body!=="object"||Array.isArray(body))
   return deny(503,"INVALID_CORE_RESPONSE");
  return {ok:true,status:response.status,body:body as Record<string,unknown>} as const;
 }catch{return deny(503,"CORE_UNAVAILABLE");}
}
const exact=(v:Record<string,unknown>,fields:string[])=>{
 return Object.keys(v).sort().join("|")===[...fields].sort().join("|");
};
const date=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v);
const time=(v:unknown):v is string=>typeof v==="string"&&Number.isFinite(Date.parse(v));
export async function fetchTeamChat(){
 if(!enabled("VOX_TEAM_CHAT_UI_ENABLED"))return deny(503,"TEAM_CHAT_DISABLED");
 const response=await requestCore("staff-chat");
 if(!response.ok)return response;
 const x=response.body;
 if(!exact(x,["ok","schema","mode","boundedWindow","totalKnown",
  "externalMessagesSent","messages"])||
   x.ok!==true||x.schema!=="qf.vox.staff.team.chat.preview.v1"||
   x.mode!=="INTERNAL_ONLY"||x.boundedWindow!==true||
   x.totalKnown!==false||x.externalMessagesSent!==0||
   !Array.isArray(x.messages)||x.messages.length>25)
  return deny(503,"INVALID_CHAT_SOURCE");
 const messages:Array<{messageId:string;staffRef:string;isMine:boolean;
  body:string;createdAt:string}>=[];
 const seen=new Set<string>();
 for(const m of x.messages){
  if(!m||typeof m!=="object"||Array.isArray(m))return deny(503,"INVALID_CHAT_ROW");
  const r=m as Record<string,unknown>;
  if(!exact(r,["messageId","staffRef","isMine","body","createdAt"])||
     !isId(r.messageId)||seen.has(r.messageId)||
     typeof r.staffRef!=="string"||!/^STAFF-[0-9a-f]{8}$/i.test(r.staffRef)||
     typeof r.isMine!=="boolean"||typeof r.body!=="string"||
     r.body.length<1||r.body.length>500||r.body!==r.body.trim()||
     /[\u0000-\u001f\u007f]/.test(r.body)||!time(r.createdAt))
   return deny(503,"INVALID_CHAT_ROW");
  seen.add(r.messageId);
  messages.push({messageId:r.messageId,staffRef:r.staffRef,
   isMine:r.isMine,body:r.body,createdAt:r.createdAt});
 }
 return {ok:true,status:200,mode:"INTERNAL_ONLY" as const,
  totalKnown:false as const,messages} as const;
}
export async function sendTeamChat(body:string,nonce:string){
 if(!enabled("VOX_TEAM_CHAT_UI_ENABLED"))return deny(503,"TEAM_CHAT_DISABLED");
 if(!isId(nonce)||typeof body!=="string"||body.length<1||body.length>500||
   body!==body.trim()||/[\u0000-\u001f\u007f]/.test(body))
  return deny(400,"INVALID_INTERNAL_MESSAGE");
 const r=await requestCore("staff-chat",{body,nonce});
 if(!r.ok)return r;
 const x=r.body;
 if(!exact(x,["ok","schema","messageId","createdAt","effect",
 "externalMessagesSent","agentConversationChanged","staffPrivilegesChanged"])||
   x.ok!==true||x.schema!=="qf.vox.staff.team.chat.receipt.v1"||
   !isId(x.messageId)||!time(x.createdAt)||
   x.effect!=="INTERNAL_TEAM_MESSAGE_ONLY"||
   x.externalMessagesSent!==0||x.agentConversationChanged!==false||
   x.staffPrivilegesChanged!==false)
  return deny(503,"INVALID_CHAT_RECEIPT");
 return {ok:true,status:201,messageId:x.messageId,effect:"INTERNAL_TEAM_MESSAGE_ONLY" as const} as const;
}
export async function fetchMyEodSubmissions(){
 if(!enabled("VOX_EOD_SUBMIT_UI_ENABLED"))return deny(503,"EOD_SUBMISSION_UI_DISABLED");
 const r=await requestCore("eod-submissions");if(!r.ok)return r;
 const x=r.body;
 if(!exact(x,["ok","schema","mode","completeness","totalKnown","records"])||
   x.ok!==true||x.schema!=="qf.vox.eod.my-submissions.v1"||
   x.mode!=="READ_ONLY"||x.completeness!=="PARTIAL_UNVERIFIED_TOTAL"||
   x.totalKnown!==false||!Array.isArray(x.records)||x.records.length>16)
  return deny(503,"INVALID_EOD_HISTORY_SOURCE");
 const records:Array<{reportId:string;businessDate:string;eventCount:number;
  state:string;revision:number}>=[];
 const seen=new Set<string>();
 for(const m of x.records){
  if(!m||typeof m!=="object"||Array.isArray(m))return deny(503,"INVALID_EOD_ROW");
  const v=m as Record<string,unknown>;
  if(!exact(v,["reportId","businessDate","eventCount","state","revision"])||
   !isId(v.reportId)||seen.has(v.reportId)||!date(v.businessDate)||
   !Number.isSafeInteger(v.eventCount)||(v.eventCount as number)<0||
   (v.eventCount as number)>100||
   !["PENDING_REVIEW","ACKNOWLEDGED","REJECTED"].includes(String(v.state))||
   !Number.isSafeInteger(v.revision)||![0,1].includes(v.revision as number)||
   (v.state==="PENDING_REVIEW"&&v.revision!==0)||
   (v.state!=="PENDING_REVIEW"&&v.revision!==1))
   return deny(503,"INVALID_EOD_ROW");
  seen.add(v.reportId);
  records.push({reportId:v.reportId,businessDate:v.businessDate,
   eventCount:v.eventCount as number,state:v.state as string,
   revision:v.revision as number});
 }
 return {ok:true,status:200,mode:"READ_ONLY" as const,
  completeness:"PARTIAL_UNVERIFIED_TOTAL" as const,records} as const;
}
export async function submitMyPartialEod(nonce:string){
 if(!enabled("VOX_EOD_SUBMIT_UI_ENABLED"))return deny(503,"EOD_SUBMISSION_UI_DISABLED");
 if(!isId(nonce))return deny(400,"INVALID_EOD_NONCE");
 const r=await requestCore("eod-submissions",{nonce,businessDate:today()});
 if(!r.ok)return r;
 const x=r.body;
 if(!exact(x,["ok","schema","reportId","state","revision","eventCount",
  "completeness","externalMessagesSent","staffPrivilegesChanged"])||
   x.ok!==true||x.schema!=="qf.vox.eod.submission.receipt.v1"||
   !isId(x.reportId)||!["PENDING_REVIEW","ACKNOWLEDGED","REJECTED"].includes(String(x.state))||
   !Number.isSafeInteger(x.revision)||![0,1].includes(x.revision as number)||
   !Number.isSafeInteger(x.eventCount)||(x.eventCount as number)<0||
   (x.eventCount as number)>100||
   x.completeness!=="PARTIAL_UNVERIFIED_TOTAL"||
   x.externalMessagesSent!==0||x.staffPrivilegesChanged!==false)
  return deny(503,"INVALID_EOD_RECEIPT");
 return {ok:true,status:200,reportId:x.reportId,
  state:x.state as string,eventCount:x.eventCount as number,
  completeness:"PARTIAL_UNVERIFIED_TOTAL" as const} as const;
}
export async function fetchTlEodQueue(){
 if(!enabled("VOX_EOD_TL_REVIEW_UI_ENABLED"))return deny(503,"EOD_TL_UI_DISABLED");
 const r=await requestCore("eod-reviews");if(!r.ok)return r;
 const x=r.body;
 if(!exact(x,["ok","schema","mode","actionsRequireCurrentCoreRpc","totalKnown","pending"])||
   x.ok!==true||x.schema!=="qf.vox.eod.tl.queue.v1"||
   x.mode!=="READ_ONLY"||x.actionsRequireCurrentCoreRpc!==true||
   x.totalKnown!==false||!Array.isArray(x.pending)||x.pending.length>16)
  return deny(503,"INVALID_EOD_TL_SOURCE");
 const pending:Array<{reportId:string;staffRef:string;businessDate:string;
  eventCount:number;revision:0}>=[];
 for(const item of x.pending){
  if(!item||typeof item!=="object"||Array.isArray(item))return deny(503,"INVALID_REVIEW_ROW");
  const m=item as Record<string,unknown>;
  if(!exact(m,["reportId","staffRef","businessDate","eventCount","revision","completeness"])||
   !isId(m.reportId)||typeof m.staffRef!=="string"||
   !/^STAFF-[0-9a-f]{8}$/i.test(m.staffRef)||!date(m.businessDate)||
   !Number.isSafeInteger(m.eventCount)||(m.eventCount as number)<0||
   (m.eventCount as number)>100||m.revision!==0||
   m.completeness!=="PARTIAL_UNVERIFIED_TOTAL")
   return deny(503,"INVALID_REVIEW_ROW");
  pending.push({reportId:m.reportId,staffRef:m.staffRef,
   businessDate:m.businessDate,eventCount:m.eventCount as number,revision:0});
 }
 return {ok:true,status:200,pending,totalKnown:false as const} as const;
}
export async function decideTlEod(reportId:string,nonce:string,decision:string){
 if(!enabled("VOX_EOD_TL_REVIEW_UI_ENABLED"))return deny(503,"EOD_TL_UI_DISABLED");
 if(!isId(reportId)||!isId(nonce)||!["ACKNOWLEDGED","REJECTED"].includes(decision))
  return deny(400,"INVALID_TL_REVIEW");
 const r=await requestCore("eod-reviews",{reportId,nonce,decision,expectedRevision:0});
 if(!r.ok)return r;
 const x=r.body;
 if(!exact(x,["ok","schema","reportId","state","revision","source",
  "providerMessagesSent","staffPrivilegesChanged"])||
  x.ok!==true||x.schema!=="qf.vox.eod.tl.receipt.v1"||
  x.reportId!==reportId||x.state!==decision||x.revision!==1||
  x.source!=="PARTIAL_CORE_WORK_ONLY"||x.providerMessagesSent!==0||
  x.staffPrivilegesChanged!==false)return deny(503,"INVALID_TL_RECEIPT");
 return {ok:true,status:200,reportId,state:decision,revision:1} as const;
}
