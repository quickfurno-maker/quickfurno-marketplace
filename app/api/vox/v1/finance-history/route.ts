import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {financeTimeline,type Pay3Mode,type Pay3EventKind} from "@/lib/payments/financeV2Pay3.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const respond=(v:unknown,s:number)=>Response.json(v,{status:s,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization","x-content-type-options":"nosniff"
}});
const validString=(v:unknown,max=180)=>typeof v==="string"&&v.length>0&&v.length<=max;
const validDate=(v:unknown)=>typeof v==="string"&&Number.isFinite(Date.parse(v));
const validAmount=(v:unknown)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
export async function GET(request:Request){
 if(process.env.FINANCE_V2_PAY3_READ_ENABLED!=="staging"||
    process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")
   return respond({ok:false,error:"FINANCE_HISTORY_DISABLED"},503);
 const url=new URL(request.url),keys=[...url.searchParams.keys()];
 const id=url.searchParams.get("orderId");
 if(keys.length!==1||keys[0]!=="orderId"||!id||!UUID.test(id)||url.hash)
   return respond({ok:false,error:"ORDER_ID_INVALID"},400);
 try{
  // No Finance Staff privileges before explicit department capability certification.
  const owner=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!owner)return respond({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
  const db=adminClient();
  const order=await db.from("vendor_package_orders")
   .select("id,payment_provider,provider_mode,provider_status,activation_status")
   .eq("id",id).maybeSingle();
  if(order.error||!order.data||order.data.payment_provider!=="razorpay"||
     !["test","live"].includes(order.data.provider_mode))
   return respond({ok:false,error:"ORDER_UNAVAILABLE_OR_UNCLASSIFIED"},503);
  const mode=order.data.provider_mode as Pay3Mode;
  const [attempts,events,audit]=await Promise.all([
   db.from("finance_payment_attempts")
    .select("id,provider,provider_mode,initiated_at,expected_amount_subunits").eq("order_id",id).limit(51),
   db.from("finance_provider_events")
    .select("id,provider,provider_mode,event_type,received_at,signature_verified").eq("order_id",id).limit(51),
   db.from("finance_audit_events")
    .select("id,related_order_id,occurred_at").eq("related_order_id",id).limit(51)
  ]);
  if(attempts.error||events.error||audit.error||!attempts.data||!events.data||!audit.data||
     attempts.data.length>50||events.data.length>50||audit.data.length>50)
   return respond({ok:false,error:"FINANCE_HISTORY_UNAVAILABLE_OR_OVER_LIMIT"},503);
  const attemptIds=attempts.data.map(v=>v.id);
  const refunds=attemptIds.length?await db.from("finance_refunds")
   .select("id,provider,provider_mode,attempt_id,requested_at,requested_amount_subunits")
   .in("attempt_id",attemptIds).limit(51):{data:[],error:null};
  if(refunds.error||!refunds.data||refunds.data.length>50)
   return respond({ok:false,error:"FINANCE_REFUNDS_UNAVAILABLE_OR_OVER_LIMIT"},503);
  const timelineInput:Array<{kind:Pay3EventKind;reference:string;occurredAt:string;
   amountSubunits:number|null;providerMode:Pay3Mode}>=[];
  function append(kind:Pay3EventKind,reference:unknown,time:unknown,money:unknown,rowMode:unknown){
   if(!validString(reference)||!UUID.test(reference as string)||!validDate(time)||
      !(money===null||validAmount(money))||rowMode!==mode)throw Error("FINANCE_ROW_INVALID");
   timelineInput.push({kind,reference:reference as string,occurredAt:time as string,
    amountSubunits:money as number|null,providerMode:mode});
  }
  for(const row of attempts.data){
   if(row.provider!=="razorpay")throw Error("FINANCE_PROVIDER_MISMATCH");
   append("attempt",row.id,row.initiated_at,row.expected_amount_subunits,row.provider_mode);
  }
  for(const row of events.data){
   if(row.provider!=="razorpay"||row.signature_verified!==true)throw Error("FINANCE_UNVERIFIED_EVENT");
   append(row.event_type==="payment.captured"?"capture":"audit",row.id,row.received_at,null,row.provider_mode);
  }
  for(const row of refunds.data){
   if(row.provider!=="razorpay"||!attemptIds.includes(row.attempt_id))throw Error("REFUND_ORPHAN");
   append("refund",row.id,row.requested_at,row.requested_amount_subunits,row.provider_mode);
  }
  for(const row of audit.data){
   if(row.related_order_id!==id)throw Error("AUDIT_ORDER_MISMATCH");
   append("audit",row.id,row.occurred_at,null,mode);
  }
  if(await verifyVoxOwnerBearer(request.headers.get("authorization"))!==owner)
   return respond({ok:false,error:"OWNER_AUTH_REVOKED_DURING_FINANCE_READ"},403);
  return respond({ok:true,schema:"qf.vox.finance.history.v1",mode:"READ_ONLY",actionsEnabled:false,
   certification:"NOT_CERTIFIED",orderId:id,providerMode:mode,
   providerStatus:validString(order.data.provider_status,30)?order.data.provider_status:"UNKNOWN",
   activationStatus:validString(order.data.activation_status,30)?order.data.activation_status:"UNKNOWN",
   timeline:financeTimeline({providerMode:mode,orderId:id,events:timelineInput})},200);
 }catch{return respond({ok:false,error:"FINANCE_HISTORY_UNAVAILABLE"},503);}
}
export function POST(){return respond({ok:false,error:"FINANCE_READ_ONLY"},405);}
export function PUT(){return respond({ok:false,error:"FINANCE_READ_ONLY"},405);}
export function PATCH(){return respond({ok:false,error:"FINANCE_READ_ONLY"},405);}
export function DELETE(){return respond({ok:false,error:"FINANCE_READ_ONLY"},405);}
