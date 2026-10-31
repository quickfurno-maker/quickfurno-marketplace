import "server-only";
import {verifiedMfaSession} from "./auth";
const HOSTS=new Set(["staging-core.quickfurno.in"]);
export function origin():string|null{
 const raw=process.env.VOX_CORE_ORIGIN;
 if(!raw)return null;
 try{
  const url=new URL(raw);
  return url.protocol==="https:"&&HOSTS.has(url.hostname)&&url.port===""&&url.pathname==="/"&&url.search===""&&url.hash===""?url.origin:null;
 }catch{return null;}
}
const vendorUUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Never pass Core's raw profile request snapshots or proposed changes to Web. */
export async function fetchScopedProfileReviews(vendorId:string){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_VENDOR_PROFILE_REVIEW_UI_ENABLED!=="staging"||
    !vendorUUID.test(vendorId))return {ok:false,status:503,error:"REVIEW_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const response=await fetch(base+"/api/vox/v1/vendor-profile-review?vendorId="+encodeURIComponent(vendorId),{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!response.ok)return {ok:false,status:response.status===403?403:503,error:"CORE_REVIEW_DENIED"} as const;
  const body:unknown=await response.json();
  if(!body||typeof body!=="object"||Array.isArray(body))return {ok:false,status:503,error:"BAD_CORE_RESPONSE"} as const;
  const v=body as Record<string,unknown>;
  if(v.ok!==true||v.schema!=="qf.vox.vendor.profile.review.v1"||v.vendorId!==vendorId||
    v.mode!=="READ_ONLY"||v.actionsEnabled!==false||!Array.isArray(v.requests)||v.requests.length>20)
    return {ok:false,status:503,error:"BAD_CORE_RESPONSE"} as const;
  const requests=[] as Array<{id:string;requestType:string;status:string;createdAt:string|null;reason:string}>;
  for(const record of v.requests){
   if(!record||typeof record!=="object"||Array.isArray(record))return {ok:false,status:503,error:"BAD_CORE_RESPONSE"} as const;
   const row=record as Record<string,unknown>;
   if(!vendorUUID.test(String(row.id))||row.status!=="pending"||row.canExecute!==false||
     row.requiresNativeCoreReview!==true||
     !["profile_update","office_location_change"].includes(String(row.requestType)))
    return {ok:false,status:503,error:"BAD_CORE_RESPONSE"} as const;
   requests.push({id:String(row.id),requestType:String(row.requestType),status:"pending",
    createdAt:typeof row.createdAt==="string"&&Number.isFinite(Date.parse(row.createdAt))?row.createdAt:null,
    reason:row.requestType==="office_location_change"?"GOOGLE_PROVIDER_PROOF_REQUIRED":"CORE_ATOMIC_V3_APPROVAL_REQUIRED"});
  }
  return {ok:true,status:200,schema:"qf.vox.vendor.profile.review.v1" as const,
   mode:"READ_ONLY" as const,actionsEnabled:false as const,requests} as const;
 }catch{return {ok:false,status:503,error:"REVIEW_UNAVAILABLE"} as const;}
}


/** Finance preview BFF: Core-only read, Owner AAL2, never a payment authority. */

