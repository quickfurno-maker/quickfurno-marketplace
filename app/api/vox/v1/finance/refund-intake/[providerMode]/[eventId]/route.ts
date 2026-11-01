import "server-only";
import {adminClient} from "@/lib/supabase";
import {verifyVoxFinanceRefundReviewerBearer} from "@/services/vox/verifiedFinanceReviewerBearer";
import {createRefundCaseReviewHandler,type RefundCaseSnapshot} from "@/services/vox/financeRefundCaseReview";
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
 return handle(request,await params);
}
export function POST(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return reply({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
