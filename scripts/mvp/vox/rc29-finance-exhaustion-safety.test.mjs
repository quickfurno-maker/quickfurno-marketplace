import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {buildRazorpayProviderEventEnvelope,inspectProviderEventClaim}
 from "../../../lib/payments/vendorPackageProviderEventLedger.mjs";
import {processVendorPackageProviderEvent,providerEventHttpStatus}
 from "../../../lib/payments/vendorPackageProviderEventProcessing.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const file=path=>readFileSync(resolve(root,path),"utf8");
const envelope=buildRazorpayProviderEventEnvelope({
 eventId:"evt_UNCERTAINPAY25",providerMode:"test",bodySha256:"a".repeat(64),
 candidate:{kind:"captured",paymentId:"pay_ABC12345",providerOrderId:"order_ABC12345"}
});
test("an exhausted unsettled payment never becomes a provider 2xx acknowledgment",async()=>{
 let handlerCalls=0,completionCalls=0;
 const result=await processVendorPackageProviderEvent({envelope,
  repository:{
   async claim(){return {event_id:envelope.eventId,provider_mode:envelope.providerMode,
    status:"needs_reconciliation",last_error_code:"PROVIDER_EVENT_ATTEMPTS_EXHAUSTED"}},
   async complete(){completionCalls++;throw Error("MUST_NOT_COMPLETE")}
  },
  async handle(){handlerCalls++;return "activated"}
 });
 assert.equal(result.ack,false);
 assert.equal(result.retry,true);
 assert.equal(result.code,"PROVIDER_EVENT_ATTEMPTS_EXHAUSTED");
 assert.equal(providerEventHttpStatus(result),503);
 assert.equal(handlerCalls,0);
 assert.equal(completionCalls,0);
});
test("an invalid exhaustion receipt is rejected, not promoted to paid",()=>{
 const claim=inspectProviderEventClaim({event_id:envelope.eventId,provider_mode:"test",
  status:"needs_reconciliation",last_error_code:"SUCCESS"},envelope);
 assert.equal(claim.state,"invalid");
});
test("review-only SQL and runtime agree on bounded non-acknowledgment",()=>{
 const sql=file("scripts/mvp/vox/fixtures/rc28-review-only-provider-event-ledger.pg17.sql");
 const processor=file("lib/payments/vendorPackageProviderEventProcessing.mjs");
 const repository=file("lib/payments/vendorPackageProviderEventRepository.mjs");
 assert.match(sql,/REVIEW-ONLY, NON-DEPLOYABLE/);
 assert.match(sql,/IF r\.attempt_count>=25 THEN/);
 assert.match(sql,/status='retryable',claimed_at=NULL,outcome=NULL/);
 assert.match(sql,/'status','needs_reconciliation','last_error_code','PROVIDER_EVENT_ATTEMPTS_EXHAUSTED'/);
 assert.match(processor,/case "needs_reconciliation":return retry\("PROVIDER_EVENT_ATTEMPTS_EXHAUSTED"\)/);
 assert.match(processor,/expected=\{disposition:"retryable",errorCode:"PROVIDER_EVENT_ATTEMPTS_EXHAUSTED"\}/);
 assert.match(repository,/RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED=false/);
 assert.doesNotMatch(sql,/IF r\.attempt_count>=25 THEN[\s\S]{0,150}status='quarantined'/);
});
