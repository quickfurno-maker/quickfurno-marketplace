import "server-only";
import {verifiedMfaSession} from "./auth";
const HOSTS=new Set(["staging-core.quickfurno.in"]);
function origin():string|null{
 const raw=process.env.VOX_CORE_ORIGIN;
 if(!raw)return null;
 try{
  const url=new URL(raw);
  return url.protocol==="https:"&&HOSTS.has(url.hostname)&&url.port===""&&url.pathname==="/"&&url.search===""&&url.hash===""?url.origin:null;
 }catch{return null;}
}
export async function fetchStaffOverview(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")return {ok:false,status:503,error:"STAFF_GATE_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();
 if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const mode=process.env.VOX_STAFF_VIEW_MODE;
  const path=mode==="owner"?"/api/vox/v1/overview":mode==="scoped"?"/api/vox/v1/my-work":null;
  if(!path)return {ok:false,status:503,error:"STAFF_SCOPE_MODE_DISABLED"} as const;
  const r=await fetch(base+path,{method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return {ok:false,status:r.status===401?401:503,error:r.status===401?"NOT_AUTHORIZED":"CORE_UNAVAILABLE"} as const;
  const payload:unknown=await r.json();
  if(!payload||typeof payload!=="object"||!("ok" in payload)||payload.ok!==true||!("view" in payload))return {ok:false,status:503,error:"UNTRUSTED_CORE_RESPONSE"} as const;
  // Core source only. Strict surface filtering; never return a raw provider response.
  const view=(payload as {view:Record<string,unknown>}).view;
  if(view?.schema!=="qf.vox.overview.v1"||view?.source!=="quickfurno-core"||view.actionsEnabled!==false)return {ok:false,status:503,error:"UNTRUSTED_CORE_RESPONSE"} as const;
  return {ok:true,status:200,view:{
   prospectPreview:Array.isArray(view.prospectPreview)?view.prospectPreview.slice(0,8):[],
   vendorCrmPreview:Array.isArray(view.vendorCrmPreview)?view.vendorCrmPreview.slice(0,8):[],
   supportPreview:Array.isArray(view.supportPreview)?view.supportPreview.slice(0,8):[],
   humanDeskPreview:Array.isArray(view.humanDeskPreview)?view.humanDeskPreview.slice(0,8):[],
  }} as const;
 }catch{return {ok:false,status:503,error:"CORE_UNAVAILABLE"} as const;}
}

function safeLabel(x:unknown,max=70):string {
 return typeof x==="string" ? x.replace(/[\u0000-\u001f]/g," ").trim().slice(0,max) : "UNKNOWN";
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uid=(x:unknown):string|null=>typeof x==="string"&&UUID.test(x)?x:null;
export async function fetchScopedServiceDesk(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_STAFF_VIEW_MODE!=="scoped")
   return {ok:false,status:503,error:"STAFF_DESK_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();
 if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const r=await fetch(base+"/api/vox/v1/desk",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500),
  });
  if(!r.ok)return {ok:false,status:r.status===403?403:503,error:"STAFF_DESK_UNAVAILABLE"} as const;
  const body:unknown=await r.json();
  if(!body||typeof body!=="object"||!("ok" in body)||body.ok!==true||!("view" in body))
   return {ok:false,status:503,error:"UNTRUSTED_DESK_RESPONSE"} as const;
  const view=(body as {view:Record<string,unknown>}).view;
  if(view?.schema!=="qf.vox.service.desk.v1"||view.mode!=="READ_ONLY"||
     !Array.isArray(view.support)||!Array.isArray(view.humanInbox)||
     view.support.length>12||view.humanInbox.length>12)
   return {ok:false,status:503,error:"UNTRUSTED_DESK_RESPONSE"} as const;
  const support=view.support.map((raw:unknown)=>{
   const row=raw&&typeof raw==="object"?raw as Record<string,unknown>:{};
   return {threadId:uid(row.threadId),state:safeLabel(row.state,32),
    priority:safeLabel(row.priority,32),ageBand:safeLabel(row.ageBand,32),
    slaStatus:"NOT_CONFIGURED",canClose:false};
  });
  const humanInbox=view.humanInbox.map((raw:unknown)=>{
   const row=raw&&typeof raw==="object"?raw as Record<string,unknown>:{};
   return {conversationId:uid(row.conversationId),
    lane:row.lane==="ANISHA"?"ANISHA":row.lane==="AAROHI"?"AAROHI":"UNKNOWN",
    serviceWindow:row.serviceWindow==="OPEN"?"OPEN":"CLOSED_OR_UNKNOWN",
    state:"HUMAN",canReply:false};
  });
  return {ok:true,status:200,view:{support,humanInbox}} as const;
 }catch{return {ok:false,status:503,error:"STAFF_DESK_UNAVAILABLE"} as const;}
}
