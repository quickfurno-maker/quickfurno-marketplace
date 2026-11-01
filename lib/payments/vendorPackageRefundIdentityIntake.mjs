// RC39 Finance: STAGED, REVIEW-ONLY refund identity intake (not wired anywhere).
// Accepts an envelope built from an HMAC-VERIFIED Razorpay refund webhook, makes
// the RC26/27 v2 durable quarantine receipt FIRST, and only then stores the RC38
// v4 HMAC identity through the injected binder. It never calls the provider,
// never touches credits/orders/wallets and never allows a refund. No webhook or
// service imports this module: it is released only by an owner-approved change
// that flips RC39_REFUND_IDENTITY_INTAKE_RELEASED, which stays false in source.
//
// Every gate below is evaluated BEFORE any I/O. A closed gate returns
// {handled:false}: the caller keeps running today's v2 flow untouched and no
// binder/RPC call is made. The env flag, MAC key, key id and SQL approval are
// injected; this module never reads process.env.
import {createRefundIdentityBinder} from "./vendorPackageRefundIdentityBinding.mjs";
import {processVendorPackageProviderEvent} from "./vendorPackageProviderEventProcessing.mjs";
import {buildRazorpayProviderEventEnvelope} from "./vendorPackageProviderEventLedger.mjs";
import {isRefundIntakeEventType} from "./vendorPackageRefundIntake.mjs";

export const RC39_REFUND_IDENTITY_INTAKE_RELEASED=false;
export const REFUND_IDENTITY_INTAKE_ENV_FLAG="QF_VOX_REFUND_IDENTITY_INTAKE";
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const closed=reason=>Object.freeze({handled:false,reason,ack:false,retry:false,
 creditMutation:false,refundAllowed:false});
const rejected=(code,retry=false)=>Object.freeze({handled:true,ack:false,retry,
 status:retry?"retry":"rejected",code,creditMutation:false,refundAllowed:false});

/** Only the exact string "on" enables the flag; unset/anything else is OFF. */
export const refundIdentityIntakeFlagOn=env=>
 obj(env)&&env[REFUND_IDENTITY_INTAKE_ENV_FLAG]==="on";

// A refund envelope must be exactly what buildRazorpayProviderEventEnvelope
// emits for its own fields: no extra, missing or reshaped properties.
function canonicalRefundEnvelope(e){
 if(!obj(e)||e.ok!==true||!isRefundIntakeEventType(e.eventType)||!Object.isFrozen(e))return false;
 const rebuilt=buildRazorpayProviderEventEnvelope({eventId:e.eventId,bodySha256:e.bodySha256,
  providerMode:e.providerMode,candidate:{kind:"refund",eventName:e.eventType,refundId:e.refundId,
  paymentId:e.paymentId,providerOrderId:e.providerOrderId}});
 if(!rebuilt.ok)return false;
 const a=Object.keys(rebuilt).sort(),b=Object.keys(e).sort();
 return a.length===b.length&&a.every((k,i)=>k===b[i]&&rebuilt[k]===e[k]);
}

/**
 * deps: {repository (v2 claim/complete), callRpc (v4 bind), macKey, keyId,
 *        providerMode (this deployment's mode), env, sqlApproved,
 *        released (defaults to the hard-false constant; production never passes it)}
 * process(envelope) -> {handled:false,...} when any gate is closed (no I/O), else
 * {handled:true, ack, retry, status, code}. ack is true ONLY when the v2
 * quarantine receipt AND the v4 identity receipt are both durable.
 */
export function createStagedRefundIdentityIntake(deps={}){
 const {repository,callRpc,macKey,keyId,providerMode,env,sqlApproved,
  released=RC39_REFUND_IDENTITY_INTAKE_RELEASED}=obj(deps)?deps:{};
 let binder=null,gate=null;
 if(released!==true)gate="REFUND_IDENTITY_INTAKE_NOT_RELEASED";
 else if(!refundIdentityIntakeFlagOn(env))gate="REFUND_IDENTITY_INTAKE_FLAG_OFF";
 else if(sqlApproved!==true)gate="REFUND_IDENTITY_SQL_NOT_APPROVED";
 else if(providerMode!=="test"&&providerMode!=="live")gate="REFUND_IDENTITY_MODE_REQUIRED";
 else if(typeof callRpc!=="function"||!obj(repository)||typeof repository.claim!=="function"||
  typeof repository.complete!=="function")gate="REFUND_IDENTITY_DEPENDENCY_MISSING";
 else try{binder=createRefundIdentityBinder(callRpc,{macKey,keyId})}
 catch{gate="REFUND_IDENTITY_KEY_MISSING"}
 return Object.freeze({
  async process(envelope){
   if(gate!==null)return closed(gate);
   if(!canonicalRefundEnvelope(envelope))return rejected("REFUND_IDENTITY_ENVELOPE_INVALID");
   // TEST and LIVE never cross: a foreign-mode envelope touches nothing.
   if(envelope.providerMode!==providerMode)return rejected("REFUND_IDENTITY_MODE_MISMATCH");
   // 1) v2 durable quarantine first. Refund events never reach `handle`.
   const quarantine=await processVendorPackageProviderEvent({envelope,repository,
    handle:async()=>{throw Error("REFUND_INTAKE_HANDLE_FORBIDDEN")}});
   if(quarantine.ack!==true||quarantine.status!=="quarantined")
    return Object.freeze({handled:true,ack:false,retry:quarantine.retry===true,
     status:quarantine.retry===true?"retry":"rejected",
     code:quarantine.code??"REFUND_IDENTITY_QUARANTINE_UNCONFIRMED",
     creditMutation:false,refundAllowed:false});
   // 2) v4 identity only after the durable quarantine receipt.
   const bound=await binder.bind(envelope);
   if(!bound.ok)return rejected(bound.reason,bound.retrySafe===true);
   return Object.freeze({handled:true,ack:true,retry:false,status:"quarantined",
    code:quarantine.code,identity:"bound",creditMutation:false,refundAllowed:false});
  }
 });
}
