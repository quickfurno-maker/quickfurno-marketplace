/**
 * VOX Owner-only vendor verification bridge. Reuses QuickFurno Core private
 * review queue, case snapshot and immutable decision; VOX NEVER has database
 * service-role access, evidence URLs, identity documents or assignment writers.
 * Staging source candidate only. Both Core and VOX flags default OFF.
 */
import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASON=/^[a-z][a-z0-9_]{2,63}$/;
const STATE=new Set(["pending","documents_requested","under_review","needs_correction"]);
const STAGE=new Set(["pending","verified","rejected","expired"]);
const DECISIONS=new Set(["request_documents","request_correction","approve","reject"]);
const CLOSED=new Set(["approved","rejected","documents_requested","needs_correction"]);
const JSON_LIMIT=24*1024;
export type OwnerReviewAction="request_documents"|"request_correction"|"approve"|"reject";
export type OwnerReviewInput={vendorId:string;caseVersion:number;action:OwnerReviewAction;reasonCode:string};
export type OwnerQueueRow={
 vendorId:string;caseVersion:number;caseState:string;submittedAt:string;
 contactStatus:string;identityStatus:string;officeStatus:string;
 categoryStatus:string;zoneStatus:string;consentValid:boolean;
 pendingScanCount:number;rejectedScanCount:number;
};
export type OwnerCase={
 vendorId:string;casePresent:boolean;caseVersion:number|null;caseState:string|null;
 contactStatus:string|null;identityStatus:string|null;officeStatus:string|null;
 categoryStatus:string|null;zoneStatus:string|null;consentValid:boolean;
 identityEvidenceVerified:boolean;officeEvidenceVerified:boolean;
 readyForCoreApproval:boolean;
};
type Outcome<T>={ok:true;status:200;data:T}|{ok:false;status:number;error:string};

const UUID_QUERY=(value:string)=>typeof value==="string"&&UUID.test(value);
const exact=(r:Record<string,unknown>,keys:readonly string[])=>
 Object.keys(r).sort().join(",")===keys.slice().sort().join(",");
const object=(v:unknown):v is Record<string,unknown>=>
 v!==null&&typeof v==="object"&&!Array.isArray(v);
const count=(value:unknown)=>typeof value==="number"&&
 Number.isSafeInteger(value)&&value>=0&&value<=1000000;
const stage=(value:unknown)=>typeof value==="string"&&STAGE.has(value);
const shortError=(status:number)=>{
 if(status===401)return {ok:false,status:401,error:"OWNER_MFA_REQUIRED"} as const;
 if(status===403)return {ok:false,status:403,error:"OWNER_AUTH_DENIED"} as const;
 if(status===409)return {ok:false,status:409,error:"OWNER_REVIEW_CHANGED_RELOAD"} as const;
 return {ok:false,status:503,error:"CORE_VENDOR_VERIFICATION_UNAVAILABLE"} as const;
};

export function ownerVendorReviewReadEnabled():boolean{
 return process.env.VOX_STAFF_PORTAL_ENABLED==="staging"&&
   process.env.VOX_STAFF_VIEW_MODE==="owner"&&
   process.env.VOX_OWNER_VENDOR_REVIEW_ENABLED==="staging";
}
export function ownerVendorDecisionEnabled():boolean{
 return ownerVendorReviewReadEnabled()&&
   process.env.VOX_OWNER_VENDOR_DECISION_ENABLED==="staging";
}

/** Full body bounds, not only the untrusted Content-Length header. */
async function boundedJson(r:Response):Promise<unknown|null>{
 if(!r.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return null;
 const declared=r.headers.get("content-length");
 if(declared!==null&&(!/^[0-9]{1,6}$/.test(declared)||Number(declared)>JSON_LIMIT))return null;
 const reader=r.body?.getReader();if(!reader)return null;
 const buffers:Uint8Array[]=[];let size=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;if(size>JSON_LIMIT){await reader.cancel().catch(()=>{});return null;}
   buffers.push(value);
  }
 }catch{return null;}finally{reader.releaseLock();}
 try{
  const output=Buffer.alloc(size);let offset=0;
  for(const item of buffers){output.set(item,offset);offset+=item.length;}
  return JSON.parse(output.toString("utf8")) as unknown;
 }catch{return null;}
}

