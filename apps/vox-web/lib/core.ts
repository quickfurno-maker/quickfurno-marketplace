import "server-only";
import {verifiedMfaSession} from "./auth";
const HOSTS=new Set(["staging-core.quickfurno.in"]);
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
  const mode=process.env.VOX_STAFF_VIEW_MODE;
  const paths=mode==="owner"?["/api/vox/v1/overview"]:
    mode==="scoped"?["/api/vox/v1/my-work"]:
    mode==="dual"?["/api/vox/v1/overview","/api/vox/v1/my-work"]:null;
  if(!paths)return {ok:false,status:503,error:"STAFF_SCOPE_MODE_DISABLED"} as const;
  let r:Response|null=null;
  // In dual mode fallback ONLY when Core refuses owner privileges (403).
  // Every fallback must pass its own Core active staff/city/team/grant validation.
  for(const path of paths){
   const candidate=await fetch(base+path,{method:"GET",
    headers:{authorization:"Bearer "+token,accept:"application/json"},
    cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
   if(mode==="dual"&&path==="/api/vox/v1/overview"&&candidate.status===403)continue;
   r=candidate;break;
  }
  if(!r)return {ok:false,status:403,error:"CORE_SCOPE_DENIED"} as const;
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

function safeLabel(x:unknown,max=70):string {
 return typeof x==="string" ? x.replace(/[\u0000-\u001f]/g," ").trim().slice(0,max) : "UNKNOWN";
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uid=(x:unknown):string|null=>typeof x==="string"&&UUID.test(x)?x:null;
export async function fetchScopedServiceDesk(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    (process.env.VOX_STAFF_VIEW_MODE!=="scoped"&&process.env.VOX_STAFF_VIEW_MODE!=="dual"))
   return {ok:false,status:503,error:"STAFF_DESK_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();
 if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const r=await fetch(base+"/api/vox/v1/desk",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500),
  });
  if(!r.ok)return {ok:false,status:r.status===403?403:503,error:"STAFF_DESK_UNAVAILABLE"} as const;
  const body:unknown=await r.json();
  if(!body||typeof body!=="object"||!("ok" in body)||body.ok!==true||!("view" in body))
   return {ok:false,status:503,error:"UNTRUSTED_DESK_RESPONSE"} as const;
  const view=(body as {view:Record<string,unknown>}).view;
  if(view?.schema!=="qf.vox.service.desk.v1"||view.mode!=="READ_ONLY"||
     !Array.isArray(view.support)||!Array.isArray(view.humanInbox)||
     view.support.length>12||view.humanInbox.length>12)
   return {ok:false,status:503,error:"UNTRUSTED_DESK_RESPONSE"} as const;
  const support=view.support.map((raw:unknown)=>{
   const row=raw&&typeof raw==="object"?raw as Record<string,unknown>:{};
   return {threadId:uid(row.threadId),state:safeLabel(row.state,32),
    priority:safeLabel(row.priority,32),ageBand:safeLabel(row.ageBand,32),
    slaStatus:"NOT_CONFIGURED",canClose:false};
  });
  const humanInbox=view.humanInbox.map((raw:unknown)=>{
   const row=raw&&typeof raw==="object"?raw as Record<string,unknown>:{};
   return {conversationId:uid(row.conversationId),
    lane:row.lane==="ANISHA"?"ANISHA":row.lane==="AAROHI"?"AAROHI":"UNKNOWN",
    serviceWindow:row.serviceWindow==="OPEN"?"OPEN":"CLOSED_OR_UNKNOWN",
    state:"HUMAN",canReply:false};
  });
  return {ok:true,status:200,view:{support,humanInbox}} as const;
 }catch{return {ok:false,status:503,error:"STAFF_DESK_UNAVAILABLE"} as const;}
}

/** VOX staff CRM adapters â€” no browser tokens, no service-role and no outbound writes.
 * Core owns record scope; the BFF independently drops all undeclared fields. */
