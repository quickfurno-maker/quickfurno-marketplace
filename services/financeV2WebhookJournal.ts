import "server-only";
import {adminClient} from "@/lib/supabase";
import {prepareVerifiedRazorpayFinanceEvent} from "@/lib/payments/financeV2ProviderEvent.mjs";
import {getVendorPackagePaymentAvailability} from "@/services/vendorPackagePaymentService";
const REF=/^(?:order|pay)_[A-Za-z0-9]{4,96}$/;
const MERCHANT=/^[A-Za-z0-9_-]{4,64}$/;
const amount=(x:unknown):x is number=>typeof x==="number"&&Number.isSafeInteger(x)&&x>0;
function fail():never{throw Error("FINANCE_RECEIPT_REJECTED");}
/** Off-by-default append-only signed journal; does NOT replace atomic checkout authority. */
export async function journalRazorpayFinanceV2Receipt(
 rawBody:string,signature:string,eventId:string
):Promise<{state:"RECORDED"|"IGNORED"}>{
 if(process.env.FINANCE_V2_PAY3_WEBHOOK_RECEIPT_ENABLED!=="staging")fail();
 if(typeof rawBody!=="string"||rawBody.length===0||rawBody.length>131072)fail();
 const cfg=getVendorPackagePaymentAvailability();
 // Hard-disable LIVE journal integration until PAY-4 reviewed provider canaries.
 if(!cfg.enabled||cfg.mode!=="test")fail();
 const mode=cfg.mode;
 const secret=process.env.RAZORPAY_TEST_WEBHOOK_SECRET;
 const merchant=process.env.FINANCE_V2_TEST_MERCHANT_ACCOUNT_ID;
 if(!secret||!merchant||!MERCHANT.test(merchant))fail();
 let receipt;
 try{receipt=prepareVerifiedRazorpayFinanceEvent({
  rawBody,signature,eventId,webhookSecret:secret,providerMode:mode,
  merchantAccountId:merchant
 });}catch{fail();}
 if(!["payment.captured","payment.failed"].includes(receipt!.event_type))
  return {state:"IGNORED"};
 let payload;
 try{payload=JSON.parse(rawBody)}catch{fail();}
 const p=payload?.payload?.payment?.entity;
 if(!p||!REF.test(String(p.order_id))||!REF.test(String(p.id))||
  !amount(p.amount)||p.currency!=="INR")fail();
 const db=adminClient();
 const order=await db.from("vendor_package_orders")
  .select("id,payment_provider,provider_mode,provider_order_id,provider_amount_subunits")
  .eq("provider_order_id",p.order_id).maybeSingle();
 if(order.error||!order.data||order.data.payment_provider!=="razorpay"||
  order.data.provider_mode!==mode||!amount(Number(order.data.provider_amount_subunits))||
  Number(order.data.provider_amount_subunits)!==p.amount)fail();
 const r=await db.rpc("qf_finance_v2_record_webhook_v1",{
  p_event_id:eventId,p_mode:mode,p_merchant:merchant,p_event_type:receipt!.event_type,
  p_payload_hash:receipt!.payload_sha256,p_provider_order_id:p.order_id,
  p_provider_payment_id:p.id,p_amount_subunits:p.amount
 });
 if(r.error||typeof r.data!=="string")fail();
 return {state:"RECORDED"};
}