/** RC10 Finance: exact Owner-only order/ledger comparison, never provider reconciliation. */
/** RC11 read-only, audit-evidence-only attempt timeline. Not settlement. */
export async function fetchOwnerFinanceAttemptEvidence(orderId:string){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_FINANCE_READ_UI_ENABLED!=="staging"||
    process.env.VOX_FINANCE_DETAIL_READ_UI_ENABLED!=="staging"||
    process.env.VOX_FINANCE_ATTEMPTS_READ_UI_ENABLED!=="staging")
  return {ok:false,error:"ATTEMPT_TIMELINE_UI_DISABLED"} as const;
 if(!UUID.test(orderId))return {ok:false,error:"ORDER_ID_INVALID"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,error:"OWNER_MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const response=await fetch(base+"/api/vox/v1/finance/order/"+
   encodeURIComponent(orderId)+"/attempts",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!response.ok)return {ok:false,error:"ATTEMPT_EVIDENCE_UNAVAILABLE"} as const;
  const raw:unknown=await response.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return {ok:false,error:"ATTEMPT_EVIDENCE_UNTRUSTED"} as const;
  const x=raw as Record<string,unknown>;
  if(x.ok!==true||x.schema!=="qf.vox.finance.attempt-evidence.v1"||
    x.readOnly!==true||x.isCompleteHistory!==false||
    x.isProviderSettlementVerified!==false||x.canReconcile!==false||
    x.canRefund!==false||x.canActivateCredits!==false||
    !Array.isArray(x.events)||x.events.length>50||x.eventCount!==x.events.length)
   return {ok:false,error:"ATTEMPT_EVIDENCE_UNTRUSTED"} as const;
  const allowedKinds=["REQUESTED","PROVIDER_RESPONSE_RECEIVED","PROVIDER_ERROR",
   "TIMEOUT_UNCERTAIN","RECONCILIATION_PENDING","RECONCILIATION_OBSERVED"];
  const allowedOrigin=["CORE_CHECKOUT","WEBHOOK_RECOVERY",
   "SCHEDULED_RECONCILIATION","AUTHORIZED_OPERATOR"];
  const events=[] as Array<{attemptRef:string;sequence:number;environment:string;
   eventKind:string;origin:string;observedAt:string;recordedAt:string}>;
  for(const row of x.events){
   if(!row||typeof row!=="object"||Array.isArray(row))
    return {ok:false,error:"ATTEMPT_EVIDENCE_UNTRUSTED"} as const;
   const e=row as Record<string,unknown>;
   if(typeof e.attemptRef!=="string"||!/^ATTEMPT-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(e.attemptRef)||
     !Number.isSafeInteger(e.sequence)||(e.sequence as number)<1||
     (e.sequence as number)>1000||!["TEST","LIVE"].includes(String(e.environment))||
     !allowedKinds.includes(String(e.eventKind))||
     !allowedOrigin.includes(String(e.origin))||
     typeof e.observedAt!=="string"||!Number.isFinite(Date.parse(e.observedAt))||
     typeof e.recordedAt!=="string"||!Number.isFinite(Date.parse(e.recordedAt)))
    return {ok:false,error:"ATTEMPT_EVIDENCE_UNTRUSTED"} as const;
   events.push({attemptRef:e.attemptRef,sequence:e.sequence as number,
    environment:String(e.environment),eventKind:String(e.eventKind),
    origin:String(e.origin),observedAt:e.observedAt,recordedAt:e.recordedAt});
  }
  return {ok:true,events,eventCount:events.length,
   providerConfirmed:false,isCompleteHistory:false} as const;
 }catch{return {ok:false,error:"ATTEMPT_EVIDENCE_UNAVAILABLE"} as const;}
}

