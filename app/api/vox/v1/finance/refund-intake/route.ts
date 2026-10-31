import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {verifyVoxFinanceRefundReviewerBearer} from "@/services/vox/verifiedFinanceReviewerBearer";
import {projectRefundIntakePreview} from "@/lib/payments/vendorPackageRefundReviewAuthority.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"}});
const gates=["VOX_FINANCE_READ_ENABLED","VOX_STAFF_READ_ENABLED","VOX_STAFF_GRANTS_ENABLED"];
/** SOURCE-ONLY, default disabled. Read-only preview of quarantined refund
 * intake events for the existing Owner finance reader (AAL2, Superadmin).
 * Exposes no body hash, credits, provider call or write capability. */
export async function GET(request:Request){
 if(process.env.VOX_FINANCE_REFUND_REVIEW_PREVIEW_ENABLED!=="staging"||
    gates.some(k=>process.env[k]!=="staging"))
  return reply({ok:false,error:"REFUND_REVIEW_PREVIEW_DISABLED"},503);
 const u=new URL(request.url);
 if(u.search||u.hash)return reply({ok:false,error:"FILTERS_NOT_CERTIFIED"},400);
 const bearer=request.headers.get("authorization");
 try{
  const owner=await verifyVoxOwnerBearer(bearer);
  if(!owner)return reply({ok:false,error:"OWNER_AAL2_REQUIRED"},403);
  const result=await adminClient().from("qf_vendor_package_provider_events_candidate_v2")
   .select("event_id,provider_mode,event_type,payment_id,provider_order_id,status,error_code")
   .like("event_type","refund.%").eq("status","quarantined")
   .eq("error_code","REFUND_REVIEW_REQUIRED").limit(21);
  if(result.error||!Array.isArray(result.data)||result.data.length>20)
   return reply({ok:false,error:"REFUND_INTAKE_UNAVAILABLE_OR_OVER_LIMIT"},503);
  const events=projectRefundIntakePreview(result.data);
  if(!events)return reply({ok:false,error:"REFUND_INTAKE_UNTRUSTED"},503);
  const current=await verifyVoxOwnerBearer(bearer);
  if(!current||current!==owner)return reply({ok:false,error:"OWNER_AUTH_REVOKED_DURING_READ"},403);
  return reply({ok:true,schema:"qf.vox.finance.refund-intake-preview.v1",mode:"READ_ONLY",
   canReview:false,canRefund:false,canRevokeCredits:false,isCompleteHistory:false,
   previewCount:events.length,events},200);
 }catch{return reply({ok:false,error:"REFUND_INTAKE_UNAVAILABLE"},503);}
}
/** Fail-closed review writer. Authority is a verified AAL2 Staff principal with
 * a canonical finance role (none exists, so this always denies). The request
 * body is never read: a reviewer id can never come from the caller. The Core
 * writer is not installed because refund_id is not yet durably stored with the
 * quarantined event; wiring it requires a reviewed ledger change. */
export async function POST(request:Request){
 if(process.env.VOX_FINANCE_REFUND_REVIEW_WRITE_ENABLED!=="staging"||
    gates.some(k=>process.env[k]!=="staging"))
  return reply({ok:false,error:"REFUND_REVIEW_WRITE_DISABLED"},503);
 try{
  const reviewer=await verifyVoxFinanceRefundReviewerBearer(request.headers.get("authorization"));
  if(!reviewer)return reply({ok:false,error:"FINANCE_REVIEWER_AAL2_ROLE_REQUIRED"},403);
  return reply({ok:false,error:"REFUND_REVIEW_WRITER_NOT_INSTALLED",
   creditMutation:false,refundAllowed:false},503);
 }catch{return reply({ok:false,error:"REFUND_REVIEW_UNAVAILABLE"},503);}
}
export function PUT(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