async function callCore(path:string,method:"GET"|"POST",body?:OwnerReviewInput):Promise<Outcome<unknown>>{
 if(!ownerVendorReviewReadEnabled()||(method==="POST"&&!ownerVendorDecisionEnabled()))
  return {ok:false,status:503,error:"OWNER_VENDOR_REVIEW_DISABLED"};
 const base=origin();if(!base)
  return {ok:false,status:503,error:"CORE_ORIGIN_UNCERTIFIED"};
 const token=await verifiedMfaSession();if(!token)
  return {ok:false,status:401,error:"OWNER_MFA_REQUIRED"};
 try{
  const response=await fetch(base+path,{
   method,cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000),
   headers:{authorization:"Bearer "+token,accept:"application/json",
     ...(body?{"content-type":"application/json"}:{})},
   ...(body?{body:JSON.stringify(body)}:{})
   // DO NOT forward browser Origin, cookies, forwarded-host or arbitrary headers
   // to Core. VOX BFF enforces same-origin CSRF before POST.
  });
  if(!response.ok)return shortError(response.status);
  const data=await boundedJson(response);
  if(data===null)return {ok:false,status:503,error:"UNTRUSTED_CORE_RESPONSE"};
  // Recheck the real GoTrue MFA session after IO; Core also independently
  // rechecks signed Owner Superadmin AAL2. Never trust the Web's role labels.
  if((await verifiedMfaSession())!==token)
   return {ok:false,status:403,error:"OWNER_SESSION_REVOKED"};
  return {ok:true,status:200,data};
 }catch{return {ok:false,status:503,error:"CORE_VENDOR_VERIFICATION_UNAVAILABLE"};}
}

const queueFields=[
 "vendorId","caseVersion","caseState","submittedAt","contactStatus","identityStatus",
 "officeStatus","categoryStatus","zoneStatus","consentValid",
 "pendingScanCount","rejectedScanCount",
] as const;
function safeQueueRow(v:unknown):OwnerQueueRow|null{
 if(!object(v)||!exact(v,queueFields)||!UUID_QUERY(String(v.vendorId))||
   !Number.isSafeInteger(v.caseVersion)||Number(v.caseVersion)<1||Number(v.caseVersion)>100000||
   typeof v.caseState!=="string"||!STATE.has(v.caseState)||
   typeof v.submittedAt!=="string"||!Number.isFinite(Date.parse(v.submittedAt))||
   typeof v.consentValid!=="boolean"||!count(v.pendingScanCount)||!count(v.rejectedScanCount)||
   ["contactStatus","identityStatus","officeStatus","categoryStatus","zoneStatus"].some(k=>!stage(v[k])))
  return null;
 return v as OwnerQueueRow;
}

export async function ownerVendorQueue():Promise<Outcome<OwnerQueueRow[]>>{
 const r=await callCore("/api/vox/v1/owner-vendor-verification-queue","GET");
 if(!r.ok)return r;
 const v=r.data;
 if(!object(v)||v.ok!==true||v.schema!=="qf.vox.owner.vendor-verification-queue.v1"||
   v.mode!=="READ_ONLY"||v.source!=="quickfurno-core"||v.limit!==20||
   v.canApprove!==false||v.canViewPrivateDocuments!==false||
   v.canActivateLeads!==false||v.requiresSeparateOwnerCaseDecision!==true||
   !Array.isArray(v.pending)||v.pending.length>20)
  return {ok:false,status:503,error:"UNTRUSTED_CORE_QUEUE"};
 const rows:OwnerQueueRow[]=[];const seen=new Set<string>();
 for(const raw of v.pending){
  const row=safeQueueRow(raw);
  if(!row||seen.has(row.vendorId))return {ok:false,status:503,error:"UNTRUSTED_CORE_QUEUE"};
  seen.add(row.vendorId);rows.push(row);
 }
 return {ok:true,status:200,data:rows};
}

