/** PAY-3 Final A: deterministic provider-truth reconciliation, no DB/provider side effects. */
const ID=/^(?:pay|order)_[A-Za-z0-9]{4,96}$/;
const MONEY=x=>Number.isSafeInteger(x)&&x>0;
function invalid(code){throw new Error("FINANCE_"+code);}
export function reconcileRazorpayProviderPayment({expected,provider,mode,merchantAccountId}={}){
 if(!expected||!provider||!["test","live"].includes(mode)||
  expected.providerMode!==mode||expected.merchantAccountId!==merchantAccountId||
  !ID.test(expected.providerPaymentId)||!ID.test(expected.providerOrderId)||
  !MONEY(expected.amountSubunits)||expected.currency!=="INR")
  invalid("PROVIDER_CONTEXT_INVALID");
 if(provider.id!==expected.providerPaymentId||provider.order_id!==expected.providerOrderId||
  provider.amount!==expected.amountSubunits||provider.currency!=="INR")
  invalid("PROVIDER_TRUTH_MISMATCH");
 if(provider.status!=="captured"){
  return Object.freeze({state:"UNPAID_OR_FAILED",safeToActivate:false,providerPaymentId:provider.id,
   reason:"PROVIDER_NOT_CAPTURED"});
 }
 if(!MONEY(provider.amount)||provider.captured!==true&&provider.captured!==undefined)
  invalid("PROVIDER_CAPTURE_INVALID");
 return Object.freeze({state:"PROVIDER_CAPTURE_CONFIRMED",safeToActivate:false,
  providerPaymentId:provider.id,amountSubunits:provider.amount,
  creditDecision:"EXISTING_CORE_ATOMIC_CREDIT_AUTHORITY_ONLY"});
}
/** No signed webhook is itself a provider-confirmed capture. */
export function deriveFinanceWorkerOutcome(event,payment,expected){
 if(!event||!expected||event.provider_mode!==expected.providerMode||
  event.merchant_account_id!==expected.merchantAccountId||
  !["payment.captured","payment.failed"].includes(event.event_type))
  return Object.freeze({outcome:"DEAD_LETTER",reason:"EVENT_CONTEXT_INVALID",creditGrant:false});
 if(event.event_type==="payment.failed"){
  if(!payment||payment.id!==expected.providerPaymentId||
   payment.order_id!==expected.providerOrderId||
   payment.amount!==expected.amountSubunits||payment.currency!=="INR")
   return Object.freeze({outcome:"DEAD_LETTER",reason:"PROVIDER_MISMATCH",creditGrant:false});
  return payment.status==="failed"?
   Object.freeze({outcome:"VERIFIED",reason:"PROVIDER_FAILURE_CHECKED",creditGrant:false}):
   Object.freeze({outcome:"RETRY",reason:"FAILURE_NOT_CONFIRMED",creditGrant:false});
 }
 try{
  const check=reconcileRazorpayProviderPayment({expected,provider:payment,
   mode:expected.providerMode,merchantAccountId:expected.merchantAccountId});
  return check.state==="PROVIDER_CAPTURE_CONFIRMED"?
    Object.freeze({outcome:"VERIFIED",reason:"PROVIDER_CAPTURE_CHECKED",creditGrant:false}):
    Object.freeze({outcome:"RETRY",reason:"CAPTURE_NOT_CONFIRMED",creditGrant:false});
 }catch{return Object.freeze({outcome:"DEAD_LETTER",reason:"PROVIDER_MISMATCH",creditGrant:false});}
}
/** Lease/fencing are enforced again by Core SQL; completion cannot activate credits. */
export async function processFinanceInboxBatch({claim,load,providerRead,finish,max=5}={}){
 if(typeof claim!=="function"||typeof load!=="function"||typeof providerRead!=="function"||
  typeof finish!=="function"||!Number.isInteger(max)||max<1||max>5)
  invalid("WORKER_UNCONFIGURED");
 const jobs=await claim(max);
 if(!Array.isArray(jobs)||jobs.length>max)invalid("WORKER_CLAIM_INVALID");
 const results=[];
 for(const job of jobs){
  if(!job||typeof job.job_id!=="string"||typeof job.token!=="string"||
   typeof job.event_id!=="string")invalid("WORKER_LEASE_INVALID");
  let decision={outcome:"RETRY",reason:"PROVIDER_UNAVAILABLE",creditGrant:false};
  try{
   const data=await load(job.event_id);
   if(!data||!data.event||!data.expected)invalid("WORKER_EVENT_INVALID");
   const payment=await providerRead(data.expected.providerPaymentId,data.expected.providerMode);
   decision=deriveFinanceWorkerOutcome(data.event,payment,data.expected);
  }catch{decision={outcome:"RETRY",reason:"PROVIDER_UNAVAILABLE",creditGrant:false};}
  const accepted=await finish(job.job_id,job.token,decision.outcome,decision.reason);
  results.push(Object.freeze({jobId:job.job_id,accepted:accepted===true,
   outcome:decision.outcome,creditGrant:false}));
 }
 return Object.freeze(results);
}