export async function fetchOwnerFinanceOrderDetail(orderId:string){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_FINANCE_READ_UI_ENABLED!=="staging"||
    process.env.VOX_FINANCE_DETAIL_READ_UI_ENABLED!=="staging")
  return {ok:false,status:503,error:"FINANCE_DETAIL_UI_DISABLED"} as const;
 if(!UUID.test(orderId))return {ok:false,status:400,error:"INVALID_ORDER_ID"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const response=await fetch(base+"/api/vox/v1/finance/order/"+encodeURIComponent(orderId),{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  // Core 401 = Owner session/AAL2 rejected: recoverable by signing in again.
  if(!response.ok)return response.status===401
   ?{ok:false,status:401,error:"MFA_REQUIRED"} as const
   :{ok:false,status:response.status===403?403:503,error:"CORE_FINANCE_DETAIL_UNAVAILABLE"} as const;
  const raw:unknown=await response.json();
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return {ok:false,status:503,error:"FINANCE_DETAIL_UNTRUSTED"} as const;
  const payload=raw as Record<string,unknown>;
  if(payload.ok!==true||payload.schema!=="qf.vox.finance.order-detail.v1"||
     payload.mode!=="READ_ONLY"||!payload.detail||
     typeof payload.detail!=="object"||Array.isArray(payload.detail))
   return {ok:false,status:503,error:"FINANCE_DETAIL_UNTRUSTED"} as const;
  const detail=payload.detail as Record<string,unknown>;
  if(detail.providerConfirmed!==false||detail.isAttemptHistoryComplete!==false||
     detail.canRefund!==false||detail.canCapture!==false||detail.canGrantCredits!==false||
     typeof detail.ledgerStatus!=="string"||
     !["CORE_RECORDS_AGREE","NO_CORRELATED_PAYMENT_RECORD"].includes(detail.ledgerStatus)||
     !detail.order||typeof detail.order!=="object"||Array.isArray(detail.order))
   return {ok:false,status:503,error:"FINANCE_DETAIL_UNTRUSTED"} as const;
  const order=detail.order as Record<string,unknown>;
  if(order.orderId!==orderId||order.currency!=="INR"||
     typeof order.vendorRef!=="string"||!/^VENDOR-[0-9a-f]{8}$/i.test(order.vendorRef)||
     (order.recordedOrderAmount!==null&&
      (typeof order.recordedOrderAmount!=="number"||
       !Number.isFinite(order.recordedOrderAmount)||order.recordedOrderAmount<0))||
     !["created","completed","cancelled","expired"].includes(String(order.orderStatus))||
     !["not_started","pending","paid","failed","refunded"].includes(String(order.paymentStatus))||
     !["not_activated","activated","failed"].includes(String(order.activationStatus))||
     typeof order.createdAt!=="string"||!Number.isFinite(Date.parse(order.createdAt)))
   return {ok:false,status:503,error:"FINANCE_DETAIL_UNTRUSTED"} as const;
  let ledger:null|{recordedPaymentId:string;recordedAmount:number;
   recordedStatus:string;recordedAt:string}=null;
  if(detail.ledger!==null){
   const entry=detail.ledger as Record<string,unknown>;
   if(!entry||typeof entry!=="object"||Array.isArray(entry)||
      entry.recordedPaymentId!==orderId||
      typeof entry.recordedAmount!=="number"||!Number.isFinite(entry.recordedAmount)||
      entry.recordedAmount<0||
      !["Pending","Paid","Failed","Refunded"].includes(String(entry.recordedStatus))||
      typeof entry.recordedAt!=="string"||!Number.isFinite(Date.parse(entry.recordedAt))||
      detail.ledgerStatus!=="CORE_RECORDS_AGREE")
    return {ok:false,status:503,error:"FINANCE_DETAIL_UNTRUSTED"} as const;
   ledger={recordedPaymentId:orderId,recordedAmount:entry.recordedAmount as number,
    recordedStatus:String(entry.recordedStatus),recordedAt:entry.recordedAt as string};
  }else if(detail.ledgerStatus!=="NO_CORRELATED_PAYMENT_RECORD")
   return {ok:false,status:503,error:"FINANCE_DETAIL_UNTRUSTED"} as const;
  return {ok:true,status:200,order:{
   orderId:orderId,vendorRef:order.vendorRef,
   recordedOrderAmount:order.recordedOrderAmount as number|null,
   orderStatus:String(order.orderStatus),paymentStatus:String(order.paymentStatus),
   activationStatus:String(order.activationStatus),createdAt:order.createdAt as string
  },ledger,ledgerStatus:detail.ledgerStatus} as const;
 }catch{return {ok:false,status:503,error:"FINANCE_DETAIL_UNAVAILABLE"} as const;}
}

export async function fetchOwnerFinancePreview(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_FINANCE_READ_UI_ENABLED!=="staging")
  return {ok:false,status:503,error:"FINANCE_UI_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const r=await fetch(base+"/api/vox/v1/finance",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return r.status===401
   ?{ok:false,status:401,error:"MFA_REQUIRED"} as const
   :{ok:false,status:r.status===403?403:503,error:"CORE_FINANCE_UNAVAILABLE"} as const;
  const payload:unknown=await r.json();
  if(!payload||typeof payload!=="object"||Array.isArray(payload))
   return {ok:false,status:503,error:"UNTRUSTED_FINANCE_RESPONSE"} as const;
  const v=payload as Record<string,unknown>;
  if(v.ok!==true||v.schema!=="qf.vox.finance.order-preview.v1"||
     v.mode!=="READ_ONLY"||v.source!=="vendor_package_orders"||
     v.canRefund!==false||v.canReconcile!==false||
     v.canActivatePayments!==false||v.hasProviderConfirmation!==false||
     v.isCompleteHistory!==false||!Array.isArray(v.orders)||v.orders.length>20)
   return {ok:false,status:503,error:"UNTRUSTED_FINANCE_RESPONSE"} as const;
  const orders=[] as Array<{orderId:string;vendorRef:string;currency:"INR";
   recordedOrderAmount:number|null;creditsIncluded:number|null;
   orderStatus:string;paymentStatus:string;activationStatus:string;createdAt:string}>;
  const status=new Set(["not_started","pending","paid","failed","refunded"]);
  const activation=new Set(["not_activated","activated","failed"]);
  const orderState=new Set(["created","completed","cancelled","expired"]);
  for(const raw of v.orders){
   if(!raw||typeof raw!=="object"||Array.isArray(raw))
    return {ok:false,status:503,error:"UNTRUSTED_FINANCE_RESPONSE"} as const;
   const row=raw as Record<string,unknown>;
   if(typeof row.orderId!=="string"||!UUID.test(row.orderId)||
      typeof row.vendorRef!=="string"||!/^VENDOR-[a-f0-9]{8}$/i.test(row.vendorRef)||
      row.currency!=="INR"||!status.has(String(row.paymentStatus))||
      !activation.has(String(row.activationStatus))||
      !orderState.has(String(row.orderStatus))||
      (row.recordedOrderAmount!==null&&
        (typeof row.recordedOrderAmount!=="number"||!Number.isFinite(row.recordedOrderAmount)||
         row.recordedOrderAmount<0||row.recordedOrderAmount>1e12))||
      (row.creditsIncluded!==null&&
        (!Number.isSafeInteger(row.creditsIncluded)||Number(row.creditsIncluded)<0))||
      typeof row.createdAt!=="string"||!Number.isFinite(Date.parse(row.createdAt)))
    return {ok:false,status:503,error:"UNTRUSTED_FINANCE_RESPONSE"} as const;
   orders.push({orderId:row.orderId,vendorRef:row.vendorRef,currency:"INR",
    recordedOrderAmount:row.recordedOrderAmount as number|null,
    creditsIncluded:row.creditsIncluded as number|null,
    orderStatus:String(row.orderStatus),paymentStatus:String(row.paymentStatus),
    activationStatus:String(row.activationStatus),createdAt:row.createdAt});
  }
  return {ok:true,status:200,orders,mode:"READ_ONLY" as const,
   isCompleteHistory:false as const,providerReconciled:false as const} as const;
 }catch{return {ok:false,status:503,error:"FINANCE_UNAVAILABLE"} as const;}
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
  if(!r.ok)return r.status===401
   ?{ok:false,status:401,error:"MFA_REQUIRED"} as const
   :{ok:false,status:r.status===403?403:503,error:"STAFF_DESK_UNAVAILABLE"} as const;
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
  if(!r.ok)return r.status===401
   ?{ok:false,status:401,error:"MFA_REQUIRED"} as const
   :{ok:false,status:r.status===403?403:503,error:"CORE_SCOPE_DENIED_OR_UNAVAILABLE"} as const;
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
  if(r.status===401)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
  if(!r.ok)return {ok:false,status:r.status===403?403:r.status===400?400:r.status===409?409:503,
   error:r.status===409?"CORE_TASK_IDEMPOTENCY_CONFLICT":"CORE_TASK_REJECTED"} as const;
  const data:unknown=await r.json();
  if(!data||typeof data!=="object"||!("ok" in data)||data.ok!==true||
     !("taskId" in data)||!uid(data.taskId))return {ok:false,status:503,error:"UNTRUSTED_TASK_RESPONSE"} as const;
  // Core: 201 created, 200 exact replay. Only those two are valid receipts.
  if(r.status!==200&&r.status!==201)return {ok:false,status:503,error:"UNTRUSTED_TASK_RESPONSE"} as const;
  return {ok:true,status:r.status,taskId:data.taskId,created:r.status===201,
   approval:"INTERNAL_TASK_ONLY" as const} as const;
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
/** Scope-filtered staff proposal; an owner must independently review, then execute. */
export async function proposeAarohiInternalFollowup(input:{targetId:string;nonce:string;rationale:string}){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_STAFF_VIEW_MODE!=="scoped"||
    process.env.VOX_FOLLOWUP_PROPOSALS_WEB_ENABLED!=="staging")
  return {ok:false,status:503,error:"PROPOSALS_DISABLED"} as const;
 if(!uid(input.targetId)||!uid(input.nonce)||input.rationale.length<12||
    input.rationale.length>300)return {ok:false,status:400,error:"INVALID_PROPOSAL"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();
 if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const response=await fetch(base+"/api/vox/v1/action-intents",{
   method:"POST",
   headers:{authorization:"Bearer "+token,"content-type":"application/json"},
   body:JSON.stringify({action:"propose",intent:{
    actionKind:"AAROHI_FOLLOWUP",targetId:input.targetId,
    nonce:input.nonce,rationale:input.rationale
   }}),
   redirect:"error",cache:"no-store",signal:AbortSignal.timeout(3500)
  });
  if(!response.ok)return {ok:false,
   status:response.status===403?403:response.status===400?400:503,
   error:"CORE_PROPOSAL_REJECTED"} as const;
  const payload:unknown=await response.json();
  if(!payload||typeof payload!=="object"||!("ok" in payload)||payload.ok!==true||
    !("intentId" in payload)||!uid(payload.intentId)||
    !("state" in payload)||payload.state!=="PENDING"||
    !("execution" in payload)||payload.execution!=="NOT_AUTHORIZED")
   return {ok:false,status:503,error:"INVALID_PROPOSAL_RECEIPT"} as const;
  return {ok:true,status:202,intentId:payload.intentId,
   state:"PENDING" as const,execution:"NOT_AUTHORIZED" as const} as const;
 }catch{return {ok:false,status:503,error:"PROPOSAL_UNAVAILABLE"} as const;}
}

