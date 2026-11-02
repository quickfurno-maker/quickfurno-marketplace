/**
 * F1-A canonical source recorder: callers cannot launder existing provider,
 * AI or unverified historical rows into employee performance.
 * This is a Core service boundary, NOT a browser API or installed writer.
 */
import {createPublicKey,verify} from "node:crypto";
import {requiredAttributableSources}
 from "./l9FourSourceEodEvidence.mjs";
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const keys=(obj,fields)=>obj&&typeof obj==="object"&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join("|")===fields.slice().sort().join("|");
const recordKeys=["schema","id","source","sourceEventId","actorId",
 "teamId","cityId","objectId","revision","eventKind","occurredAt",
 "subjectKind","subjectId","nonce","issuedAtMs","expiresAtMs"];
const deny=reason=>Object.freeze({ok:false,reason,inserted:false,
 status:"REJECTED",providerMessagesSent:0});
export const canonicalSourceEventBody=(r)=>{
 if(!keys(r,recordKeys))throw Error("UNTRUSTED_SOURCE_SHAPE");
 return JSON.stringify(recordKeys.map(k=>[k,r[k]]));
};
export async function recordVerifiedStaffSourceAction({
 command,signature,publicKeyPem,verifyCurrentNeutralStaff,
 verifyImmutableSourceObject,verifyExactObjectGrant,insertOnce,
 now=Date.now()
}={}){
 if(!keys(command,recordKeys)||command.schema!=="qf.vox.f1.staff-source-action.v1"||
  !requiredAttributableSources.includes(command.source)||
  !["id","sourceEventId","actorId","teamId","cityId","objectId",
   "subjectId","nonce"].every(k=>typeof command[k]==="string"&&ID.test(command[k]))||
  !Number.isSafeInteger(command.revision)||command.revision<0||
  typeof command.eventKind!=="string"||!/^[A-Z_]{3,32}$/.test(command.eventKind)||
  typeof command.occurredAt!=="string"||
  !Number.isFinite(Date.parse(command.occurredAt))||
  Math.abs(Date.parse(command.occurredAt)-now)>30000||
  !Number.isSafeInteger(now)||!Number.isSafeInteger(command.issuedAtMs)||
  !Number.isSafeInteger(command.expiresAtMs)||
  command.issuedAtMs>now+30000||command.issuedAtMs<now-30000||
  command.expiresAtMs<=now||command.expiresAtMs>now+60000||
  typeof signature!=="string"||!/^[A-Za-z0-9_-]{80,140}$/.test(signature)||
  typeof publicKeyPem!=="string"||typeof verifyCurrentNeutralStaff!=="function"||
  typeof verifyImmutableSourceObject!=="function"||
  typeof verifyExactObjectGrant!=="function"||
  typeof insertOnce!=="function")return deny("STRICT_TRUSTED_STAFF_ACTION_REQUIRED");
 const sourceKind={
  CORE_WORK_LEDGER:["prospect","vendor","support_thread"],
  CRM_AAROHI:["prospect"],SUPPORT_DESK:["support_thread"],
  CORE_CONVERSATION:["conversation"]
 };
 if(!sourceKind[command.source].includes(command.subjectKind))
  return deny("SOURCE_SUBJECT_MISMATCH");
 try{
  if(!verify(null,Buffer.from(canonicalSourceEventBody(command)),
   createPublicKey(publicKeyPem),Buffer.from(signature,"base64url")))
   return deny("CORE_EVENT_SIGNER_DENIED");
 }catch{return deny("CORE_EVENT_SIGNER_DENIED");}
 try{
  // All three checks must be done again, inside the accepted DB atomic
  // procedure before making the append visible.
  if((await verifyCurrentNeutralStaff(command))!==true)
   return deny("STAFF_GRANT_REVOKED");
  if((await verifyImmutableSourceObject(command))!==true)
   return deny("SOURCE_OBJECT_PROVENANCE_UNVERIFIED");
  if((await verifyExactObjectGrant(command))!==true)
   return deny("OBJECT_CITY_DEPARTMENT_REVOKED");
  const inserted=await insertOnce(command);
  if(!keys(inserted,["id","persisted","provenanceCheckedInTransaction",
    "staffCheckedInTransaction","grantCheckedInTransaction",
    "nonceConsumedInTransaction"])||
   inserted.id!==command.id||inserted.persisted!==true||
   inserted.provenanceCheckedInTransaction!==true||
   inserted.staffCheckedInTransaction!==true||
   inserted.grantCheckedInTransaction!==true||
   inserted.nonceConsumedInTransaction!==true)
   return deny("DURABLE_ATOMIC_INSERT_UNVERIFIED");
  return Object.freeze({ok:true,id:command.id,inserted:true,
   status:"IMMUTABLE_CORE_SOURCE_APPEND",providerMessagesSent:0});
 }catch{return deny("SOURCE_DATABASE_UNAVAILABLE");}
}
