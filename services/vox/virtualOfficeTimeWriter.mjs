import {validateTimeCommand} from "../../contracts/vox/virtualOfficeTimekeeping.mjs";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>Object.freeze({ok:false,reason,applied:false,providerMessagesSent:0});
const unknown=()=>Object.freeze({ok:false,reason:"TIME_WRITE_OUTCOME_UNKNOWN",
 committed:null,retrySameNonceOnly:true,providerMessagesSent:0});
const taskAction=action=>action.startsWith("TASK_");
const isId=x=>typeof x==="string"&&uuid.test(x);
function scopedProof(x){
 if(!x||!isId(x.userId)||!isId(x.teamId)||!isId(x.cityId)||
    typeof x.role!=="string"||x.canMutate!==false||
    !Array.isArray(x.verifiedDepartments)||!x.verifiedDepartments.every(v=>typeof v==="string")||
    ["prospectIds","vendorIds","supportThreadIds","conversationIds"].some(k=>
      !Array.isArray(x[k])||!x[k].every(isId)))return false;
 return true;
}
function sameScope(a,b){
 if(!scopedProof(a)||!scopedProof(b))return false;
 for(const k of ["userId","teamId","cityId","role","canMutate"])if(a[k]!==b[k])return false;
 for(const k of ["prospectIds","vendorIds","supportThreadIds","conversationIds","verifiedDepartments"]){
  const aa=[...a[k]].sort(),bb=[...b[k]].sort();
  if(aa.length!==bb.length||aa.some((v,i)=>v!==bb[i]))return false;
 }
 return true;
}
const exact=(obj,keys)=>Object.keys(obj).sort().join("|")===[...keys].sort().join("|");

/**
 * OFF by default: controlled Core->SQL atomic time event writer.
 * This adapter does not implement or install the database RPC.
 * The SQL writer MUST lock one Staff ledger row, validate current work rights
 * in the same transaction, use DB clock, and atomically persist a unique nonce.
 * No retries/fallback after an attempted RPC, including response timeout.
 */
export async function writeScopedTimeCommand(raw,deps={}){
 const parsed=validateTimeCommand(raw);
 if(!parsed.ok)return deny(parsed.reason);
 if(deps.environment!=="staging"||
    deps.enabled?.()!==true||deps.installed?.()!==true)
  return deny("TIME_WRITER_NOT_CERTIFIED");
 if(typeof deps.currentScopedStaff!=="function"||
    typeof deps.currentTaskGrant!=="function"||
    typeof deps.rpc!=="function")return deny("TIME_WRITER_DEPENDENCIES_MISSING");
 const command=parsed.command;
 let before;
 try{before=await deps.currentScopedStaff();}
 catch{return deny("CURRENT_STAFF_SCOPE_UNAVAILABLE");}
 if(!scopedProof(before)||["team_leader","auditor"].includes(before.role))
  return deny("CURRENT_NEUTRAL_STAFF_SCOPE_REQUIRED");
 if(taskAction(command.action)){
  try{
   if(await deps.currentTaskGrant(before,command.workItemId)!==true)
    return deny("CURRENT_ASSIGNED_TASK_REQUIRED");
  }catch{return deny("CURRENT_TASK_GRANT_UNAVAILABLE");}
 }
 const args=Object.freeze({p_actor:before.userId,p_team:before.teamId,p_city:before.cityId,
  p_action:command.action,p_nonce:command.nonce,
  p_expected_revision:command.expectedRevision,p_work_item:command.workItemId??null});
 let response;
 try{response=await deps.rpc("qf_vox_staff_time_atomic_candidate_v1",args);}
 catch{return unknown();}
 if(response?.error||!Array.isArray(response?.data)||response.data.length!==1)
  return unknown();
 const r=response.data[0];
 if(!r||typeof r!=="object"||Array.isArray(r)||
    !exact(r,["nonce","actor_id","event_id","revision","applied","occurred_at","work_item_id","external_messages_sent","money_minor_units"])||
    r.nonce!==command.nonce||r.actor_id!==before.userId||!isId(r.event_id)||
    r.revision!==command.expectedRevision+1||r.applied!==true||
    r.work_item_id!==(command.workItemId??null)||
    r.external_messages_sent!==0||r.money_minor_units!==0||
    typeof r.occurred_at!=="string"||
    !Number.isFinite(Date.parse(r.occurred_at)))return unknown();
 let after;
 try{after=await deps.currentScopedStaff();}
 catch{return unknown();}
 if(!sameScope(before,after))return unknown();
 if(taskAction(command.action)){
  try{if(await deps.currentTaskGrant(after,command.workItemId)!==true)return unknown();}
  catch{return unknown();}
 }
 return Object.freeze({ok:true,applied:true,nonce:command.nonce,
  revision:r.revision,eventId:r.event_id,occurredAt:r.occurred_at,
  providerMessagesSent:0,moneyMinorUnits:0,productionCertified:false});
}