export async function fetchScopedCrm(kind:"acquisition"|"vendor360"){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    (process.env.VOX_STAFF_VIEW_MODE!=="scoped"&&process.env.VOX_STAFF_VIEW_MODE!=="dual"))return {ok:false,status:503,error:"STAFF_SCOPE_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 const key=kind==="acquisition"?"acquisition":"vendor360";
 try{
  const r=await fetch(base+"/api/vox/v1/"+key,{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return {ok:false,status:r.status===403?403:503,error:"CORE_SCOPE_DENIED_OR_UNAVAILABLE"} as const;
  const payload:unknown=await r.json();
  if(!payload||typeof payload!=="object"||!("ok" in payload)||payload.ok!==true||!("view" in payload))
   return {ok:false,status:503,error:"INVALID_CORE_SCHEMA"} as const;
  const view=(payload as {view:Record<string,unknown>}).view;
  const expected=key==="acquisition"?"qf.vox.aarohi.reuse.v1":"qf.vox.vendor360.reuse.v1";
  if(view?.schema!==expected||view.readOnly!==true||view.owner!=="quickfurno-core")
   return {ok:false,status:503,error:"INVALID_CORE_SCHEMA"} as const;
  const array=(x:unknown)=>Array.isArray(x)&&x.length<=12?x:[];
  if(key==="acquisition"){
   const prospects=array(view.prospects).map(x=>{
    const p=x&&typeof x==="object"?x as Record<string,unknown>:{};
    return {id:uid(p.id),businessName:safeLabel(p.businessName,120),stage:safeLabel(p.stage,40),
     priority:safeLabel(p.priority,8),nextAction:safeLabel(p.nextAction,50),
     humanTakeover:p.humanTakeover===true,doNotContact:p.doNotContact===true};});
   const tasks=array(view.tasks).map(x=>{const t=x&&typeof x==="object"?x as Record<string,unknown>:{};
    return {id:uid(t.id),prospectId:uid(t.prospectId),status:safeLabel(t.status,30),
     type:safeLabel(t.type,60),dueAt:typeof t.dueAt==="string"?t.dueAt:null};});
   return {ok:true,status:200,kind:key,view:{prospects,tasks}} as const;
  }
  const vendors=array(view.vendors).map(x=>{const v=x&&typeof x==="object"?x as Record<string,unknown>:{};
   return {vendorId:uid(v.vendorId),businessName:safeLabel(v.businessName,120),
    status:safeLabel(v.status,45),verificationStatus:safeLabel(v.verificationStatus,45),
    locationVerification:safeLabel(v.locationVerification,45),active:v.active===true};});
  const crm=array(view.crm).map(x=>{const v=x&&typeof x==="object"?x as Record<string,unknown>:{};
   return {vendorId:uid(v.vendorId),onboarding:safeLabel(v.onboarding,60),
     relationship:safeLabel(v.relationship,60)};});
  const tasks=array(view.tasks).map(x=>{const t=x&&typeof x==="object"?x as Record<string,unknown>:{};
   return {id:uid(t.id),vendorId:uid(t.vendorId),title:safeLabel(t.title,120),
     status:safeLabel(t.status,30)};});
  return {ok:true,status:200,kind:key,view:{vendors,crm,tasks}} as const;
 }catch{return {ok:false,status:503,error:"CORE_CRM_UNAVAILABLE"} as const;}
}

/** Owner-only, read-only AOS operational observation. No agent or AGNI claims. */
export async function fetchOwnerAosHealth(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    (process.env.VOX_STAFF_VIEW_MODE!=="owner"&&process.env.VOX_STAFF_VIEW_MODE!=="dual")||
    process.env.VOX_INTELLIGENCE_VIEW_ENABLED!=="staging")
   return {ok:false,status:503,error:"INTELLIGENCE_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const r=await fetch(base+"/api/vox/v1/aos-health",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return {ok:false,status:r.status===403?403:503,error:"CORE_AOS_UNAVAILABLE"} as const;
  const body:unknown=await r.json();
  if(!body||typeof body!=="object"||!("ok" in body)||body.ok!==true||!("view" in body))
   return {ok:false,status:503,error:"INVALID_AOS_SCHEMA"} as const;
  const view=(body as {view:Record<string,unknown>}).view;
  if(view.schema!=="qf.vox.aos.health.v1"||view.owner!=="quickfurno-core"||
     view.scope!=="PLATFORM_OWNER_ONLY"||view.mode!=="READ_ONLY"||
     view.actionsEnabled!==false||view.advisoryOnly!==true)
   return {ok:false,status:503,error:"INVALID_AOS_SCHEMA"} as const;
  const count=(x:unknown):number|null=>Number.isSafeInteger(x)&&typeof x==="number"&&x>=0&&x<=1e9?x:null;
  const ready=view.observation==="READY";
  return {ok:true,status:200,view:{
   observation:ready?"READY":"UNAVAILABLE",runtime:view.runtime==="SHADOW"?"SHADOW":"OFF_OR_UNKNOWN",
   agentCount:count(view.agentCount),operationalAgentCount:count(view.operationalAgentCount),
   runs24h:ready?count(view.runs24h):null,
   completed24h:ready?count(view.completed24h):null,
   failed24h:ready?count(view.failed24h):null,
   recommendations24h:ready?count(view.recommendations24h):null,
   agni:"NOT_CONNECTED" as const,actionsEnabled:false as const,
  }} as const;
 }catch{return {ok:false,status:503,error:"CORE_AOS_UNAVAILABLE"} as const;}
}

/** Staff access-review queue and single-use decision via existing Core RPC. */
export async function fetchTeamLeaderReviewQueue(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    (process.env.VOX_STAFF_VIEW_MODE!=="scoped"&&process.env.VOX_STAFF_VIEW_MODE!=="dual")||
    process.env.VOX_STAFF_REVIEW_WEB_ENABLED!=="staging")
   return {ok:false,status:503,error:"REVIEW_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const response=await fetch(base+"/api/vox/v1/staff-review-queue",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!response.ok)return {ok:false,status:response.status===403?403:503,error:"NOT_TEAM_LEADER_OR_UNAVAILABLE"} as const;
  const payload:unknown=await response.json();
  if(!payload||typeof payload!=="object"||!("ok" in payload)||payload.ok!==true||!("schema" in payload)||
     payload.schema!=="qf.vox.staff.review.queue.v1"||!("pending" in payload)||!Array.isArray(payload.pending)||
     payload.pending.length>16||!("mode" in payload)||payload.mode!=="READ_ONLY")
   return {ok:false,status:503,error:"INVALID_REVIEW_SCHEMA"} as const;
  const safe=payload.pending.map((x:unknown)=>{
   const p=x&&typeof x==="object"?x as Record<string,unknown>:{};
   return {requestId:uid(p.requestId),targetId:uid(p.targetId),
    kind:p.kind==="STAFF_MEMBERSHIP"?"STAFF_MEMBERSHIP":p.kind==="OBJECT_SCOPE"?"OBJECT_SCOPE":"UNKNOWN",
    role:typeof p.role==="string"?safeLabel(p.role,40):null,
    scopeKind:typeof p.scopeKind==="string"?safeLabel(p.scopeKind,40):null,
    expiresAt:typeof p.expiresAt==="string"?p.expiresAt:null,
    revision:p.revision===0?0:-1,state:"PENDING" as const};
  });
  if(safe.some(x=>!x.requestId||!x.targetId||x.revision!==0||x.kind==="UNKNOWN"))
   return {ok:false,status:503,error:"INVALID_REVIEW_SCHEMA"} as const;
  return {ok:true,status:200,pending:safe} as const;
 }catch{return {ok:false,status:503,error:"REVIEW_QUEUE_UNAVAILABLE"} as const;}
}
export async function submitTeamLeaderReview(requestId:string,decision:"APPROVE"|"REJECT",reference:string){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    (process.env.VOX_STAFF_VIEW_MODE!=="scoped"&&process.env.VOX_STAFF_VIEW_MODE!=="dual")||
    process.env.VOX_STAFF_REVIEW_WEB_ENABLED!=="staging")
   return {ok:false,status:503,error:"REVIEW_DISABLED"} as const;
 if(!uid(requestId)||!["APPROVE","REJECT"].includes(decision)||reference.length<8||reference.length>128)
  return {ok:false,status:400,error:"INVALID_REVIEW"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const response=await fetch(base+"/api/vox/v1/staff-grants",{
   method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},
   body:JSON.stringify({action:"review",requestId,decision,expectedRevision:0,reference}),
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!response.ok)return {ok:false,status:response.status===409?409:503,error:"REVIEW_REJECTED_OR_STALE"} as const;
  const data:unknown=await response.json();
  if(!data||typeof data!=="object"||!("ok" in data)||data.ok!==true||
     !("state" in data)||data.state!==(decision==="APPROVE"?"APPROVED":"REJECTED")||
     !("revision" in data)||data.revision!==1)
   return {ok:false,status:503,error:"INVALID_REVIEW_ACK"} as const;
  return {ok:true,status:200,state:decision==="APPROVE"?"APPROVED":"REJECTED",
   note:"Reviewed only. Owner activation remains separately required."} as const;
 }catch{return {ok:false,status:503,error:"REVIEW_UNAVAILABLE"} as const;}
}

