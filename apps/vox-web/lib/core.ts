import "server-only";
import {verifiedMfaSession} from "./auth";
const HOSTS=new Set(["quickfurno.in","staging-core.quickfurno.in"]);
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
  const r=await fetch(base+"/api/vox/v1/overview",{method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
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
