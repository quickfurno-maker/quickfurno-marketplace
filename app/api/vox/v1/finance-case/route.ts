import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {financeStaffAllowed} from "@/services/financeV2Scope";
import {validateFinanceCaseRequest} from "@/lib/payments/financeV2Pay4aCase.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const deny=(error:string,status:number)=>Response.json({ok:false,error},{
 status,headers:{"cache-control":"private, no-store, max-age=0","vary":"Authorization"}});
export async function POST(request:Request){
 if(process.env.FINANCE_V2_PAY4A_CASE_WRITES_ENABLED!=="staging"||
    process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")
  return deny("FINANCE_CASE_DISABLED",503);
 const len=Number(request.headers.get("content-length")??"0");
 if(!Number.isFinite(len)||len>2048)return deny("BODY_TOO_LARGE",413);
 let body;
 try{body=validateFinanceCaseRequest(await request.json());}
 catch{return deny("FINANCE_CASE_INVALID",400);}
 const bearer=request.headers.get("authorization");
 try{
  const staff=await getVerifiedScopedStaff(bearer);
  if(!staff)return deny("STAFF_AAL2_REQUIRED",403);
  const db=adminClient();
  const order=await db.from("vendor_package_orders")
   .select("id,vendor_id,provider_mode").eq("id",body.orderId).maybeSingle();
  if(order.error||!order.data||!["test","live"].includes(order.data.provider_mode))
   return deny("ORDER_UNAVAILABLE",404);
  const vendor=order.data.vendor_id;
  if(!await financeStaffAllowed(staff,vendor))return deny("FINANCE_GRANT_REQUIRED",403);
  // Recheck fresh grants and AAL2 before any write.
  const fresh=await getVerifiedScopedStaff(bearer);
  if(!fresh||fresh.userId!==staff.userId||!await financeStaffAllowed(fresh,vendor))
   return deny("FINANCE_GRANT_REVOKED",403);
  const existing=await db.from("finance_staff_case_requests")
   .select("id,order_id,vendor_id,case_kind,requested_amount_subunits,evidence_sha256")
   .eq("requested_by",staff.userId).eq("client_request_id",body.clientRequestId).limit(2);
  if(existing.error||!existing.data||existing.data.length>1)return deny("FINANCE_CASE_UNAVAILABLE",503);
  if(existing.data.length===1){
   const x=existing.data[0];
   if(x.order_id!==body.orderId||x.vendor_id!==vendor||x.case_kind!==body.caseKind||
      x.requested_amount_subunits!==body.requestedAmountSubunits||
      x.evidence_sha256!==body.evidenceSha256)return deny("FINANCE_CASE_REPLAY_CONFLICT",409);
   return Response.json({ok:true,caseId:x.id,state:"EVIDENCE_REQUESTED",
    paymentExecution:false},{headers:{"cache-control":"no-store"}});
  }
  const saved=await db.from("finance_staff_case_requests").insert({
   client_request_id:body.clientRequestId,order_id:body.orderId,vendor_id:vendor,
   requested_by:staff.userId,case_kind:body.caseKind,
   requested_amount_subunits:body.requestedAmountSubunits,evidence_sha256:body.evidenceSha256
  }).select("id").single();
  if(saved.error||!saved.data)return deny("FINANCE_CASE_UNAVAILABLE",503);
  return Response.json({ok:true,caseId:saved.data.id,state:"EVIDENCE_REQUESTED",
   paymentExecution:false},{status:201,headers:{"cache-control":"no-store"}});
 }catch{return deny("FINANCE_CASE_UNAVAILABLE",503);}
}
export function GET(){return deny("METHOD_NOT_ALLOWED",405);}
export function PUT(){return deny("METHOD_NOT_ALLOWED",405);}
export function PATCH(){return deny("METHOD_NOT_ALLOWED",405);}
export function DELETE(){return deny("METHOD_NOT_ALLOWED",405);}
