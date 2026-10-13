import {adminClient} from "@/lib/supabase";
import {verifyVoxOwnerBearer} from "@/services/vox/verifiedStaffBearer";
import {projectVoxOverview} from "@/services/vox/overviewProjection.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff","vary":"Authorization"};
function response(value:unknown,status:number){return new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});}
/** Read-only pre-staff rollout gate. Only verified existing Core Superadmin at AAL2.
 * Delegated staff/city/team reads remain impossible until certified VOX grants. */
export async function GET(request:Request){
 try {
  const actor=await verifyVoxOwnerBearer(request.headers.get("authorization"));
  if(!actor) return response({ok:false,error:"UNAUTHORIZED"},401);
  const db=adminClient();
  const [prospects,crm,support,human]=await Promise.all([
   db.from("aarohi_prospects").select("id,business_name,prospect_stage,priority_band,last_activity_at")
     .order("last_activity_at",{ascending:false}).limit(8),
   db.from("vendor_crm_profiles").select("vendor_id,onboarding_stage,relationship_status,next_follow_up_at")
     .order("updated_at",{ascending:false}).limit(8),
   db.from("vendor_support_threads").select("id,vendor_id,status,priority,updated_at")
     .order("updated_at",{ascending:false}).limit(8),
   db.from("communication_conversations").select("id,subject_type,state,human_takeover,revision,updated_at")
     .eq("state","HUMAN").eq("human_takeover",true).order("updated_at",{ascending:false}).limit(8),
  ]);
  if(prospects.error||crm.error||support.error||human.error)return response({ok:false,error:"READ_UNAVAILABLE"},503);
  return response({ok:true,view:projectVoxOverview({
   prospects:prospects.data,crm:crm.data,vendorSupport:support.data,humanConversations:human.data,
  })},200);
 } catch {return response({ok:false,error:"READ_UNAVAILABLE"},503);}
}
export function POST(){return response({ok:false,error:"READ_ONLY"},405);}
export function PUT(){return response({ok:false,error:"READ_ONLY"},405);}
export function DELETE(){return response({ok:false,error:"READ_ONLY"},405);}
