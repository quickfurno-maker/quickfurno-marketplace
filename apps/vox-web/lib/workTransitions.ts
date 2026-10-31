import "server-only";
import {verifiedMfaSession} from "./auth";
import {origin} from "./core";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed=["CLAIM","START","WAIT_EXTERNAL","REQUEST_APPROVAL","BLOCK","RESUME","COMPLETE"] as const;
export type WorkAction=typeof allowed[number];
export type WorkCommand={action:WorkAction;itemId:string;expectedRevision:number;nonce:string;reason:string};
const exact=(obj:Record<string,unknown>,keys:string[])=>
 Object.keys(obj).sort().join("|")===[...keys].sort().join("|");
const fail=(status:number,error:string)=>({ok:false,status,error} as const);
/** Staff browser -> same origin Next BFF -> pinned Core signed-in Staff.
 * The actual Core atomic DB routine verifies current grants, team/city,
 * department, vendor/prospect subject, revision and nonce under row lock.
 */
export async function submitScopedWorkTransition(cmd:WorkCommand){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
    process.env.VOX_WORK_ACTIONS_UI_ENABLED!=="staging"||
    process.env.VOX_WORK_ACTIONS_ENABLED!=="staging"||
    !["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE)))
  return fail(503,"WORK_ACTIONS_DISABLED");
 if(!cmd||!allowed.includes(cmd.action)||!UUID.test(cmd.itemId)||!UUID.test(cmd.nonce)||
  !Number.isSafeInteger(cmd.expectedRevision)||cmd.expectedRevision<0||
  cmd.expectedRevision>2147483646||
  typeof cmd.reason!=="string"||cmd.reason.length>300||cmd.reason!==cmd.reason.trim()||
  (cmd.action==="CLAIM"&&cmd.reason!=="")||
  (["BLOCK","REQUEST_APPROVAL","COMPLETE"].includes(cmd.action)&&cmd.reason.length<12))
  return fail(400,"INVALID_WORK_COMMAND");
 const token=await verifiedMfaSession();
 if(!token)return fail(401,"STAFF_MFA_REQUIRED");
 const base=origin();
 if(!base)return fail(503,"CORE_ORIGIN_UNVERIFIED");
 try{
  const result=await fetch(base+"/api/vox/v1/work-transitions",{
   method:"POST",headers:{authorization:"Bearer "+token,
    "content-type":"application/json",accept:"application/json"},
   body:JSON.stringify({action:cmd.action,itemId:cmd.itemId,
    expectedRevision:cmd.expectedRevision,nonce:cmd.nonce,reason:cmd.reason}),
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!result.ok)return fail(result.status===409?409:
   result.status===403?403:result.status===401?401:503,
   "CORE_WORK_ACTION_NOT_VERIFIED");
  const obj:unknown=await result.json();
  if(!obj||typeof obj!=="object"||Array.isArray(obj))return fail(503,"INVALID_CORE_RECEIPT");
  const r=obj as Record<string,unknown>;
  if(!exact(r,["ok","schema","workItemId","newState","revision",
    "providerMessagesSent","affectsVendorLeadMatching"])||
    r.ok!==true||r.schema!=="qf.vox.work.transaction.receipt.v1"||
    r.workItemId!==cmd.itemId||
    !["ASSIGNED","IN_PROGRESS","WAITING_EXTERNAL","WAITING_APPROVAL","BLOCKED","DONE"].includes(String(r.newState))||
    r.newState!==({CLAIM:"ASSIGNED",START:"IN_PROGRESS",
     WAIT_EXTERNAL:"WAITING_EXTERNAL",REQUEST_APPROVAL:"WAITING_APPROVAL",
     BLOCK:"BLOCKED",RESUME:"IN_PROGRESS",COMPLETE:"DONE"} as const)[cmd.action]||
    !Number.isSafeInteger(r.revision)||r.revision!==cmd.expectedRevision+1||
    r.providerMessagesSent!==0||r.affectsVendorLeadMatching!==false)
   return fail(503,"UNTRUSTED_CORE_WORK_RECEIPT");
  return {ok:true,status:200,workItemId:cmd.itemId,
   revision:r.revision as number,newState:r.newState as string,
   providerMessagesSent:0 as const} as const;
 }catch{return fail(503,"CORE_WORK_ACTION_UNAVAILABLE");}
}

/** Preserve the already-source-tested simple claim/start transition contract.
 * The expanded command UI is a separately gated superset; both use the exact
 * Core atomic candidate RPC and the same current Staff MFA session.
 */
export async function transitionMyStaffWork(cmd:{
 action:"CLAIM"|"START";itemId:string;expectedRevision:number;nonce:string;
}){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
   process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
   process.env.VOX_WORK_TRANSITION_UI_ENABLED!=="staging"||
   !["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE)))
  return fail(503,"WORK_ACTIONS_DISABLED");
 if(!cmd||!["CLAIM","START"].includes(cmd.action)||
   !UUID.test(cmd.itemId)||!UUID.test(cmd.nonce)||
   !Number.isSafeInteger(cmd.expectedRevision)||cmd.expectedRevision<0||
   cmd.expectedRevision>2147483646)
  return fail(400,"INVALID_WORK_COMMAND");
 const token=await verifiedMfaSession();
 if(!token)return fail(401,"STAFF_MFA_REQUIRED");
 const base=origin();if(!base)return fail(503,"CORE_ORIGIN_UNVERIFIED");
 try{
  const r=await fetch(base+"/api/vox/v1/work-transitions",{
   method:"POST",headers:{authorization:"Bearer "+token,
    "content-type":"application/json",accept:"application/json"},
   body:JSON.stringify({...cmd,reason:""}),cache:"no-store",
   redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return fail(r.status===409?409:r.status===403?403:
    r.status===401?401:503,"CORE_WORK_ACTION_NOT_VERIFIED");
  const result:unknown=await r.json();
  if(!result||typeof result!=="object"||Array.isArray(result))
   return fail(503,"INVALID_CORE_RECEIPT");
  const v=result as Record<string,unknown>;
  const expected=cmd.action==="CLAIM"?"ASSIGNED":"IN_PROGRESS";
  if(!exact(v,["ok","schema","workItemId","newState","revision",
   "providerMessagesSent","affectsVendorLeadMatching"])||
   v.ok!==true||v.schema!=="qf.vox.work.transaction.receipt.v1"||
   v.workItemId!==cmd.itemId||v.newState!==expected||
   !Number.isSafeInteger(v.revision)||v.revision!==cmd.expectedRevision+1||
   v.providerMessagesSent!==0||v.affectsVendorLeadMatching!==false)
   return fail(503,"INVALID_CORE_RECEIPT");
  return {ok:true,status:200,workItemId:cmd.itemId,newState:expected,
   revision:v.revision as number,externalMessagesSent:0 as const} as const;
 }catch{return fail(503,"CORE_WORK_ACTION_UNAVAILABLE");}
}
