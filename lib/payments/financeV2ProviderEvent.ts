/**
 * Source-only PAY-2: verify Razorpay webhook raw bytes and bind immutable
 * event ID to a sanitized append-only receipt. Do NOT activate a payment.
 */
import {createHash} from "node:crypto";
import {verifyWebhookSignature} from "./vendorPackageRazorpay.ts";
export function prepareVerifiedRazorpayFinanceEvent(input:{
 rawBody:string;
 signature:string;
 webhookSecret:string;
 eventId:string;
 providerMode:"test"|"live";
 merchantAccountId:string;
}){
 if(!input.eventId||!/^[a-zA-Z0-9_.:-]{6,180}$/.test(input.eventId))
  throw new Error("RAZORPAY_EVENT_ID_INVALID");
 if(!["test","live"].includes(input.providerMode)
  ||!input.merchantAccountId?.trim())throw new Error("RAZORPAY_EVENT_CONTEXT_MISSING");
 if(!verifyWebhookSignature(input.rawBody,input.signature,input.webhookSecret))
  throw new Error("RAZORPAY_EVENT_SIGNATURE_INVALID");
 let parsed:unknown;
 try{parsed=JSON.parse(input.rawBody);}catch{throw new Error("RAZORPAY_EVENT_JSON_INVALID");}
 if(!parsed||typeof parsed!=="object")throw new Error("RAZORPAY_EVENT_JSON_INVALID");
 const event=(parsed as {event?:unknown}).event;
 if(typeof event!=="string"||!/^[a-z_.]{3,70}$/.test(event))
  throw new Error("RAZORPAY_EVENT_TYPE_INVALID");
 return Object.freeze({
  provider:"razorpay" as const,provider_mode:input.providerMode,
  merchant_account_id:input.merchantAccountId.trim(),provider_event_id:input.eventId,
  event_type:event,payload_sha256:createHash("sha256").update(input.rawBody).digest("hex"),
  signature_verified:true as const
 });
}
