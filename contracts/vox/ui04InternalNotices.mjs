/**
 * UI-04 T4: strictly bounded internal notification view.
 * No push/Webhook/WhatsApp dispatcher or acknowledgement mutation.
 */
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid=x=>typeof x==="string"&&ID.test(x);
const deny=reason=>Object.freeze({ok:false,reason,items:[],
 canAcknowledge:false,pushDeliveriesVerified:0,providerMessagesSent:0});
const types=["WORK_ASSIGNED","WORK_CHANGED","STAFF_REVIEW_REQUIRED",
 "CLIENT_HANDOVER","SUPPORT_ESCALATION","EOD_REVIEW_REQUIRED"];
const severity=["INFO","ACTION","URGENT"];
export async function projectVerifiedInternalNoticeList({
 scope,rows,verifyCurrentScope,verifyPersistedNotice,now=Date.now()
}={}){
 if(!scope||!uuid(scope.userId)||!uuid(scope.cityId)||!uuid(scope.teamId)||
  scope.currentAal!=="aal2"||scope.canReadContent!==true||
  scope.canMutate!==false||!Array.isArray(rows)||rows.length>30||
  typeof verifyCurrentScope!=="function"||
  typeof verifyPersistedNotice!=="function"||
  !Number.isSafeInteger(now)||now<=0)
  return deny("CURRENT_STAFF_NOTIFICATION_SCOPE_REQUIRED");
 try{
  if(await verifyCurrentScope(scope)!==true)
   return deny("NOTIFICATION_SCOPE_REVOKED");
  const seen=new Set(),items=[];
  for(const n of rows){
   if(!n||typeof n!=="object"||Array.isArray(n)||
    Object.keys(n).sort().join("|")!==
     ["id","recipientId","cityId","teamId","workItemId","type",
      "severity","createdAt","expiresAt","revision","state"].sort().join("|")||
    ![n.id,n.recipientId,n.cityId,n.teamId,n.workItemId].every(uuid)||
    n.recipientId!==scope.userId||n.cityId!==scope.cityId||
    n.teamId!==scope.teamId||!types.includes(n.type)||
    !severity.includes(n.severity)||!["UNREAD","READ"].includes(n.state)||
    !Number.isSafeInteger(n.revision)||n.revision<0||
    typeof n.createdAt!=="string"||typeof n.expiresAt!=="string"||
    !Number.isFinite(Date.parse(n.createdAt))||
    !Number.isFinite(Date.parse(n.expiresAt))||
    Date.parse(n.createdAt)>now+30000||
    Date.parse(n.expiresAt)<=now||seen.has(n.id))
    return deny("INVALID_INTERNAL_NOTICE_PROVENANCE");
   if(await verifyPersistedNotice({scope,notice:n})!==true)
    return deny("PERSISTED_NOTICE_NOT_VERIFIED");
   seen.add(n.id);
   items.push(Object.freeze({id:n.id,workItemId:n.workItemId,
    kind:n.type,urgency:n.severity,state:n.state,createdAt:n.createdAt,
    canAcknowledge:false,canReply:false,canSend:false}));
  }
  items.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||
   a.id.localeCompare(b.id));
  return Object.freeze({ok:true,schema:"qf.vox.ui04.internal-notice.preview.v1",
   mode:"READ_ONLY",items:Object.freeze(items),
   completeness:"BOUNDED_NOT_TOTAL",canAcknowledge:false,
   pushDeliveriesVerified:0,providerMessagesSent:0});
 }catch{return deny("NOTIFICATION_SOURCE_UNAVAILABLE");}
}
export function classifyInternalOutboxOutcome(result){
 const bad=reason=>Object.freeze({ok:false,reason,
  requiresOwnerReview:true,externalMessagesSent:0});
 if(!result||typeof result!=="object"||
  result.totalExternalMessagesSent!==0||result.source!=="CORE_ONLY"||
  !Number.isSafeInteger(result.jobsDeadLettered)||
  !Number.isSafeInteger(result.jobsRetried)||
  result.jobsDeadLettered<0||result.jobsRetried<0)return bad("UNVERIFIED_OUTBOX_RESULT");
 if(result.ok!==true||result.requiresOwnerAlert===true||
  result.jobsDeadLettered>0)return bad("OWNER_REVIEW_REQUIRED");
 return Object.freeze({ok:true,reason:"INTERNAL_ONLY_NO_SEND",
  requiresOwnerReview:false,externalMessagesSent:0});
}