const WORKFLOWS=["vendor_journey","client_journey","campaigns","recovery","orphan_cleanup","stale_cleanup"] as const;
export async function fetchScopedStudioSimulation(key:string){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||(process.env.VOX_STAFF_VIEW_MODE!=="scoped"&&process.env.VOX_STAFF_VIEW_MODE!=="dual")||
    process.env.VOX_STUDIO_WEB_ENABLED!=="staging")
  return {ok:false,status:503,error:"STUDIO_DISABLED"} as const;
 if(!WORKFLOWS.some(v=>v===key))return {ok:false,status:400,error:"UNKNOWN_WORKFLOW"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const r=await fetch(base+"/api/vox/v1/studio-simulate?workflowKey="+encodeURIComponent(key),{
   headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return {ok:false,status:r.status===403?403:503,error:"STUDIO_UNAVAILABLE"} as const;
  const body:unknown=await r.json();
  if(!body||typeof body!=="object"||!("ok" in body)||body.ok!==true||!("schema" in body)||
     body.schema!=="qf.vox.studio.simulation.v1"||!("visited" in body)||!Array.isArray(body.visited)||
     body.visited.length>50||!("mode" in body)||body.mode!=="DRY_RUN_ONLY"||
     !("workflowKey" in body)||body.workflowKey!==key)return {ok:false,status:503,error:"UNTRUSTED_SIMULATION"} as const;
  const nodes=body.visited.map((n:unknown)=>{
   const x=n&&typeof n==="object"?n as Record<string,unknown>:{};
   return {label:safeLabel(x.label,80),kind:safeLabel(x.kind,40),
    authority:safeLabel(x.authority,40)};
  });
  return {ok:true,status:200,view:{workflowKey:key,nodes,
   source:"NATIVE_DEFAULT_DEFINITION" as const,runtime:"NOT_QUERIED" as const,
   canPublish:false as const,canExecute:false as const}} as const;
 }catch{return {ok:false,status:503,error:"STUDIO_UNAVAILABLE"} as const;}
}
export async function submitScopedVendorTask(input:{vendorId:string;nonce:string;taskType:string;title:string;priority:string;dueAt:string}){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||(process.env.VOX_STAFF_VIEW_MODE!=="scoped"&&process.env.VOX_STAFF_VIEW_MODE!=="dual")||
    process.env.VOX_VENDOR_TASK_UI_ENABLED!=="staging")return {ok:false,status:503,error:"TASK_WRITE_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const r=await fetch(base+"/api/vox/v1/vendor-task",{
   method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},
   body:JSON.stringify(input),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return {ok:false,status:r.status===403?403:r.status===400?400:503,error:"CORE_TASK_REJECTED"} as const;
  const data:unknown=await r.json();
  if(!data||typeof data!=="object"||!("ok" in data)||data.ok!==true||
     !("taskId" in data)||!uid(data.taskId))return {ok:false,status:503,error:"UNTRUSTED_TASK_RESPONSE"} as const;
  return {ok:true,status:201,taskId:data.taskId,approval:"INTERNAL_TASK_ONLY" as const} as const;
 }catch{return {ok:false,status:503,error:"CORE_TASK_UNAVAILABLE"} as const;}
}

