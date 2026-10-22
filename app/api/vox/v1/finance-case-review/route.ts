import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {validateFinanceCaseDecision} from "@/lib/payments/financeV2Pay4aCase.mjs";
export const runtime="nodejs";export const dynamic="force-dynamic";
const deny=(error:string,status:number)=>Response.json({ok:false,error},{
 status,headers:{"cache-control":"private, no-store, max-age=0","vary":"Authorization"}});
const active=()=>process.env.FINANCE_V2_PAY4A_CASE_WRITES_ENABLED==="staging"&&
 process.env.VOX_STAFF_PORTAL_ENABLED==="staging";
export async function GET(request:Request){
 if(!active())return deny("FINANCE_CASE_DISABLED",503);
 const bearer=request.headers.get("authorization");
 const owner=await verifyVoxOwnerBearer(bearer);
 if(!owner)return deny("OWNER_AAL2_REQUIRED",403);
 try{
  const result=await adminClient().from("finance_staff_case_requests")
   .select("id,order_id,case_kind,requested_amount_subunits,created_at")
   .order("created_at",{ascending:false}).limit(20);
  if(result.error||!result.data)return deny("FINANCE_CASE_UNAVAILABLE",503);
  if(await verifyVoxOwnerBearer(bearer)!==owner)return deny("OWNER_AUTH_REVOKED",403);
  return Response.json({ok:true,certification:"NOT_CERTIFIED",
   cases:result.data,financialExecution:false},{headers:{"cache-control":"private, no-store"}});
 }catch{return deny("FINANCE_CASE_UNAVAILABLE",503);}
}
export async function POST(request:Request){
 if(!active())return deny("FINANCE_CASE_DISABLED",503);
 if(Number(request.headers.get("content-length")??"0")>2048)
  return deny("BODY_TOO_LARGE",413);
 let input;
 try{input=validateFinanceCaseDecision(await request.json());}
 catch{return deny("FINANCE_REVIEW_INVALID",400);}
 const bearer=request.headers.get("authorization");
 try{
  const owner=await verifyVoxOwnerBearer(bearer);
  if(!owner)return deny("OWNER_AAL2_REQUIRED",403);
  const db=adminClient();
  const original=await db.from("finance_staff_case_requests")
   .select("id,requested_by").eq("id",input.caseId).maybeSingle();
  if(original.error||!original.data||original.data.requested_by===owner)
   return deny("INDEPENDENT_REVIEW_REQUIRED",403);
  const existing=await db.from("finance_staff_case_reviews")
   .select("id,reviewer_id,decision,review_reference,reason_code")
   .eq("case_id",input.caseId).limit(2);
  if(existing.error||!existing.data||existing.data.length>1)
   return deny("FINANCE_REVIEW_UNAVAILABLE",503);
  if(existing.data.length===1){
   const r=existing.data[0];
   if(r.reviewer_id!==owner||r.decision!==input.decision||
      r.review_reference!==input.reviewReference||r.reason_code!==input.reasonCode)
    return deny("REVIEW_CONFLICT",409);
   return Response.json({ok:true,reviewId:r.id,financialExecution:false},{
    headers:{"cache-control":"no-store"}});
  }
  if(await verifyVoxOwnerBearer(bearer)!==owner)
   return deny("OWNER_AUTH_REVOKED",403);
  const out=await db.from("finance_staff_case_reviews").insert({
   case_id:input.caseId,reviewer_id:owner,case_requester_id:original.data.requested_by,
   decision:input.decision,review_reference:input.reviewReference,
   reason_code:input.reasonCode
  }).select("id").single();
  if(out.error||!out.data)return deny("FINANCE_REVIEW_UNAVAILABLE",503);
  return Response.json({ok:true,reviewId:out.data.id,
   state:"REVIEW_ONLY_NO_PAYMENT_EXECUTION",financialExecution:false},{
   status:201,headers:{"cache-control":"no-store"}});
 }catch{return deny("FINANCE_REVIEW_UNAVAILABLE",503);}
}
export function PUT(){return deny("METHOD_NOT_ALLOWED",405);}
export function PATCH(){return deny("METHOD_NOT_ALLOWED",405);}
export function DELETE(){return deny("METHOD_NOT_ALLOWED",405);}