/** Scoped internal support task; never forwards message text, provider actions, or a vendor ID. */
export async function submitScopedSupportTask(input:{threadId:string;nonce:string;priority:string;dueAt:string}){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
  (process.env.VOX_STAFF_VIEW_MODE!=="scoped"&&process.env.VOX_STAFF_VIEW_MODE!=="dual")||
  process.env.VOX_SUPPORT_TASK_UI_ENABLED!=="staging")
  return {ok:false,status:503,error:"SUPPORT_TASK_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const r=await fetch(base+"/api/vox/v1/support-task",{method:"POST",
   headers:{authorization:"Bearer "+token,"content-type":"application/json"},
   body:JSON.stringify(input),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return {ok:false,status:r.status===403?403:r.status===400?400:503,error:"CORE_SUPPORT_TASK_DENIED"} as const;
  const data:unknown=await r.json();
  if(!data||typeof data!=="object"||!("ok" in data)||data.ok!==true||
   !("taskId" in data)||!uid(data.taskId)||
   !("threadId" in data)||data.threadId!==input.threadId||
   !("effect" in data)||data.effect!=="INTERNAL_SUPPORT_TASK_ONLY"||
   !("providerMessagesSent" in data)||data.providerMessagesSent!==0)
   return {ok:false,status:503,error:"INVALID_NATIVE_TASK_RECEIPT"} as const;
  return {ok:true,status:201,taskId:data.taskId,effect:"INTERNAL_SUPPORT_TASK_ONLY" as const} as const;
 }catch{return {ok:false,status:503,error:"CORE_SUPPORT_TASK_UNAVAILABLE"} as const;}
}

