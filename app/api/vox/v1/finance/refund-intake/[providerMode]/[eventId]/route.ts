import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxFinanceRefundReviewerBearer} from "@/services/vox/verifiedFinanceReviewerBearer";
import {createRefundCaseReviewHandler,REFUND_CASE_GATES,type RefundCaseSnapshot} from "@/services/vox/financeRefundCaseReview";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"}});
/** SOURCE-ONLY, default OFF. Read-only per-refund case review (RC41). One
 * read-only RPC snapshot over PostgREST (no pg pool); no write, refund, credit
 * or provider path exists. Fails closed while no canonical Finance role exists. */
const handle=createRefundCaseReviewHandler({
 verifyReviewer:verifyVoxFinanceRefundReviewerBearer,
 macKey:()=>process.env.QF_VOX_REFUND_IDENTITY_MAC_KEY,
 async loadSnapshot(eventId,providerMode){
  const r=await adminClient().rpc("qf_get_vendor_package_refund_case_snapshot_v1",
   {p_event_id:eventId,p_provider_mode:providerMode});
  if(r.error)throw new Error("REFUND_CASE_SNAPSHOT_UNAVAILABLE");
  if(r.data==null)return null;
  return r.data as RefundCaseSnapshot;
 }
});
export async function GET(request:Request,{params}:{params:Promise<{providerMode:string;eventId:string}>}){
 // The Core route independently enforces the canonical Finance reviewer AAL2
 // before delegating; the handler re-verifies both before and after its reads.
 if(REFUND_CASE_GATES.some(k=>process.env[k]!=="staging"))
  return reply({ok:false,error:"REFUND_CASE_REVIEW_DISABLED"},503);
 const p=await params,u=new URL(request.url);
 if(u.search||u.hash||!/^(test|live)$/.test(p.providerMode)||
    !/^[A-Za-z0-9_-]{8,64}$/.test(p.eventId))
  return reply({ok:false,error:"REFUND_CASE_REQUEST_INVALID"},400);
 try{
  if(!await verifyVoxFinanceRefundReviewerBearer(request.headers.get("authorization")))
   return reply({ok:false,error:"FINANCE_REVIEWER_AAL2_ROLE_REQUIRED"},403);
 }catch{return reply({ok:false,error:"FINANCE_REVIEWER_AUTH_UNAVAILABLE"},503);}
 return handle(request,p);
}
export function POST(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
