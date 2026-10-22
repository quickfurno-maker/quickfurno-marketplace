import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVendorPackagePaymentAvailability} from "@/services/vendorPackagePaymentService";
import {processFinanceInboxBatch} from "@/lib/payments/financeV2Pay3Final.mjs";
const PAY=/^pay_[A-Za-z0-9]{4,96}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** PAY-3 Staging-only processor. Provider GET and audited inbox completion; ZERO credit writes. */
export async function runFinanceV2StagingInboxCanary(){
 if(process.env.FINANCE_V2_PAY3_INBOX_WORKER_ENABLED!=="staging"||
  process.env.RAZORPAY_VENDOR_PACKAGE_MODE!=="test")
  throw Error("FINANCE_INBOX_DISABLED");
 const config=getVendorPackagePaymentAvailability();
 const secret=process.env.RAZORPAY_TEST_KEY_SECRET;
 const key=process.env.RAZORPAY_TEST_KEY_ID;
 const merchant=process.env.FINANCE_V2_TEST_MERCHANT_ACCOUNT_ID;
 if(!config.enabled||config.mode!=="test"||!key||!secret||!merchant)
  throw Error("FINANCE_INBOX_CONFIG_INVALID");
 const db=adminClient();
 // Terminalize bounded exhausted leases before claiming new work; never credit/refund.
 const expired=await db.rpc("qf_finance_v2_expire_exhausted_inbox",{p_limit:10});
 if(expired.error||typeof expired.data!=="number")throw Error("FINANCE_RECOVERY_UNAVAILABLE");
 const result=await processFinanceInboxBatch({
  max:5,
  claim:async limit=>{
   const r=await db.rpc("qf_finance_v2_claim_inbox",{p_limit:limit});
   if(r.error||!Array.isArray(r.data))throw Error("FINANCE_CLAIM_UNAVAILABLE");
   return r.data;
  },
  load:async (eventId:string)=>{
   if(!UUID.test(eventId))throw Error("FINANCE_EVENT_ID_INVALID");
   const event=await db.from("finance_provider_events")
    .select("id,event_type,provider_mode,merchant_account_id,order_id,signature_verified")
    .eq("id",eventId).maybeSingle();
   if(event.error||!event.data||event.data.signature_verified!==true||
    event.data.provider_mode!=="test"||event.data.merchant_account_id!==merchant||
    !UUID.test(String(event.data.order_id)))throw Error("FINANCE_EVENT_INVALID");
   const [link,order]=await Promise.all([
    db.from("finance_provider_event_payment_links")
     .select("provider_payment_id,provider_order_id,amount_subunits,currency")
     .eq("event_row_id",eventId).maybeSingle(),
    db.from("vendor_package_orders")
     .select("id,payment_provider,provider_mode,provider_order_id,provider_amount_subunits,package_currency")
     .eq("id",event.data.order_id).maybeSingle()
   ]);
   if(link.error||!link.data||order.error||!order.data||order.data.payment_provider!=="razorpay"||
    order.data.provider_mode!=="test"||!PAY.test(link.data.provider_payment_id)||
    order.data.provider_order_id!==link.data.provider_order_id||
    Number(order.data.provider_amount_subunits)!==link.data.amount_subunits||
    link.data.currency!=="INR"||order.data.package_currency!=="INR")
    throw Error("FINANCE_ORDER_LINK_MISMATCH");
   return {event:event.data,expected:{
    providerMode:"test",merchantAccountId:merchant,
    providerOrderId:link.data.provider_order_id,providerPaymentId:link.data.provider_payment_id,
    amountSubunits:link.data.amount_subunits,currency:"INR"}};
  },
  providerRead:async (paymentId:string,mode:string)=>{
   if(mode!=="test"||!PAY.test(paymentId))throw Error("FINANCE_PROVIDER_READ_DENIED");
   const response=await fetch("https://api.razorpay.com/v1/payments/"+encodeURIComponent(paymentId),{
    method:"GET",headers:{authorization:"Basic "+Buffer.from(key+":"+secret).toString("base64")},
    cache:"no-store",redirect:"error",signal:AbortSignal.timeout(7000)
   });
   if(!response.ok)throw Error("FINANCE_PROVIDER_FETCH_FAILED");
   return response.json();
  },
  finish:async (job:string,lease:string,outcome:string,reason:string)=>{
   if(!UUID.test(job)||!UUID.test(lease))throw Error("FINANCE_LEASE_INVALID");
   const r=await db.rpc("qf_finance_v2_finish_inbox",
    {p_job:job,p_token:lease,p_outcome:outcome,p_reason:reason});
   if(r.error)throw Error("FINANCE_INBOX_ACK_FAILED");
   return r.data===true;
  }
 });
 const health=await db.from("qf_finance_v2_inbox_health_v")
  .select("total,ready,retry,active,expired,dead_letter,verified").single();
 if(health.error||!health.data)throw Error("FINANCE_INBOX_HEALTH_UNAVAILABLE");
 const snapshot=health.data;
 const metrics=["total","ready","retry","active","expired","dead_letter","verified"] as const;
 for(const n of metrics){
  if(!Number.isSafeInteger(snapshot[n])||snapshot[n]<0)throw Error("FINANCE_HEALTH_INVALID");
 }
 return {ok:true,mode:"AUDIT_ONLY",creditWrites:0,processed:result.length,
  acknowledged:result.filter((r:{accepted:boolean})=>r.accepted).length,
  exhaustedDeadLetters:expired.data,health:snapshot};
}
