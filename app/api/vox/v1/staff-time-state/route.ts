import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {projectVerifiedStaffTimeRow} from "@/contracts/vox/virtualOfficeTimeRead.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
// REVIEW-ONLY table exists in disposable PG17, not in managed Staging.
// No environment flag can activate the live read without reviewed code change.
const VO4_MANAGED_TIME_READ_CERTIFIED=false as const;
const headers={"cache-control":"private, no-store, max-age=0",
 "vary":"Authorization","x-content-type-options":"nosniff"};
const send=(body:unknown,status:number)=>Response.json(body,{status,headers});
const same=(a:Record<string,unknown>,b:Record<string,unknown>)=>{
 const keys=["userId","teamId","cityId","role","canMutate","canReadContent"];
 if(keys.some(k=>a[k]!==b[k]))return false;
 for(const k of ["prospectIds","vendorIds","supportThreadIds",
  "conversationIds","verifiedDepartments"]){
  if(!Array.isArray(a[k])||!Array.isArray(b[k]))return false;
  const before=[...(a[k] as string[])].sort();
  const after=[...(b[k] as string[])].sort();
  if(before.length!==after.length||before.some((x,i)=>x!==after[i]))return false;
 }
 return true;
};
export async function GET(request:Request){
 if(!VO4_MANAGED_TIME_READ_CERTIFIED||
    process.env.VOX_VO4_TIME_READ_ENABLED!=="staging"||
    process.env.VOX_STAFF_GRANTS_ENABLED!=="staging"||
    process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging")
  return send({ok:false,error:"STAFF_TIME_READ_NOT_CERTIFIED"},503);
 if(new URL(request.url).search||new URL(request.url).hash)
  return send({ok:false,error:"FILTER_DENIED"},400);
 let scoped:Awaited<ReturnType<typeof getVerifiedScopedStaff>>;
 try{scoped=await getVerifiedScopedStaff(request.headers.get("authorization"));}
 catch{return send({ok:false,error:"CURRENT_STAFF_UNAVAILABLE"},503);}
 if(!scoped||scoped.canMutate!==false||scoped.canReadContent!==true||
    ["team_leader","auditor"].includes(scoped.role))
  return send({ok:false,error:"CURRENT_STAFF_AAL2_REQUIRED"},403);
 const selected=["staff_id","team_id","city_id","revision","clocked_in_at",
  "clocked_out_at","break_started_at","total_break_ms","active_work_item_id",
  "task_started_at","last_work_item_id","task_time_ms","last_event_at"];
 try{
  const db=adminClient();
  const result=await db.from("vox_vo2_staff_time_state_candidate_v1")
   .select(selected.join(",")).eq("staff_id",scoped.userId).maybeSingle();
  if(result.error)return send({ok:false,error:"CURRENT_SHIFT_SOURCE_UNAVAILABLE"},503);
  // The original Staff identity must still own this team/city after the query.
  const latest=await getVerifiedScopedStaff(request.headers.get("authorization"));
  if(!latest||!same(scoped as unknown as Record<string,unknown>,
    latest as unknown as Record<string,unknown>))
   return send({ok:false,error:"STAFF_SCOPE_CHANGED"},403);
  const projection=projectVerifiedStaffTimeRow(result.data,{
   staffId:scoped.userId,teamId:scoped.teamId,cityId:scoped.cityId,
   serverNowMs:Date.now(),sourceVerified:true});
  if(projection.ok!==true)
   return send({ok:false,error:"CURRENT_SHIFT_INTEGRITY_UNVERIFIED"},503);
  return send(projection,200);
 }catch{return send({ok:false,error:"CURRENT_SHIFT_READ_UNAVAILABLE"},503);}
}
export function POST(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PUT(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function PATCH(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
export function DELETE(){return send({ok:false,error:"METHOD_NOT_ALLOWED"},405);}
