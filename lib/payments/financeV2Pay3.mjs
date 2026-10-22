/**
 * Finance V2 PAY-3 source-only deterministic policies. No database or gateway calls.
 * Never equate a verified webhook with bank settlement or wallet entitlement.
 */
import {prepareVerifiedRazorpayFinanceEvent} from "./financeV2ProviderEvent.mjs";
const isMoney=x=>Number.isSafeInteger(x)&&x>=0&&x<=Number.MAX_SAFE_INTEGER;
const str=(x,min=1,max=180)=>typeof x==="string"&&x.length>=min&&x.length<=max&&x.trim()===x;
function requireMoney(x){if(!isMoney(x))throw new Error("FINANCE_AMOUNT_INVALID");return x;}
function context(x){
 if(!x||x.provider!=="razorpay"||!["test","live"].includes(x.providerMode)||
    !str(x.merchantAccountId)||!str(x.providerOrderId)||
    !str(x.orderId)||x.currency!=="INR")throw new Error("FINANCE_CONTEXT_INVALID");
 requireMoney(x.expectedAmountSubunits);
 if(x.expectedAmountSubunits===0)throw new Error("FINANCE_AMOUNT_INVALID");
 return x;
}
/** A whitelisted capture journal receipt, NOT a credit-grant instruction. */
export function evaluateVerifiedCapture(input){
 const expected=context(input.expected);
 const receipt=prepareVerifiedRazorpayFinanceEvent(input.webhook);
 if(receipt.event_type!=="payment.captured")throw new Error("FINANCE_CAPTURE_EVENT_REQUIRED");
 if(receipt.provider_mode!==expected.providerMode||
    receipt.merchant_account_id!==expected.merchantAccountId)throw new Error("FINANCE_MERCHANT_MODE_MISMATCH");
 let data;
 try{data=JSON.parse(input.webhook.rawBody)}catch{throw new Error("FINANCE_PAYLOAD_INVALID");}
 const p=data?.payload?.payment?.entity;
 if(!p||!str(p.id)||p.order_id!==expected.providerOrderId||
    p.currency!==expected.currency||p.status!=="captured"||
    !isMoney(p.amount)||p.amount!==expected.expectedAmountSubunits)
   throw new Error("FINANCE_CAPTURE_MISMATCH");
 // Captured amount in a signed event alone never executes activation.
 return Object.freeze({receipt,orderId:expected.orderId,providerPaymentId:p.id,
   capturedSubunits:p.amount,currency:"INR",decision:"JOURNAL_AND_VERIFY_WITH_PROVIDER",
   creditActivationAllowed:false});
}
/** Block self-approval, overspending and hidden concurrent refund reservations. */
export function evaluateRefundProposal(input){
 if(!input||input.providerMode!=="test"&&input.providerMode!=="live"||
    !str(input.merchantAccountId)||!str(input.orderId)||!str(input.paymentId)||
    !str(input.requestedBy)||!str(input.approvedBy)||input.requestedBy===input.approvedBy||
    input.approverAal2!==true||!str(input.approvalReference))
   throw new Error("FINANCE_REFUND_APPROVAL_REQUIRED");
 const capture=requireMoney(input.capturedSubunits);
 const req=requireMoney(input.requestedSubunits);
 if(capture===0||req===0||!Array.isArray(input.existingRefunds)||input.existingRefunds.length>500)
   throw new Error("FINANCE_REFUND_AMOUNT_INVALID");
 let reserved=0;
 for(const r of input.existingRefunds){
  if(!r||!["requested","pending","processed"].includes(r.state)||!isMoney(r.amountSubunits))
   throw new Error("FINANCE_REFUND_STATE_UNTRUSTED");
  if(r.providerMode!==input.providerMode||r.merchantAccountId!==input.merchantAccountId||
     r.paymentId!==input.paymentId)throw new Error("FINANCE_REFUND_CONTEXT_MISMATCH");
  reserved+=r.amountSubunits;
  if(!Number.isSafeInteger(reserved))throw new Error("FINANCE_REFUND_AMOUNT_OVERFLOW");
 }
 if(reserved+req>capture||!Number.isSafeInteger(reserved+req))
   throw new Error("FINANCE_REFUND_EXCEEDS_CAPTURE");
 return Object.freeze({mode:input.providerMode,paymentId:input.paymentId,
   requestedSubunits:req,remainingSubunits:capture-reserved-req,
   decision:"NEEDS_ATOMIC_DB_RESERVATION_AND_PROVIDER_CONFIRMATION",
   gatewayExecutionAllowed:false,creditReversalAllowed:false});
}
/** Settlement reconciler only computes discrepancies; never confirms bank deposit. */
export function reconcileSettlement(input){
 if(!input||!["test","live"].includes(input.providerMode)||
    !str(input.merchantAccountId)||!str(input.settlementId))
   throw new Error("FINANCE_SETTLEMENT_CONTEXT_INVALID");
 const {grossSubunits,refundSubunits,feeSubunits,taxOnFeeSubunits,
   adjustmentSubunits,bankDepositSubunits}=input;
 for(const amount of [grossSubunits,refundSubunits,feeSubunits,taxOnFeeSubunits,bankDepositSubunits])
   requireMoney(amount);
 if(!Number.isSafeInteger(adjustmentSubunits))throw new Error("FINANCE_SETTLEMENT_AMOUNT_INVALID");
 const net=grossSubunits-refundSubunits-feeSubunits-taxOnFeeSubunits+adjustmentSubunits;
 if(!Number.isSafeInteger(net)||net<0)throw new Error("FINANCE_SETTLEMENT_NET_INVALID");
 const difference=bankDepositSubunits-net;
 if(!Number.isSafeInteger(difference))throw new Error("FINANCE_SETTLEMENT_AMOUNT_OVERFLOW");
 return Object.freeze({mode:input.providerMode,settlementId:input.settlementId,
   calculatedNetSubunits:net,discrepancySubunits:difference,
   state:difference===0?"AMOUNT_MATCH_ONLY":"DISCREPANCY",
   bankStatementVerified:false,accountingRevenueCertified:false});
}
/** Server-approved timeline: strict mode, no payload, signature or banking secrets. */
export function financeTimeline(input){
 if(!input||!["test","live"].includes(input.providerMode)||
    !str(input.orderId)||!Array.isArray(input.events)||input.events.length>150)
   throw new Error("FINANCE_TIMELINE_INVALID");
 const results=input.events.map((e,index)=>{
  if(!e||!["order","attempt","capture","refund","credit","settlement","audit"].includes(e.kind)||
     e.providerMode!==input.providerMode||!str(e.reference,1,180)||
     !str(e.occurredAt,1,40)||!Number.isFinite(Date.parse(e.occurredAt))||
     e.amountSubunits!==null&&!isMoney(e.amountSubunits))
    throw new Error("FINANCE_TIMELINE_EVENT_INVALID");
  return {kind:e.kind,reference:e.reference,occurredAt:e.occurredAt,
    amountSubunits:e.amountSubunits??null,mode:input.providerMode,index};
 });
 return Object.freeze(results.sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||a.index-b.index)
   .map(({index,...row})=>Object.freeze(row)));
}
