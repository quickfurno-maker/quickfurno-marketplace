/**
 * Read-only, offline VOX Finance timeline candidate. Never grants financial access:
 * must be used alongside current verified Core scope/grants and managed RLS.
 * Does not connect to Razorpay, Supabase, bank, wallet or outbound providers.
 */
import {evaluateFinanceReadGrant} from "../../contracts/vox/financeReadGrant.mjs";
import {financeTimeline} from "./financeV2Pay3.mjs";
const string=x=>typeof x==="string"&&x.length>0&&x.length<=180&&x===x.trim();
export function buildFinanceHistoryPreview(input={}){
 const {scope,grant,revoked,vendorId,providerMode,merchantAccountId,
  orderId,events,now}=input;
 if(!evaluateFinanceReadGrant({scope,grant,revoked,vendorId,now})||
    !["test","live"].includes(providerMode)||!string(merchantAccountId)||
    !string(orderId)||!Array.isArray(events)||events.length>150)
   throw Error("FINANCE_HISTORY_SCOPE_DENIED");
 const seen=new Set();
 const bounded=events.map(e=>{
   if(!e||typeof e!=="object"||Array.isArray(e)||
     Object.keys(e).some(k=>!["eventId","kind","reference","occurredAt","amountSubunits",
       "providerMode","merchantAccountId","orderId","vendorId"].includes(k))||
     !string(e.eventId)||!string(e.reference)||e.providerMode!==providerMode||
     e.merchantAccountId!==merchantAccountId||e.orderId!==orderId||
     e.vendorId!==vendorId||seen.has(e.eventId))
     throw Error("FINANCE_HISTORY_EVENT_ISOLATION_DENIED");
   seen.add(e.eventId);
   return {kind:e.kind,reference:e.reference,occurredAt:e.occurredAt,
     amountSubunits:e.amountSubunits,providerMode:e.providerMode};
 });
 const timeline=financeTimeline({providerMode,orderId,events:bounded});
 return Object.freeze({schema:"qf.step3b7.finance.history.preview.v1",
  vendorId,orderId,providerMode,entries:timeline,
  immutablePreview:true,bankSettlementVerified:false,
  paymentAuthorized:false,refundAuthorized:false,walletCreditAuthorized:false,
  actualProviderTestCertified:false,releaseStatus:"HOLD"});
}
