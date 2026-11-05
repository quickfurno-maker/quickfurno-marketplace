/**
 * Defense-in-depth for VOX Owner verification's browser projection.
 * Core + the server BFF remain the only authorization/case authorities.
 * These checks never enable decisions, expose evidence or grant vendor access.
 */
import type {OwnerCase,OwnerQueueRow} from "./ownerVendorVerification";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const caseStates=new Set(["pending","documents_requested","under_review","needs_correction","approved","rejected"]);
const stages=new Set(["pending","verified","rejected","expired"]);
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const exact=(x:Record<string,unknown>,fields:readonly string[])=>Object.keys(x).sort().join(",")===fields.slice().sort().join(",");
const cnt=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0&&v<=1_000_000;
const version=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=1&&v<=100_000;
const stage=(v:unknown)=>typeof v==="string"&&stages.has(v);
const queueKeys=[
 "vendorId","caseVersion","caseState","submittedAt","contactStatus","identityStatus",
 "officeStatus","categoryStatus","zoneStatus","consentValid","pendingScanCount","rejectedScanCount"
] as const;
const caseKeys=[
 "vendorId","casePresent","caseVersion","caseState","contactStatus","identityStatus",
 "officeStatus","categoryStatus","zoneStatus","consentValid","identityEvidenceVerified",
 "officeEvidenceVerified","readyForCoreApproval"
] as const;
export function isOwnerQueueRow(v:unknown):v is OwnerQueueRow{
 if(!obj(v)||!exact(v,queueKeys))return false;
 return typeof v.vendorId==="string"&&uuid.test(v.vendorId)&&version(v.caseVersion)&&
  typeof v.caseState==="string"&&caseStates.has(v.caseState)&&
  typeof v.submittedAt==="string"&&Number.isFinite(Date.parse(v.submittedAt))&&
  ["contactStatus","identityStatus","officeStatus","categoryStatus","zoneStatus"].every(k=>stage(v[k]))&&
  typeof v.consentValid==="boolean"&&cnt(v.pendingScanCount)&&cnt(v.rejectedScanCount);
}
export function isOwnerQueueEnvelope(v:unknown):v is {ok:true;schema:"qf.vox.owner.vendor-review-bff.v1";pending:OwnerQueueRow[]}{
 if(!obj(v)||!exact(v,["ok","schema","pending","limit"])||v.ok!==true||
  v.schema!=="qf.vox.owner.vendor-review-bff.v1"||v.limit!==20||
  !Array.isArray(v.pending)||v.pending.length>20)return false;
 const seen=new Set<string>();
 for(const entry of v.pending){
  if(!isOwnerQueueRow(entry)||seen.has(entry.vendorId))return false;
  seen.add(entry.vendorId);
 }
 return true;
}
export function isOwnerCase(v:unknown):v is OwnerCase{
 if(!obj(v)||!exact(v,caseKeys)||typeof v.vendorId!=="string"||!uuid.test(v.vendorId)||
  typeof v.casePresent!=="boolean"||typeof v.consentValid!=="boolean"||
  typeof v.identityEvidenceVerified!=="boolean"||typeof v.officeEvidenceVerified!=="boolean"||
  typeof v.readyForCoreApproval!=="boolean")return false;
 if(!v.casePresent){
  return v.caseVersion===null&&v.caseState===null&&
   ["contactStatus","identityStatus","officeStatus","categoryStatus","zoneStatus"].every(k=>v[k]===null)&&
   !v.consentValid&&!v.identityEvidenceVerified&&!v.officeEvidenceVerified&&!v.readyForCoreApproval;
 }
 return version(v.caseVersion)&&typeof v.caseState==="string"&&caseStates.has(v.caseState)&&
  ["contactStatus","identityStatus","officeStatus","categoryStatus","zoneStatus"].every(k=>stage(v[k]));
}
export function isOwnerCaseEnvelope(v:unknown,requestedVendorId:string):
 v is {ok:true;schema:"qf.vox.owner.vendor-case-bff.v1";case:OwnerCase}{
 return obj(v)&&exact(v,["ok","schema","case"])&&v.ok===true&&
  v.schema==="qf.vox.owner.vendor-case-bff.v1"&&isOwnerCase(v.case)&&
  v.case.vendorId===requestedVendorId;
}
export function canOfferOwnerCaseApproval(c:OwnerCase|null):boolean{
 return Boolean(c&&c.casePresent&&version(c.caseVersion)&&
  c.caseState!=="approved"&&c.caseState!=="rejected"&&
  c.readyForCoreApproval===true&&c.consentValid===true&&
  c.identityEvidenceVerified===true&&c.officeEvidenceVerified===true&&
  ["contactStatus","identityStatus","officeStatus","categoryStatus","zoneStatus"]
   .every(k=>c[k as keyof OwnerCase]==="verified"));
}