/**
 * TO-02: display-only department catalogue, retrieved from Core under its
 * existing OWNER/Superadmin AAL2 verification. No Auth Admin, grants or invites.
 */
export async function fetchAdminStaffCapabilityCatalog(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
    process.env.VOX_MULTI_DEPARTMENT_UI_ENABLED!=="staging"||
    !["owner","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE)))
  return {ok:false,status:503,error:"STAFF_SETUP_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();
 if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const response=await fetch(base+"/api/vox/v1/staff-capability-catalog",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!response.ok)return {ok:false,status:response.status===403?403:503,error:"OWNER_PERMISSION_REQUIRED"} as const;
  const body:unknown=await response.json();
  if(!body||typeof body!=="object"||Array.isArray(body))return {ok:false,status:503,error:"BAD_CORE_SCHEMA"} as const;
  const x=body as Record<string,unknown>;
  if(x.ok!==true||x.schema!=="qf.vox.staff.department.catalog.v1"||
     x.mode!=="READ_ONLY"||x.owner!=="quickfurno-core"||
     x.canInvite!==false||x.canActivate!==false||
     x.requiresSeparateReview!==true||x.requiresObjectScopes!==true||
     !Array.isArray(x.capabilities)||x.capabilities.length!==4)
    return {ok:false,status:503,error:"BAD_CORE_SCHEMA"} as const;
  const wanted=new Set(["client_success","vendor_success","acquisition","service_support"]);
  const packs=[] as Array<{key:string;label:string}>;
  for(const raw of x.capabilities){
   if(!raw||typeof raw!=="object"||Array.isArray(raw))return {ok:false,status:503,error:"BAD_CORE_PACK"} as const;
   const v=raw as Record<string,unknown>;
   if(typeof v.key!=="string"||!wanted.has(v.key)||packs.some(p=>p.key===v.key)||
      typeof v.label!=="string"||v.label.length<4||v.label.length>80)
    return {ok:false,status:503,error:"BAD_CORE_PACK"} as const;
   packs.push({key:v.key,label:v.label});
  }
  if(packs.length!==4)return {ok:false,status:503,error:"MISSING_PACK"} as const;
  return {ok:true,status:200,mode:"READ_ONLY" as const,capabilities:packs} as const;
 }catch{return {ok:false,status:503,error:"CORE_UNAVAILABLE"} as const;}
}

/**
 * TO-02B: masked staff directory. Core owner-only AAL2 verified on EVERY GET.
 * Never ship staff emails, phones, Auth users, metadata, raw grants or tokens.
 */
export async function fetchAdminStaffDirectory(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
    process.env.VOX_MULTI_DEPARTMENT_UI_ENABLED!=="staging"||
    process.env.VOX_ADMIN_STAFF_DIRECTORY_UI_ENABLED!=="staging"||
    !["owner","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE)))
  return {ok:false,status:503,error:"STAFF_DIRECTORY_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();
 if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const response=await fetch(base+"/api/vox/v1/staff-directory",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!response.ok)return {ok:false,status:response.status===403?403:503,error:"CORE_OWNER_DIRECTORY_DENIED"} as const;
  const body:unknown=await response.json();
  if(!body||typeof body!=="object"||Array.isArray(body))
   return {ok:false,status:503,error:"BAD_DIRECTORY_SCHEMA"} as const;
  const v=body as Record<string,unknown>;
  if(v.ok!==true||v.schema!=="qf.vox.staff.directory.preview.v1"||
     v.source!=="quickfurno-core"||v.mode!=="READ_ONLY"||
     v.actionsEnabled!==false||v.totalKnown!==false||
     !Number.isSafeInteger(v.previewCount)||typeof v.previewCount!=="number"||
     v.previewCount<0||v.previewCount>40||!Array.isArray(v.members)||
     v.members.length!==v.previewCount)
    return {ok:false,status:503,error:"BAD_DIRECTORY_SCHEMA"} as const;
  const allowedRoles=new Set(["operations_manager","acquisition_agent","vendor_success_agent","support_agent","team_leader","auditor"]);
  const reference=/^(?:STAFF|TEAM|CITY)-[0-9a-f]{8}$/i;
  const rows=[] as Array<{staffRef:string;teamRef:string;cityRef:string;role:string;
    state:"ACTIVE"|"SUSPENDED_OR_EXPIRED";expiresAt:string}>;
  for(const m of v.members){
   if(!m||typeof m!=="object"||Array.isArray(m))
    return {ok:false,status:503,error:"BAD_DIRECTORY_MEMBER"} as const;
   const x=m as Record<string,unknown>;
   if(typeof x.staffRef!=="string"||!reference.test(x.staffRef)||
      !x.staffRef.startsWith("STAFF-")||typeof x.teamRef!=="string"||
      !x.teamRef.startsWith("TEAM-")||!reference.test(x.teamRef)||
      typeof x.cityRef!=="string"||!x.cityRef.startsWith("CITY-")||
      !reference.test(x.cityRef)||typeof x.staffRole!=="string"||
      !allowedRoles.has(x.staffRole)||!["ACTIVE","SUSPENDED_OR_EXPIRED"].includes(String(x.state))||
      typeof x.expiresAt!=="string"||x.expiresAt.length>40||
      !Number.isFinite(Date.parse(x.expiresAt)))
    return {ok:false,status:503,error:"BAD_DIRECTORY_MEMBER"} as const;
   rows.push({staffRef:x.staffRef,teamRef:x.teamRef,cityRef:x.cityRef,
    role:x.staffRole,state:x.state as "ACTIVE"|"SUSPENDED_OR_EXPIRED",expiresAt:x.expiresAt});
  }
  return {ok:true,status:200,mode:"READ_ONLY" as const,
    members:rows,previewCount:rows.length,totalKnown:false as const} as const;
 }catch{return {ok:false,status:503,error:"DIRECTORY_UNAVAILABLE"} as const;}
}


/** TO-02E protected, private team/city options for a NON-SAVING staff setup. */
export async function fetchAdminStaffTeamOptions(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_TEAM_WORKSPACE_ENABLED!=="staging"||
    process.env.VOX_MULTI_DEPARTMENT_UI_ENABLED!=="staging"||
    process.env.VOX_ADMIN_STAFF_TEAM_PICKER_UI_ENABLED!=="staging"||
    !["owner","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE)))
  return {ok:false,status:503,error:"STAFF_TEAM_PICKER_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();
 if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const response=await fetch(base+"/api/vox/v1/staff-team-options",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   redirect:"error",cache:"no-store",signal:AbortSignal.timeout(3500)});
  if(!response.ok)return {ok:false,
   status:response.status===403?403:503,error:"CORE_TEAM_OPTIONS_DENIED"} as const;
  const body:unknown=await response.json();
  if(!body||typeof body!=="object"||Array.isArray(body))
   return {ok:false,status:503,error:"INVALID_CORE_TEAMS"} as const;
  const x=body as Record<string,unknown>;
  if(x.ok!==true||x.schema!=="qf.vox.staff.team-options.v1"||
     x.mode!=="READ_ONLY"||x.actionsEnabled!==false||x.totalKnown!==false||
     !Array.isArray(x.items)||x.items.length>40||
     !Number.isInteger(x.previewCount)||x.previewCount!==x.items.length)
   return {ok:false,status:503,error:"INVALID_CORE_TEAMS"} as const;
  const seen=new Set<string>();
  const items:Array<{teamId:string;cityId:string}>=[];
  for(const raw of x.items){
   if(!raw||typeof raw!=="object"||Array.isArray(raw))
    return {ok:false,status:503,error:"INVALID_CORE_TEAM_ROW"} as const;
   const row=raw as Record<string,unknown>;
   if(typeof row.teamId!=="string"||!UUID.test(row.teamId)||
      typeof row.cityId!=="string"||!UUID.test(row.cityId)||
      seen.has(row.teamId))
    return {ok:false,status:503,error:"INVALID_CORE_TEAM_ROW"} as const;
   seen.add(row.teamId);
   items.push({teamId:row.teamId,cityId:row.cityId});
  }
  return {ok:true,status:200,items,mode:"READ_ONLY" as const} as const;
 }catch{return {ok:false,status:503,error:"CORE_TEAM_OPTIONS_UNAVAILABLE"} as const;}
}


/** VOX TO-04B read-only staff queue through the EXISTING Supabase AAL2 session.
 * The Core route independently revalidates reviewed department, current TL,
 * team/city, exact object grants, source city and assignment.
 * Never trust an unverified/overlarge response, and NEVER expose provider data.
 */
export async function fetchStaffWorkQueuePreview(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_STAFF_VIEW_MODE!=="scoped"&&
    process.env.VOX_STAFF_VIEW_MODE!=="dual"||
    process.env.VOX_WORK_QUEUE_UI_ENABLED!=="staging")
  return {ok:false,status:503,error:"STAFF_QUEUE_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();
 if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const response=await fetch(base+"/api/vox/v1/work-queue",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   redirect:"error",cache:"no-store",signal:AbortSignal.timeout(3500)});
  // Core 401 = Staff session/AAL2 rejected: surface 401 (no body forwarded)
  // so the UI offers sign-in instead of a dead-end 503.
  if(!response.ok)return {ok:false,
   status:response.status===401?401:response.status===403?403:503,
   error:response.status===401?"MFA_REQUIRED":"CORE_STAFF_SCOPE_DENIED_OR_UNAVAILABLE"} as const;
  const data:unknown=await response.json();
  if(!data||typeof data!=="object"||Array.isArray(data))
   return {ok:false,status:503,error:"INVALID_QUEUE_SCHEMA"} as const;
  const v=data as Record<string,unknown>;
  if(Object.keys(v).sort().join("|")!==
     ["actionsEnabled","boundedWindow","completeness","items","mode","ok","schema"].sort().join("|")||
    v.ok!==true||v.schema!=="qf.vox.work.queue.preview.v1"||
    v.actionsEnabled!==false||v.mode!=="READ_ONLY"||
    v.boundedWindow!==true||v.completeness!=="BOUNDED_NOT_TOTAL"||
    !Array.isArray(v.items)||v.items.length>25)
   return {ok:false,status:503,error:"INVALID_QUEUE_SCHEMA"} as const;
  const uu=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const permittedKinds=new Set(["prospect","vendor","support_thread"]);
  const permittedStates=new Set(["NEW","ASSIGNED","IN_PROGRESS",
   "WAITING_EXTERNAL","WAITING_APPROVAL","BLOCKED","DONE"]);
  const seen=new Set<string>();
  const items:Array<{workItemId:string;kind:string;state:string;revision:number;
    updatedAt:string;assignedToMe:boolean}>=[];
  for(const raw of v.items){
   if(!raw||typeof raw!=="object"||Array.isArray(raw))
    return {ok:false,status:503,error:"INVALID_QUEUE_ITEM"} as const;
   const item=raw as Record<string,unknown>;
   if(Object.keys(item).sort().join("|")!==
      ["assignedToMe","canClaim","canTransition","kind","revision","state","updatedAt","workItemId"].sort().join("|")||
      typeof item.workItemId!=="string"||!uu.test(item.workItemId)||
      seen.has(item.workItemId)||!permittedKinds.has(String(item.kind))||
      !permittedStates.has(String(item.state))||
      !Number.isSafeInteger(item.revision)||(item.revision as number)<0||
      typeof item.updatedAt!=="string"||
      !Number.isFinite(Date.parse(item.updatedAt))||
      item.canClaim!==false||item.canTransition!==false||
      typeof item.assignedToMe!=="boolean")
    return {ok:false,status:503,error:"INVALID_QUEUE_ITEM"} as const;
   seen.add(item.workItemId);
   items.push({workItemId:item.workItemId,kind:String(item.kind),
    state:String(item.state),revision:item.revision as number,
    updatedAt:item.updatedAt,assignedToMe:item.assignedToMe});
  }
  return {ok:true,status:200,mode:"READ_ONLY" as const,items,
   completeness:"BOUNDED_NOT_TOTAL" as const} as const;
 }catch{return {ok:false,status:503,error:"CORE_QUEUE_UNAVAILABLE"} as const;}
}

