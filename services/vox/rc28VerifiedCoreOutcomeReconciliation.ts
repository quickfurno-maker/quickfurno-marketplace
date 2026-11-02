import "server-only";
import {verifyVoxOperationsStaffBearer} from "./verifiedStaffBearer";
import {reconcileRc8CoreCommitOutcome} from "./rc26CoreCommitReconciliation";

/**
 * RC28: real Staff GoTrue/AAL2 identity -> safe read-only Core receipt proof.
 * No caller-supplied actor/source, no mutation, no provider messages.
 * Release routing is separately HARD OFF until approved Staff/Core DB roles.
 */
export const RC28_CORE_RECONCILIATION_ROUTE_INSTALLED=false as const;
type Db={query:(sql:string,values?:unknown[])=>Promise<{rows:any[];rowCount:number}>;release:(destroy?:boolean)=>void};
type Requested={conversationId:string;nonce:string;action:"PAUSE_AI"|"TAKEOVER";expectedRevision:number};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS=["action","conversationId","expectedRevision","nonce"];
const unknown=(reason:string)=>Object.freeze({outcome:"UNKNOWN" as const,reason,requiresReconciliation:true,
 providerMessagesSent:0 as const,mutationsApplied:0 as const});
const valid=(x:unknown):x is Requested=>{
 if(!x||typeof x!=="object"||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 const keys=Object.keys(v).sort();
 return keys.length===4&&keys.every((k,i)=>k===KEYS[i])&&
  typeof v.conversationId==="string"&&UUID.test(v.conversationId)&&
  typeof v.nonce==="string"&&UUID.test(v.nonce)&&
  (v.action==="TAKEOVER"||v.action==="PAUSE_AI")&&
  Number.isSafeInteger(v.expectedRevision)&&(v.expectedRevision as number)>=0&&
  (v.expectedRevision as number)<=2147483646;
};
export async function reconcileRc28VerifiedCoreCommand(
 authorization:string|null,request:unknown,acquireClient:()=>Promise<Db>
){
 if(!valid(request)||typeof acquireClient!=="function")
  return unknown("RC28_RECONCILIATION_INPUT_INVALID");
 let actor:Awaited<ReturnType<typeof verifyVoxOperationsStaffBearer>>;
 try{actor=await verifyVoxOperationsStaffBearer(authorization)}
 catch{return unknown("RC28_CURRENT_STAFF_AUTH_UNAVAILABLE")}
 if(!actor||actor.aal!=="aal2"||!UUID.test(actor.userId)||actor.expiresAtMs<=Date.now())
  return unknown("RC28_CURRENT_STAFF_AAL2_REQUIRED");
 // RC26 rechecks the exact native nonce, receipt and event with a row lock,
 // then always ROLLBACKs; it never trusts a caller-supplied actor.
 const outcome=await reconcileRc8CoreCommitOutcome({
  conversationId:request.conversationId,nonce:request.nonce,
  action:request.action,expectedRevision:request.expectedRevision,actorId:actor.userId
 },acquireClient);
 // PostgreSQL FOR SHARE may wait for an in-flight writer. Re-read genuine
 // Staff Auth/membership/team/city after that wait; a revoked principal
 // cannot receive a positive committed/noncommitted Core receipt.
 if(outcome.outcome==="UNKNOWN")return outcome;
 let current:Awaited<ReturnType<typeof verifyVoxOperationsStaffBearer>>;
 try{current=await verifyVoxOperationsStaffBearer(authorization)}
 catch{return unknown("RC28_STAFF_RECHECK_UNAVAILABLE")}
 if(!current||current.aal!=="aal2"||current.userId!==actor.userId||
    current.teamId!==actor.teamId||current.cityId!==actor.cityId||
    current.expiresAtMs<=Date.now())
  return unknown("RC28_STAFF_REVOKED_DURING_RECONCILIATION");
 return outcome;
}
