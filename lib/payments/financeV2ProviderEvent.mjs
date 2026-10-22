/** PAY-2 source-only: verify Razorpay webhook and derive safe receipt. */
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
const equalHex=(actual,expected)=>{
 if(typeof actual!=="string"||!/^[a-f0-9]{64}$/i.test(actual))return false;
 const a=Buffer.from(actual,"hex"),b=Buffer.from(expected,"hex");
 return a.length===b.length&&timingSafeEqual(a,b);
};
export function prepareVerifiedRazorpayFinanceEvent(input){
 if(!input?.eventId||!/^[a-zA-Z0-9_.:-]{6,180}$/.test(input.eventId))
  throw new Error("RAZORPAY_EVENT_ID_INVALID");
 if(!["test","live"].includes(input.providerMode)||!input.merchantAccountId?.trim())
  throw new Error("RAZORPAY_EVENT_CONTEXT_MISSING");
 if(typeof input.rawBody!=="string"||typeof input.webhookSecret!=="string")
  throw new Error("RAZORPAY_EVENT_SIGNATURE_INVALID");
 const expected=createHmac("sha256",input.webhookSecret).update(input.rawBody).digest("hex");
 if(!equalHex(input.signature,expected))throw new Error("RAZORPAY_EVENT_SIGNATURE_INVALID");
 let parsed;try{parsed=JSON.parse(input.rawBody)}catch{throw new Error("RAZORPAY_EVENT_JSON_INVALID")}
 if(!parsed||typeof parsed!=="object")throw new Error("RAZORPAY_EVENT_JSON_INVALID");
 const event=parsed.event;
 if(typeof event!=="string"||!/^[a-z_.]{3,70}$/.test(event))
  throw new Error("RAZORPAY_EVENT_TYPE_INVALID");
 return Object.freeze({
  provider:"razorpay",provider_mode:input.providerMode,
  merchant_account_id:input.merchantAccountId.trim(),provider_event_id:input.eventId,
  event_type:event,payload_sha256:createHash("sha256").update(input.rawBody).digest("hex"),
  signature_verified:true
 });
}