/** Owner-only review queue for non-executing operational proposals. */
export async function fetchOwnerOperationalIntents(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    (process.env.VOX_STAFF_VIEW_MODE!=="owner"&&process.env.VOX_STAFF_VIEW_MODE!=="dual")||
    process.env.VOX_OPERATIONAL_REVIEW_UI_ENABLED!=="staging")
  return {ok:false,status:503,error:"APPROVALS_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const r=await fetch(base+"/api/vox/v1/action-intents",{method:"GET",
   headers:{authorization:"Bearer "+token,accept:"application/json"},
   redirect:"error",cache:"no-store",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return {ok:false,status:r.status===403?403:503,error:"CORE_APPROVALS_UNAVAILABLE"} as const;
  const payload:unknown=await r.json();
  if(!payload||typeof payload!=="object"||!("ok" in payload)||payload.ok!==true||
     !("schema" in payload)||payload.schema!=="qf.vox.operational.intents.v1"||
     !("mode" in payload)||payload.mode!=="REVIEW_ONLY"||
     !("pending" in payload)||!Array.isArray(payload.pending)||payload.pending.length>16)
   return {ok:false,status:503,error:"INVALID_APPROVALS_SCHEMA"} as const;
  const pending=payload.pending.map((raw:unknown)=>{
   const x=raw&&typeof raw==="object"?raw as Record<string,unknown>:{};
   return {id:uid(x.id),requesterId:uid(x.requesterId),
    actionKind:safeLabel(x.actionKind,48),targetKind:safeLabel(x.targetKind,40),
    targetId:uid(x.targetId),teamId:uid(x.teamId),cityId:uid(x.cityId),
    revision:x.revision===0?0:-1,state:"PENDING" as const};
  });
  if(pending.some(x=>!x.id||!x.requesterId||!x.targetId||!x.teamId||!x.cityId||x.revision!==0))
   return {ok:false,status:503,error:"INVALID_APPROVALS_SCHEMA"} as const;
  return {ok:true,status:200,pending} as const;
 }catch{return {ok:false,status:503,error:"APPROVALS_UNAVAILABLE"} as const;}
}
export async function submitOwnerOperationalDecision(id:string,decision:"APPROVED"|"REJECTED"){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
   (process.env.VOX_STAFF_VIEW_MODE!=="owner"&&process.env.VOX_STAFF_VIEW_MODE!=="dual")||
   process.env.VOX_OPERATIONAL_REVIEW_UI_ENABLED!=="staging")return {ok:false,status:503,error:"APPROVALS_DISABLED"} as const;
 if(!uid(id)||!["APPROVED","REJECTED"].includes(decision))return {ok:false,status:400,error:"INVALID_DECISION"} as const;
 const token=await verifiedMfaSession();if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const r=await fetch(base+"/api/vox/v1/action-intents",{method:"POST",
   headers:{authorization:"Bearer "+token,"content-type":"application/json"},
   body:JSON.stringify({action:"review",intentId:id,decision,expectedRevision:0}),
   redirect:"error",cache:"no-store",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return {ok:false,status:r.status===409?409:503,error:"DECISION_REJECTED_OR_STALE"} as const;
  const x:unknown=await r.json();
  if(!x||typeof x!=="object"||!("ok" in x)||x.ok!==true||
     !("state" in x)||x.state!==decision||!("revision" in x)||x.revision!==1||
     !("execution" in x)||x.execution!=="NOT_AUTHORIZED")
   return {ok:false,status:503,error:"INVALID_DECISION_RECEIPT"} as const;
  return {ok:true,status:200,decision,execution:"NOT_AUTHORIZED" as const} as const;
 }catch{return {ok:false,status:503,error:"DECISION_UNAVAILABLE"} as const;}
}