/** Owner AAL2 read-only preview of quarantined refund intake events. Core
 * independently re-verifies Owner AAL2 and its own feature gates. Provider
 * payment/order IDs are dropped here: the Web page only needs status. */
export async function fetchOwnerRefundIntakePreview(){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging"||
    process.env.VOX_FINANCE_READ_UI_ENABLED!=="staging"||
    process.env.VOX_FINANCE_REFUND_REVIEW_PREVIEW_UI_ENABLED!=="staging")
  return {ok:false,status:503,error:"REFUND_REVIEW_UI_DISABLED"} as const;
 const token=await verifiedMfaSession();
 if(!token)return {ok:false,status:401,error:"MFA_REQUIRED"} as const;
 const base=origin();if(!base)return {ok:false,status:503,error:"CORE_NOT_CONFIGURED"} as const;
 try{
  const r=await fetch(base+"/api/vox/v1/finance/refund-intake",{
   method:"GET",headers:{authorization:"Bearer "+token,accept:"application/json"},
   cache:"no-store",redirect:"error",signal:AbortSignal.timeout(3500)});
  if(!r.ok)return r.status===401
   ?{ok:false,status:401,error:"MFA_REQUIRED"} as const
   :{ok:false,status:r.status===403?403:503,error:"CORE_REFUND_REVIEW_UNAVAILABLE"} as const;
  const payload:unknown=await r.json();
  if(!payload||typeof payload!=="object"||Array.isArray(payload))
   return {ok:false,status:503,error:"UNTRUSTED_REFUND_RESPONSE"} as const;
  const v=payload as Record<string,unknown>;
  if(v.ok!==true||v.schema!=="qf.vox.finance.refund-intake-preview.v1"||
     v.mode!=="READ_ONLY"||v.canReview!==false||v.canRefund!==false||
     v.canRevokeCredits!==false||v.isCompleteHistory!==false||
     !Array.isArray(v.events)||v.events.length>20||v.previewCount!==v.events.length)
   return {ok:false,status:503,error:"UNTRUSTED_REFUND_RESPONSE"} as const;
  const events=[] as Array<{eventRef:string;providerMode:"test"|"live";
   eventType:"refund.created"|"refund.processed"|"refund.failed"}>;
  for(const raw of v.events){
   if(!raw||typeof raw!=="object"||Array.isArray(raw))
    return {ok:false,status:503,error:"UNTRUSTED_REFUND_RESPONSE"} as const;
   const e=raw as Record<string,unknown>;
   if(typeof e.eventId!=="string"||!/^[A-Za-z0-9_-]{8,64}$/.test(e.eventId)||
      !["test","live"].includes(String(e.providerMode))||
      !["refund.created","refund.processed","refund.failed"].includes(String(e.eventType)))
    return {ok:false,status:503,error:"UNTRUSTED_REFUND_RESPONSE"} as const;
   events.push({eventRef:e.eventId.slice(0,8),providerMode:e.providerMode as "test"|"live",
    eventType:e.eventType as "refund.created"|"refund.processed"|"refund.failed"});
  }
  return {ok:true,status:200,events,mode:"READ_ONLY" as const,
   isCompleteHistory:false as const} as const;
 }catch{return {ok:false,status:503,error:"REFUND_REVIEW_UNAVAILABLE"} as const;}
}
