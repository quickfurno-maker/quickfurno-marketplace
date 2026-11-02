// TO-02C: pure validated WORK INTENT, no mutation, no queue auth grant.
// Future Core must verify actor/token (AAL2), current membership, exact scope,
// source object, transaction revision, nonce uniqueness & capacity IN DATABASE.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=x=>typeof x==="string"&&UUID.test(x);
const RECORD=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const STATES=new Set(["NEW","ASSIGNED","IN_PROGRESS","WAITING_EXTERNAL","WAITING_APPROVAL","BLOCKED","DONE","ESCALATED","CANCELLED"]);
const ACTIONS=Object.freeze({
 CLAIM:{from:["NEW"],to:"ASSIGNED",authority:"ELIGIBLE_STAFF"},
 START:{from:["ASSIGNED"],to:"IN_PROGRESS",authority:"ASSIGNEE"},
 WAIT_EXTERNAL:{from:["IN_PROGRESS"],to:"WAITING_EXTERNAL",authority:"ASSIGNEE"},
 REQUEST_APPROVAL:{from:["IN_PROGRESS","BLOCKED"],to:"WAITING_APPROVAL",authority:"ASSIGNEE"},
 BLOCK:{from:["ASSIGNED","IN_PROGRESS"],to:"BLOCKED",authority:"ASSIGNEE"},
 ESCALATE:{from:["NEW","ASSIGNED","IN_PROGRESS","WAITING_EXTERNAL","BLOCKED"],to:"ESCALATED",authority:"TEAM_LEADER"},
 RESUME:{from:["WAITING_EXTERNAL","BLOCKED","ESCALATED"],to:"IN_PROGRESS",authority:"ASSIGNEE"},
 COMPLETE:{from:["IN_PROGRESS"],to:"DONE",authority:"ASSIGNEE"}
});
const reject=reason=>Object.freeze({ok:false,error:reason,executionAuthorized:false});
/**
 * The caller-supplied `context` MUST be server-built from current Core policy.
 * This is INPUT SHAPE VALIDATION, not actual authorization and NOT a send/RPC.
 * No client browser should be allowed to select context flags/role.
 */
export function prepareScopedWorkIntent({context,item,request,now=Date.now()}={}){
 if(!RECORD(context)||context.coreVerified!==true||context.aal!=="aal2"||
    context.isActive!==true||!ID(context.actorId)||!ID(context.teamId)||!ID(context.cityId)||
    !["staff","team_leader"].includes(context.role)||context.isOwner===true)
  return reject("VERIFIED_CURRENT_CORE_SCOPE_REQUIRED");
 if(!RECORD(item)||!ID(item.id)||!ID(item.teamId)||!ID(item.cityId)||
    item.teamId!==context.teamId||item.cityId!==context.cityId||
    !STATES.has(item.state)||!Number.isSafeInteger(item.revision)||item.revision<0||
    (item.assigneeId!==null&&!ID(item.assigneeId)))
  return reject("ITEM_SCOPE_OR_REVISION_INVALID");
 if(!RECORD(request)||!Object.hasOwn(ACTIONS,request.action)||
    !ID(request.nonce)||!Number.isSafeInteger(request.expectedRevision)||
    request.expectedRevision!==item.revision||
    typeof request.reason!=="string"||
    request.reason.length>300||
    (request.reason.length>0&&request.reason.trim()!==request.reason))
  return reject("REQUEST_SHAPE_OR_REVISION_INVALID");
 if(!Number.isSafeInteger(now)||now<=0)return reject("INVALID_CLOCK");
 const rule=ACTIONS[request.action];
 if(!rule.from.includes(item.state))return reject("STATE_TRANSITION_INVALID");
 const assignee=item.assigneeId===context.actorId;
 const isLeader=context.role==="team_leader";
 if(rule.authority==="TEAM_LEADER"&&!isLeader)return reject("ESCALATION_ROLE_REQUIRED");
 if(rule.authority==="ASSIGNEE"&&!assignee)return reject("CURRENT_ASSIGNEE_REQUIRED");
 if(rule.authority==="ELIGIBLE_STAFF"&&item.assigneeId!==null)
  return reject("ITEM_ALREADY_ASSIGNED");
 if(request.action==="CLAIM"&&context.role==="team_leader")
  return reject("LEADER_CLAIM_REQUIRES_SEPARATE_POLICY");
 if(["BLOCK","ESCALATE","REQUEST_APPROVAL","COMPLETE"].includes(request.action)&&
    request.reason.length<12)return reject("EXPLICIT_AUDIT_REASON_REQUIRED");
 if(request.action==="CLAIM"&&request.reason.length>0)return reject("CLAIM_NO_REASON");
 // Token-bound Core, subject grants, shift/capacity and case retention are
 // still future transactional validators and can reject this planning intent.
 return Object.freeze({
  ok:true,schema:"qf.vox.team.work.intent.preparation.v1",
  kind:"NON_EXECUTABLE_INTENT",actorId:context.actorId,
  teamId:context.teamId,cityId:context.cityId,
  itemId:item.id,expectedRevision:request.expectedRevision,nonce:request.nonce,
  action:request.action,fromState:item.state,proposedState:rule.to,
  reason:request.reason,atMs:now,
  executionAuthorized:false,mustReverifyCore:true,
  requiresDatabaseAtomicity:true,requiresFreshSubjectGrant:true,
  affectsVendorLeadMatching:false,providerMessagesSent:0
 });
}
export const allowedWorkIntentActions=Object.freeze(Object.keys(ACTIONS));