/** Owner-only approved Aarohi internal task executions. Never sends WhatsApp. */
export async function fetchApprovedNativeFollowups(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||(process.env.VOX_STAFF_VIEW_MODE!=="owner"&&process.env.VOX_STAFF_VIEW_MODE!=="dual")||
    process.env.VOX_APPROVED_FOLLOWUP_WEB_ENABLED!=="staging")
  return {ok:false,status:503,error:"EXECUTION_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_UNAVAILABLE"} as const;
 try{
  const r=await fetch(base+"/api/vox/v1/execute-followup",{
   headers:{authorization:"Bearer "+token,accept:"application/json"},
   redirect:"error",cache:"no-store",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return {ok:false,status:r.status===403?403:503,error:"CORE_EXECUTION_QUEUE_UNAVAILABLE"} as const;
  const obj:unknown=await r.json();
  if(!obj||typeof obj!=="object"||!("ok" in obj)||obj.ok!==true||!("schema" in obj)||
     obj.schema!=="qf.vox.followup.approved.queue.v1"||!("mode" in obj)||
     obj.mode!=="EXECUTION_ELIGIBLE_ONLY"||!("pending" in obj)||!Array.isArray(obj.pending)||
     obj.pending.length>16)return {ok:false,status:503,error:"INVALID_EXECUTION_QUEUE"} as const;
  const rows=obj.pending.map((item:unknown)=>{
   const x=item&&typeof item==="object"?item as Record<string,unknown>:{};
   return {intentId:uid(x.intentId),prospectId:uid(x.prospectId),
    requesterId:uid(x.requesterId),cityId:uid(x.cityId),
    expiresAt:typeof x.expiresAt==="string"?x.expiresAt:null,revision:x.revision===1?1:-1};
  });
  if(rows.some(x=>!x.intentId||!x.prospectId||!x.requesterId||!x.cityId||x.revision!==1))
   return {ok:false,status:503,error:"INVALID_EXECUTION_QUEUE"} as const;
  return {ok:true,status:200,pending:rows} as const;
 }catch{return {ok:false,status:503,error:"EXECUTION_QUEUE_UNAVAILABLE"} as const;}
}
export async function executeApprovedNativeFollowup(intentId:string){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||(process.env.VOX_STAFF_VIEW_MODE!=="owner"&&process.env.VOX_STAFF_VIEW_MODE!=="dual")||
    process.env.VOX_APPROVED_FOLLOWUP_WEB_ENABLED!=="staging")
  return {ok:false,status:503,error:"EXECUTION_DISABLED"} as const;
 if(!uid(intentId))return {ok:false,status:400,error:"INVALID_INTENT"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_UNAVAILABLE"} as const;
 try{
  const r=await fetch(base+"/api/vox/v1/execute-followup",{
   method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},
   body:JSON.stringify({intentId,expectedRevision:1}),redirect:"error",
   cache:"no-store",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return {ok:false,status:r.status===409?409:503,error:"NOT_APPROVED_OR_STALE"} as const;
  const response:unknown=await r.json();
  if(!response||typeof response!=="object"||!("ok" in response)||response.ok!==true||
    !("taskId" in response)||!uid(response.taskId)||
    !("effect" in response)||response.effect!=="INTERNAL_FOLLOW_UP_ONLY"||
    !("externalMessagesSent" in response)||response.externalMessagesSent!==0||
    !("creditsChanged" in response)||response.creditsChanged!==0)
   return {ok:false,status:503,error:"INVALID_NATIVE_EXECUTION_RECEIPT"} as const;
  return {ok:true,status:200,taskId:response.taskId,effect:"INTERNAL_FOLLOW_UP_ONLY" as const} as const;
 }catch{return {ok:false,status:503,error:"EXECUTION_UNAVAILABLE"} as const;}
}

/** One fixed, metadata-only proposal path, never a provider or profile action. */
export async function submitScopedOperationalProposal(input:{
 actionKind:"AAROHI_FOLLOWUP"|"VENDOR_PROFILE_CHANGE"|"SUPPORT_REPLY";
 targetId:string;nonce:string;reasonCode:"INTERNAL_FOLLOWUP"|"PROFILE_REVIEW"|"SUPPORT_REVIEW";
}){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    (process.env.VOX_STAFF_VIEW_MODE!=="scoped"&&process.env.VOX_STAFF_VIEW_MODE!=="dual")||
    process.env.VOX_OPERATIONAL_PROPOSAL_UI_ENABLED!=="staging")
  return {ok:false,status:503,error:"PROPOSAL_DISABLED"} as const;
 if(!uid(input.targetId)||!uid(input.nonce))return {ok:false,status:400,error:"INVALID_REFERENCE"} as const;
 const fixed={
  AAROHI_FOLLOWUP:{reasonCode:"INTERNAL_FOLLOWUP",rationale:"Request owner review of internal Aarohi follow-up"},
  VENDOR_PROFILE_CHANGE:{reasonCode:"PROFILE_REVIEW",rationale:"Request owner review of vendor profile change"},
  SUPPORT_REPLY:{reasonCode:"SUPPORT_REVIEW",rationale:"Request owner review of vendor support response"},
 } as const;
 const kind=fixed[input.actionKind];
 if(!kind||kind.reasonCode!==input.reasonCode)
  return {ok:false,status:400,error:"INVALID_PROPOSAL_KIND"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_UNAVAILABLE"} as const;
 try{
  const response=await fetch(base+"/api/vox/v1/action-intents",{
   method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},
   body:JSON.stringify({action:"propose",intent:{
    actionKind:input.actionKind,targetId:input.targetId,nonce:input.nonce,rationale:kind.rationale,
   }}),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!response.ok)return {ok:false,status:response.status===403?403:response.status===409?409:503,
    error:"CORE_PROPOSAL_DENIED"} as const;
  const body:unknown=await response.json();
  if(!body||typeof body!=="object"||!("ok" in body)||body.ok!==true||
     !("intentId" in body)||!uid(body.intentId)||
     !("state" in body)||body.state!=="PENDING"||
     !("execution" in body)||body.execution!=="NOT_AUTHORIZED")
   return {ok:false,status:503,error:"INVALID_PROPOSAL_RECEIPT"} as const;
  return {ok:true,status:202,intentId:body.intentId,
   state:"PENDING" as const,execution:"NOT_AUTHORIZED" as const} as const;
 }catch{return {ok:false,status:503,error:"CORE_PROPOSAL_UNAVAILABLE"} as const;}
}
