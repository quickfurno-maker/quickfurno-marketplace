import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";
const fields=["ok","schema","mode","actionsEnabled","businessDate","source",
 "completeness","sourceWatermark","eventsIncluded","counts","canSubmit",
 "canAcknowledge","canExport","providerMessagesSent"].sort().join("|");
const types=["claims","starts","completions","blocks",
 "approvalRequests","externalWaits","resumptions"] as const;
const countFields=[...types].sort().join("|");
const fail=(status:number,error:string)=>({ok:false,status,error} as const);
export async function fetchStaffEodPreview(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
    !["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE))||
    process.env.VOX_EOD_PREVIEW_UI_ENABLED!=="staging")
  return fail(503,"STAFF_EOD_DISABLED");
 const token=await verifiedMfaSession();
 if(!token)return fail(401,"MFA_REQUIRED");
 const base=origin();
 if(!base)return fail(503,"CORE_NOT_CONFIGURED");
 try{
  const res=await fetch(base+"/api/vox/v1/eod-preview",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)
  });
  if(!res.ok)return fail(res.status===403?403:res.status===401?401:503,
   "CORE_EOD_UNAVAILABLE_OR_DENIED");
  const raw:unknown=await res.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return fail(503,"INVALID_CORE_EOD_SCHEMA");
  const body=raw as Record<string,unknown>;
  if(Object.keys(body).sort().join("|")!==fields||
     body.ok!==true||body.schema!=="qf.vox.eod.core-work.partial.v1"||
     body.mode!=="READ_ONLY"||body.actionsEnabled!==false||
     body.source!=="CORE_WORK_LEDGER_ONLY"||
     body.completeness!=="PARTIAL_UNVERIFIED_TOTAL"||
     body.sourceWatermark!=="UNAVAILABLE"||body.canSubmit!==false||
     body.canAcknowledge!==false||body.canExport!==false||
     body.providerMessagesSent!==0||typeof body.businessDate!=="string"||
     !/^\d{4}-\d{2}-\d{2}$/.test(body.businessDate)||
     !Number.isSafeInteger(body.eventsIncluded)||
     (body.eventsIncluded as number)<0||(body.eventsIncluded as number)>100)
   return fail(503,"INVALID_CORE_EOD_SCHEMA");
  const counts=body.counts;
  if(!counts||typeof counts!=="object"||Array.isArray(counts))
   return fail(503,"INVALID_CORE_EOD_COUNTS");
  const counters=counts as Record<string,unknown>;
  if(Object.keys(counters).sort().join("|")!==countFields||
     types.some(k=>!Number.isSafeInteger(counters[k])||
      (counters[k] as number)<0||(counters[k] as number)>100))
   return fail(503,"INVALID_CORE_EOD_COUNTS");
  const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",
   year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  if(body.businessDate!==today)return fail(503,"STALE_EOD_DATE");
  const verified=Object.fromEntries(types.map(k=>[k,counters[k] as number])) as Record<typeof types[number],number>;
  return {ok:true,status:200,mode:"READ_ONLY" as const,
   completeness:"PARTIAL_UNVERIFIED_TOTAL" as const,
   businessDate:today,eventsIncluded:body.eventsIncluded as number,
   counts:verified,canSubmit:false as const,canExport:false as const,
   providerMessagesSent:0 as const};
 }catch{return fail(503,"CORE_EOD_UNAVAILABLE");}
}
