// RC27-B Finance: provider-event processing orchestration over the RC26 ledger
// fences. Pure control flow: no DB, no provider, no credits. All durable state
// lives behind an injected repository whose SQL authority
// (qf_record/complete_vendor_package_razorpay_event_v2) is NOT yet applied, so
// the route gate below stays hard-OFF / fail-closed until a DBA-approved
// repository exists. Runs ONLY after HMAC verification and
// classifyVendorPackageWebhookEvent.
import {
 PROVIDER_EVENT_MAX_ATTEMPTS,vendorPackageEventLedgerMode,vendorPackageEventLedgerConfigError,
 inspectProviderEventClaim,inspectProviderEventCompletion,providerEventOutcomeAllowed,
 financeErrorCode,classifyVendorPackageWebhookFailure,
} from "./vendorPackageProviderEventLedger.mjs";

const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);

/**
 * Route gate. "legacy" keeps today's TEST webhook behaviour byte-for-byte.
 * Everything else denies before any order lookup, provider GET or Core RPC:
 * LIVE without the ledger, invalid config, and enforce without a durable
 * repository (the only state reachable from source today).
 */
export function resolveVendorPackageEventLedgerGate(input){
 const deny=code=>Object.freeze({action:"deny",code});
 if(!obj(input))return deny("RAZORPAY_EVENT_LEDGER_CONFIG_INVALID");
 const ledgerMode=vendorPackageEventLedgerMode(input.ledgerModeValue);
 const configError=vendorPackageEventLedgerConfigError(input.providerMode,ledgerMode);
 if(configError)return deny(configError);
 if(ledgerMode==="off")return Object.freeze({action:"legacy"});
 if(!isProviderEventRepository(input.repository))
  return deny("RAZORPAY_EVENT_LEDGER_REPOSITORY_UNAVAILABLE");
 return Object.freeze({action:"ledger",repository:input.repository});
}

/**
 * Durable repository contract (implemented later over the SQL ledger RPCs):
 *  claim(envelope)              -> receipt {event_id, provider_mode, status, ...}
 *  complete(envelope, expected) -> receipt {event_id, provider_mode, status, outcome|error_code}
 * claim must be atomic per (provider_mode, event_id) and reject body-hash drift
 * as status "conflict".
 */
export function isProviderEventRepository(repository){
 return obj(repository)&&typeof repository.claim==="function"&&
  typeof repository.complete==="function";
}

const decision=(d)=>Object.freeze(d);
const retry=code=>decision({ack:false,retry:true,status:"retry",code});
const reject=code=>decision({ack:false,retry:false,status:"rejected",code});

/**
 * Webhook retry classification for Razorpay (redelivers on any non-2xx):
 *  ack=true  -> 2xx, provider stops redelivering (completed, replay, quarantined)
 *  retry     -> non-2xx, safe to redeliver (transport/DB/uncertain/in-flight)
 *  rejected  -> non-2xx, needs human review (conflict, invalid ledger receipt)
 * handle(envelope) performs the existing order lookup/provider GET/Core RPC and
 * must resolve to an allowed outcome for the event type.
 */
export async function processVendorPackageProviderEvent({envelope,repository,handle}={}){
 if(!obj(envelope)||envelope.ok!==true)
  return reject(obj(envelope)&&typeof envelope.reason==="string"?envelope.reason:"PROVIDER_EVENT_ENVELOPE_INVALID");
 if(!isProviderEventRepository(repository))return retry("RAZORPAY_EVENT_LEDGER_REPOSITORY_UNAVAILABLE");
 if(typeof handle!=="function")return reject("PROVIDER_EVENT_HANDLER_INVALID");

 let claimReceipt;
 try{claimReceipt=await repository.claim(envelope)}
 catch{return retry("PROVIDER_EVENT_LEDGER_UNAVAILABLE")}
 const claim=inspectProviderEventClaim(claimReceipt,envelope);
 switch(claim.state){
  case "replay":return decision({ack:true,retry:false,status:claim.outcome,code:null,replay:true});
  case "quarantined":return decision({ack:true,retry:false,status:"quarantined",code:claim.code});
  case "needs_reconciliation":return retry("PROVIDER_EVENT_ATTEMPTS_EXHAUSTED");
  case "in_flight":return retry("PROVIDER_EVENT_IN_FLIGHT");
  case "conflict":return reject("PROVIDER_EVENT_CONFLICT");
  case "claimed":break;
  default:return reject("PROVIDER_EVENT_LEDGER_RECEIPT_INVALID");
 }

 let expected;
 try{
  const outcome=await handle(envelope);
  expected=providerEventOutcomeAllowed(envelope.eventType,outcome)
   ?{disposition:"completed",outcome}
   :{disposition:"retryable",errorCode:"PROVIDER_EVENT_OUTCOME_INVALID"};
 }catch(error){
  const code=financeErrorCode(error);
  expected=classifyVendorPackageWebhookFailure(code)==="quarantine"
   ?{disposition:"quarantined",errorCode:code}
   :{disposition:"retryable",errorCode:code};
 }
 // Exhausted uncertainty remains non-2xx until an independent reviewer
 // reconciles provider settlement; never acknowledge merely on retry count.
 if(expected.disposition==="retryable"&&claim.attempt>=PROVIDER_EVENT_MAX_ATTEMPTS)
  expected={disposition:"retryable",errorCode:"PROVIDER_EVENT_ATTEMPTS_EXHAUSTED"};

 let completion;
 try{completion=await repository.complete(envelope,Object.freeze(expected))}
 catch{return retry("PROVIDER_EVENT_COMPLETION_UNCONFIRMED")}
 // Unconfirmed completion is never acknowledged: redelivery re-enters the
 // idempotent Core RPCs (already_activated / failure_ignored).
 if(!inspectProviderEventCompletion(completion,envelope,expected))
  return retry("PROVIDER_EVENT_COMPLETION_UNCONFIRMED");
 if(expected.disposition==="completed")
  return decision({ack:true,retry:false,status:expected.outcome,code:null});
 if(expected.disposition==="quarantined")
  return decision({ack:true,retry:false,status:"quarantined",code:expected.errorCode});
 return retry(expected.errorCode);
}

export function providerEventHttpStatus(result){
 if(!obj(result))return 500;
 if(result.ack===true)return 200;
 if(result.retry===true)return 503;
 return result.code==="PROVIDER_EVENT_CONFLICT"?409:500;
}
