import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";

type Lane="acquisition"|"vendor_success"|"service_support";
export type Ab3DomainItem=Readonly<{id:string;kind:"prospect"|"vendor"|"support_thread";
 state:string;updatedAt:string;canChange:false;canSend:false}>;
export type Ab3DomainView=Readonly<
 |{ok:true;status:200;department:Lane;items:readonly Ab3DomainItem[];
   completeness:"BOUNDED_NOT_TOTAL"}
 |{ok:false;status:401|403|503;reason:string}>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const denied=(status:401|403|503,reason:string):Ab3DomainView=>
 ({ok:false,status,reason});
const strict=(value:Record<string,unknown>,keys:string[])=>
 Object.keys(value).sort().join("|")===keys.slice().sort().join("|");
const kinds={acquisition:["prospect"],vendor_success:["vendor","support_thread"],
 service_support:["support_thread"]} as const;
export function parseAb3DomainWindow(raw:unknown):Ab3DomainView{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))
  return denied(503,"INVALID_DOMAIN_ENVELOPE");
 const p=raw as Record<string,unknown>;
 if(!strict(p,["ok","schema","department","mode","items","completeness",
  "totalKnown","canChange","canSend","providerMessagesSent",
  "nextPageAuthorized","status","source","stageCertified",
  "officialTotal","actionsEnabled"])||
  p.ok!==true||p.schema!=="qf.vox.ab2.domain-work-window.v1"||
  p.mode!=="READ_ONLY"||p.status!==200||
  p.source!=="EXISTING_AUTHENTICATED_CORE_WORK_QUEUE"||
  p.actionsEnabled!==false||p.stageCertified!==false||
  p.officialTotal!==null||p.totalKnown!==false||
  p.completeness!=="BOUNDED_NOT_TOTAL"||
  p.canChange!==false||p.canSend!==false||
  p.providerMessagesSent!==0||p.nextPageAuthorized!==false||
  !Object.hasOwn(kinds,String(p.department))||
  !Array.isArray(p.items)||p.items.length>25)
  return denied(503,"UNVERIFIED_CORE_DOMAIN_SOURCE");
 const dep=p.department as Lane,seen=new Set<string>(),items:Ab3DomainItem[]=[];
 for(const input of p.items){
  if(!input||typeof input!=="object"||Array.isArray(input))
   return denied(503,"INVALID_DOMAIN_ITEM");
  const x=input as Record<string,unknown>;
  if(!strict(x,["id","kind","state","updatedAt","canChange","canSend"])||
   typeof x.id!=="string"||!UUID.test(x.id)||seen.has(x.id)||
   !kinds[dep].some(k=>k===x.kind)||
   typeof x.state!=="string"||!["NEW","ASSIGNED","IN_PROGRESS",
    "BLOCKED","WAITING_EXTERNAL","WAITING_APPROVAL","DONE"].includes(x.state)||
   typeof x.updatedAt!=="string"||
   !Number.isFinite(Date.parse(x.updatedAt))||
   x.canChange!==false||x.canSend!==false)
   return denied(503,"INVALID_DOMAIN_ITEM");
  seen.add(x.id);
  items.push({id:x.id,kind:x.kind as Ab3DomainItem["kind"],
   state:x.state,updatedAt:x.updatedAt,canChange:false,canSend:false});
 }
 return {ok:true,status:200,department:dep,
  completeness:"BOUNDED_NOT_TOTAL",items};
}
export async function fetchAb3DomainWindow():Promise<Ab3DomainView>{
 if(process.env.VOX_AB3_DOMAIN_WEB_ENABLED!=="staging"||
  process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
  !["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE)))
  return denied(503,"AB3_DOMAIN_WORKSPACE_DISABLED");
 const token=await verifiedMfaSession();
 if(!token)return denied(401,"CURRENT_AAL2_REQUIRED");
 const base=origin();
 if(!base)return denied(503,"CORE_ORIGIN_UNAVAILABLE");
 try{
  const response=await fetch(base+"/api/vox/v1/ab3-domain-work",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000)});
  if(!response.ok)return denied(response.status===403?403:503,
   "CANONICAL_DEPARTMENT_AUTHORIZATION_DENIED");
  if(!(response.headers.get("content-type")??"").startsWith("application/json"))
   return denied(503,"NON_JSON_CORE_RESPONSE");
  const body=await response.text();
  if(!body||body.length>24000)return denied(503,"INVALID_CORE_RESPONSE_SIZE");
  return parseAb3DomainWindow(JSON.parse(body));
 }catch{return denied(503,"AUTHENTICATED_CORE_DOMAIN_UNAVAILABLE");}
}