const caseFields=[
 "ok","schema","vendorId","mode","casePresent","caseVersion","caseState",
 "contactStatus","identityStatus","officeStatus","categoryStatus","zoneStatus",
 "consentValid","identityEvidenceVerified","officeEvidenceVerified",
 "readyForCoreApproval","canViewPrivateDocuments","canActivateLeads",
 "requiresSeparateCoreVendorApproval",
] as const;
export async function ownerVendorCase(vendorId:string):Promise<Outcome<OwnerCase>>{
 if(!UUID_QUERY(vendorId))return {ok:false,status:400,error:"INVALID_VENDOR_ID"};
 const r=await callCore("/api/vox/v1/owner-vendor-verification-case?vendorId="+
  encodeURIComponent(vendorId),"GET");
 if(!r.ok)return r;
 const v=r.data;
 if(!object(v)||!exact(v,caseFields)||v.ok!==true||
   v.schema!=="qf.vox.owner.vendor-private-review.v1"||
   v.vendorId!==vendorId||v.mode!=="OWNER_REVIEW"||
   typeof v.casePresent!=="boolean"||
   (v.casePresent&&(!Number.isSafeInteger(v.caseVersion)||Number(v.caseVersion)<1||
     Number(v.caseVersion)>100000))||
   (!v.casePresent&&v.caseVersion!==null)||
   (v.caseState!==null&&(typeof v.caseState!=="string"||
     !new Set([...STATE,"approved","rejected","expired"]).has(v.caseState)))||
   ["contactStatus","identityStatus","officeStatus","categoryStatus","zoneStatus"]
    .some(k=>v[k]!==null&&!stage(v[k]))||
   ["consentValid","identityEvidenceVerified","officeEvidenceVerified","readyForCoreApproval"]
    .some(k=>typeof v[k]!=="boolean")||
   v.canViewPrivateDocuments!==false||v.canActivateLeads!==false||
   v.requiresSeparateCoreVendorApproval!==true)
   return {ok:false,status:503,error:"UNTRUSTED_CORE_CASE"};
 const data:OwnerCase={
  vendorId,casePresent:v.casePresent as boolean,caseVersion:v.caseVersion as number|null,
  caseState:v.caseState as string|null,contactStatus:v.contactStatus as string|null,
  identityStatus:v.identityStatus as string|null,officeStatus:v.officeStatus as string|null,
  categoryStatus:v.categoryStatus as string|null,zoneStatus:v.zoneStatus as string|null,
  consentValid:v.consentValid as boolean,
  identityEvidenceVerified:v.identityEvidenceVerified as boolean,
  officeEvidenceVerified:v.officeEvidenceVerified as boolean,
  readyForCoreApproval:v.readyForCoreApproval as boolean
 };
 return {ok:true,status:200,data};
}

export function validOwnerReviewInput(v:unknown):v is OwnerReviewInput{
 return object(v)&&exact(v,["vendorId","caseVersion","action","reasonCode"])&&
  typeof v.vendorId==="string"&&UUID_QUERY(v.vendorId)&&
  typeof v.caseVersion==="number"&&Number.isSafeInteger(v.caseVersion)&&
  v.caseVersion>=1&&v.caseVersion<=100000&&
  typeof v.action==="string"&&DECISIONS.has(v.action)&&
  typeof v.reasonCode==="string"&&REASON.test(v.reasonCode);
}

export async function ownerVendorDecision(input:OwnerReviewInput):
 Promise<Outcome<{vendorId:string;caseState:string}>>{
 if(!validOwnerReviewInput(input))return {ok:false,status:400,error:"INVALID_OWNER_DECISION"};
 const r=await callCore("/api/vox/v1/owner-vendor-verification-case","POST",input);
 if(!r.ok)return r;
 const v=r.data;
 if(!object(v)||v.ok!==true||v.schema!=="qf.vox.owner.vendor-review-decision.v1"||
   v.vendorId!==input.vendorId||typeof v.caseState!=="string"||
   !CLOSED.has(v.caseState)||v.immutableDecisionRecorded!==true||
   v.vendorBusinessStatusUnchanged!==true||v.leadActivationUnchanged!==true||
   v.requiresSeparateCoreVendorApproval!==true)
  return {ok:false,status:503,error:"OWNER_DECISION_OUTCOME_UNCONFIRMED"};
 return {ok:true,status:200,data:{vendorId:input.vendorId,caseState:v.caseState}};
}
