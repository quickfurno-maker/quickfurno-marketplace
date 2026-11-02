import "server-only";
import {adjudicateConsumedCreditRefundEvidence}
 from "@/lib/payments/vendorPackageConsumedCreditRefundAdjudication.mjs";
import type {VerifiedFinanceReviewer} from "@/lib/payments/vendorPackageRefundReviewAuthority.mjs";
/** RC41 Finance: READ-ONLY per-refund case review handler. SOURCE-ONLY, default OFF.
 * Composes a durable HMAC refund identity, the provider event, the order/payment
 * identity and the exact vendor credit ledger with a verified AAL2 reviewer through
 * the rc40 adjudicator. It can never refund, grant/revoke credits or call a
 * provider; the reviewer comes only from the injected verifier, never the caller. */
const MODE=/^(test|live)$/;
const EVENT_ID=/^[A-Za-z0-9_-]{8,64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^[a-f0-9]{64}$/;
const PAY=/^pay_[A-Za-z0-9]{4,64}$/;
const ORDER=/^order_[A-Za-z0-9]{4,64}$/;
const MAX_DEBITS=10000;
export const REFUND_CASE_GATES=["VOX_FINANCE_REFUND_CASE_REVIEW_ENABLED","VOX_FINANCE_READ_ENABLED",
 "VOX_STAFF_READ_ENABLED","VOX_STAFF_GRANTS_ENABLED"] as const;
export type RefundCaseSnapshot=Readonly<{event:unknown;identity:unknown;order:unknown;ledger:unknown}>;
export type RefundCaseDeps=Readonly<{
 verifyReviewer:(authorization:string|null)=>Promise<VerifiedFinanceReviewer|null>;
 loadSnapshot:(eventId:string,providerMode:"test"|"live")=>Promise<RefundCaseSnapshot|null>;
 macKey:()=>string|undefined;
 approvedRoles?:readonly string[];
 now?:()=>number;
 env?:Readonly<Record<string,string|undefined>>;
}>;
const reply=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"}});
const obj=(x:unknown):x is Record<string,unknown>=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const exact=(o:unknown,keys:string[]):o is Record<string,unknown>=>
 obj(o)&&Object.keys(o).sort().join("|")===[...keys].sort().join("|");
const str=(x:unknown,re:RegExp):x is string=>typeof x==="string"&&re.test(x);
const sameReviewer=(a:VerifiedFinanceReviewer,b:VerifiedFinanceReviewer|null)=>
 !!b&&a.userId===b.userId&&a.staffRole===b.staffRole&&a.teamId===b.teamId&&
 a.cityId===b.cityId&&a.expiresAtMs===b.expiresAtMs;
const ADJUDICATION_STATUS:Record<string,number>={
 FINANCE_REVIEW_ROLE_NOT_CANONICAL:403,FINANCE_REVIEWER_NOT_VERIFIED:403,
 FINANCE_REVIEWER_SESSION_INVALID:403,FINANCE_REVIEW_ROLE_FORBIDDEN:403};

export function createRefundCaseReviewHandler(deps:RefundCaseDeps){
 const env=deps.env??process.env;
 const now=deps.now??Date.now;
 return async function handle(request:Request,params:{providerMode:string;eventId:string}){
  // Literal gate FIRST: nothing below (auth, key, SQL) runs while default OFF.
  if(REFUND_CASE_GATES.some(k=>env[k]!=="staging"))
   return reply({ok:false,error:"REFUND_CASE_REVIEW_DISABLED"},503);
  const u=new URL(request.url);
  if(u.search||u.hash||!MODE.test(params.providerMode)||!EVENT_ID.test(params.eventId))
   return reply({ok:false,error:"REFUND_CASE_REQUEST_INVALID"},400);
  const providerMode=params.providerMode as "test"|"live",eventId=params.eventId;
  const bearer=request.headers.get("authorization");
  try{
   const reviewer=await deps.verifyReviewer(bearer);
   if(!reviewer)return reply({ok:false,error:"FINANCE_REVIEWER_AAL2_ROLE_REQUIRED"},403);
   const macKey=deps.macKey();
   if(typeof macKey!=="string"||Buffer.byteLength(macKey,"utf8")<32)
    return reply({ok:false,error:"REFUND_CASE_NOT_CONFIGURED"},503);
   const snap=await deps.loadSnapshot(eventId,providerMode);
   if(!snap)return reply({ok:false,error:"REFUND_CASE_NOT_FOUND"},404);
   const {event,identity,order,ledger}=snap;
   const shapeOk=exact(snap,["event","identity","order","ledger"])&&
    exact(event,["event_id","provider_mode","body_sha256","event_type","payment_id","provider_order_id","status","error_code"])&&
    exact(identity,["event_id","provider_mode","body_sha256","event_type","refund_id","payment_id","provider_order_id","identity_mac","mac_key_id"])&&
    exact(order,["id","vendor_id","provider_order_id","provider_payment_id"])&&
    exact(ledger,["order_id","vendor_id","credits_granted","credits_remaining","debits"])&&
    Array.isArray(ledger.debits)&&ledger.debits.length<=MAX_DEBITS&&
    str(event.body_sha256,SHA256)&&str(event.payment_id,PAY)&&str(event.provider_order_id,ORDER)&&
    str(order.id,UUID)&&str(order.vendor_id,UUID);
   if(!shapeOk)return reply({ok:false,error:"REFUND_CASE_SOURCE_INVALID"},503);
   // The event must be the exact quarantined refund case named by the path.
   if(event.event_id!==eventId||event.provider_mode!==providerMode||
      event.status!=="quarantined"||event.error_code!=="REFUND_REVIEW_REQUIRED"||
      !String(event.event_type).startsWith("refund."))
    return reply({ok:false,error:"REFUND_CASE_NOT_REVIEWABLE"},409);
   // Event row, durable identity and order/payment identity must all agree.
   if(identity.event_id!==eventId||identity.provider_mode!==providerMode||
      identity.event_type!==event.event_type||identity.payment_id!==event.payment_id||
      identity.provider_order_id!==event.provider_order_id||
      order.provider_order_id!==event.provider_order_id||
      order.provider_payment_id!==event.payment_id)
    return reply({ok:false,error:"REFUND_CASE_IDENTITY_MISMATCH"},409);
   const debits=(ledger.debits as unknown[]).map(d=>obj(d)?{orderId:d.order_id,vendorId:d.vendor_id,
    leadId:d.lead_id,credits:d.credits}:d);
   const result=adjudicateConsumedCreditRefundEvidence({
    identityRow:identity,macKey,
    expected:{orderId:order.id as string,vendorId:order.vendor_id as string,
     providerOrderId:event.provider_order_id as string,providerMode,
     bodySha256:event.body_sha256 as string},
    requesterVendorId:order.vendor_id as string,
    ledger:{orderId:ledger.order_id,vendorId:ledger.vendor_id,creditsGranted:ledger.credits_granted,
     creditsRemaining:ledger.credits_remaining,ledgerDebits:debits},
    reviewer,approvedRoles:deps.approvedRoles,now:now()} as Parameters<typeof adjudicateConsumedCreditRefundEvidence>[0]);
   // Revocation during the async read invalidates the whole response.
   if(!sameReviewer(reviewer,await deps.verifyReviewer(bearer)))
    return reply({ok:false,error:"FINANCE_REVIEWER_REVOKED_DURING_READ"},403);
   const never={canRefund:false,canGrantCredits:false,canRevokeCredits:false,canCallProvider:false};
   if(result.decision!=="POLICY_APPROVAL_MISSING"||!result.evidence)
    return reply({ok:false,error:"REFUND_CASE_DENIED",decision:result.decision,reason:result.reason,
     ...never},ADJUDICATION_STATUS[result.reason]??409);
   return reply({ok:true,schema:"qf.vox.finance.refund-case-review.v1",mode:"READ_ONLY",
    decision:result.decision,reason:result.reason,requiresHumanReview:true,...never,
    evidence:result.evidence},200);
  }catch{return reply({ok:false,error:"REFUND_CASE_UNAVAILABLE"},503);}
 };
}
