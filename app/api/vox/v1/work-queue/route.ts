import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {projectScopedWorkQueue} from "@/contracts/vox/workQueuePreview.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const send=(body:unknown,status:number)=>Response.json(body,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization",
 "x-content-type-options":"nosniff"
}});
/** Private, metadata-only queue. No work action permitted by this endpoint.
 * Effective department intersection must be explicitly on; an existing Core
 * object assignment alone is never enough to access this new Staff queue.
 */
export async function GET(request:Request){
 if(process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging"||
    process.env.VOX_WORK_QUEUE_READ_ENABLED!=="staging")
  return send({ok:false,error:"WORK_QUEUE_DISABLED"},503);
 try{
  const url=new URL(request.url);
  if(url.search||url.hash)return send({ok:false,error:"UNSUPPORTED_FILTER"},400);
  const scope=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!scope||scope.canReadContent!==true||
     scope.role==="team_leader"||scope.role==="auditor")
   return send({ok:false,error:"CURRENT_AAL2_STAFF_SCOPE_REQUIRED"},403);
  const db=adminClient();
  const prospects=scope.prospectIds.length?await db.from("aarohi_prospects")
   .select("id").eq("city_id",scope.cityId)
   .in("id",[...scope.prospectIds]).limit(201):{data:[],error:null};
  const zones=scope.vendorIds.length?await db.from("marketplace_service_zones")
   .select("id").eq("city_id",scope.cityId).eq("is_active",true)
   .limit(201):{data:[],error:null};
  if(prospects.error||zones.error||!prospects.data||!zones.data||
     prospects.data.length>200||zones.data.length>200)
   return send({ok:false,error:"CANONICAL_PROSPECT_ZONE_PROOF_FAILED"},503);
  const verifiedProspectIds=prospects.data.map(p=>p.id);
  const validVendors=scope.vendorIds.length&&zones.data.length?
   await db.from("vendors").select("id")
   .in("id",[...scope.vendorIds]).in("service_zone_id",zones.data.map(z=>z.id))
   .limit(201):{data:[],error:null};
  if(validVendors.error||!validVendors.data||validVendors.data.length>200)
   return send({ok:false,error:"CANONICAL_VENDOR_PROOF_FAILED"},503);
  const verifiedVendorIds=validVendors.data.map(v=>v.id);
  const threads=scope.supportThreadIds.length&&verifiedVendorIds.length?
   await db.from("vendor_support_threads").select("id")
   .in("id",[...scope.supportThreadIds])
   .in("vendor_id",verifiedVendorIds).limit(201):{data:[],error:null};
  if(threads.error||!threads.data||threads.data.length>200)
   return send({ok:false,error:"CANONICAL_SUPPORT_PROOF_FAILED"},503);
  const verifiedSupportThreadIds=threads.data.map(t=>t.id);
  if(!verifiedProspectIds.length&&!verifiedVendorIds.length&&!verifiedSupportThreadIds.length)
   return send({ok:true,schema:"qf.vox.work.queue.preview.v1",mode:"READ_ONLY",
    actionsEnabled:false,boundedWindow:true,completeness:"BOUNDED_NOT_TOTAL",items:[]},200);
  // Candidate SQL table remains absent in staging/production. If feature
  // flags are enabled prematurely, no fallback or fabricated work appears.
  const work=await db.from("vox_work_items_candidate_v1")
   .select("id,team_id,city_id,source_kind,source_id,assignee_id,state,revision,updated_at")
   .eq("team_id",scope.teamId).eq("city_id",scope.cityId)
   .order("updated_at",{ascending:false}).limit(25);
  if(work.error||!work.data)return send({ok:false,error:"WORK_SOURCE_UNAVAILABLE"},503);
  const result=projectScopedWorkQueue({scope,rows:work.data,
   verifiedProspectIds,verifiedVendorIds,verifiedSupportThreadIds});
  if(!result.ok)return send({ok:false,error:"INVALID_CORE_WORK_PROJECTION"},503);
  return send(result,200);
 }catch{return send({ok:false,error:"WORK_QUEUE_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"READ_ONLY"},405);}
export function PATCH(){return send({ok:false,error:"READ_ONLY"},405);}
export function PUT(){return send({ok:false,error:"READ_ONLY"},405);}
export function DELETE(){return send({ok:false,error:"READ_ONLY"},405);}
