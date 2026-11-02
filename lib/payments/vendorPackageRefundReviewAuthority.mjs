// RC37 Finance: SOURCE-ONLY authority fence for refund intake review.
// The reviewer identity is NEVER caller supplied. It comes only from a
// principal minted by the server-side verifier after real Auth (AAL2), live
// Staff membership and a canonical finance role were all confirmed.
// No finance review role is canonical yet (contracts/vox/scopedStaff.mjs has
// none), so the approved set is EMPTY and every review fails closed. A role
// must be added by an owner-approved change, not invented here.
import {createRefundIntakeReviewer} from "./vendorPackageRefundIntakeReview.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAY=/^pay_[A-Za-z0-9]{4,64}$/;
const ORDER=/^order_[A-Za-z0-9]{4,64}$/;
const REFUND=/^rfnd_[A-Za-z0-9]{4,64}$/;
const EVENT_ID=/^[A-Za-z0-9_-]{8,64}$/;
export const FINANCE_REFUND_REVIEW_ROLES=Object.freeze([]);
const issued=new WeakSet();
const deny=reason=>Object.freeze({ok:false,reason});
const fail=reason=>Object.freeze({ok:false,reason,retrySafe:false,
 creditMutation:false,refundAllowed:false});

/** Called ONLY by the Auth verifier. Object literals can never pass authorize. */
export function issueVerifiedFinanceReviewer(v,now=Date.now()){
 if(!v||typeof v!=="object"||v.aal!=="aal2"||typeof v.userId!=="string"||
    !UUID.test(v.userId)||typeof v.staffRole!=="string"||v.staffRole===""||
    !Number.isSafeInteger(v.expiresAtMs)||v.expiresAtMs<=now||
    typeof v.teamId!=="string"||!UUID.test(v.teamId)||
    typeof v.cityId!=="string"||!UUID.test(v.cityId))return null;
 const p=Object.freeze({userId:v.userId,staffRole:v.staffRole,aal:"aal2",
  expiresAtMs:v.expiresAtMs,teamId:v.teamId,cityId:v.cityId});
 issued.add(p);return p;
}

export function authorizeRefundReviewer(principal,approvedRoles=FINANCE_REFUND_REVIEW_ROLES,now=Date.now()){
 if(!Array.isArray(approvedRoles)||approvedRoles.length===0)
  return deny("FINANCE_REVIEW_ROLE_NOT_CANONICAL");
 if(!principal||typeof principal!=="object"||!issued.has(principal))
  return deny("FINANCE_REVIEWER_NOT_VERIFIED");
 if(principal.aal!=="aal2"||!UUID.test(principal.userId)||
    !Number.isSafeInteger(principal.expiresAtMs)||principal.expiresAtMs<=now)
  return deny("FINANCE_REVIEWER_SESSION_INVALID");
 if(!approvedRoles.includes(principal.staffRole))
  return deny("FINANCE_REVIEW_ROLE_FORBIDDEN");
 return Object.freeze({ok:true,reviewerId:principal.userId});
}

/**
 * Trusted-service wrapper. `input` MUST NOT contain reviewerId/principal; the
 * reviewer is derived from the verified principal alone.
 */
export function createFinanceRefundReviewService({callRpc,approvedRoles=FINANCE_REFUND_REVIEW_ROLES,now=Date.now}){
 const reviewer=createRefundIntakeReviewer(callRpc,{refundBound:true});
 return Object.freeze({
  async review(principal,input){
   if(!input||typeof input!=="object"||Array.isArray(input)||
      Object.hasOwn(input,"reviewerId")||Object.hasOwn(input,"principal"))
    return fail("REFUND_REVIEW_CALLER_IDENTITY_REJECTED");
   const auth=authorizeRefundReviewer(principal,approvedRoles,now());
   if(!auth.ok)return fail(auth.reason);
   return reviewer.review({...input,reviewerId:auth.reviewerId});
  }
 });
}

/** Strict read-only projection of quarantined refund intake rows (no hashes). */
export function projectRefundIntakePreview(rows){
 if(!Array.isArray(rows)||rows.length>20)return null;
 const out=[];
 for(const r of rows){
  if(!r||typeof r!=="object"||!EVENT_ID.test(r.event_id)||
     !["test","live"].includes(r.provider_mode)||
     !["refund.created","refund.processed","refund.failed"].includes(r.event_type)||
     !PAY.test(r.payment_id)||!ORDER.test(r.provider_order_id)||
     r.status!=="quarantined"||r.error_code!=="REFUND_REVIEW_REQUIRED")return null;
  out.push(Object.freeze({eventId:r.event_id,providerMode:r.provider_mode,
   eventType:r.event_type,paymentId:r.payment_id,providerOrderId:r.provider_order_id}));
 }
 return Object.freeze(out);
}
export const isProviderRefundId=v=>typeof v==="string"&&REFUND.test(v);
